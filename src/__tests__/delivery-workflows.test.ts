import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Structural inspection only: no workflow commands or helper assets are executed.
function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Expected a YAML mapping");
	return value as Record<string, unknown>;
}

function workflow(file: string) {
	const parsed: unknown = parse(
		readFileSync(
			new URL(`../../.github/workflows/${file}.yml`, import.meta.url),
			"utf8",
		),
	);
	return object(parsed);
}

function steps(job: unknown) {
	const value = object(job).steps;
	if (!Array.isArray(value)) throw new Error("Expected workflow steps");
	return value.map(object);
}

const ci = workflow("ci");
const release = workflow("release");
const linux = workflow("claude-hook-linux");
const windows = workflow("claude-hook-windows");
const jobs = object(ci.jobs);
const publishing = {
	contents: "write",
	issues: "write",
	"pull-requests": "write",
	"id-token": "write",
};
const releaseJob = object(object(release.jobs).release);
const linuxJob = object(object(linux.jobs).runtime);
const windowsJob = object(object(windows.jobs).runtime);
const named = (job: unknown, name: string) => {
	const step = steps(job).find((step) => step.name === name);
	if (!step) throw new Error(`Missing step: ${name}`);
	return step;
};
const lines = (step: Record<string, unknown>) => {
	if (typeof step.run !== "string") throw new Error("Expected run command");
	return step.run.trimEnd().split("\n");
};

