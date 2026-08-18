/**
 * Synchronous in-memory `PlatformSecureFs` fake for the transaction engine's
 * fault matrix. Host-independent, no root, no real filesystem: directories,
 * files, modes, and dev+ino identities live in Maps, and every failure branch
 * (identity drift, ACL refusal, exclusive-create EEXIST, write/fsync fault,
 * rename fault, ownership loss, capture refusal, post-commit hash drift) is a
 * declarative toggle. Used only by tests.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import type {
	CapturedFile,
	PlatformSecureFs,
	SecureDirHandle,
	SecureResult,
} from "../secure-fs-transaction.js";

interface FakeFile {
	bytes: Buffer;
	mode: number;
}

/** Per-call fault predicates; every one defaults to "no fault". */
export interface FakeFaults {
	/** Refuse revalidateIdentity for a path on its Nth (1-based) call. */
	revalidateRefuse?: (target: string, callIndex: number) => boolean;
	/** Refuse proveOwnershipAndMode for a path on its Nth call. */
	ownershipRefuse?: (dirPath: string, callIndex: number) => boolean;
	/** Refuse proveNoExtendedAcl for a path on its Nth call. */
	aclRefuse?: (target: string, callIndex: number) => boolean;
	/** Refuse captureFile for a path (simulate open/read failure). */
	captureRefuse?: (target: string) => boolean;
	/** Override the sha of a captured file (simulate post-commit drift). */
	captureShaOverride?: (target: string) => string | undefined;
	/** Refuse writeExclusive for a base name on its Nth call (EEXIST / fsync fault). */
	writeRefuse?: (name: string, callIndex: number) => boolean;
	/** Refuse renameInDir when the destination base name matches. */
	renameRefuse?: (to: string) => boolean;
	/**
	 * Refuse applyExactMode for a target (chmod fault). Lets a test drive the
	 * rollback's prior-mode restore into failure without touching the bytes.
	 */
	applyModeRefuse?: (target: string) => boolean;
	/**
	 * Refuse proveManagedContainer for a path on its Nth call (a foreign
	 * add/delete-child ACE on a managed container we own — the win32 CREATE_PARENT_DIR
	 * strictness that the lenient ancestor gate deliberately tolerates).
	 */
	managedContainerRefuse?: (dirPath: string, callIndex: number) => boolean;
	/**
	 * Make openDirNoFollow return a PRESENT-BUT-UNOPENABLE refusal (a reparse
	 * point/junction, EACCES, ENOTDIR, or transient) — a refusal with `notFound`
	 * absent, so ensureManagedContainer must fail closed, never skip (JDA6-001).
	 */
	openDirUnopenable?: (dirPath: string) => boolean;
}

export interface FakeSecureFs extends PlatformSecureFs {
	readonly dirs: Set<string>;
	readonly files: Map<string, FakeFile>;
	readonly dirModes: Map<string, number>;
	faults: FakeFaults;
	seedDir(dirPath: string): void;
	seedFile(filePath: string, bytes: Buffer, mode?: number): void;
	fileText(filePath: string): string | undefined;
	hasBackup(dirPath: string): boolean;
}

const ok = (): SecureResult<void> => ({ ok: true });
const okValue = <T>(value: T): SecureResult<T> => ({ ok: true, value });
const unsafe = <T>(detail: string): SecureResult<T> => ({
	ok: false,
	refusal: "unsafe-parent-chain",
	detail,
});
/** A GENUINE not-found refusal (the only state ensureManagedContainer may skip/create on). */
const notFound = <T>(detail: string): SecureResult<T> => ({
	ok: false,
	refusal: "unsafe-parent-chain",
	detail,
	notFound: true,
});

