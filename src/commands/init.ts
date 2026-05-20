import path from "node:path";
import fs from "fs-extra";
import { AGENT_SKILLS_MANIFEST_FILE } from "../constants.js";
import { ensureDirExists } from "../lib/common.js";
import type {
	AgentSkillsManifest,
	ForgeManifest,
	InitOptions,
} from "../types/index.js";
import { report } from "./init/report.js";
import { stepAISync } from "./init/steps/ai-sync.js";
import { stepCITemplate, stepDependabot } from "./init/steps/ci.js";
import { stepClaudeMd } from "./init/steps/claude-md.js";
import { stepCodeGraph } from "./init/steps/code-graph.js";
import { stepContextDir } from "./init/steps/context-dir.js";
import { stepDockerDeploy } from "./init/steps/docker-deploy.js";
import { stepGhagga } from "./init/steps/ghagga.js";
import { stepGitHooks, stepGitInit } from "./init/steps/git.js";
import { stepGitignore } from "./init/steps/gitignore.js";
import { stepLocalAi } from "./init/steps/local-ai.js";
import { stepMemory } from "./init/steps/memory.js";
import { stepMock } from "./init/steps/mock.js";
import { stepSDD } from "./init/steps/sdd.js";
import { stepHookProfile, stepSecurityHooks } from "./init/steps/security.js";
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
	await stepSecurityHooks(ctx);

	// ── Step 14b: Write hook profile ─────────────────────────────────────────────
	await stepHookProfile(ctx);

	// ── Step 15: RepoForge code graph scaffolding ───────────────────────────────
	await stepCodeGraph(ctx);

	// ── Step 16: Local AI dev stack ────────────────────────────────────────────
	await stepLocalAi(ctx);

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
