import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	constants as FS,
	fstatSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApprovalAuthority } from "./preparation-authorization.js";
import { bindPreparation, OUTPUTS, POLICY } from "./preparation-capability.js";
import { ProtectedDirectory } from "./preparation-stager.js";

interface WorkerConfig {
	executable: string;
	executableDigest: string;
	source: string;
	sourceDigest: string;
	launcher: string;
	launcherDigest: string;
}
export interface CapturedWorker {
	readonly executableDigest: string;
	readonly codeDigest: string;
	readonly dependenciesDigest: string;
	readonly launcherDigest: string;
}
interface WorkerBytes {
	executable: Buffer;
	launcher: string;
}
interface Identity {
	dev: number;
	ino: number;
}
export interface PreparationRuntimeLimits {
	overallMs: number;
	testsMs: number;
}
interface PreparationRuntimeBinding {
	readonly binding: string;
	readonly identities: Readonly<{ destination: string }>;
	readonly outputs: Readonly<Record<string, string>>;
}
const snapshots = new WeakMap<CapturedWorker, WorkerBytes>();
const hash = (data: Buffer | string) =>
	createHash("sha256").update(data).digest("hex");
const PREPARATION_RUNTIME_REASON = {
	RUNTIME_UNAVAILABLE: "runtime-unavailable",
	WORKER_EXECUTABLE_UNAVAILABLE: "worker-executable-unavailable",
	WORKER_SOURCE_UNAVAILABLE: "worker-source-unavailable",
	WORKER_EXECUTABLE_UNSUPPORTED: "worker-executable-unsupported",
	LAUNCHER_UNAVAILABLE: "launcher-unavailable",
} as const;
type PreparationRuntimeReason =
	(typeof PREPARATION_RUNTIME_REASON)[keyof typeof PREPARATION_RUNTIME_REASON];
const RUNTIME_REASONS = new Set<string>(
	Object.values(PREPARATION_RUNTIME_REASON),
);
const denied = (
	reason: PreparationRuntimeReason = PREPARATION_RUNTIME_REASON.RUNTIME_UNAVAILABLE,
) => new Error(reason);
function ensure(valid: boolean) {
	if (!valid) throw denied();
}
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
function capture(
	file: string,
	expected: string,
	reason: PreparationRuntimeReason,
	rootOwned = false,
) {
	const fd = openSync(file, FS.O_RDONLY | FS.O_NOFOLLOW);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.size > 4194304 ||
			stat.size < 1 ||
			(rootOwned && (stat.uid !== 0 || stat.mode & 0o022))
		)
			throw denied(reason);
		const bytes = readFileSync(fd);
		if (!/^[a-f0-9]{64}$/.test(expected) || hash(bytes) !== expected)
			throw denied(reason);
		return bytes;
	} finally {
		closeSync(fd);
	}
}
function preserveRuntimeReason(error: unknown): never {
	if (error instanceof Error && RUNTIME_REASONS.has(error.message)) throw error;
	throw denied();
}
/** Explicit operator build pins; no discovery/download/build or approval issuance.
 * The compiler/toolchain provenance of the pinned binary is an operator trust input.
 * ELF64 x86-64 with no interpreter/dynamic segment has no external worker libraries.
 */