export function makeFakeSecureFs(): FakeSecureFs {
	const dirs = new Set<string>();
	const files = new Map<string, FakeFile>();
	const dirModes = new Map<string, number>();
	const inos = new Map<string, number>();
	let inoSeq = 100;
	const revalidateCounts = new Map<string, number>();
	const ownershipCounts = new Map<string, number>();
	const aclCounts = new Map<string, number>();
	const writeCounts = new Map<string, number>();
	const managedCounts = new Map<string, number>();

	const inoFor = (p: string): number => {
		let ino = inos.get(p);
		if (ino === undefined) {
			ino = inoSeq++;
			inos.set(p, ino);
		}
		return ino;
	};
	const bump = (m: Map<string, number>, key: string): number => {
		const next = (m.get(key) ?? 0) + 1;
		m.set(key, next);
		return next;
	};
	const handleFor = (p: string): SecureDirHandle => ({
		path: p,
		identity: { dev: 1, ino: inoFor(p) },
		close: async () => {},
	});
	const isEmptyDir = (p: string): boolean => {
		const prefix = `${p}/`;
		for (const f of files.keys()) if (f.startsWith(prefix)) return false;
		for (const d of dirs) if (d !== p && d.startsWith(prefix)) return false;
		return true;
	};

	const fake: FakeSecureFs = {
		dirs,
		files,
		dirModes,
		faults: {},

		seedDir(dirPath) {
			dirs.add(dirPath);
		},
		seedFile(filePath, bytes, mode = 0o644) {
			files.set(filePath, { bytes, mode });
		},
		fileText(filePath) {
			return files.get(filePath)?.bytes.toString("utf8");
		},
		hasBackup(dirPath) {
			const prefix = `${dirPath}/`;
			for (const f of files.keys()) {
				if (f.startsWith(prefix) && f.includes(".javi-forge.bak.")) return true;
			}
			return false;
		},

		async openDirNoFollow(dirPath) {
			if (fake.faults.openDirUnopenable?.(dirPath)) {
				// PRESENT-but-unopenable-no-follow: refusal WITHOUT notFound.
				return unsafe(`openDir unopenable ${dirPath}`);
			}
			if (!dirs.has(dirPath)) return notFound(`openDir enoent ${dirPath}`);
			return okValue<SecureDirHandle>(handleFor(dirPath));
		},

		async revalidateIdentity(target, held) {
			const idx = bump(revalidateCounts, target);
			if (fake.faults.revalidateRefuse?.(target, idx)) {
				return unsafe(`identity drift ${target}`);
			}
			if (!dirs.has(target) && !files.has(target)) {
				return unsafe(`identity missing ${target}`);
			}
			return inoFor(target) === held.ino
				? ok()
				: unsafe(`identity drift ${target}`);
		},

		async proveOwnershipAndMode(dirPath) {
			const idx = bump(ownershipCounts, dirPath);
			if (fake.faults.ownershipRefuse?.(dirPath, idx)) {
				return unsafe(`ownership ${dirPath}`);
			}
			return ok();
		},

		async proveNoExtendedAcl(target) {
			const idx = bump(aclCounts, target);
			if (fake.faults.aclRefuse?.(target, idx)) {
				return { ok: false, refusal: "unsupported-posix-acl", detail: target };
			}
			return ok();
		},

		async createDirExclusive(parent, name, mode) {
			const full = path.join(parent.path, name);
			if (dirs.has(full) || files.has(full)) return unsafe(`EEXIST ${full}`);
			dirs.add(full);
			dirModes.set(full, mode);
			return okValue<SecureDirHandle>(handleFor(full));
		},

		async captureFile(target) {
			if (fake.faults.captureRefuse?.(target))
				return unsafe(`capture ${target}`);
			const file = files.get(target);
			if (!file) return unsafe(`capture enoent ${target}`);
			const realSha = createHash("sha256").update(file.bytes).digest("hex");
			const sha256 = fake.faults.captureShaOverride?.(target) ?? realSha;
			return okValue<CapturedFile>({
				bytes: file.bytes,
				mode: file.mode,
				identity: { dev: 1, ino: inoFor(target) },
				sha256,
			});
		},

		async writeExclusive(dir, name, bytes, mode) {
			const idx = bump(writeCounts, name);
			if (fake.faults.writeRefuse?.(name, idx)) return unsafe(`write ${name}`);
			const full = path.join(dir.path, name);
			if (files.has(full)) return unsafe(`EEXIST ${full}`);
			files.set(full, { bytes, mode });
			return ok();
		},

		async applyExactMode(target, mode) {
			if (fake.faults.applyModeRefuse?.(target))
				return unsafe(`applyMode ${target}`);
			const file = files.get(target);
			if (!file) return unsafe(`applyMode enoent ${target}`);
			file.mode = mode;
			return ok();
		},

		async renameInDir(dir, from, to) {
			if (fake.faults.renameRefuse?.(to)) return unsafe(`rename ${to}`);
			const fromP = path.join(dir.path, from);
			const toP = path.join(dir.path, to);
			const file = files.get(fromP);
			if (!file) return unsafe(`rename enoent ${fromP}`);
			files.set(toP, file);
			files.delete(fromP);
			inos.delete(toP); // fresh identity for the renamed-in target
			return ok();
		},

		async unlinkIfIdentity(dir, name, _held) {
			const full = path.join(dir.path, name);
			if (!files.has(full)) return unsafe(`unlink enoent ${full}`);
			files.delete(full);
			return ok();
		},

		async rmdirIfIdentityEmpty(handle) {
			if (!dirs.has(handle.path)) return unsafe(`rmdir enoent ${handle.path}`);
			if (inoFor(handle.path) !== handle.identity.ino) {
				return unsafe(`rmdir identity ${handle.path}`);
			}
			if (!isEmptyDir(handle.path))
				return unsafe(`rmdir not-empty ${handle.path}`);
			dirs.delete(handle.path);
			return ok();
		},

		async proveManagedContainer(dirPath) {
			const idx = bump(managedCounts, dirPath);
			if (fake.faults.managedContainerRefuse?.(dirPath, idx)) {
				return {
					ok: false,
					refusal: "unsafe-windows-dacl",
					detail: `add-child ${dirPath}`,
				};
			}
			if (!dirs.has(dirPath)) return unsafe(`container enoent ${dirPath}`);
			return ok();
		},
	};

	return fake;
}
