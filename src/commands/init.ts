import { ensureDirExists } from "../lib/common.js";
import type { InitOptions } from "../types/index.js";
import { stepAgentSkills } from "./init/steps/agent-skills.js";
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
import { stepManifest } from "./init/steps/manifest.js";
import { stepMemory } from "./init/steps/memory.js";
import { stepMock } from "./init/steps/mock.js";
import { stepSDD } from "./init/steps/sdd.js";
import { stepHookProfile, stepSecurityHooks } from "./init/steps/security.js";
import type { StepCallback, StepContext } from "./init/types.js";

/**
 * Main init orchestrator: bootstraps a project with CI, git hooks,
 * memory module, AI config sync, SDD, ghagga, and friends.
 *
 * Pure dispatch: every step lives in src/commands/init/steps/.
 */
export async function initProject(
	options: InitOptions,
	onStep: StepCallback,
): Promise<void> {
	const { projectDir, dryRun } = options;

	// Ensure project directory exists before any steps
	if (!dryRun && projectDir) {
		await ensureDirExists(projectDir);
	}

	// Shared context passed to every step.
	const ctx: StepContext = { options, projectDir, dryRun, onStep };

	await stepGitInit(ctx);
	await stepGitHooks(ctx);
	await stepCITemplate(ctx);
	await stepGitignore(ctx);
	await stepDependabot(ctx);
	await stepMemory(ctx);
	await stepAISync(ctx);
	await stepSDD(ctx);
	await stepGhagga(ctx);
	await stepMock(ctx);
	await stepContextDir(ctx);
	await stepClaudeMd(ctx);
	await stepDockerDeploy(ctx);
	await stepSecurityHooks(ctx);
	await stepHookProfile(ctx);
	await stepCodeGraph(ctx);
	await stepLocalAi(ctx);
	await stepAgentSkills(ctx);
	await stepManifest(ctx);
}
