/**
 * Platform-agnostic transactional file-write core for the SkillGuard Claude
 * PreToolUse installer (Slice 3a). This module owns all irreversible I/O behind
 * a single `PlatformSecureFs` adapter interface: it NEVER spawns a process and
 * NEVER branches on `process.platform`. Every ownership/identity/ACL/exclusive
 * decision is delegated to the injected adapter, so the engine is reviewed once
 * (platform-free) and exercised by a synchronous in-memory fake in tests.
 *
 * WU-2 defines the interface + result types here so the POSIX adapter can
 * implement them; WU-3 grows this file with `runTransaction` + `TransactionDeps`.
 */

import { createHash } from "node:crypto";
import path from "node:path";

/** Identity of an opened directory/file, captured from its handle. */
export interface SecureIdentity {
	dev: number;
	ino: number;
	/**
	 * Full-precision, platform-opaque identity token. POSIX leaves this undefined
	 * (identity is `dev`+`ino`). win32 sets `"<volumeSerialHex>:<fileIdHex>"` and
	 * compares ONLY on this — an absent/zero token is a hard refusal there, never
	 * a fallback to the truncated `dev`/`ino` (Decision 1b). Additive: the core
	 * passes it back to the adapter opaquely and never interprets it.
	 */
	opaque?: string;
}

/** A held, no-follow directory handle plus its captured identity and path. */
export interface SecureDirHandle {
	readonly path: string;
	readonly identity: SecureIdentity;
	close(): Promise<void>;
}

/** Captured prior state of a target file, taken through the validated gate. */
export interface CapturedFile {
	bytes: Buffer;
	mode: number; // exact source mode, e.g. 0o600 / 0o644
	identity: SecureIdentity;
	sha256: string;
}

export type SecureRefusal =
	| "unsafe-parent-chain" // owner/mode/identity/handle proof failed
	| "unsupported-posix-acl" // ACL tool absent/parse/timeout/extended/changed
	| "unsafe-windows-dacl" // win32: foreign owner/path-endangering/add-child/NULL DACL
	| "windows-secure-object-unavailable"; // 3a Windows stub only

export interface SecureResult<T> {
	ok: boolean;
	value?: T;
	refusal?: SecureRefusal;
	detail?: string; // first offending path/capability, never secret content
	/**
	 * Set ONLY by `openDirNoFollow` on a refusal, and ONLY for a GENUINE
	 * not-found (POSIX ENOENT / win32 `ERROR_FILE_NOT_FOUND`|`ERROR_PATH_NOT_FOUND`).
	 * Every other refusal — a reparse point/junction, EACCES, ENOTDIR, a transient
	 * error, or any non-open proof — leaves this absent/false so a managed
	 * container that is PRESENT-but-unopenable fails the transaction closed rather
	 * than being silently skipped (Round-6 / JDA6-001). Additive.
	 */
	notFound?: boolean;
}

/**
 * The whole platform boundary. Every host-dependent operation is a method here;
 * the transaction core talks only to this interface. POSIX now, Windows stub in
 * Slice 3b, a synchronous fake in tests.
 */
export interface PlatformSecureFs {
	/** Open an existing directory no-follow (O_DIRECTORY|O_NOFOLLOW) and capture dev+ino. */
	openDirNoFollow(dirPath: string): Promise<SecureResult<SecureDirHandle>>;

	/** Reopen a path and confirm its identity equals a previously held one. */
	revalidateIdentity(
		target: string,
		held: SecureIdentity,
	): Promise<SecureResult<void>>;

	/** Prove owner == effective uid or root AND no group/other write bits. */
	proveOwnershipAndMode(dirPath: string): Promise<SecureResult<void>>;

	/** Prove no extended/named/mask/default/inherited ACL on the path. */
	proveNoExtendedAcl(target: string): Promise<SecureResult<void>>;

	/** Create ONE child directory exclusively at mode, reopen+verify, return its handle. */
	createDirExclusive(
		parent: SecureDirHandle,
		name: string,
		mode: number,
	): Promise<SecureResult<SecureDirHandle>>;

