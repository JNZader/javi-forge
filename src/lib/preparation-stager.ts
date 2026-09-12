import { createHash } from "node:crypto";
import {
	closeSync,
	constants as FS,
	fchmodSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	rmdirSync,
	rmSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUTPUTS, POLICY } from "./preparation-capability.js";

const DIR_FLAGS = FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW;
const FILE_FLAGS = FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW;
interface Identity {
	path: string;
	dev: number;
	ino: number;
}
function same(a: Identity, b: { dev: number; ino: number }) {
	return a.dev === b.dev && a.ino === b.ino;
}
function deny(): never {
	throw new Error("staging-denied");
}

/** Linux local-filesystem primitive. Root and effective UID are trusted, including
 * against concurrent mutation. Foreign-writable ancestors are refused, except a
 * root-owned sticky directory (e.g. /tmp) which cannot replace another UID's child.
 * Descriptor-relative operations use the kernel's /proc/self/fd directory handle.
 * A same-UID hostile process or compromised root is outside this trust boundary.
 */
export class ProtectedDirectory {
	readonly fd: number;
	readonly absolutePath: string;
	readonly #chain: Identity[] = [];
	#closed = false;
	constructor(directory: string) {
		let held: number | undefined;
		try {
			if (
				process.platform !== "linux" ||
				!process.geteuid ||
				!path.isAbsolute(directory) ||
				path.resolve(directory) !== directory
			)
				throw new Error();
			held = openSync("/", DIR_FLAGS);
			let absolute = "/";
			const components = directory.split("/").filter(Boolean);
			for (let i = 0; i <= components.length; i++) {
				const stat = fstatSync(held);
				const writableByForeign = (stat.mode & 0o022) !== 0;
				const stickyIntermediate =
					(stat.mode & 0o1000) !== 0 && i < components.length;
				const trusted =
					stat.uid === process.geteuid() ||
					!writableByForeign ||
					stickyIntermediate;
				if (
					!stat.isDirectory() ||
					!trusted ||
					(writableByForeign && !stickyIntermediate)
				)
					throw new Error();
				if (
					i === components.length &&
					(stat.uid !== process.geteuid() || (stat.mode & 0o777) !== 0o700)
				)
					throw new Error();
				this.#chain.push({ path: absolute, dev: stat.dev, ino: stat.ino });
				if (i < components.length) {
					const next = openSync(
						`/proc/self/fd/${held}/${components[i]}`,
						DIR_FLAGS,
					);
					closeSync(held);
					held = next;
					absolute = path.join(absolute, components[i]);
				}
			}
			this.fd = held;
			this.absolutePath = directory;
			this.assertCurrent();
		} catch {
			if (held !== undefined) closeSync(held);
			throw new Error("unsafe-directory");
		}
	}
	child(name: string) {
		if (this.#closed || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
			throw new Error("unsafe-directory");
		return `/proc/self/fd/${this.fd}/${name}`;
	}
	assertCurrent() {
		if (this.#closed) throw new Error("unsafe-directory");
		for (const entry of this.#chain) {
			const stat = lstatSync(entry.path);
			if (!stat.isDirectory() || stat.isSymbolicLink() || !same(entry, stat))
				throw new Error("unsafe-directory");
		}
		const stat = fstatSync(this.fd);
		if (stat.uid !== process.geteuid?.() || (stat.mode & 0o777) !== 0o700)
			throw new Error("unsafe-directory");
	}
	identity() {
		this.assertCurrent();
		const stat = fstatSync(this.fd);
		return createHash("sha256")
			.update(
				JSON.stringify({
					path: this.absolutePath,
					dev: stat.dev,
					ino: stat.ino,
					uid: stat.uid,
					mode: stat.mode,
				}),
			)
			.digest("hex");
	}
	close() {
		if (!this.#closed) {
			closeSync(this.fd);
			this.#closed = true;
		}
	}
}

/** Mechanism only, not an authorization endpoint. No caller code is interpreted.
 * Kept private: production routing remains unavailable until the isolated worker
 * exists. The fixture factory exercises this exact implementation at a fresh temp root.
 */
function stage(
	directory: ProtectedDirectory,
	input: Readonly<Record<string, string>>,
) {
	let held: number | undefined;
	let created: Identity | undefined;
	const files: Identity[] = [];
	try {
		const values = OUTPUTS.map((name) => {
			const descriptor = Object.getOwnPropertyDescriptor(input, name);
			if (
				!descriptor ||
				!("value" in descriptor) ||
				typeof descriptor.value !== "string"
			)
				deny();
			return [name, descriptor.value] as const;
		});
		if (
			Object.keys(input).sort().join("\0") !== [...OUTPUTS].sort().join("\0") ||
			values.reduce((total, [, value]) => total + Buffer.byteLength(value), 0) >
				POLICY.maxBytes
		)
			deny();
		directory.assertCurrent();
		const target = directory.child("attempt-3");
		mkdirSync(target, { mode: 0o700 });
		const stat = lstatSync(target);
		if (!stat.isDirectory() || stat.isSymbolicLink()) deny();
		created = { path: target, dev: stat.dev, ino: stat.ino };
		held = openSync(target, DIR_FLAGS);
		if (!same(created, fstatSync(held))) deny();
		fchmodSync(held, 0o700);
		for (const [name, value] of values) {
			const filePath = `/proc/self/fd/${held}/${name}`;
			const file = openSync(filePath, FILE_FLAGS, 0o600);
			try {
				const fileStat = fstatSync(file);
				files.push({ path: filePath, dev: fileStat.dev, ino: fileStat.ino });
				fchmodSync(file, 0o600);
				const bytes = Buffer.from(value);
				let offset = 0;
				while (offset < bytes.length) {
					const count = writeSync(file, bytes, offset, bytes.length - offset);
					if (count <= 0) deny();
					offset += count;
				}
				fsyncSync(file);
			} finally {
				closeSync(file);
			}
		}
		directory.assertCurrent();
		if (!same(created, lstatSync(target))) deny();
		fsyncSync(held);
		fsyncSync(directory.fd);
		return path.join(directory.absolutePath, "attempt-3");
	} catch {
		// Never recursively delete a replaced name or follow a replacement link.
		for (const file of files.reverse()) {
			try {
				if (same(file, lstatSync(file.path))) unlinkSync(file.path);
			} catch {
				/* Preserve unknown state. */
			}
		}
		if (created) {
			try {
				if (same(created, lstatSync(created.path))) rmdirSync(created.path);
			} catch {
				/* Preserve unknown state. */
			}
		}
		deny();
	} finally {
		if (held !== undefined) closeSync(held);
	}
}

/** Explicit test fixture surface, never a production destination override. It can
 * only stage into a newly-created random temporary directory; accepts no root path.
 */
export function createFixtureStager() {
	const root = mkdtempSync(path.join(os.tmpdir(), "preparation-stager-test-"));
	const directory = new ProtectedDirectory(root);
	return {
		root,
		stage: (outputs: Readonly<Record<string, string>>) =>
			stage(directory, outputs),
		dispose() {
			directory.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
