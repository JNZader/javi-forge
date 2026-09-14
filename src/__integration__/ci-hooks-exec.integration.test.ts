/**
 * Hooks verified by EXECUTION, not by grepping substrings.
 *
 * The hooks are installed into a real git repo and then run the way git runs
 * them: the file is executed directly so its `#!/bin/bash` shebang decides the
 * interpreter. (Running them through `sh` would pick dash on Debian-family
 * systems and break the bash arrays in `commit-msg`, producing a failure that
 * says nothing about the hook.)
 *
 * `pre-commit` / `pre-push` are exercised against a stub `javi-forge` (and a
 * stub `docker`) placed FIRST on PATH, so the frozen flag string and the
 * exit-code propagation are observed rather than assumed.
 */

import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installCIHooks } from "../commands/ci.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

/**
 * Frozen hook contract (S1b): each shim execs the dispatcher `hooks run <name>`,
 * NOT `ci --quick …` directly. The dispatcher decides which sections run from
 * the `hooks:` config; the shim only forwards the hook name and propagates the
 * exit code.
 */
const FROZEN_PRE_COMMIT_ARGS = "hooks run pre-commit";
const FROZEN_PRE_PUSH_ARGS = "hooks run pre-push";
const ZERO_SHA1_OID = "0".repeat(40);
const ZERO_SHA256_OID = "0".repeat(64);
const SAMPLE_SHA1_OID = "1".repeat(40);
const SAMPLE_SHA256_OID = "1".repeat(64);

interface HookRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface RepoMetadataSnapshot {
	commonConfig: Buffer;
	head: Buffer;
	attachedRef: Buffer;
	index: Buffer;
	worktreeStatus: string;
}

let tmpDir: string;
let stubDir: string;
let argsLog: string;

/**
 * Write an executable stub that records its argv and exits with the value of
 * its OWN env var, so the CLI and Docker exit codes are controlled separately.
 */
async function writeStub(name: string, exitVar: string): Promise<void> {
	await fs.writeFile(
		path.join(stubDir, name),
		`#!/bin/bash\nprintf '%s\\n' "$*" >> "$STUB_ARGS_LOG"\nexit "\${${exitVar}:-0}"\n`,
		{ mode: 0o755 },
	);
}