export function captureWorker(config: WorkerConfig): CapturedWorker {
	try {
		if (process.platform !== "linux" || process.arch !== "x64") throw denied();
		const bytes = capture(
			config.executable,
			config.executableDigest,
			PREPARATION_RUNTIME_REASON.WORKER_EXECUTABLE_UNAVAILABLE,
		);
		capture(
			config.source,
			config.sourceDigest,
			PREPARATION_RUNTIME_REASON.WORKER_SOURCE_UNAVAILABLE,
		);
		capture(
			config.launcher,
			config.launcherDigest,
			PREPARATION_RUNTIME_REASON.LAUNCHER_UNAVAILABLE,
			true,
		);
		if (
			bytes.length < 64 ||
			bytes.subarray(0, 6).toString("hex") !== "7f454c460201" ||
			bytes.readUInt16LE(18) !== 62
		)
			throw denied(PREPARATION_RUNTIME_REASON.WORKER_EXECUTABLE_UNSUPPORTED);
		const start = Number(bytes.readBigUInt64LE(32)),
			size = bytes.readUInt16LE(54),
			count = bytes.readUInt16LE(56);
		if (
			!Number.isSafeInteger(start) ||
			size !== 56 ||
			!count ||
			count > 1024 ||
			start + size * count > bytes.length
		)
			throw denied(PREPARATION_RUNTIME_REASON.WORKER_EXECUTABLE_UNSUPPORTED);
		for (let i = 0; i < count; i++)
			if ([2, 3].includes(bytes.readUInt32LE(start + i * size)))
				throw denied(PREPARATION_RUNTIME_REASON.WORKER_EXECUTABLE_UNSUPPORTED);
		const captured = Object.freeze({
			executableDigest: hash(bytes),
			codeDigest: config.sourceDigest,
			dependenciesDigest: hash("[]"),
			launcherDigest: config.launcherDigest,
		});
		snapshots.set(captured, { executable: bytes, launcher: config.launcher });
		return captured;
	} catch (error) {
		preserveRuntimeReason(error);
	}
}
const FIXED_ARGS = [
	"--unshare-all",
	"--die-with-parent",
	"--cap-drop",
	"ALL",
	"--clearenv",
	"--bind-fd",
	"4",
	"/out",
	"--perms",
	"0500",
	"--ro-bind-data",
	"5",
	"/worker",
	"--perms",
	"0400",
	"--ro-bind-data",
	"6",
	"/identity",
	"--dir",
	"/payload",
];

export function bindPreparationRuntime(
	worker: CapturedWorker,
	outputs: Readonly<Record<string, string>>,
	directory: ProtectedDirectory,
	limits: PreparationRuntimeLimits,
	fixture: boolean,
): PreparationRuntimeBinding {
	return bindPreparation({
		cwd: POLICY.cwd,
		destination: POLICY.destination,
		entrypoint: POLICY.entrypoint,
		args: [],
		env: {},
		stdin: "",
		importPaths: [],
		outputs,
		identities: {
			code: worker.codeDigest,
			dependencies: worker.dependenciesDigest,
			executable: worker.executableDigest,
			config: hash(
				JSON.stringify({
					args: FIXED_ARGS,
					policy: POLICY,
					limits,
					launcher: worker.launcherDigest,
					protocol: 1,
					fixture,
				}),
			),
			destination: directory.identity(),
		},
	});
}

