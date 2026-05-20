import path from "node:path";
import fs from "fs-extra";
import {
	AGENT_SKILLS_MANIFEST_FILE,
	LOCAL_AI_TEMPLATE_DIR,
	SECURITY_HOOKS_DIR,
	TEMPLATES_DIR,
} from "../constants.js";
import { backupIfExists, ensureDirExists } from "../lib/common.js";
import type {
	AgentSkillsManifest,
	ForgeManifest,
	HookProfile,
	InitOptions,
} from "../types/index.js";
import { report } from "./init/report.js";
import { stepAISync } from "./init/steps/ai-sync.js";
import { stepCITemplate, stepDependabot } from "./init/steps/ci.js";
import { stepClaudeMd } from "./init/steps/claude-md.js";
import { stepContextDir } from "./init/steps/context-dir.js";
import { stepDockerDeploy } from "./init/steps/docker-deploy.js";
import { stepGhagga } from "./init/steps/ghagga.js";
import { stepGitHooks, stepGitInit } from "./init/steps/git.js";
import { stepGitignore } from "./init/steps/gitignore.js";
import { stepMemory } from "./init/steps/memory.js";
import { stepMock } from "./init/steps/mock.js";
import { stepSDD } from "./init/steps/sdd.js";
import type { StepCallback, StepContext } from "./init/types.js";

/**
 * Main init orchestrator: bootstraps a project with CI, git hooks,
 * memory module, AI config sync, SDD, and ghagga.
 */