	/**
	 * Capture a regular file's bytes+mode+identity+sha through the validated gate.
	 * MUST open the target with `O_NOFOLLOW|O_RDONLY` (never a plain path read): a
	 * symlink swapped in at the target name must fail the open, not be
	 * dereferenced. This is a security boundary (JD-B-003) — the capture is the
	 * source of both the persistent backup and the in-memory rollback bytes.
	 */
	captureFile(target: string): Promise<SecureResult<CapturedFile>>;

	/**
	 * Create <name> in dir with O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW at mode; write
	 * bytes; `handle.sync()` (fsync) the file before close. The write and the
	 * fsync are one method so an fsync fault is an injectable fault point of
	 * `writeExclusive` itself (JD-B-004): a fake can succeed the write and fail
	 * the sync to drive that branch.
	 */
	writeExclusive(
		dir: SecureDirHandle,
		name: string,
		bytes: Buffer,
		mode: number,
	): Promise<SecureResult<void>>;

	/** Apply an exact mode to an existing staged file and re-verify mode + ACL absence. */
	applyExactMode(target: string, mode: number): Promise<SecureResult<void>>;

	/** Same-directory rename from -> to, then fsync the directory. */
	renameInDir(
		dir: SecureDirHandle,
		from: string,
		to: string,
	): Promise<SecureResult<void>>;

	/** Unlink an identity-matched file (rollback of a newly created target). */
	unlinkIfIdentity(
		dir: SecureDirHandle,
		name: string,
		held: SecureIdentity,
	): Promise<SecureResult<void>>;

	/** Remove an identity-matched EMPTY directory (rollback of a created segment). */
	rmdirIfIdentityEmpty(handle: SecureDirHandle): Promise<SecureResult<void>>;

	/**
	 * Prove a directory the tool OWNS as a MANAGED CONTAINER (`.claude`,
	 * `.claude/hooks`): refuse ALL foreign add/delete-child rights — strictly more
	 * than the lenient ancestor `gate()`, which tolerates harmless add-child on
	 * high traversal ancestors (Round-4 / JDA-401). The core calls this ONLY on the
	 * dirs it constructs, expressing the managed-container role by WHICH method it
	 * invokes — no `process.platform` ever enters the engine. POSIX delegates to its
	 * existing strict ownership/mode check (group/other write IS add-child on a
	 * directory), so POSIX behavior is unchanged; the seam has teeth only on win32.
	 */
	proveManagedContainer(dirPath: string): Promise<SecureResult<void>>;
}

// ---------------------------------------------------------------------------
// Transaction engine (WU-3)
// ---------------------------------------------------------------------------

/** Injected seams making the engine deterministic and host-independent. */
export interface TransactionDeps {
	secureFs: PlatformSecureFs;
	clock: () => Date; // backup/temp timestamp
	nonce: () => string; // 8 lowercase hex
}

/**
 * One target of the transaction (asset or settings). All Claude-specific state
 * is collapsed to explicit flags so the engine stays agent-agnostic.
 */
export interface TransactionComponent {
	/** Absolute target path. */
	path: string;
	/** Bytes to write, or null to skip this component (no-op / already current). */
	desired: Buffer | null;
	/** Capture prior bytes for in-memory rollback (existing managed/legacy content). */
	capturePrior: boolean;
	/** Create a persistent backup — forced edited-managed only (Decision 5). */
	forceBackup: boolean;
	/** True when the target did not exist before this op (rollback = unlink). */
	wasAbsent: boolean;
}

export interface RunTransactionInput extends TransactionDeps {
	/** Existing project directory; `.claude` / `.claude/hooks` are created under it. */
	projectDir: string;
	/** Committed first. */
	asset: TransactionComponent;
	/** Committed second. */
	settings: TransactionComponent;
}

