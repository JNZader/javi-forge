import { execFile } from "child_process";
import { promisify } from "util";
import type { InitStep } from "../types/index.js";

const execFileAsync = promisify(execFile);

type StepCallback = (step: InitStep) => void;

function report(
	onStep: StepCallback,
	id: string,
	label: string,
	status: InitStep["status"],
	detail?: string,
) {
	onStep({ id, label, status, detail });
}

/** Check if a binary is available in PATH */
async function which(bin: string): Promise<boolean> {
	try {
		await execFileAsync("which", [bin]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Run repoforge skills analysis on a project directory.
 * This is a thin wrapper that delegates to the repoforge CLI.
 */
export async function runAnalyze(
	projectDir: string,
	dryRun: boolean,
	onStep: StepCallback,
): Promise<void> {
	const stepId = "analyze-repoforge";
	report(onStep, stepId, "Run repoforge skills analysis", "running");

	try {
		// Check if repoforge is installed
		const hasRepoforge = await which("repoforge");

		if (!hasRepoforge) {
			report(
				onStep,
				stepId,
				"Run repoforge skills analysis",
				"error",
				"repoforge not found. Install with: pip install repoforge",
			);
			return;
		}

		const args = ["skills", "-w", projectDir];
		if (dryRun) {
			args.push("--dry-run");
		}

		const { stdout, stderr } = await execFileAsync("repoforge", args, {
			cwd: projectDir,
			timeout: 300_000, // 5 min — analysis can take a while on large repos
		});

		if (stdout) {
			report(
				onStep,
				stepId,
				"Run repoforge skills analysis",
				"done",
				stdout.trim().split("\n").pop() ?? "complete",
			);
		} else {
			report(
				onStep,
				stepId,
				"Run repoforge skills analysis",
				"done",
				dryRun ? "dry-run complete" : "complete",
			);
		}

		if (stderr) {
			const warnId = "analyze-warnings";
			report(
				onStep,
				warnId,
				"Analysis warnings",
				"skipped",
				stderr.trim().split("\n").pop() ?? "",
			);
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		report(onStep, stepId, "Run repoforge skills analysis", "error", msg);
	}
}
