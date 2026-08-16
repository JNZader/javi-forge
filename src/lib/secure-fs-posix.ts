/**
 * POSIX `PlatformSecureFs` adapters for the SkillGuard transactional installer
 * (Slice 3a). This is the ONLY place a shell tool runs (`getfacl` on Linux,
 * `/bin/ls -lde` on macOS) and the ONLY place `os`/`fs` ownership bits are
 * interpreted. Everything fails closed: a missing/erroring/timed-out ACL tool,
 * an extended/named/mask/default/inherited ACL entry, a foreign-owned or
 * group/other-writable directory, or any inconclusive result refuses rather than
 * degrading to a weaker mode-only write. It never strips an ACL.
 */

import { execFile } from "node:child_process";
import type { SecureRefusal, SecureResult } from "./secure-fs-transaction.js";

/** Bounded time budget for a single ACL inspection. */
const ACL_TIMEOUT_MS = 2000;
/** Read budget for the ACL tool output (defensive; ACLs are tiny). */
const ACL_MAX_BUFFER = 1024 * 1024;

/** Outcome of a bounded, locale-C spawn of an ACL inspection tool. */
export interface SpawnOutcome {
	/** The executable could not be spawned (e.g. ENOENT). */
	spawnError?: boolean;
	/** The call exceeded the bounded timeout. */
	timedOut?: boolean;
	/** Exit code, or null when it never exited cleanly. */
	code: number | null;
	stdout: string;
}

export type SpawnFn = (cmd: string, args: string[]) => Promise<SpawnOutcome>;

/** The bounded ACL prover behind each platform adapter. */
export interface PosixAclAdapter {
	/** Run the bounded, LC_ALL=C ACL tool and decide clean|extended|inconclusive. */
	proveClean(target: string): Promise<SecureResult<void>>;
}

// --- result constructors -----------------------------------------------------

const ok = (): SecureResult<void> => ({ ok: true });
const refuse = <T>(
	refusal: SecureRefusal,
	detail: string,
): SecureResult<T> => ({
	ok: false,
	refusal,
	detail,
});

// --- default spawn (bounded, LC_ALL=C, argv never a shell string) ------------

const defaultSpawn: SpawnFn = (cmd, args) =>
	new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{
				timeout: ACL_TIMEOUT_MS,
				maxBuffer: ACL_MAX_BUFFER,
				encoding: "utf8",
				env: { ...process.env, LC_ALL: "C", LANG: "C" },
			},
			(error, stdout) => {
				if (!error) return resolve({ code: 0, stdout: stdout ?? "" });
				const e = error as NodeJS.ErrnoException & {
					killed?: boolean;
					signal?: NodeJS.Signals | null;
				};
				if (e.code === "ENOENT") {
					return resolve({ spawnError: true, code: null, stdout: "" });
				}
				if (e.killed || e.signal === "SIGTERM") {
					return resolve({ timedOut: true, code: null, stdout: stdout ?? "" });
				}
				const code = typeof e.code === "number" ? e.code : 1;
				return resolve({ code, stdout: stdout ?? "" });
			},
		);
	});

// --- Linux getfacl adapter (Algorithm D) -------------------------------------

const LINUX_BASE_ENTRY = /^(user|group|other)::/;

export function createLinuxAclAdapter(
	spawn: SpawnFn = defaultSpawn,
): PosixAclAdapter {
	return {
		async proveClean(target) {
			const res = await spawn("getfacl", [
				"--absolute-names",
				"--numeric",
				"--omit-header",
				"--",
				target,
			]);
			if (res.spawnError) {
				return refuse("unsupported-posix-acl", "getfacl absent");
			}
			if (res.timedOut)
				return refuse("unsupported-posix-acl", "getfacl timeout");
			if (res.code !== 0) {
				return refuse("unsupported-posix-acl", `getfacl exit ${res.code}`);
			}
			for (const raw of res.stdout.split("\n")) {
				const line = raw.trim();
				if (line === "" || line.startsWith("#")) continue;
				if (LINUX_BASE_ENTRY.test(line)) continue;
				return refuse("unsupported-posix-acl", "extended ACL entry");
			}
			return ok();
		},
	};
}

// --- macOS /bin/ls -lde adapter (Algorithm E) --------------------------------

const MACOS_ACE_LINE = /^\s*\d+:\s/;

export function createMacosAclAdapter(
	spawn: SpawnFn = defaultSpawn,
): PosixAclAdapter {
	return {
		async proveClean(target) {
			const res = await spawn("/bin/ls", ["-lde", "--", target]);
			if (res.spawnError) {
				return refuse("unsupported-posix-acl", "/bin/ls absent");
			}
			if (res.timedOut) return refuse("unsupported-posix-acl", "ls timeout");
			if (res.code !== 0) {
				return refuse("unsupported-posix-acl", `ls exit ${res.code}`);
			}
			const lines = res.stdout.split("\n");
			const modeLine = lines[0] ?? "";
			if (modeLine[10] === "+") {
				return refuse("unsupported-posix-acl", "ACL present (+ flag)");
			}
			if (lines.some((line) => MACOS_ACE_LINE.test(line))) {
				return refuse("unsupported-posix-acl", "ACE listed");
			}
			return ok();
		},
	};
}
