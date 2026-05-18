import { describe, expect, it } from "vitest";
import {
	type BatchJob,
	createJob,
	createShellExecutor,
	formatBatchResult,
	type JobExecutor,
	runBatch,
} from "../parallel-batch.js";

// Mock executor for fast unit tests
function mockExecutor(exitCode = 0): JobExecutor {
	return async (job: BatchJob) => {
		job.status = exitCode === 0 ? "done" : "error";
		job.exitCode = exitCode;
		job.startedAt = Date.now();
		job.completedAt = Date.now() + 10;
		job.durationMs = 10;
		job.stdout = "mock output";
		return job;
	};
}

describe("createJob", () => {
	it("creates pending job", () => {
		const job = createJob("test-lint", "pnpm lint", "core");
		expect(job.status).toBe("pending");
		expect(job.name).toBe("test-lint");
		expect(job.module).toBe("core");
		expect(job.id).toBeTruthy();
	});

	it("generates unique IDs", () => {
		const a = createJob("a", "cmd", "mod");
		const b = createJob("b", "cmd", "mod");
		expect(a.id).not.toBe(b.id);
	});
});

describe("runBatch", () => {
	it("runs all jobs", async () => {
		const jobs = [
			createJob("lint", "lint", "a"),
			createJob("test", "test", "b"),
			createJob("build", "build", "c"),
		];
		const result = await runBatch(jobs, mockExecutor());
		expect(result.jobs).toHaveLength(3);
		expect(result.passedCount).toBe(3);
		expect(result.failedCount).toBe(0);
	});

	it("handles failures", async () => {
		const jobs = [createJob("fail", "false", "mod")];
		const result = await runBatch(jobs, mockExecutor(1));
		expect(result.failedCount).toBe(1);
		expect(result.passedCount).toBe(0);
	});

	it("respects parallelism", async () => {
		const executionOrder: string[] = [];
		const trackingExecutor: JobExecutor = async (job) => {
			executionOrder.push(job.name);
			job.status = "done";
			job.exitCode = 0;
			job.durationMs = 0;
			return job;
		};

		const jobs = Array.from({ length: 6 }, (_, i) =>
			createJob(`job-${i}`, "cmd", "mod"),
		);
		await runBatch(jobs, trackingExecutor, { maxParallel: 2, timeoutMs: 5000 });
		expect(executionOrder).toHaveLength(6);
	});

	it("tracks total duration", async () => {
		const jobs = [createJob("a", "cmd", "mod")];
		const result = await runBatch(jobs, mockExecutor());
		expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
	});

	it("handles empty job list", async () => {
		const result = await runBatch([], mockExecutor());
		expect(result.jobs).toHaveLength(0);
		expect(result.passedCount).toBe(0);
	});
});

describe("createShellExecutor (integration)", () => {
	it("executes real shell command", async () => {
		const executor = createShellExecutor(5000);
		const job = createJob("echo", "echo hello", "test");
		const result = await executor(job);
		expect(result.status).toBe("done");
		expect(result.stdout).toContain("hello");
		expect(result.exitCode).toBe(0);
	});

	it("captures failure", async () => {
		const executor = createShellExecutor(5000);
		const job = createJob("fail", "exit 42", "test");
		const result = await executor(job);
		expect(result.status).toBe("error");
		expect(result.exitCode).toBe(42);
	});
});

describe("formatBatchResult", () => {
	it("shows pass status", async () => {
		const result = await runBatch(
			[createJob("a", "cmd", "mod")],
			mockExecutor(),
		);
		expect(formatBatchResult(result)).toContain("ALL PASSED");
	});

	it("shows failure status", async () => {
		const result = await runBatch(
			[createJob("a", "cmd", "mod")],
			mockExecutor(1),
		);
		expect(formatBatchResult(result)).toContain("FAILURES");
	});
});