export interface TransactionOutcome {
	ok: boolean;
	committed: string[]; // target paths renamed, in commit order
	backups: string[]; // persistent backup paths (forced ops only)
	errors: string[]; // includes STOP-for-manual-recovery guidance
}

/** Bounded nonce retries for an exclusive backup create. */
const BACKUP_NONCE_CANDIDATES = 8;

class TxAbort extends Error {
	constructor(
		readonly step: string,
		readonly detail?: string,
	) {
		super(`${step}${detail ? `: ${detail}` : ""}`);
	}
}

function must<T>(step: string, res: SecureResult<T>): T {
	if (!res.ok) throw new TxAbort(step, res.detail ?? res.refusal);
	return res.value as T;
}

function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Compact ISO-ms stamp: 2026-08-16T19:00:00.123Z -> 20260816T190000123Z. */
function timestamp(clock: () => Date): string {
	return clock().toISOString().replace(/[-:.]/g, "");
}

function backupName(base: string, clock: () => Date, nonce: string): string {
	return `${base}.javi-forge.bak.${timestamp(clock)}.${nonce}`;
}

function tempName(base: string, nonce: string): string {
	return `${base}.javi-forge.tmp.${process.pid}.${nonce}`;
}

/** Existing directory chain from the filesystem root through `leaf`, root first. */
function ancestorChain(leaf: string): string[] {
	const chain: string[] = [];
	let current = leaf;
	while (true) {
		chain.push(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return chain.reverse();
}

interface StagedEntry {
	dir: SecureDirHandle;
	tempName: string;
	target: TransactionComponent;
	prior: CapturedFile | null;
}

interface CommittedEntry {
	path: string;
	dir: SecureDirHandle;
	wroteHash: string;
	wasAbsent: boolean;
	prior: CapturedFile | null;
}

/**
 * Run the staged, two-target transaction. Preflight gates the private parent
 * chain, creates `.claude`/`.claude/hooks` one exclusive `0o700` segment at a
 * time, captures prior bytes (+ a forced-only persistent backup), stages each
 * new byte set into a same-directory `0o600` temp, re-proves the full gate
 * immediately before the first rename (JD-007), then commits asset-first and
 * settings-second via same-directory rename + parent fsync. A failure after a
 * commit triggers guarded reverse-order rollback from the in-memory captured
 * bytes; lost proof or a post-write hash drift STOPS cleanup and returns
 * manual-recovery guidance (never clobbers a concurrent change).
 */
export async function runTransaction(
	input: RunTransactionInput,
): Promise<TransactionOutcome> {
	const { secureFs, clock, nonce, projectDir } = input;
	const claudeDir = path.join(projectDir, ".claude");
	const hooksDir = path.join(claudeDir, "hooks");
	// The dirs the tool OWNS: their children include the executed asset and the
	// settings it is referenced from. Fixed and known to the core regardless of
	// the per-run write plan; each existing member is proved on EVERY anyWrite run
	// (Round-4/5 / JDA-401 + JDB5-001).
	const managedContainers = new Set<string>([claudeDir, hooksDir]);

	const heldByPath = new Map<string, SecureDirHandle>();
	const heldOrder: SecureDirHandle[] = [];
	const createdDirs: SecureDirHandle[] = [];
	const staged: StagedEntry[] = [];
	const committed: CommittedEntry[] = [];
	const backups: string[] = [];

	const needsWrite = (c: TransactionComponent): boolean => c.desired !== null;
	const anyWrite = needsWrite(input.asset) || needsWrite(input.settings);

	async function gate(dirPath: string, handle: SecureDirHandle): Promise<void> {
		must(`ownership ${dirPath}`, await secureFs.proveOwnershipAndMode(dirPath));
		must(`acl ${dirPath}`, await secureFs.proveNoExtendedAcl(dirPath));
		heldByPath.set(dirPath, handle);
		heldOrder.push(handle);
	}

	/**
	 * Ensure a MANAGED CONTAINER (`.claude`/`.claude/hooks`): an existing one is
	 * ALWAYS gated + proveManagedContainer'd (→ heldOrder → re-proved pre-commit);
	 * an absent one is created Predicate-B strict ONLY when `createIfAbsent` (a
	 * child is written into it this run), else left alone. Four fail-closed
	 * branches (Round-4/5/6 / JDA-401 + JDB5-001 + JDA6-001):
	 *   (1) present + openable    → gate + proveManagedContainer, return handle
	 *   (2) notFound + create     → createDirExclusive + gate + proveManagedContainer
	 *   (3) notFound + !create    → return null (nothing to secure)
	 *   (4) any non-notFound !ok  → FAIL CLOSED explicitly (present-but-unopenable:
	 *                               junction/reparse/EACCES) regardless of create.
	 */
	async function ensureManagedContainer(
		parent: SecureDirHandle,
		fullPath: string,
		createIfAbsent: boolean,
	): Promise<SecureDirHandle | null> {
		const opened = await secureFs.openDirNoFollow(fullPath);
		// (1) PRESENT + openable no-follow.
		if (opened.ok && opened.value) {
			await gate(fullPath, opened.value);
			must(
				`container ${fullPath}`,
				await secureFs.proveManagedContainer(fullPath),
			);
			return opened.value;
		}
		// (4) ANY non-notFound refusal → fail the whole transaction closed,
		// regardless of createIfAbsent. Refuse EXPLICITLY (JDB7-002): do not rely
		// on a later must() throwing — propagate the refusal here so a
		// present-but-unopenable managed container is never silently skipped.
		if (!opened.notFound) {
			throw new TxAbort(
				`container ${fullPath}`,
				opened.detail ?? opened.refusal ?? "present-but-unopenable",
			);
		}
		// GENUINELY ABSENT (notFound === true) — the ONLY safe skip/create path.
		// (3) absent + no child written this run → nothing to secure.
		if (!createIfAbsent) return null;
		// (2) absent + a child IS written into it this run → create + prove.
		const created = must(
			`create ${fullPath}`,
			await secureFs.createDirExclusive(parent, path.basename(fullPath), 0o700),
		);
		// Post-create identity revalidation + full gate on the new segment.
		must(
			`revalidate-created ${fullPath}`,
			await secureFs.revalidateIdentity(fullPath, created.identity),
		);
		createdDirs.push(created);
		await gate(fullPath, created);
		must(
			`container ${fullPath}`,
			await secureFs.proveManagedContainer(fullPath),
		);
		return created;
	}

	async function gateStillValid(): Promise<boolean> {
		for (const handle of heldOrder) {
			const id = await secureFs.revalidateIdentity(
				handle.path,
				handle.identity,
			);
			if (!id.ok) return false;
			if (!(await secureFs.proveOwnershipAndMode(handle.path)).ok) return false;
			if (!(await secureFs.proveNoExtendedAcl(handle.path)).ok) return false;
			// Re-check the container add/delete-child dimension on the rollback path
			// too, for full symmetry with the pre-commit re-prove (JDB5-002).
			if (managedContainers.has(handle.path)) {
				if (!(await secureFs.proveManagedContainer(handle.path)).ok) {
					return false;
				}
			}
		}
		return true;
	}

	try {
		// --- PREFLIGHT: gate the existing chain root..projectDir ---
		for (const dirPath of ancestorChain(projectDir)) {
			const handle = must(
				`openDir ${dirPath}`,
				await secureFs.openDirNoFollow(dirPath),
			);
			await gate(dirPath, handle);
		}

		// --- SEGMENT CREATION + MANAGED-CONTAINER PROOF ---
		// Prove the COMPLETE managed set {claudeDir, hooksDir} on every anyWrite run,
		// decoupled from which child is written. A managed container that EXISTS is
		// always gate()d + proveManagedContainer'd (→ heldOrder → re-proved
		// pre-commit); one that is absent is CREATED only when a child is written
		// into it this run, else left alone (nothing to secure).
		if (anyWrite) {
			const projectHandle = heldByPath.get(projectDir) as SecureDirHandle;
			// .claude always ensured on anyWrite (holds settings; grandparent of
			// the asset). createIfAbsent=true never returns null (opens, creates, or
			// throws) → narrow non-null before passing as parent (JDA6-003).
			const claudeHandle = await ensureManagedContainer(
				projectHandle,
				claudeDir,
				/* createIfAbsent */ true,
			);
			if (!claudeHandle) {
				throw new TxAbort(`container ${claudeDir}`, "unexpected null handle");
			}
			// .claude/hooks: create when the asset writes into it; otherwise prove
			// IF it exists (settings-only repair must still secure the hook's
			// container — JDB5-001).
			await ensureManagedContainer(
				claudeHandle,
				hooksDir,
				/* createIfAbsent */ needsWrite(input.asset),
			);
		}

		// --- CAPTURE + (FORCED) BACKUP + STAGE, asset then settings ---
		for (const component of [input.asset, input.settings]) {
			if (!needsWrite(component)) continue;
			const parentPath = path.dirname(component.path);
			const dir = heldByPath.get(parentPath) as SecureDirHandle;
			const base = path.basename(component.path);
			must(
				`revalidate ${parentPath}`,
				await secureFs.revalidateIdentity(dir.path, dir.identity),
			);

			let prior: CapturedFile | null = null;
			if (component.capturePrior || component.forceBackup) {
				prior = must(
					`capture ${component.path}`,
					await secureFs.captureFile(component.path),
				);
				must(
					`source-acl ${component.path}`,
					await secureFs.proveNoExtendedAcl(component.path),
				);
				if (component.forceBackup) {
					backups.push(await writeBackup(dir, base, prior));
				}
			}

			const tName = tempName(base, nonce());
			must(
				`stage ${tName}`,
				await secureFs.writeExclusive(
					dir,
					tName,
					component.desired as Buffer,
					0o600,
				),
			);
			must(
				`stage-mode ${tName}`,
				await secureFs.applyExactMode(
					path.join(dir.path, tName),
					prior ? prior.mode : 0o600,
				),
			);
			// Identity revalidation after each writeExclusive (JD-B-005).
			must(
				`revalidate-staged ${parentPath}`,
				await secureFs.revalidateIdentity(dir.path, dir.identity),
			);
			staged.push({ dir, tempName: tName, target: component, prior });
		}

		// --- PRE-FIRST-RENAME FULL-GATE RE-PROVE (JD-007) ---
		for (const handle of heldOrder) {
			must(
				`recheck-id ${handle.path}`,
				await secureFs.revalidateIdentity(handle.path, handle.identity),
			);
			must(
				`recheck-own ${handle.path}`,
				await secureFs.proveOwnershipAndMode(handle.path),
			);
			must(
				`recheck-acl ${handle.path}`,
				await secureFs.proveNoExtendedAcl(handle.path),
			);
			// Re-prove the managed-container add/delete-child dimension for held
			// handles that ARE managed containers, closing the TOCTOU window between
			// ensure time and commit (JDB7-003; parity with 3a Decision 6 / JD-007).
			if (managedContainers.has(handle.path)) {
				must(
					`recheck-container ${handle.path}`,
					await secureFs.proveManagedContainer(handle.path),
				);
			}
		}

		// --- COMMIT: asset first, settings second ---
		for (const entry of staged) {
			const base = path.basename(entry.target.path);
			must(
				`pre-rename ${entry.dir.path}`,
				await secureFs.revalidateIdentity(entry.dir.path, entry.dir.identity),
			);
			const wroteHash = sha256(entry.target.desired as Buffer);
			must(
				`rename ${base}`,
				await secureFs.renameInDir(entry.dir, entry.tempName, base),
			);
			must(
				`post-rename ${entry.dir.path}`,
				await secureFs.revalidateIdentity(entry.dir.path, entry.dir.identity),
			);
			committed.push({
				path: entry.target.path,
				dir: entry.dir,
				wroteHash,
				wasAbsent: entry.target.wasAbsent,
				prior: entry.prior,
			});
		}

		return {
			ok: true,
			committed: committed.map((c) => c.path),
			backups,
			errors: [],
		};
	} catch (error) {
		const errors: string[] = [
			error instanceof TxAbort ? error.message : String(error),
		];
		await rollback(committed, createdDirs, errors);
		return {
			ok: false,
			committed: committed.map((c) => c.path),
			backups,
			errors,
		};
	} finally {
		for (const handle of [...createdDirs, ...heldOrder]) {
			await handle.close().catch(() => {});
		}
	}

	async function writeBackup(
		dir: SecureDirHandle,
		base: string,
		prior: CapturedFile,
	): Promise<string> {
		for (let attempt = 0; attempt < BACKUP_NONCE_CANDIDATES; attempt++) {
			const name = backupName(base, clock, nonce());
			const written = await secureFs.writeExclusive(
				dir,
				name,
				prior.bytes,
				0o600,
			);
			if (!written.ok) continue; // collision or transient — retry with a fresh nonce
			must(
				`backup-mode ${name}`,
				await secureFs.applyExactMode(path.join(dir.path, name), prior.mode),
			);
			must(
				`backup-revalidate ${dir.path}`,
				await secureFs.revalidateIdentity(dir.path, dir.identity),
			);
			return path.join(dir.path, name);
		}
		throw new TxAbort(
			"backup",
			`no exclusive backup name after ${BACKUP_NONCE_CANDIDATES}`,
		);
	}

	async function rollback(
		done: CommittedEntry[],
		created: SecureDirHandle[],
		errors: string[],
	): Promise<void> {
		for (const entry of [...done].reverse()) {
			if (!(await gateStillValid())) {
				errors.push(
					`STOP: lost parent-chain proof; manual recovery at ${entry.path}`,
				);
				return;
			}
			const current = await secureFs.captureFile(entry.path);
			if (!current.ok || !current.value) {
				errors.push(`STOP: cannot re-read ${entry.path}; manual recovery`);
				return;
			}
			if (current.value.sha256 !== entry.wroteHash) {
				errors.push(
					`STOP: ${entry.path} changed after commit; manual recovery (concurrent edit)`,
				);
				return;
			}
			const base = path.basename(entry.path);
			if (entry.wasAbsent) {
				await secureFs.unlinkIfIdentity(
					entry.dir,
					base,
					current.value.identity,
				);
			} else if (entry.prior) {
				const rName = tempName(base, nonce());
				const wrote = await secureFs.writeExclusive(
					entry.dir,
					rName,
					entry.prior.bytes,
					0o600,
				);
				if (!wrote.ok) {
					errors.push(`STOP: cannot stage rollback for ${entry.path}`);
					return;
				}
				// Prior-mode restore is BEST-EFFORT (JD-B-003): a chmod miss fails
				// toward MORE restrictive perms (the 0600 staging mode), so it is not
				// a security regression and must not halt the rollback — restoring the
				// prior BYTES matters more than the prior mode. Record an
				// INFORMATIONAL note (never `STOP:`, which signals a halted rollback)
				// and continue to the rename.
				const remoded = await secureFs.applyExactMode(
					path.join(entry.dir.path, rName),
					entry.prior.mode,
				);
				if (!remoded.ok) {
					errors.push(
						`note: restored ${entry.path}; prior-mode restore failed, verify permissions (${remoded.detail ?? remoded.refusal ?? "unknown"})`,
					);
				}
				const restored = await secureFs.renameInDir(entry.dir, rName, base);
				if (!restored.ok) {
					errors.push(
						`STOP: cannot restore ${entry.path}; prior payload staged at ${path.join(entry.dir.path, rName)} for manual recovery`,
					);
					return;
				}
			}
		}
		// Remove only tx-created, identity-matched, still-empty segments, child-first.
		for (const handle of [...created].reverse()) {
			await secureFs.rmdirIfIdentityEmpty(handle);
		}
	}
}