function executor(
	worker: CapturedWorker,
	outputs: Readonly<Record<string, string>>,
	directory: ProtectedDirectory,
	limits: PreparationRuntimeLimits,
	fixture: boolean,
) {
	const bytes = snapshots.get(worker);
	if (!bytes) throw denied();
	const binding = bindPreparationRuntime(
		worker,
		outputs,
		directory,
		limits,
		fixture,
	);
	let attempted = false;
	return {
		binding: binding.binding,
		async execute(authority: ApprovalAuthority, evidence: string) {
			const audit: string[] = [];
			const fds: number[] = [];
			let temp: string | undefined;
			let child: ChildProcess | undefined;
			let recordedDir: Identity | undefined;
			const records = new Map<number, Identity>();
			let complete = false;
			let preserved = false;
			const started = performance.now();
			try {
				if (attempted || !(authority instanceof ApprovalAuthority))
					throw denied();
				directory.assertCurrent();
				if (directory.identity() !== binding.identities.destination)
					throw denied();
				const approval = authority.verify(
					evidence,
					binding.binding,
					Date.now(),
				);
				attempted = true;
				// Runtime readiness must fail before consume if the trusted launcher changed.
				capture(
					bytes.launcher,
					worker.launcherDigest,
					PREPARATION_RUNTIME_REASON.LAUNCHER_UNAVAILABLE,
					true,
				);
				temp = mkdtempSync(path.join(os.tmpdir(), "preparation-runtime-"));
				const snapshotFd = (content: Buffer) => {
					const file = path.join(temp as string, String(fds.length));
					writeFileSync(file, content, { flag: "wx", mode: 0o400 });
					const fd = openSync(file, FS.O_RDONLY | FS.O_NOFOLLOW);
					unlinkSync(file);
					fds.push(fd);
					return fd;
				};
				const launcher = openSync(bytes.launcher, FS.O_RDONLY | FS.O_NOFOLLOW);
				fds.push(launcher);
				// Use this held descriptor for both verification and exec; never hash then reopen.
				if (
					hash(readFileSync(launcher)) !== worker.launcherDigest ||
					fstatSync(launcher).uid !== 0
				)
					throw denied();
				const stat = fstatSync(directory.fd);
				const runtimeFd = snapshotFd(bytes.executable);
				const identityFd = snapshotFd(Buffer.from(`${stat.dev} ${stat.ino}`));
				const inputs = OUTPUTS.map((name) =>
					snapshotFd(Buffer.from(binding.outputs[name])),
				);
				const args = [...FIXED_ARGS];
				for (const [index, name] of OUTPUTS.entries()) {
					args.push(
						"--perms",
						"0400",
						"--ro-bind-data",
						String(7 + index),
						`/payload/${name}`,
					);
				}
				args.push("--remount-ro", "/", "--chdir", "/", "--", "/worker");
				if (performance.now() - started >= limits.overallMs) throw denied();
				let timer: ReturnType<typeof setTimeout> | undefined;
				let testTimer: ReturnType<typeof setTimeout> | undefined;
				let ready = false,
					validated = false,
					done = false,
					closed = false,
					aborted = false,
					output = "";
				let outputBytes = 0;
				child = spawn("/proc/self/fd/3", args, {
					env: {},
					cwd: "/",
					detached: true,
					stdio: [
						"pipe",
						"pipe",
						"pipe",
						launcher,
						directory.fd,
						runtimeFd,
						identityFd,
						...inputs,
					],
				});
				const running = child;
				const kill = () => {
					aborted = true;
					if (!closed && running.pid) {
						try {
							process.kill(-running.pid, "SIGKILL");
						} catch {
							running.kill("SIGKILL");
						}
					}
				};
				try {
					const outcome = new Promise<boolean>((resolve) => {
						running.once("error", () => {
							closed = true;
							resolve(false);
						});
						running.once("close", (code) => {
							closed = true;
							if (code !== 0) audit.push(`worker-exit-${code ?? "signal"}`);
							resolve(
								!aborted &&
									code === 0 &&
									ready &&
									validated &&
									done &&
									records.size === 6,
							);
						});
						running.stdin?.on("error", kill);
						running.stderr?.on("data", (chunk: Buffer) => {
							outputBytes += chunk.length;
							if (outputBytes > 2048) kill();
						});
						running.stdout?.on("data", (chunk: Buffer) => {
							if (aborted) return;
							outputBytes += chunk.length;
							if (outputBytes > 2048) {
								kill();
								return;
							}
							output += chunk.toString("ascii");
							while (output.includes("\n")) {
								const newline = output.indexOf("\n");
								if (aborted) break;
								const line = output.slice(0, newline);
								output = output.slice(newline + 1);
								try {
									if (line === "READY" && !ready) {
										directory.assertCurrent();
										if (
											directory.identity() !== binding.identities.destination ||
											performance.now() - started >= limits.overallMs
										)
											throw denied();
										audit.push("ready");
										authority.consume(approval, Date.now());
										ready = true;
										audit.push("consumed");
										testTimer = setTimeout(kill, limits.testsMs);
										running.stdin?.end("G");
									} else if (line === "VALID" && ready && !validated) {
										validated = true;
										clearTimeout(testTimer);
										audit.push("validated");
									} else if (
										/^DIR \d+ \d+$/.test(line) &&
										validated &&
										!recordedDir
									) {
										const [, dev, ino] = line.split(" ");
										recordedDir = { dev: Number(dev), ino: Number(ino) };
									} else if (/^FILE [0-5] \d+ \d+$/.test(line) && recordedDir) {
										const [, index, dev, ino] = line.split(" ");
										if (records.has(Number(index))) throw denied();
										records.set(Number(index), {
											dev: Number(dev),
											ino: Number(ino),
										});
									} else if (line === "DONE" && records.size === 6 && !done)
										done = true;
									else throw denied();
								} catch {
									kill();
								}
							}
						});
					});
					timer = setTimeout(
						kill,
						Math.max(1, limits.overallMs - (performance.now() - started)),
					);
					if (
						!(await outcome) ||
						output.length ||
						performance.now() - started > limits.overallMs
					)
						throw denied();
				} finally {
					clearTimeout(timer);
					clearTimeout(testTimer);
				}
				directory.assertCurrent();
				const target = directory.child("attempt-3");
				const dir = openSync(
					target,
					FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW,
				);
				try {
					if (
						!recordedDir ||
						!same(recordedDir, fstatSync(dir)) ||
						(fstatSync(dir).mode & 0o777) !== 0o700 ||
						readdirSync(`/proc/self/fd/${dir}`).length !== 6
					)
						throw denied();
					for (let i = 0; i < 6; i++) {
						const file = openSync(
							`/proc/self/fd/${dir}/${OUTPUTS[i]}`,
							FS.O_RDONLY | FS.O_NOFOLLOW,
						);
						try {
							const fileStat = fstatSync(file);
							const recorded = records.get(i);
							if (
								!recorded ||
								!same(recorded, fileStat) ||
								!fileStat.isFile() ||
								fileStat.size > POLICY.maxBytes ||
								fileStat.nlink !== 1 ||
								(fileStat.mode & 0o777) !== 0o600 ||
								hash(readFileSync(file)) !== hash(binding.outputs[OUTPUTS[i]])
							)
								throw denied();
						} finally {
							closeSync(file);
						}
					}
				} finally {
					closeSync(dir);
				}
				complete = true;
				audit.push("prepared");
			} catch {
				/* Only sanitized outcomes leave this boundary. */
			} finally {
				if (!complete && !recordedDir) {
					try {
						lstatSync(directory.child("attempt-3"));
						preserved = true;
					} catch (error) {
						if (
							!(
								error &&
								typeof error === "object" &&
								"code" in error &&
								error.code === "ENOENT"
							)
						)
							preserved = true;
					}
				}
				if (!complete && recordedDir) {
					let held: number | undefined;
					try {
						const target = directory.child("attempt-3");
						held = openSync(
							target,
							FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW,
						);
						ensure(same(recordedDir, fstatSync(held)));
						for (const [index, identity] of records) {
							const file = `/proc/self/fd/${held}/${OUTPUTS[index]}`;
							ensure(same(identity, lstatSync(file)));
							unlinkSync(file);
						}
						ensure(readdirSync(`/proc/self/fd/${held}`).length === 0);
						ensure(same(recordedDir, lstatSync(target)));
						rmdirSync(target);
					} catch {
						preserved = true;
					} finally {
						if (held !== undefined) closeSync(held);
					}
				}
				for (const fd of fds) closeSync(fd);
				if (temp) rmdirSync(temp);
			}
			return {
				status: complete ? "prepared" : "denied",
				audit,
				cleanup: preserved ? "preserved" : "complete",
			};
		},
	};
}