function gitOutput(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function snapshotRepoMetadata(
	cwd: string,
): Promise<RepoMetadataSnapshot> {
	const gitDir = gitOutput(cwd, ["rev-parse", "--absolute-git-dir"]);
	const commonDir = gitOutput(cwd, [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	const indexPath = gitOutput(cwd, [
		"rev-parse",
		"--path-format=absolute",
		"--git-path",
		"index",
	]);
	const attachedRef = gitOutput(cwd, ["symbolic-ref", "HEAD"]);

	return {
		commonConfig: await fs.readFile(path.join(commonDir, "config")),
		head: await fs.readFile(path.join(gitDir, "HEAD")),
		attachedRef: await fs.readFile(path.join(commonDir, attachedRef)),
		index: await fs.readFile(indexPath),
		worktreeStatus: execFileSync(
			"git",
			["status", "--porcelain=v2", "--untracked-files=all"],
			{ cwd, encoding: "utf8" },
		),
	};
}

async function prepareSacrificialParent(): Promise<void> {
	execFileSync("git", ["config", "user.name", "Sacrificial Parent"], {
		cwd: tmpDir,
	});
	execFileSync("git", ["config", "user.email", "parent@example.invalid"], {
		cwd: tmpDir,
	});
	await fs.writeFile(path.join(tmpDir, "parent.txt"), "parent\n");
	execFileSync("git", ["add", "parent.txt"], { cwd: tmpDir });
	execFileSync("git", ["commit", "-qm", "test: parent baseline"], {
		cwd: tmpDir,
	});
	await fs.appendFile(
		path.join(tmpDir, ".git", "info", "exclude"),
		"\npayload-child/\n",
	);
}

async function writeGitPayloadStub(exitCode: number): Promise<string> {
	const childDir = path.join(tmpDir, "payload-child");
	await fs.writeFile(
		path.join(stubDir, "javi-forge"),
		`#!/bin/bash
set -e
mkdir -p "$PAYLOAD_CHILD"
cd "$PAYLOAD_CHILD"
git init -q --initial-branch=main
git config user.name "Sacrificial Child"
git config user.email "child@example.invalid"
printf 'child\n' > child.txt
git add -f child.txt
git commit --no-verify -qm "test: child payload"
exit ${exitCode}
`,
		{ mode: 0o755 },
	);
	return childDir;
}

async function writeGitDiscoveryStub(
	mode: "failure" | "malformed",
): Promise<void> {
	const discovery =
		mode === "failure"
			? "exit 42"
			: "printf 'GIT_DIR\\nMALFORMED-NAME\\n'\nexit 0";
	await fs.writeFile(
		path.join(stubDir, "git"),
		`#!/bin/bash
if [ "$1" = "rev-parse" ] && [ "$2" = "--local-env-vars" ]; then
${discovery}
fi
PATH="$REAL_GIT_PATH" exec git "$@"
`,
		{ mode: 0o755 },
	);
}

async function writePayloadMarkerStub(markerPath: string): Promise<void> {
	await fs.writeFile(
		path.join(stubDir, "javi-forge"),
		`#!/bin/bash
printf 'ran\n' > "$PAYLOAD_RAN"
`,
		{ mode: 0o755 },
	);
	await fs.remove(markerPath);
}

async function runHook(
	name: string,
	args: string[] = [],
	env: Record<string, string> = {},
	runCwd: string = tmpDir,
	stdin = "",
): Promise<HookRunResult> {
	const hookPath = path.join(tmpDir, ".git", "hooks", name);
	return await new Promise((resolve) => {
		const child = spawn(hookPath, args, {
			cwd: runCwd,
			env: {
				...process.env,
				PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ""}`,
				STUB_ARGS_LOG: argsLog,
				...env,
			},
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			resolve({ exitCode: 1, stdout, stderr: stderr + error.message });
		});
		child.on("close", (code) => {
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
		child.stdin.end(stdin);
	});
}

async function readArgsLog(): Promise<string[]> {
	if (!(await fs.pathExists(argsLog))) return [];
	return (await fs.readFile(argsLog, "utf-8"))
		.split("\n")
		.filter((line) => line.length > 0);
}

/** Write a commit message file and run commit-msg against it. */
async function runCommitMsg(message: string): Promise<HookRunResult> {
	const msgFile = path.join(tmpDir, "COMMIT_EDITMSG_FIXTURE");
	await fs.writeFile(msgFile, message);
	return runHook("commit-msg", [msgFile]);
}

describe("installed hooks — executed", () => {
	beforeEach(async () => {
		tmpDir = await createTempDir("javi-forge-hooks-exec-");
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmpDir });
		execFileSync("git", ["config", "user.name", "Hook Fixture"], {
			cwd: tmpDir,
		});
		execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
			cwd: tmpDir,
		});
		await fs.writeFile(path.join(tmpDir, "fixture.txt"), "fixture\n");
		execFileSync("git", ["add", "fixture.txt"], { cwd: tmpDir });
		execFileSync("git", ["commit", "--no-verify", "-qm", "test: fixture"], {
			cwd: tmpDir,
		});
		stubDir = path.join(tmpDir, "stub-bin");
		await fs.ensureDir(stubDir);
		argsLog = path.join(tmpDir, "stub-args.log");
		await writeStub("javi-forge", "STUB_EXIT_CLI");
		await writeStub("docker", "STUB_EXIT_DOCKER");

		const { errors } = await installCIHooks(tmpDir);
		expect(errors).toEqual([]);
	});

	afterEach(async () => {
		await cleanupTempDir(tmpDir);
	});

	// ── commit-msg ────────────────────────────────────────────────────────────

	const BLOCKED_MESSAGES: Array<{ name: string; message: string }> = [
		{
			name: "co-authored-by claude",
			message:
				"feat: add parser\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
		},
		{
			name: "co-authored-by copilot",
			message:
				"fix: patch\n\nco-authored-by: GitHub Copilot <bot@github.com>\n",
		},
		{ name: "generated by ai", message: "chore: cleanup (generated by AI)\n" },
		{ name: "made by gpt", message: "docs: readme made by GPT\n" },
		{ name: "claude code marker", message: "feat: done with Claude Code\n" },
		{ name: "chatgpt marker", message: "refactor: asked ChatGPT for this\n" },
		{ name: "openai email", message: "feat: x\n\nContact: bot@openai.com\n" },
		{
			name: "claude-session trailer",
			message:
				"feat: add parser\n\nClaude-Session: https://claude.ai/code/session_01NZExampleId\n",
		},
	];

	const ALLOWED_MESSAGES: Array<{ name: string; message: string }> = [
		{ name: "plain feat", message: "feat(ci): add characterization tests\n" },
		{ name: "plain fix", message: "fix: correct off-by-one in parser\n" },
		{ name: "release commit", message: "chore(release): 1.7.0 [skip ci]\n" },
		{
			name: "human co-author",
			message:
				"feat: pair work\n\nCo-Authored-By: Ada Lovelace <ada@example.com>\n",
		},
	];

	it.each(BLOCKED_MESSAGES)("commit-msg blocks AI attribution: $name", async ({
		message,
	}) => {
		const result = await runCommitMsg(message);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("COMMIT BLOCKED");
	});

	it.each(ALLOWED_MESSAGES)("commit-msg allows a clean message: $name", async ({
		message,
	}) => {
		const result = await runCommitMsg(message);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("COMMIT BLOCKED");
	});

	// ── pre-commit ────────────────────────────────────────────────────────────

	it("pre-commit invokes the dispatcher with the frozen `hooks run` args", async () => {
		const result = await runHook("pre-commit");

		expect(result.exitCode).toBe(0);
		expect(await readArgsLog()).toEqual([FROZEN_PRE_COMMIT_ARGS]);
	});

	it("pre-commit aborts when the dispatcher exits non-zero", async () => {
		const result = await runHook("pre-commit", [], { STUB_EXIT_CLI: "3" });

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("pre-commit FAILED");
		// The dispatcher really was invoked — the abort is a propagated failure,
		// not a hook that never ran anything.
		expect(await readArgsLog()).toEqual([FROZEN_PRE_COMMIT_ARGS]);
	});

	// ── pre-push ──────────────────────────────────────────────────────────────
	// The pre-push shim execs the SAME dispatcher entry point as pre-commit but
	// forwards its OWN hook name (`hooks run pre-push`). The dispatcher — not the
	// shim — decides which sections run from the `hooks:` config. The stub logs
	// `$*` as ONE line, so a single invocation is a single-element argsLog.

	it("pre-push invokes the dispatcher with the frozen `hooks run` args", async () => {
		const result = await runHook("pre-push");

		expect(result.exitCode).toBe(0);
		expect(await readArgsLog()).toEqual([FROZEN_PRE_PUSH_ARGS]);
	});

	it("pre-push skips the dispatcher for deletion-only ref updates", async () => {
		const result = await runHook(
			"pre-push",
			[],
			{},
			tmpDir,
			`(delete) ${ZERO_SHA1_OID} refs/heads/stale ${SAMPLE_SHA1_OID}\n`,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("deletion-only ref update");
		expect(await readArgsLog()).toEqual([]);
	});

	it("pre-push skips the dispatcher for SHA-256 deletion-only ref updates", async () => {
		const result = await runHook(
			"pre-push",
			[],
			{},
			tmpDir,
			`(delete) ${ZERO_SHA256_OID} refs/heads/stale ${SAMPLE_SHA256_OID}\n`,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("deletion-only ref update");
		expect(await readArgsLog()).toEqual([]);
	});

	it("pre-push runs the dispatcher for malformed deletion-shaped ref updates", async () => {
		const result = await runHook(
			"pre-push",
			[],
			{},
			tmpDir,
			`(delete) ${ZERO_SHA1_OID} refs/heads/../stale ${SAMPLE_SHA1_OID}\n`,
		);

		expect(result.exitCode).toBe(0);
		expect(await readArgsLog()).toEqual([FROZEN_PRE_PUSH_ARGS]);
	});

	it("pre-push runs the dispatcher for mismatched deletion oid widths", async () => {
		const result = await runHook(
			"pre-push",
			[],
			{},
			tmpDir,
			`(delete) ${ZERO_SHA1_OID} refs/heads/stale ${SAMPLE_SHA256_OID}\n`,
		);

		expect(result.exitCode).toBe(0);
		expect(await readArgsLog()).toEqual([FROZEN_PRE_PUSH_ARGS]);
	});

	it("pre-push still runs the dispatcher for mixed delete and update ref updates", async () => {
		const head = gitOutput(tmpDir, ["rev-parse", "HEAD"]);
		const result = await runHook(
			"pre-push",
			[],
			{},
			tmpDir,
			`(delete) ${ZERO_SHA1_OID} refs/heads/stale ${SAMPLE_SHA1_OID}\nrefs/heads/master ${head} refs/heads/master ${head}\n`,
		);

		expect(result.exitCode).toBe(0);
		expect(await readArgsLog()).toEqual([FROZEN_PRE_PUSH_ARGS]);
	});

	it("pre-push aborts when the dispatcher exits non-zero", async () => {
		const result = await runHook("pre-push", [], { STUB_EXIT_CLI: "5" });

		expect(result.exitCode).toBe(5);
		expect(result.stdout).toContain("pre-push FAILED");
		// The dispatcher really ran before the propagated abort.
		expect(await readArgsLog()).toEqual([FROZEN_PRE_PUSH_ARGS]);
	});

	it("pre-push scrubs hook-local Git targeting before a real-Git test payload", async () => {
		await prepareSacrificialParent();
		const childDir = await writeGitPayloadStub(0);
		const before = await snapshotRepoMetadata(tmpDir);

		const result = await runHook("pre-push", [], {
			GIT_DIR: path.join(tmpDir, ".git"),
			GIT_COMMON_DIR: path.join(tmpDir, ".git"),
			GIT_INDEX_FILE: path.join(tmpDir, ".git", "index"),
			GIT_WORK_TREE: tmpDir,
			PAYLOAD_CHILD: childDir,
		});

		expect(result.exitCode).toBe(0);
		expect(await snapshotRepoMetadata(tmpDir)).toEqual(before);
		expect(await fs.pathExists(path.join(childDir, ".git"))).toBe(true);
		expect(gitOutput(childDir, ["log", "-1", "--format=%s"])).toBe(
			"test: child payload",
		);
	});

	it("pre-push preserves the real-Git test payload exit code", async () => {
		await prepareSacrificialParent();
		const childDir = await writeGitPayloadStub(7);

		const result = await runHook("pre-push", [], {
			GIT_DIR: path.join(tmpDir, ".git"),
			GIT_COMMON_DIR: path.join(tmpDir, ".git"),
			GIT_INDEX_FILE: path.join(tmpDir, ".git", "index"),
			GIT_WORK_TREE: tmpDir,
			PAYLOAD_CHILD: childDir,
		});

		expect(result.exitCode).toBe(7);
		expect(result.stdout).toContain("pre-push FAILED");
		expect(await fs.pathExists(path.join(childDir, ".git"))).toBe(true);
	});

	it.each([
		"failure",
		"malformed",
	] as const)("pre-push fails closed when Git-local variable discovery is %s", async (mode) => {
		const payloadMarker = path.join(tmpDir, `payload-ran-${mode}`);
		await writeGitDiscoveryStub(mode);
		await writePayloadMarkerStub(payloadMarker);

		const result = await runHook("pre-push", [], {
			PAYLOAD_RAN: payloadMarker,
			REAL_GIT_PATH: process.env.PATH ?? "",
		});

		expect(result.exitCode).toBe(1);
		expect(await fs.pathExists(payloadMarker)).toBe(false);
		expect(result.stdout).toContain(
			mode === "failure"
				? "Could not discover Git-local environment variables"
				: "Invalid Git-local environment variable name",
		);
	});

	it("pre-push canary fails closed when the test payload changes common config", async () => {
		await prepareSacrificialParent();
		const configPath = path.join(tmpDir, ".git", "config");
		await fs.writeFile(
			path.join(stubDir, "javi-forge"),
			`#!/bin/bash
git config --file "$CANARY_CONFIG" canary.mutated true
`,
			{ mode: 0o755 },
		);

		const result = await runHook("pre-push", [], {
			CANARY_CONFIG: configPath,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain(
			"Git metadata changed during pre-push tests",
		);
	});

	it("pre-push canary fails closed when a linked-worktree payload changes config.worktree", async () => {
		const linkedRoot = await createTempDir("javi-forge-hooks-linked-");
		const linkedDir = path.join(linkedRoot, "worktree");
		execFileSync("git", ["config", "extensions.worktreeConfig", "true"], {
			cwd: tmpDir,
		});
		execFileSync(
			"git",
			["worktree", "add", "-q", "-b", "linked-fixture", linkedDir],
			{ cwd: tmpDir },
		);
		execFileSync("git", ["config", "--worktree", "canary.baseline", "true"], {
			cwd: linkedDir,
		});
		const worktreeConfigPath = gitOutput(linkedDir, [
			"rev-parse",
			"--path-format=absolute",
			"--git-path",
			"config.worktree",
		]);
		const commonConfigPath = path.join(tmpDir, ".git", "config");
		const commonConfigBefore = await fs.readFile(commonConfigPath);
		const worktreeConfigBefore = await fs.readFile(worktreeConfigPath);

		await fs.writeFile(
			path.join(stubDir, "javi-forge"),
			`#!/bin/bash
git config --worktree canary.mutated true
`,
			{ mode: 0o755 },
		);

		try {
			const result = await runHook("pre-push", [], {}, linkedDir);

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toContain(
				"Git metadata changed during pre-push tests",
			);
			expect(await fs.readFile(commonConfigPath)).toEqual(commonConfigBefore);
			expect(await fs.readFile(worktreeConfigPath)).not.toEqual(
				worktreeConfigBefore,
			);
		} finally {
			execFileSync("git", ["worktree", "remove", "--force", linkedDir], {
				cwd: tmpDir,
			});
			await cleanupTempDir(linkedRoot);
		}
	});
});
