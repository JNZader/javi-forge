import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Expected a YAML mapping");
	}

	return value as Record<string, unknown>;
}

function workflow(file: string): Record<string, unknown> {
	const parsed: unknown = parse(
		readFileSync(
			new URL(`../../.github/workflows/${file}.yml`, import.meta.url),
			"utf8",
		),
	);
	return object(parsed);
}

function action(file: string): Record<string, unknown> {
	const parsed: unknown = parse(
		readFileSync(
			new URL(`../../.github/actions/${file}/action.yml`, import.meta.url),
			"utf8",
		),
	);
	return object(parsed);
}

function steps(job: unknown): Record<string, unknown>[] {
	const value = object(job).steps;
	if (!Array.isArray(value)) throw new Error("Expected workflow steps");
	return value.map(object);
}

function actionSteps(actionDefinition: unknown): Record<string, unknown>[] {
	const value = object(object(actionDefinition).runs).steps;
	if (!Array.isArray(value)) throw new Error("Expected composite action steps");
	return value.map(object);
}

function usesStepIndex(job: unknown, action: string): number {
	const index = steps(job).findIndex((candidate) => candidate.uses === action);
	if (index === -1) throw new Error(`Missing action step: ${action}`);
	return index;
}

function runStepIndex(job: unknown, command: string): number {
	const index = steps(job).findIndex((candidate) => candidate.run === command);
	if (index === -1) throw new Error(`Missing run step: ${command}`);
	return index;
}

function runCommand(step: Record<string, unknown>): string {
	if (typeof step.run !== "string") throw new Error("Expected run command");
	return step.run;
}

const ci = workflow("ci");
const bubblewrapSetup = action("setup-bubblewrap");
const linux = workflow("claude-hook-linux");
const windows = workflow("claude-hook-windows");
const ciJobs = object(ci.jobs);
const testJob = object(ciJobs.test);
const linuxJob = object(object(linux.jobs).runtime);
const windowsJob = object(object(windows.jobs).runtime);

describe("dependency-gated delivery workflows", () => {
	it("uses CI as the sole push and pull-request entrypoint", () => {
		expect(ci.on).toEqual({
			push: { branches: ["main"] },
			pull_request: { branches: ["main"] },
		});
		expect(linux.on).toEqual({ workflow_call: null });
		expect(windows.on).toEqual({ workflow_call: null });
	});

	it("runs same-commit delivery gates without automatic release authority", () => {
		expect(Object.keys(ciJobs).sort()).toEqual([
			"linux-hook",
			"test",
			"windows-hook",
		]);
		for (const [id, file] of [
			["linux-hook", "claude-hook-linux"],
			["windows-hook", "claude-hook-windows"],
		]) {
			const job = object(ciJobs[id]);
			expect(job.uses).toBe(`./.github/workflows/${file}.yml`);
			expect(job.with).toBeUndefined();
			expect(job["continue-on-error"]).toBeUndefined();
		}
		expect(ciJobs.release).toBeUndefined();
	});

	it("keeps publishing permissions and tokens out of active CI jobs", () => {
		expect(ci.permissions).toEqual({ contents: "read" });
		expect(linux.permissions).toEqual({ contents: "read" });
		expect(windows.permissions).toEqual({ contents: "read" });
		for (const id of ["test", "linux-hook", "windows-hook"]) {
			expect(object(ciJobs[id]).secrets).toBeUndefined();
			expect(object(ciJobs[id]).permissions).toBeUndefined();
		}
	});

	it("shares the Ubuntu 26.04 bubblewrap and AppArmor test prerequisite", () => {
		expect(testJob["runs-on"]).toBe("ubuntu-26.04");
		expect(
			usesStepIndex(testJob, "./.github/actions/setup-bubblewrap"),
		).toBeGreaterThanOrEqual(0);
		const setup = runCommand(actionSteps(bubblewrapSetup)[0]);
		expect(setup).toContain(
			"sudo apt-get install -y apparmor apparmor-profiles apparmor-utils bubblewrap",
		);
		expect(setup).toContain(
			"/usr/share/apparmor/extra-profiles/bwrap-userns-restrict",
		);
		expect(setup).toContain(
			"sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict",
		);
		expect(setup).toContain("bwrap --version");
		expect(setup).toContain("version >= (0, 10)");
		expect(
			usesStepIndex(testJob, "./.github/actions/setup-bubblewrap"),
		).toBeLessThan(runStepIndex(testJob, "pnpm test:coverage"));
	});

	it("preserves reusable hook job platforms and their SHA-pinned actions", () => {
		expect(linuxJob["runs-on"]).toBe("ubuntu-latest");
		expect(linuxJob.strategy).toEqual({
			"fail-fast": false,
			matrix: { leg: ["with-acl", "without-acl"] },
		});
		expect(windowsJob["runs-on"]).toBe("windows-latest");

		const hookPins = [
			"actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
			"pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320",
			"actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
			"actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
		];
		for (const job of [linuxJob, windowsJob]) {
			for (const step of steps(job)) {
				if (step.uses !== undefined) expect(hookPins).toContain(step.uses);
				if (String(step.uses).startsWith("actions/checkout@")) {
					expect(object(step.with ?? {}).ref).toBeUndefined();
				}
			}
		}
	});

	it("checks out the caller SHA", () => {
		for (const job of [testJob, linuxJob, windowsJob]) {
			for (const step of steps(job)) {
				if (String(step.uses).startsWith("actions/checkout@")) {
					expect(object(step.with ?? {}).ref).toBeUndefined();
				}
			}
		}
	});
});