describe("dependency-gated delivery workflows", () => {
	it("uses CI as the sole push/PR entry for this delivery graph", () => {
		expect(ci.on).toEqual({
			push: { branches: ["main"] },
			pull_request: { branches: ["main"] },
		});
		expect(linux.on).toEqual({ workflow_call: null });
		expect(windows.on).toEqual({ workflow_call: null });
		expect(release.on).toEqual({
			workflow_call: { secrets: { NPM_TOKEN: { required: true } } },
		});
	});

	it("gates main-push release on every same-commit local check", () => {
		expect(Object.keys(jobs).sort()).toEqual([
			"linux-hook",
			"release",
			"test",
			"windows-hook",
		]);
		for (const [id, file] of [
			["linux-hook", "claude-hook-linux"],
			["windows-hook", "claude-hook-windows"],
			["release", "release"],
		]) {
			const job = object(jobs[id!]);
			expect(job.uses).toBe(`./.github/workflows/${file}.yml`);
			expect(job.with).toBeUndefined();
			expect(job["continue-on-error"]).toBeUndefined();
		}
		const call = object(jobs.release);
		expect(call.needs).toEqual(["test", "linux-hook", "windows-hook"]);
		expect(call.if).toBe(
			"github.event_name == 'push' && github.ref == 'refs/heads/main'",
		);
		for (const job of [
			jobs.test,
			jobs["linux-hook"],
			jobs["windows-hook"],
			linuxJob,
			windowsJob,
		]) {
			expect(object(job).if).toBeUndefined();
			expect(object(job)["continue-on-error"]).toBeUndefined();
		}
	});

	it("confines publishing secrets and token writes to the release boundary", () => {
		expect(ci.permissions).toEqual({ contents: "read" });
		expect(linux.permissions).toEqual({ contents: "read" });
		expect(windows.permissions).toEqual({ contents: "read" });
		expect(release.permissions).toEqual(publishing);
		expect(object(jobs.release).permissions).toEqual(publishing);
		expect(object(jobs.release).secrets).toEqual({
			NPM_TOKEN: `\${{ secrets.NPM_TOKEN }}`,
		});
		for (const id of ["test", "linux-hook", "windows-hook"]) {
			expect(object(jobs[id]).secrets).toBeUndefined();
			expect(object(jobs[id]).permissions).toBeUndefined();
		}
		expect(named(releaseJob, "Release").env).toEqual({
			GITHUB_TOKEN: `\${{ secrets.GITHUB_TOKEN }}`,
			NPM_TOKEN: `\${{ secrets.NPM_TOKEN }}`,
			NODE_AUTH_TOKEN: `\${{ secrets.NPM_TOKEN }}`,
		});
	});

	it("pins actions and leaves checkout on the caller SHA", () => {
		const pins = [
			"actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
			"actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
			"pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
			"actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
			"actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
			"pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320",
			"actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
		];
		for (const job of [jobs.test, releaseJob, linuxJob, windowsJob]) {
			for (const step of steps(job)) {
				expect(step["continue-on-error"]).toBeUndefined();
				if (step.uses !== undefined) {
					expect(pins).toContain(step.uses);
					if (String(step.uses).startsWith("actions/checkout@"))
						expect(object(step.with ?? {}).ref).toBeUndefined();
				}
			}
		}
		expect(steps(releaseJob)[0]?.with).toEqual({
			"fetch-depth": 0,
			"persist-credentials": false,
		});
	});

	it("retains CI audit, coverage, package, hooks and packed self-CI gates", () => {
		expect(object(jobs.test)["runs-on"]).toBe("ubuntu-latest");
		const testSteps = steps(jobs.test);
		const commands = testSteps.map((step) => step.run);
		for (const run of [
			"pnpm install --frozen-lockfile",
			"pnpm audit --audit-level=high",
			"pnpm build",
			"pnpm test:coverage",
			"pnpm package:check",
			"pnpm test:hooks",
		])
			expect(commands).toContain(run);
		expect(commands.indexOf("pnpm audit --audit-level=high")).toBeLessThan(
			commands.indexOf("pnpm build"),
		);
		for (const step of testSteps) expect(step.if).toBeUndefined();
		expect(
			lines(named(jobs.test, "Install ruff (from integration tests)")),
		).toEqual([
			"pipx install ruff==0.15.6",
			'echo "$HOME/.local/bin" >> "$GITHUB_PATH"',
		]);
		expect(
			lines(
				named(jobs.test, "Self-CI (javi-forge ci --quick from packed tarball)"),
			),
		).toEqual([
			"set -euo pipefail",
			"npm pack",
			"npm install -g ./javi-forge-*.tgz",
			"rm -f ./javi-forge-*.tgz",
			"javi-forge ci --quick --no-docker --no-ci-ghagga",
		]);
	});

	it("retains release build/tests, package check, ruff and skip-ci condition", () => {
		expect(releaseJob["runs-on"]).toBe("ubuntu-latest");
		expect(releaseJob.if).toBe(
			"!contains(github.event.head_commit.message, '[skip ci]')",
		);
		const commands = steps(releaseJob).map((step) => step.run);
		for (const run of [
			"pnpm install --frozen-lockfile",
			"pnpm build",
			"pnpm test",
			"pnpm package:check",
			"pnpm exec semantic-release",
		])
			expect(commands).toContain(run);
		for (const step of steps(releaseJob)) expect(step.if).toBeUndefined();
		expect(
			lines(
				named(releaseJob, "Install ruff (required tool for integration tests)"),
			),
		).toEqual([
			"pipx install ruff==0.15.6",
			'echo "$HOME/.local/bin" >> "$GITHUB_PATH"',
		]);
	});

	it("preserves both real Linux ACL legs and their setup/restore boundaries", () => {
		expect(linuxJob["runs-on"]).toBe("ubuntu-latest");
		expect(linuxJob["timeout-minutes"]).toBe(15);
		expect(linuxJob.strategy).toEqual({
			"fail-fast": false,
			matrix: { leg: ["with-acl", "without-acl"] },
		});
		expect(
			lines(named(linuxJob, "Install the acl toolchain (both legs)")),
		).toEqual([
			"set -euo pipefail",
			"sudo apt-get update",
			"sudo apt-get install -y --no-install-recommends acl",
		]);
		for (const leg of ["with-acl", "without-acl"]) {
			const check = named(
				linuxJob,
				`Validate real POSIX secure-fs adapter (${leg} leg)`,
			);
			expect(check.if).toBe(`matrix.leg == '${leg}'`);
			expect(check.env).toEqual(
				leg === "with-acl"
					? { JAVI_FORGE_LINUX_INT: "1" }
					: { JAVI_FORGE_ACL_LEG: "absent", JAVI_FORGE_LINUX_INT: "1" },
			);
			expect(lines(check)).toEqual([
				"set -euo pipefail",
				"pnpm vitest run src/__integration__/secure-fs-posix.integration.test.ts",
			]);
		}
		const present = named(linuxJob, "Assert getfacl is present (with-acl leg)");
		expect(present.if).toBe("matrix.leg == 'with-acl'");
		expect(lines(present)).toContain("if ! command -v getfacl; then");
		const absent = named(
			linuxJob,
			"Displace getfacl and assert it is unresolvable (without-acl leg)",
		);
		expect(absent.if).toBe("matrix.leg == 'without-acl'");
		expect(lines(absent)).toContain(
			"sudo mv /usr/bin/getfacl /usr/bin/getfacl.disabled",
		);
		expect(lines(absent)).toContain("if command -v getfacl; then");
		const restore = named(linuxJob, "Restore getfacl (without-acl leg)");
		expect(restore.if).toBe("always() && matrix.leg == 'without-acl'");
		expect(lines(restore)).toContain(
			"  sudo mv /usr/bin/getfacl.disabled /usr/bin/getfacl",
		);
	});

	it("preserves Windows typechecks, hook runtime, ACL and real helper suite", () => {
		expect(windowsJob["runs-on"]).toBe("windows-latest");
		const standalone = named(windowsJob, "Validate standalone runtime");
		expect(standalone.shell).toBe("pwsh");
		expect(lines(standalone)).toEqual([
			"pnpm typecheck; if ($LASTEXITCODE) { exit $LASTEXITCODE }",
			"pnpm typecheck:test; if ($LASTEXITCODE) { exit $LASTEXITCODE }",
			"pnpm vitest run src/__tests__/claude-hook-assets.test.ts src/__integration__/claude-pretooluse-exec.integration.test.ts",
			"if ($LASTEXITCODE) { exit $LASTEXITCODE }",
		]);
		const helper = named(
			windowsJob,
			"Validate real win32 secure-object helper (.ps1)",
		);
		expect(helper.shell).toBe("pwsh");
		expect(lines(helper)).toEqual([
			"pnpm vitest run src/__integration__/secure-fs-windows.integration.test.ts",
			"if ($LASTEXITCODE) { exit $LASTEXITCODE }",
		]);
	});
});
