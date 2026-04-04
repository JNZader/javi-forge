import fs from "fs-extra";
import { glob } from "glob";
import path from "path";
import { detectStack } from "../lib/common.js";
import type { InitStep } from "../types/index.js";

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

/**
 * Generate an llms.txt file — compact AI-friendly project notation.
 * Reduces token usage by ~75% compared to full README + docs.
 */
export async function generateLlmsTxt(
	projectDir: string,
	dryRun: boolean,
	onStep: StepCallback,
): Promise<void> {
	report(onStep, "scan", "Scan project structure", "running");

	const detection = await detectStack(projectDir);
	const stackLabel = detection?.stackType ?? "unknown";

	// Gather project info
	const name = path.basename(projectDir);
	let description = "";
	let version = "";
	let entryPoints: string[] = [];
	let dependencies: string[] = [];

	// Try package.json (Node)
	const pkgPath = path.join(projectDir, "package.json");
	if (await fs.pathExists(pkgPath)) {
		try {
			const pkg = await fs.readJson(pkgPath);
			description = pkg.description ?? "";
			version = pkg.version ?? "";
			entryPoints = pkg.main ? [pkg.main] : [];
			dependencies = Object.keys(pkg.dependencies ?? {}).slice(0, 15);
		} catch {
			/* ignore */
		}
	}

	// Scan source files
	const sourceFiles = await glob("src/**/*.{ts,tsx,js,jsx,py,go,rs}", {
		cwd: projectDir,
		ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
	});

	// Scan test files
	const testFiles = await glob("**/*.{test,spec}.{ts,tsx,js,jsx,py}", {
		cwd: projectDir,
		ignore: ["**/node_modules/**", "**/dist/**"],
	});

	report(
		onStep,
		"scan",
		"Scan project structure",
		"done",
		`${sourceFiles.length} source, ${testFiles.length} test files`,
	);

	// Build llms.txt content
	report(onStep, "generate", "Generate llms.txt", "running");

	const lines: string[] = [
		`# ${name}`,
		"",
		`> ${description || "No description"}`,
		"",
		`- stack: ${stackLabel}${detection?.buildTool ? ` (${detection.buildTool})` : ""}`,
		`- version: ${version || "unknown"}`,
		`- files: ${sourceFiles.length} source, ${testFiles.length} tests`,
		"",
	];

	// Structure summary (compact)
	if (sourceFiles.length > 0) {
		lines.push("## Structure");
		const dirs = new Map<string, number>();
		for (const f of sourceFiles) {
			const dir = path.dirname(f);
			dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
		}
		for (const [dir, count] of [...dirs.entries()].sort().slice(0, 20)) {
			lines.push(`- ${dir}/ (${count})`);
		}
		lines.push("");
	}

	// Dependencies (compact — name only, no versions)
	if (dependencies.length > 0) {
		lines.push("## Dependencies");
		lines.push(dependencies.join(", "));
		lines.push("");
	}

	// Entry points
	if (entryPoints.length > 0) {
		lines.push("## Entry");
		for (const ep of entryPoints) {
			lines.push(`- ${ep}`);
		}
		lines.push("");
	}

	const content = lines.join("\n");
	const tokenEstimate = Math.ceil(content.length / 4);

	if (!dryRun) {
		await fs.writeFile(path.join(projectDir, "llms.txt"), content, "utf-8");
	}

	report(
		onStep,
		"generate",
		"Generate llms.txt",
		"done",
		dryRun
			? `dry-run: ~${tokenEstimate} tokens (${content.length} chars)`
			: `written — ~${tokenEstimate} tokens (${content.length} chars)`,
	);
}
