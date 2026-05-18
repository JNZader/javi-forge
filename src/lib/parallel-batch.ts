/**
 * Parallel batch sub-agents — spawn test/lint/build runners per module
 * in parallel during quality scoring. Collects results and aggregates.
 */

// ── Types ──

export type JobStatus = "pending" | "running" | "done" | "error";

export interface BatchJob {
	id: string;
	name: string;
	command: string;
	module: string;
	status: JobStatus;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number;
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface BatchResult {
	jobs: BatchJob[];
	totalDurationMs: number;
	passedCount: number;
	failedCount: number;
	parallelism: number;
}

export interface BatchConfig {
	maxParallel: number;
	timeoutMs: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
	maxParallel: 4,
	timeoutMs: 60_000,
};

// ── Job creation ──

let _jobCounter = 0;

export function createJob(
	name: string,
	command: string,
	module: string,
): BatchJob {
	_jobCounter++;
	return {
		id: `job-${Date.now()}-${_jobCounter}`,
		name,
		command,
		module,
		status: "pending",
		startedAt: null,
		completedAt: null,
		durationMs: 0,
		exitCode: null,
		stdout: "",
		stderr: "",
	};
}

// ── Execution ──

export type JobExecutor = (job: BatchJob) => Promise<BatchJob>;

/**
 * Default executor — runs command via child_process.
 */
export function createShellExecutor(timeoutMs: number = 60_000): JobExecutor {
	return async (job: BatchJob): Promise<BatchJob> => {
		const { execFile } = await import("child_process");
		const { promisify } = await import("util");
		const execFileAsync = promisify(execFile);

		job.status = "running";
		job.startedAt = Date.now();

		try {
			const { stdout, stderr } = await execFileAsync(
				"sh",
				["-c", job.command],
				{ timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 },
			);
			job.stdout = stdout;
			job.stderr = stderr;
			job.exitCode = 0;
			job.status = "done";
		} catch (err: unknown) {
			const e = err as {
				stdout?: string;
				stderr?: string;
				code?: number;
				killed?: boolean;
			};
			job.stdout = e.stdout ?? "";
			job.stderr = e.stderr ?? "";
			job.exitCode = e.killed ? -1 : (e.code ?? 1);
			job.status = "error";
		}

		job.completedAt = Date.now();
		job.durationMs = job.completedAt - job.startedAt;
		return job;
	};
}

/**
 * Run jobs in parallel with configurable concurrency.
 */
export async function runBatch(
	jobs: BatchJob[],
	executor: JobExecutor,
	config: BatchConfig = DEFAULT_BATCH_CONFIG,
): Promise<BatchResult> {
	const start = Date.now();
	const results: BatchJob[] = [];
	const queue = [...jobs];

	// Process in waves of maxParallel
	while (queue.length > 0) {
		const wave = queue.splice(0, config.maxParallel);
		const waveResults = await Promise.all(wave.map((j) => executor(j)));
		results.push(...waveResults);
	}

	return {
		jobs: results,
		totalDurationMs: Date.now() - start,
		passedCount: results.filter((j) => j.status === "done").length,
		failedCount: results.filter((j) => j.status === "error").length,
		parallelism: config.maxParallel,
	};
}

// ── Formatting ──

export function formatBatchResult(result: BatchResult): string {
	const status = result.failedCount === 0 ? "✅ ALL PASSED" : "❌ FAILURES";
	const lines: string[] = [];
	lines.push(`## Batch Result: ${status}`);
	lines.push(
		`**Jobs**: ${result.jobs.length} | **Passed**: ${result.passedCount} | **Failed**: ${result.failedCount} | **Time**: ${result.totalDurationMs}ms | **Parallelism**: ${result.parallelism}`,
	);
	lines.push("");

	for (const job of result.jobs) {
		const icon = job.status === "done" ? "✓" : "✗";
		lines.push(
			`  ${icon} ${job.name} (${job.module}) — ${job.durationMs}ms [exit ${job.exitCode}]`,
		);
	}

	return lines.join("\n");
}