/** Disconnected production source API: no destination/argument/environment override.
 * Requires an externally pinned worker build and operator-signed exact binding.
 */
export function createPreparationExecutor(
	worker: CapturedWorker,
	outputs: Readonly<Record<string, string>>,
) {
	if (process.cwd() !== POLICY.cwd) throw denied();
	const directory = new ProtectedDirectory(POLICY.cwd);
	try {
		return {
			...executor(
				worker,
				outputs,
				directory,
				{ overallMs: POLICY.overallMs, testsMs: POLICY.testsMs },
				false,
			),
			close: () => directory.close(),
		};
	} catch (error) {
		directory.close();
		throw error;
	}
}
/** Fixture roots are freshly generated here, never caller-supplied production overrides. */
export function createExecutorFixture(
	worker: CapturedWorker,
	outputs: Readonly<Record<string, string>>,
	limits: PreparationRuntimeLimits = {
		overallMs: POLICY.overallMs,
		testsMs: POLICY.testsMs,
	},
) {
	if (
		!Number.isSafeInteger(limits.overallMs) ||
		!Number.isSafeInteger(limits.testsMs) ||
		limits.overallMs < 1 ||
		limits.testsMs < 1 ||
		limits.overallMs > POLICY.overallMs ||
		limits.testsMs > POLICY.testsMs
	)
		throw denied();
	const root = mkdtempSync(
		path.join(os.tmpdir(), "preparation-executor-fixture-"),
	);
	const directory = new ProtectedDirectory(root);
	try {
		return {
			root,
			...executor(worker, outputs, directory, { ...limits }, true),
			dispose: () => {
				directory.close();
				rmSync(root, { recursive: true, force: true });
			},
		};
	} catch (error) {
		directory.close();
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}
