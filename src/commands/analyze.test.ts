import type { ChildProcess } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitStep } from "../types/index.js";

// ── Mock child_process ───────────────────────────────────────────────────────
vi.mock("child_process", () => ({
	execFile: vi.fn(
		(_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
			if (typeof cb === "function") cb(null, { stdout: "", stderr: "" });
			return undefined as unknown as ChildProcess;
		},
	),
}));

import { execFile } from "child_process";
import { runAnalyze } from "./analyze.js";

const mockedExecFile = vi.mocked(execFile);

beforeEach(() => {
	vi.resetAllMocks();
});

function collectSteps(
	projectDir: string,
	dryRun: boolean,
): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	return runAnalyze(projectDir, dryRun, (step) => steps.push(step)).then(
		() => steps,
	);
}

describe("runAnalyze", () => {
	it("reports error when repoforge not found", async () => {
		// which fails → repoforge not found
		mockedExecFile.mockImplementation(
			(_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
				const cmd = String(_cmd);
				// The 'which' call is execFile('which', ['repoforge']) with 2 args (no opts)
				// promisify(execFile) passes (cmd, args) → node adds callback
				if (cmd === "which") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(new Error("not found"));
				}
				return undefined as unknown as ChildProcess;
			},
		);

		const steps = await collectSteps("/project", false);
		const errorStep = steps.find((s) => s.status === "error");
		expect(errorStep).toBeDefined();
		expect(errorStep!.detail).toContain("repoforge not found");
		expect(errorStep!.detail).toContain("pip install repoforge");
	});

	it("reports done when repoforge succeeds", async () => {
		mockedExecFile.mockImplementation(
			(_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
				const cmd = String(_cmd);
				if (cmd === "which") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "/usr/bin/repoforge",
							stderr: "",
						});
				} else if (cmd === "repoforge") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "Analysis complete\nGenerated 5 skills",
							stderr: "",
						});
				}
				return undefined as unknown as ChildProcess;
			},
		);

		const steps = await collectSteps("/project", false);
		const doneStep = steps.find(
			(s) => s.id === "analyze-repoforge" && s.status === "done",
		);
		expect(doneStep).toBeDefined();
		expect(doneStep!.detail).toContain("Generated 5 skills");
	});

	it("passes --dry-run when dryRun is true", async () => {
		let capturedArgs: string[] = [];
		mockedExecFile.mockImplementation(
			(_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
				const cmd = String(_cmd);
				if (cmd === "which") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "/usr/bin/repoforge",
							stderr: "",
						});
				} else if (cmd === "repoforge") {
					capturedArgs = (_args as string[]) ?? [];
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, { stdout: "", stderr: "" });
				}
				return undefined as unknown as ChildProcess;
			},
		);

		await collectSteps("/project", true);
		expect(capturedArgs).toContain("--dry-run");
	});

	it("reports error when repoforge execution fails", async () => {
		mockedExecFile.mockImplementation(
			(_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
				const cmd = String(_cmd);
				if (cmd === "which") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "/usr/bin/repoforge",
							stderr: "",
						});
				} else if (cmd === "repoforge") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(new Error("Analysis crashed"));
				}
				return undefined as unknown as ChildProcess;
			},
		);

		const steps = await collectSteps("/project", false);
		const errorStep = steps.find(
			(s) => s.id === "analyze-repoforge" && s.status === "error",
		);
		expect(errorStep).toBeDefined();
		expect(errorStep!.detail).toContain("Analysis crashed");
	});

	it("reports done with dry-run message when no stdout and dryRun", async () => {
		mockedExecFile.mockImplementation(
			(_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
				const cmd = String(_cmd);
				if (cmd === "which") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "/usr/bin/repoforge",
							stderr: "",
						});
				} else if (cmd === "repoforge") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, { stdout: "", stderr: "" });
				}
				return undefined as unknown as ChildProcess;
			},
		);

		const steps = await collectSteps("/project", true);
		const doneStep = steps.find(
			(s) => s.id === "analyze-repoforge" && s.status === "done",
		);
		expect(doneStep).toBeDefined();
		expect(doneStep!.detail).toContain("dry-run");
	});

	it("reports warning when stderr has output", async () => {
		mockedExecFile.mockImplementation(
			(_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
				const cmd = String(_cmd);
				if (cmd === "which") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "/usr/bin/repoforge",
							stderr: "",
						});
				} else if (cmd === "repoforge") {
					const callback = typeof _opts === "function" ? _opts : cb;
					if (typeof callback === "function")
						(callback as Function)(null, {
							stdout: "Analysis done",
							stderr: "Warning: deprecated API\nWarning: slow scan",
						});
				}
				return undefined as unknown as ChildProcess;
			},
		);

		const steps = await collectSteps("/project", false);
		const warnStep = steps.find((s) => s.id === "analyze-warnings");
		expect(warnStep).toBeDefined();
		expect(warnStep!.status).toBe("skipped");
		expect(warnStep!.detail).toContain("Warning: slow scan");
	});
});
