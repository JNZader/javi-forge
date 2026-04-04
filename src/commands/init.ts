import { execFile } from "child_process";
import fs from "fs-extra";
import path from "path";
import { promisify } from "util";
import {
	AGENT_SKILLS_MANIFEST_FILE,
	CI_LOCAL_DIR,
	FORGE_ROOT,
	LOCAL_AI_TEMPLATE_DIR,
	MODULES_DIR,
	SECURITY_HOOKS_DIR,
	TEMPLATES_DIR,
} from "../constants.js";
import { generateSmartClaudeMd } from "../lib/claudemd.js";
import { backupIfExists, ensureDirExists } from "../lib/common.js";
import { generateContextDir } from "../lib/context.js";
import { detectProjectStack } from "../lib/stack-detector.js";
import {
	generateCIWorkflow,
	generateDependabotYml,
	generateDeployWorkflow,
	getCIDestination,
	getDeployDestination,
} from "../lib/template.js";
import type {
	AgentSkillsManifest,
	ForgeManifest,
	HookProfile,
	InitOptions,
	InitStep,
} from "../types/index.js";

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

	// ── Step 1: Initialize git ────────────────────────────────────────────────
	const stepGit = "git-init";
	report(onStep, stepGit, "Initialize git repository", "running");
	try {
		const gitDir = path.join(projectDir, ".git");
		if (!(await fs.pathExists(gitDir))) {
			if (!dryRun) {
				await execFileAsync("git", ["init"], { cwd: projectDir });
			}
			report(
				onStep,
				stepGit,
				"Initialize git repository",
				"done",
				"initialized",
			);
		} else {
			report(
				onStep,
				stepGit,
				"Initialize git repository",
				"done",
				"already exists",
			);
		}
	} catch (e) {
		report(onStep, stepGit, "Initialize git repository", "error", String(e));
	}

	// ── Step 2: Configure git hooks path ──────────────────────────────────────
	const stepHooks = "git-hooks";
	report(onStep, stepHooks, "Configure git hooks path", "running");
	try {
		const ciLocalSrc = CI_LOCAL_DIR;
		const ciLocalDest = path.join(projectDir, "ci-local");
		if (await fs.pathExists(ciLocalSrc)) {
			if (!dryRun) {
				await fs.copy(ciLocalSrc, ciLocalDest, {
					overwrite: false,
					errorOnExist: false,
				});
				// Set core.hooksPath to ci-local/hooks
				const hooksDir = path.join(ciLocalDest, "hooks");
				if (await fs.pathExists(hooksDir)) {
					// Ensure hooks are executable
					const hookFiles = await fs.readdir(hooksDir);
					for (const hook of hookFiles) {
						await fs.chmod(path.join(hooksDir, hook), 0o755);
					}
					await execFileAsync(
						"git",
						["config", "core.hooksPath", "ci-local/hooks"],
						{ cwd: projectDir },
					);
				}
			}
			report(
				onStep,
				stepHooks,
				"Configure git hooks path",
				"done",
				"ci-local/hooks",
			);
		} else {
			report(
				onStep,
				stepHooks,
				"Configure git hooks path",
				"skipped",
				"no ci-local dir",
			);
		}
	} catch (e) {
		report(onStep, stepHooks, "Configure git hooks path", "error", String(e));
	}

	// ── Step 3: Copy CI template ──────────────────────────────────────────────
	const stepCI = "ci-template";
	report(onStep, stepCI, `Copy ${ciProvider} CI workflow`, "running");
	try {
		const ciContent = await generateCIWorkflow(stack, ciProvider);
		if (ciContent) {
			const dest = path.join(projectDir, getCIDestination(ciProvider));
			if (!dryRun) {
				await backupIfExists(dest);
				await ensureDirExists(path.dirname(dest));
				await fs.writeFile(dest, ciContent, "utf-8");
			}
			report(
				onStep,
				stepCI,
				`Copy ${ciProvider} CI workflow`,
				"done",
				getCIDestination(ciProvider),
			);
		} else {
			report(
				onStep,
				stepCI,
				`Copy ${ciProvider} CI workflow`,
				"skipped",
				`no template for ${stack}`,
			);
		}
	} catch (e) {
		report(
			onStep,
			stepCI,
			`Copy ${ciProvider} CI workflow`,
			"error",
			String(e),
		);
	}

	// ── Step 4: Generate .gitignore ───────────────────────────────────────────
	const stepGitignore = "gitignore";
	report(onStep, stepGitignore, "Generate .gitignore", "running");
	try {
		const templatePath = path.join(FORGE_ROOT, ".gitignore.template");
		const dest = path.join(projectDir, ".gitignore");
		if ((await fs.pathExists(templatePath)) && !(await fs.pathExists(dest))) {
			if (!dryRun) {
				await fs.copy(templatePath, dest);
			}
			report(
				onStep,
				stepGitignore,
				"Generate .gitignore",
				"done",
				"from template",
			);
		} else if (await fs.pathExists(dest)) {
			report(
				onStep,
				stepGitignore,
				"Generate .gitignore",
				"done",
				"already exists",
			);
		} else {
			report(
				onStep,
				stepGitignore,
				"Generate .gitignore",
				"skipped",
				"no template",
			);
		}
	} catch (e) {
		report(onStep, stepGitignore, "Generate .gitignore", "error", String(e));
	}

	// ── Step 5: Generate dependabot.yml ───────────────────────────────────────
	const stepDeps = "dependabot";
	report(onStep, stepDeps, "Generate dependabot.yml", "running");
	try {
		if (ciProvider === "github") {
			const content = await generateDependabotYml([stack], true);
			const dest = path.join(projectDir, ".github", "dependabot.yml");
			if (!dryRun) {
				await backupIfExists(dest);
				await ensureDirExists(path.dirname(dest));
				await fs.writeFile(dest, content, "utf-8");
			}
			report(onStep, stepDeps, "Generate dependabot.yml", "done");
		} else {
			report(
				onStep,
				stepDeps,
				"Generate dependabot.yml",
				"skipped",
				`not needed for ${ciProvider}`,
			);
		}
	} catch (e) {
		report(onStep, stepDeps, "Generate dependabot.yml", "error", String(e));
	}

	// ── Step 6: Install memory module ─────────────────────────────────────────
	const stepMem = "memory";
	report(onStep, stepMem, `Install memory module: ${memory}`, "running");
	try {
		if (memory !== "none") {
			const moduleSrc = path.join(MODULES_DIR, memory);
			if (await fs.pathExists(moduleSrc)) {
				if (!dryRun) {
					// Copy module files to project
					const moduleDest = path.join(
						projectDir,
						".javi-forge",
						"modules",
						memory,
					);
					await ensureDirExists(moduleDest);
					await fs.copy(moduleSrc, moduleDest, {
						overwrite: false,
						errorOnExist: false,
					});

					// If engram, copy .mcp-config-snippet.json to project with placeholder replacement
					if (memory === "engram") {
						const snippetSrc = path.join(moduleSrc, ".mcp-config-snippet.json");
						if (await fs.pathExists(snippetSrc)) {
							const snippetDest = path.join(
								projectDir,
								".mcp-config-snippet.json",
							);
							let content = await fs.readFile(snippetSrc, "utf-8");
							content = content.replace(/__PROJECT_NAME__/g, projectName);
							await fs.writeFile(snippetDest, content, "utf-8");
						}
					}
				}
				report(onStep, stepMem, `Install memory module: ${memory}`, "done");
			} else {
				report(
					onStep,
					stepMem,
					`Install memory module: ${memory}`,
					"error",
					"module not found",
				);
			}
		} else {
			report(
				onStep,
				stepMem,
				`Install memory module: ${memory}`,
				"skipped",
				"none selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepMem,
			`Install memory module: ${memory}`,
			"error",
			String(e),
		);
	}

	// ── Step 7: AI config sync (delegated to javi-ai) ──────────────────────────
	const stepAI = "ai-sync";
	report(onStep, stepAI, "Sync AI config via javi-ai", "running");
	try {
		if (aiSync) {
			if (!dryRun) {
				try {
					const { stderr } = await execFileAsync(
						"npx",
						["javi-ai", "sync", "--project-dir", projectDir, "--target", "all"],
						{
							cwd: projectDir,
							timeout: 120_000,
						},
					);
					// javi-ai may exit 0 but crash (e.g. Ink raw mode error) — detect via stderr
					if (
						stderr &&
						(stderr.includes("Raw mode is not supported") ||
							stderr.includes("ERROR"))
					) {
						report(
							onStep,
							stepAI,
							"Sync AI config via javi-ai",
							"error",
							"javi-ai crashed. Run manually: npx javi-ai sync --project-dir . --target all",
						);
					} else {
						report(
							onStep,
							stepAI,
							"Sync AI config via javi-ai",
							"done",
							"javi-ai sync --target all",
						);
					}
				} catch (syncErr: unknown) {
					const msg =
						syncErr instanceof Error ? syncErr.message : String(syncErr);
					if (
						msg.includes("ENOENT") ||
						msg.includes("not found") ||
						msg.includes("ERR_MODULE_NOT_FOUND")
					) {
						report(
							onStep,
							stepAI,
							"Sync AI config via javi-ai",
							"error",
							"javi-ai not found. Install with: npm install -g javi-ai (or run npx javi-ai sync manually)",
						);
					} else {
						report(onStep, stepAI, "Sync AI config via javi-ai", "error", msg);
					}
				}
			} else {
				report(
					onStep,
					stepAI,
					"Sync AI config via javi-ai",
					"done",
					"dry-run: would run javi-ai sync --target all",
				);
			}
		} else {
			report(
				onStep,
				stepAI,
				"Sync AI config via javi-ai",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepAI, "Sync AI config via javi-ai", "error", String(e));
	}

	// ── Step 8: SDD (Spec-Driven Development) ─────────────────────────────────
	const stepSDD = "sdd";
	report(onStep, stepSDD, "Set up SDD (openspec/)", "running");
	try {
		if (sdd) {
			if (!dryRun) {
				const openspecDir = path.join(projectDir, "openspec");
				await ensureDirExists(openspecDir);
				// Create a README if none exists
				const readmePath = path.join(openspecDir, "README.md");
				if (!(await fs.pathExists(readmePath))) {
					await fs.writeFile(
						readmePath,
						`# openspec/\n\nSpec-Driven Development artifacts for ${projectName}.\n\nSee: /sdd:new <name> to start a new change.\n`,
						"utf-8",
					);
				}
			}
			report(onStep, stepSDD, "Set up SDD (openspec/)", "done");
		} else {
			report(
				onStep,
				stepSDD,
				"Set up SDD (openspec/)",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepSDD, "Set up SDD (openspec/)", "error", String(e));
	}

	// ── Step 9: GHAGGA ────────────────────────────────────────────────────────
	const stepGhagga = "ghagga";
	report(onStep, stepGhagga, "Install GHAGGA review system", "running");
	try {
		if (ghagga) {
			const ghaggaSrc = path.join(MODULES_DIR, "ghagga");
			if (await fs.pathExists(ghaggaSrc)) {
				if (!dryRun) {
					const ghaggaDest = path.join(
						projectDir,
						".javi-forge",
						"modules",
						"ghagga",
					);
					await ensureDirExists(ghaggaDest);
					await fs.copy(ghaggaSrc, ghaggaDest, {
						overwrite: false,
						errorOnExist: false,
					});

					// Copy ghagga caller workflow to CI provider location
					if (ciProvider === "github") {
						const workflowSrc = path.join(
							FORGE_ROOT,
							"templates",
							"github",
							"ghagga-review.yml",
						);
						if (await fs.pathExists(workflowSrc)) {
							const workflowDest = path.join(
								projectDir,
								".github",
								"workflows",
								"ghagga-review.yml",
							);
							await ensureDirExists(path.dirname(workflowDest));
							await fs.copy(workflowSrc, workflowDest, { overwrite: false });
						}
					}
				}
				report(onStep, stepGhagga, "Install GHAGGA review system", "done");
			} else {
				report(
					onStep,
					stepGhagga,
					"Install GHAGGA review system",
					"error",
					"module not found",
				);
			}
		} else {
			report(
				onStep,
				stepGhagga,
				"Install GHAGGA review system",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepGhagga,
			"Install GHAGGA review system",
			"error",
			String(e),
		);
	}

	// ── Step 10: Mock-first mode ───────────────────────────────────────────────
	const stepMock = "mock";
	if (options.mock) {
		report(onStep, stepMock, "Configure mock-first mode", "running");
		try {
			if (!dryRun) {
				// Create .env.example with mock values
				const envExample = `# Mock environment — no real API keys required
# Copy to .env to use: cp .env.example .env

# Database
DATABASE_URL=postgresql://mock:mock@localhost:5432/mock_db

# Auth
JWT_SECRET=mock-jwt-secret-for-local-development
SESSION_SECRET=mock-session-secret

# External APIs (mock mode — no real calls)
MOCK_MODE=true
API_KEY=mock-api-key-not-real
STRIPE_KEY=sk_test_mock_not_real
SENDGRID_KEY=SG.mock_not_real

# Feature flags
ENABLE_ANALYTICS=false
ENABLE_EMAILS=false
ENABLE_WEBHOOKS=false
`;
				const envExamplePath = path.join(projectDir, ".env.example");
				if (!(await fs.pathExists(envExamplePath))) {
					await fs.writeFile(envExamplePath, envExample, "utf-8");
				}

				// Create .env from example
				const envPath = path.join(projectDir, ".env");
				if (!(await fs.pathExists(envPath))) {
					await fs.writeFile(envPath, envExample, "utf-8");
				}
			}
			report(
				onStep,
				stepMock,
				"Configure mock-first mode",
				"done",
				".env.example + .env with mock values",
			);
		} catch (e) {
			report(onStep, stepMock, "Configure mock-first mode", "error", String(e));
		}
	} else {
		report(
			onStep,
			stepMock,
			"Configure mock-first mode",
			"skipped",
			"not selected",
		);
	}

	// ── Step 11: Generate .context/ directory ──────────────────────────────────
	const stepContext = "context-dir";
	report(onStep, stepContext, "Generate .context/ directory", "running");
	try {
		if (contextDir) {
			const contextDirPath = path.join(projectDir, ".context");
			if (await fs.pathExists(contextDirPath)) {
				report(
					onStep,
					stepContext,
					"Generate .context/ directory",
					"done",
					"already exists",
				);
			} else {
				if (!dryRun) {
					const { index, summary } = await generateContextDir(options);
					await ensureDirExists(contextDirPath);
					await fs.writeFile(
						path.join(contextDirPath, "INDEX.md"),
						index,
						"utf-8",
					);
					await fs.writeFile(
						path.join(contextDirPath, "summary.md"),
						summary,
						"utf-8",
					);
				}
				report(
					onStep,
					stepContext,
					"Generate .context/ directory",
					"done",
					dryRun
						? "dry-run: would generate .context/"
						: ".context/INDEX.md + summary.md",
				);
			}
		} else {
			report(
				onStep,
				stepContext,
				"Generate .context/ directory",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepContext,
			"Generate .context/ directory",
			"error",
			String(e),
		);
	}

	// ── Step 12: Generate CLAUDE.md (smart: project-aware) ─────────────────────
	const stepClaudeMd = "claude-md";
	report(onStep, stepClaudeMd, "Generate CLAUDE.md", "running");
	try {
		if (claudeMd) {
			const claudeMdPath = path.join(projectDir, "CLAUDE.md");
			if (await fs.pathExists(claudeMdPath)) {
				report(
					onStep,
					stepClaudeMd,
					"Generate CLAUDE.md",
					"done",
					"already exists",
				);
			} else {
				if (!dryRun) {
					// Detect project stack for smart CLAUDE.md generation
					const detection = await detectProjectStack(projectDir).catch(
						() => null,
					);
					const content = generateSmartClaudeMd(options, detection);
					await fs.writeFile(claudeMdPath, content, "utf-8");
					const skillCount = detection?.recommendedSkills.length ?? 0;
					report(
						onStep,
						stepClaudeMd,
						"Generate CLAUDE.md",
						"done",
						skillCount > 0
							? `CLAUDE.md (${skillCount} skills detected)`
							: "CLAUDE.md",
					);
				} else {
					report(
						onStep,
						stepClaudeMd,
						"Generate CLAUDE.md",
						"done",
						"dry-run: would generate CLAUDE.md",
					);
				}
			}
		} else {
			report(
				onStep,
				stepClaudeMd,
				"Generate CLAUDE.md",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepClaudeMd, "Generate CLAUDE.md", "error", String(e));
	}

	// ── Step 13: Docker zero-downtime deploy ───────────────────────────────────
	const stepDeploy = "docker-deploy";
	report(onStep, stepDeploy, "Scaffold Docker zero-downtime deploy", "running");
	try {
		if (options.dockerDeploy) {
			const deployDest = getDeployDestination(ciProvider);
			if (deployDest) {
				const fullDest = path.join(projectDir, deployDest);
				if (await fs.pathExists(fullDest)) {
					report(
						onStep,
						stepDeploy,
						"Scaffold Docker zero-downtime deploy",
						"done",
						"already exists",
					);
				} else {
					const serviceName = options.dockerServiceName || "app";
					const content = await generateDeployWorkflow(ciProvider, serviceName);
					if (content) {
						if (!dryRun) {
							await backupIfExists(fullDest);
							await ensureDirExists(path.dirname(fullDest));
							await fs.writeFile(fullDest, content, "utf-8");
						}
						report(
							onStep,
							stepDeploy,
							"Scaffold Docker zero-downtime deploy",
							"done",
							dryRun ? `dry-run: would create ${deployDest}` : deployDest,
						);
					} else {
						report(
							onStep,
							stepDeploy,
							"Scaffold Docker zero-downtime deploy",
							"error",
							`no deploy template for ${ciProvider}`,
						);
					}
				}
			} else {
				report(
					onStep,
					stepDeploy,
					"Scaffold Docker zero-downtime deploy",
					"error",
					`no deploy destination for ${ciProvider}`,
				);
			}
		} else {
			report(
				onStep,
				stepDeploy,
				"Scaffold Docker zero-downtime deploy",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepDeploy,
			"Scaffold Docker zero-downtime deploy",
			"error",
			String(e),
		);
	}

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
