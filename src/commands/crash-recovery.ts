/**
 * Crash recovery — reconstruct pipeline state from git commit history
 * when checkpoint files are corrupted or lost. Git is the single
 * source of truth for what was actually done.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Types ──

export interface RecoveredTask {
	commitHash: string;
	message: string;
	timestamp: string;
	filesChanged: string[];
	taskId: string | null; // extracted from commit message if present
	phase: string | null; // feat/fix/test/refactor
}

export interface RecoveryReport {
	branch: string;
	totalCommits: number;
	tasks: RecoveredTask[];
	phases: Record<string, number>;
	lastActivity: string | null;
}

// ── Git operations ──

export async function getGitLog(
	projectDir: string,
	options: { maxCommits?: number; since?: string } = {},
): Promise<string> {
	const args = [
		"log",
		`--max-count=${options.maxCommits ?? 50}`,
		"--pretty=format:%H|%s|%aI",
		"--name-only",
	];
	if (options.since) args.push(`--since=${options.since}`);

	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd: projectDir,
			timeout: 10_000,
		});
		return stdout;
	} catch {
		return "";
	}
}

export async function getCurrentBranch(projectDir: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["branch", "--show-current"],
			{ cwd: projectDir, timeout: 5_000 },
		);
		return stdout.trim();
	} catch {
		return "unknown";
	}
}

// ── Parsing ──

const CONVENTIONAL_RE =
	/^(feat|fix|test|refactor|docs|chore|ci|perf|style|build)(?:\(([^)]*)\))?:\s*(.+)/;
const TASK_ID_RE = /#(\d+)|task[- ](\d+[.\d]*)/i;

export function parseCommitPhase(message: string): string | null {
	const match = CONVENTIONAL_RE.exec(message);
	return match ? match[1]! : null;
}

export function extractTaskId(message: string): string | null {
	const match = TASK_ID_RE.exec(message);
	if (match) return match[1] ?? match[2] ?? null;
	return null;
}

export function parseGitLog(raw: string): RecoveredTask[] {
	if (!raw.trim()) return [];

	const tasks: RecoveredTask[] = [];
	const blocks = raw.split("\n\n").filter((b) => b.trim());

	for (const block of blocks) {
		const lines = block.split("\n").filter((l) => l.trim());
		if (lines.length === 0) continue;

		const headerLine = lines[0]!;
		const parts = headerLine.split("|");
		if (parts.length < 3) continue;

		const [hash, message, timestamp] = parts as [string, string, string];
		const filesChanged = lines.slice(1).filter((l) => !l.includes("|"));

		tasks.push({
			commitHash: hash.slice(0, 7),
			message,
			timestamp,
			filesChanged,
			taskId: extractTaskId(message),
			phase: parseCommitPhase(message),
		});
	}

	return tasks;
}

// ── Recovery ──

export async function recoverFromGit(
	projectDir: string,
	options: { maxCommits?: number; since?: string } = {},
): Promise<RecoveryReport> {
	const branch = await getCurrentBranch(projectDir);
	const raw = await getGitLog(projectDir, options);
	const tasks = parseGitLog(raw);

	const phases: Record<string, number> = {};
	for (const task of tasks) {
		if (task.phase) {
			phases[task.phase] = (phases[task.phase] ?? 0) + 1;
		}
	}

	return {
		branch,
		totalCommits: tasks.length,
		tasks,
		phases,
		lastActivity: tasks[0]?.timestamp ?? null,
	};
}

// ── Formatting ──

export function formatRecovery(report: RecoveryReport): string {
	const lines: string[] = [];
	lines.push(`## Crash Recovery Report`);
	lines.push(
		`**Branch**: ${report.branch} | **Commits**: ${report.totalCommits}`,
	);
	if (report.lastActivity) {
		lines.push(`**Last activity**: ${report.lastActivity}`);
	}
	lines.push("");

	if (Object.keys(report.phases).length > 0) {
		const phaseStr = Object.entries(report.phases)
			.map(([p, c]) => `${p}: ${c}`)
			.join(", ");
		lines.push(`**Phases**: ${phaseStr}`);
		lines.push("");
	}

	for (const task of report.tasks.slice(0, 10)) {
		const tag = task.phase ? `[${task.phase}]` : "";
		const id = task.taskId ? ` #${task.taskId}` : "";
		lines.push(
			`- \`${task.commitHash}\` ${tag}${id} ${task.message} (${task.filesChanged.length} files)`,
		);
	}

	if (report.totalCommits > 10) {
		lines.push(`\n... and ${report.totalCommits - 10} more commits`);
	}

	return lines.join("\n");
}
