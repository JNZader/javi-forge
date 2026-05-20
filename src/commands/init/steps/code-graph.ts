import path from "node:path";
import fs from "fs-extra";
import { TEMPLATES_DIR } from "../../../constants.js";
import { backupIfExists, ensureDirExists } from "../../../lib/common.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 15: Scaffold RepoForge code graph.
 *
 * - When options.codeGraph is false, reports "skipped".
 * - Otherwise:
 *   1. Copies .repoforge.yaml config (skip if exists).
 *   2. Ensures .repoforge/ output dir exists.
 *   3. Copies the graph generation CI workflow when ciProvider === "github".
 *   4. Copies the MCP config snippet with __PROJECT_NAME__ interpolation.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 5 of 6).
 */
export const stepCodeGraph: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { projectName, ciProvider } = options;
	const stepId = "code-graph";
	report(onStep, stepId, "Scaffold RepoForge code graph", "running");
	try {
		if (options.codeGraph) {
			if (!dryRun) {
				// 1. Copy .repoforge.yaml config
				const repoforgeConfigSrc = path.join(
					TEMPLATES_DIR,
					"common",
					"repoforge",
					"repoforge.yaml",
				);
				const repoforgeConfigDest = path.join(projectDir, ".repoforge.yaml");
				if (!(await fs.pathExists(repoforgeConfigDest))) {
					await fs.copy(repoforgeConfigSrc, repoforgeConfigDest);
				}

				// 2. Ensure .repoforge/ output dir exists
				await ensureDirExists(path.join(projectDir, ".repoforge"));

				// 3. Copy CI workflow for graph generation (GitHub only)
				if (ciProvider === "github") {
					const graphWorkflowSrc = path.join(
						TEMPLATES_DIR,
						"github",
						"repoforge-graph.yml",
					);
					if (await fs.pathExists(graphWorkflowSrc)) {
						const graphWorkflowDest = path.join(
							projectDir,
							".github",
							"workflows",
							"repoforge-graph.yml",
						);
						await ensureDirExists(path.dirname(graphWorkflowDest));
						await backupIfExists(graphWorkflowDest);
						await fs.copy(graphWorkflowSrc, graphWorkflowDest, {
							overwrite: false,
						});
					}
				}

				// 4. Copy MCP config snippet for repoforge code intelligence
				const mcpSnippetSrc = path.join(
					TEMPLATES_DIR,
					"common",
					"repoforge",
					"mcp-repoforge-snippet.json",
				);
				if (await fs.pathExists(mcpSnippetSrc)) {
					const mcpSnippetDest = path.join(
						projectDir,
						".repoforge",
						"mcp-config-snippet.json",
					);
					let content = await fs.readFile(mcpSnippetSrc, "utf-8");
					content = content.replace(/__PROJECT_NAME__/g, projectName);
					await fs.writeFile(mcpSnippetDest, content, "utf-8");
				}
			}
			report(
				onStep,
				stepId,
				"Scaffold RepoForge code graph",
				"done",
				dryRun
					? "dry-run: would scaffold .repoforge.yaml + CI + MCP"
					: ".repoforge.yaml + CI + MCP snippet",
			);
		} else {
			report(
				onStep,
				stepId,
				"Scaffold RepoForge code graph",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Scaffold RepoForge code graph", "error", String(e));
	}
};