export async function initProject(
	options: InitOptions,
	onStep: StepCallback,
): Promise<void> {
	const {
		projectDir,
		projectName,
		stack,
		ciProvider,
		memory,
		aiSync,
		sdd,
		ghagga,
		contextDir,
		claudeMd,
		securityHooks,
		hookProfile,
		dryRun,
	} = options;

	// Ensure project directory exists before any steps
	if (!dryRun && projectDir) {
		await ensureDirExists(projectDir);
	}

	// Shared context passed to every extracted step. Other steps will be
	// migrated to this signature in PR 2-6.
	const ctx: StepContext = { options, projectDir, dryRun, onStep };

	// ── Step 1: Initialize git ────────────────────────────────────────────────
	await stepGitInit(ctx);

	// ── Step 2: Configure git hooks path ──────────────────────────────────────
	await stepGitHooks(ctx);

	// ── Step 3: Copy CI template ──────────────────────────────────────────────
	await stepCITemplate(ctx);

	// ── Step 4: Generate .gitignore ───────────────────────────────────────────
	await stepGitignore(ctx);

	// ── Step 5: Generate dependabot.yml ───────────────────────────────────────
	await stepDependabot(ctx);

	// ── Step 6: Install memory module ─────────────────────────────────────────
	await stepMemory(ctx);

	// ── Step 7: AI config sync (delegated to javi-ai) ──────────────────────────
	await stepAISync(ctx);

	// ── Step 8: SDD (Spec-Driven Development) ─────────────────────────────────
	await stepSDD(ctx);

	// ── Step 9: GHAGGA ────────────────────────────────────────────────────────
	await stepGhagga(ctx);

	// ── Step 10: Mock-first mode ───────────────────────────────────────────────
	await stepMock(ctx);

	// ── Step 11: Generate .context/ directory ──────────────────────────────────
	await stepContextDir(ctx);

	// ── Step 12: Generate CLAUDE.md (smart: project-aware) ─────────────────────
	await stepClaudeMd(ctx);

	// ── Step 13: Docker zero-downtime deploy ───────────────────────────────────
	await stepDockerDeploy(ctx);

	// ── Step 14: Security hooks scaffold ────────────────────────────────────────
	const stepSecurity = "security-hooks";
	report(onStep, stepSecurity, "Scaffold security hooks", "running");
	try {
		if (securityHooks) {
			if (await fs.pathExists(SECURITY_HOOKS_DIR)) {
				if (!dryRun) {
					// Copy 6-layer git security hooks into ci-local/hooks/security/
					const secHooksDest = path.join(
						projectDir,
						"ci-local",
						"hooks",
						"security",
					);
					await ensureDirExists(secHooksDest);
					const hookFiles = await fs.readdir(SECURITY_HOOKS_DIR);
					const gitHooks = hookFiles.filter((f) => !f.endsWith(".json"));
					for (const hook of gitHooks) {
						const src = path.join(SECURITY_HOOKS_DIR, hook);
						const dest = path.join(secHooksDest, hook);
						await fs.copy(src, dest, { overwrite: false });
						await fs.chmod(dest, 0o755);
					}

					// Copy runtime security settings (kiteguard-style) to .claude/
					const settingsSrc = path.join(
						SECURITY_HOOKS_DIR,
						"claude-settings-security.json",
					);
					if (await fs.pathExists(settingsSrc)) {
						const claudeDir = path.join(projectDir, ".claude");
						await ensureDirExists(claudeDir);
						const settingsDest = path.join(claudeDir, "settings.json");
						if (!(await fs.pathExists(settingsDest))) {
							await fs.copy(settingsSrc, settingsDest);
						}
					}
				}
				report(
					onStep,
					stepSecurity,
					"Scaffold security hooks",
					"done",
					dryRun
						? "dry-run: would scaffold security hooks"
						: "6 git layers + runtime hooks",
				);
			} else {
				report(
					onStep,
					stepSecurity,
					"Scaffold security hooks",
					"error",
					"security-hooks templates not found",
				);
			}
		} else {
			report(
				onStep,
				stepSecurity,
				"Scaffold security hooks",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepSecurity, "Scaffold security hooks", "error", String(e));
	}

	// ── Step 14b: Write hook profile ─────────────────────────────────────────────
	const stepHookProfile = "hook-profile";
	report(onStep, stepHookProfile, "Write hook reliability profile", "running");
	try {
		if (securityHooks) {
			if (!dryRun) {
				const hooksDir = path.join(projectDir, "ci-local", "hooks");
				await ensureDirExists(hooksDir);
				const profilePath = path.join(hooksDir, "profile.json");
				const resolvedProfile: HookProfile = hookProfile ?? "standard";
				await fs.writeJson(
					profilePath,
					{ profile: resolvedProfile },
					{ spaces: 2 },
				);
			}
			report(
				onStep,
				stepHookProfile,
				"Write hook reliability profile",
				"done",
				dryRun
					? `dry-run: would write profile.json (${hookProfile ?? "standard"})`
					: `ci-local/hooks/profile.json (${hookProfile ?? "standard"})`,
			);
		} else {
			report(
				onStep,
				stepHookProfile,
				"Write hook reliability profile",
				"skipped",
				"security hooks not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepHookProfile,
			"Write hook reliability profile",
			"error",
			String(e),
		);
	}

	// ── Step 15: RepoForge code graph scaffolding ───────────────────────────────
	const stepGraph = "code-graph";
	report(onStep, stepGraph, "Scaffold RepoForge code graph", "running");
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
				stepGraph,
				"Scaffold RepoForge code graph",
				"done",
				dryRun
					? "dry-run: would scaffold .repoforge.yaml + CI + MCP"
					: ".repoforge.yaml + CI + MCP snippet",
			);
		} else {
			report(
				onStep,
				stepGraph,
				"Scaffold RepoForge code graph",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepGraph,
			"Scaffold RepoForge code graph",
			"error",
			String(e),
		);
	}

	// ── Step 16: Local AI dev stack ────────────────────────────────────────────
	const stepLocalAi = "local-ai";
	report(onStep, stepLocalAi, "Scaffold local AI dev stack", "running");
	try {
		if (options.localAi) {
			if (await fs.pathExists(LOCAL_AI_TEMPLATE_DIR)) {
				const composeDest = path.join(projectDir, "docker-compose.yml");
				const envDest = path.join(projectDir, ".env.local-ai");
				if (!dryRun) {
					// Copy docker-compose.yml (skip if exists)
					if (!(await fs.pathExists(composeDest))) {
						await fs.copy(
							path.join(LOCAL_AI_TEMPLATE_DIR, "docker-compose.yml"),
							composeDest,
						);
					}
					// Copy .env.example as .env.local-ai
					const envSrc = path.join(LOCAL_AI_TEMPLATE_DIR, ".env.example");
					if (
						(await fs.pathExists(envSrc)) &&
						!(await fs.pathExists(envDest))
					) {
						await fs.copy(envSrc, envDest);
					}
				}
				report(
					onStep,
					stepLocalAi,
					"Scaffold local AI dev stack",
					"done",
					dryRun
						? "dry-run: would create docker-compose.yml + .env.local-ai"
						: "docker-compose.yml + .env.local-ai",
				);
			} else {
				report(
					onStep,
					stepLocalAi,
					"Scaffold local AI dev stack",
					"error",
					"local-ai template not found",
				);
			}
		} else {
			report(
				onStep,
				stepLocalAi,
				"Scaffold local AI dev stack",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepLocalAi,
			"Scaffold local AI dev stack",
			"error",
			String(e),
		);
	}

	// ── Step 17: Generate Agent Skills manifest (skills.json) ─────────────────
	const stepSkills = "agent-skills";
	report(
		onStep,
		stepSkills,
		"Generate Agent Skills manifest (skills.json)",
		"running",
	);
	try {
		if (!dryRun) {
			const skillsManifest: AgentSkillsManifest = {
				name: projectName,
				version: "0.1.0",
				description: `Agent Skills manifest for ${projectName}`,
				skills: [],
			};
			const skillsJsonPath = path.join(projectDir, AGENT_SKILLS_MANIFEST_FILE);
			if (!(await fs.pathExists(skillsJsonPath))) {
				await fs.writeJson(skillsJsonPath, skillsManifest, { spaces: 2 });
				report(
					onStep,
					stepSkills,
					"Generate Agent Skills manifest (skills.json)",
					"done",
					AGENT_SKILLS_MANIFEST_FILE,
				);
			} else {
				report(
					onStep,
					stepSkills,
					"Generate Agent Skills manifest (skills.json)",
					"done",
					"already exists",
				);
			}
		} else {
			report(
				onStep,
				stepSkills,
				"Generate Agent Skills manifest (skills.json)",
				"done",
				`dry-run: would generate ${AGENT_SKILLS_MANIFEST_FILE}`,
			);
		}
	} catch (e) {
		report(
			onStep,
			stepSkills,
			"Generate Agent Skills manifest (skills.json)",
			"error",
			String(e),
		);
	}

	// ── Step 18: Write manifest ───────────────────────────────────────────────
	const stepManifest = "manifest";
	report(onStep, stepManifest, "Write forge manifest", "running");
	try {
		if (!dryRun) {
			const manifestDir = path.join(projectDir, ".javi-forge");
			await ensureDirExists(manifestDir);
			const manifest: ForgeManifest = {
				version: "0.1.0",
				projectName,
				stack,
				ciProvider,
				memory,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modules: [
					...(memory !== "none" ? [memory] : []),
					...(ghagga ? ["ghagga"] : []),
					...(sdd ? ["sdd"] : []),
					...(aiSync ? ["ai-config"] : []),
					...(contextDir ? ["context"] : []),
					...(claudeMd ? ["claude-md"] : []),
					...(options.dockerDeploy ? ["docker-deploy"] : []),
					...(securityHooks ? ["security-hooks"] : []),
					...(options.codeGraph ? ["code-graph"] : []),
					...(options.localAi ? ["local-ai"] : []),
				],
			};
			await fs.writeJson(path.join(manifestDir, "manifest.json"), manifest, {
				spaces: 2,
			});
		}
		report(
			onStep,
			stepManifest,
			"Write forge manifest",
			"done",
			".javi-forge/manifest.json",
		);
	} catch (e) {
		report(onStep, stepManifest, "Write forge manifest", "error", String(e));
	}
}
