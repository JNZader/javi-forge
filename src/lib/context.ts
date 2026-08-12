import path from "node:path";
import fs from "fs-extra";
import { STACK_CONTEXT_MAP } from "../constants.js";
import type {
	ForgeManifest,
	InitOptions,
	StackContextEntry,
} from "../types/index.js";
import { describeSafeReadFailure, safeReadFile } from "./safe-read.js";

// =============================================================================
// Internal helpers
// =============================================================================

function getStackContext(stack: string): StackContextEntry {
	return STACK_CONTEXT_MAP[stack] ?? STACK_CONTEXT_MAP.default;
}

export function buildIndexMd(
	projectName: string,
	stackCtx: StackContextEntry,
	ciProvider: string,
	memory: string,
): string {
	return `# ${projectName} — Project Index

## Structure

\`\`\`
${stackCtx.tree}
\`\`\`

## Entry Point

\`${stackCtx.entryPoint}\`

## Conventions

- **Stack**: ${stackCtx.conventions}
- **CI**: ${ciProvider}
- **Memory**: ${memory}
`;
}

export function buildSummaryMd(
	projectName: string,
	stack: string,
	ciProvider: string,
	memory: string,
	modules: string[],
	dependencies: string[] = [],
): string {
	const modulesList = modules.length > 0 ? modules.join(", ") : "none";
	const depsList =
		dependencies.length > 0 ? dependencies.join(", ") : "none detected";

	return `# ${projectName}

## Overview

${stack}-based project scaffolded with javi-forge.

## Stack

- **Runtime**: ${stack}
- **CI**: ${ciProvider}
- **Memory**: ${memory}
- **Modules**: ${modulesList}
- **Dependencies**: ${depsList}

## Key Decisions

- Scaffolded with javi-forge
- AI-ready project structure with .context/ directory
`;
}

// =============================================================================
// Dependency detection
// =============================================================================

const MAX_DEPS = 10;

/**
 * Byte ceiling for a dependency manifest. A package.json or go.mod past this is
 * not a manifest we can learn anything useful from — it is generated noise.
 */
const MAX_MANIFEST_BYTES = 512 * 1024;

/**
 * Dependency detection outcome. `warnings` explains every manifest that could
 * not be read or parsed, so a failure is distinguishable from "no dependencies"
 * instead of being swallowed by a blanket catch.
 */
export interface DependencyDetection {
	dependencies: string[];
	warnings: string[];
}

/** Read a manifest under a byte budget; returns null and a warning on failure. */
async function readManifest(
	manifestPath: string,
	warnings: string[],
): Promise<string | null> {
	const read = await safeReadFile(manifestPath, {
		hardRejectOverBytes: MAX_MANIFEST_BYTES,
	});
	if (!read.ok) {
		warnings.push(
			`${path.basename(manifestPath)}: ${describeSafeReadFailure(read)}`,
		);
		return null;
	}
	if (read.truncated) {
		warnings.push(
			`${path.basename(manifestPath)}: truncated at ${read.bytesRead} of ${read.totalBytes} bytes`,
		);
	}
	return read.content;
}

/**
 * Detect top-level dependencies from project manifest files, reporting why a
 * manifest was skipped. Returns up to 10 dependency names (key deps only).
 */
export async function detectDependenciesDetailed(
	projectDir: string,
	stack: string,
): Promise<DependencyDetection> {
	const warnings: string[] = [];

	switch (stack) {
		case "node": {
			const pkgPath = path.join(projectDir, "package.json");
			if (!(await fs.pathExists(pkgPath)))
				return { dependencies: [], warnings };
			const content = await readManifest(pkgPath, warnings);
			if (content === null) return { dependencies: [], warnings };
			let pkg: { dependencies?: Record<string, unknown> };
			try {
				pkg = JSON.parse(content);
			} catch (err) {
				warnings.push(
					`package.json: invalid JSON (${err instanceof Error ? err.message : String(err)})`,
				);
				return { dependencies: [], warnings };
			}
			const deps = Object.keys(pkg?.dependencies ?? {});
			return { dependencies: deps.slice(0, MAX_DEPS), warnings };
		}
		case "python": {
			const pyprojectPath = path.join(projectDir, "pyproject.toml");
			if (await fs.pathExists(pyprojectPath)) {
				const content = await readManifest(pyprojectPath, warnings);
				const match = content?.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
				if (match?.[1]) {
					const deps = match[1]
						.split("\n")
						.map((l) => l.replace(/[",]/g, "").trim())
						.filter((l) => l.length > 0 && !l.startsWith("#"))
						.map((l) => l.split(/[>=<~!]/)[0].trim())
						.filter(Boolean);
					return { dependencies: deps.slice(0, MAX_DEPS), warnings };
				}
			}
			const reqPath = path.join(projectDir, "requirements.txt");
			if (await fs.pathExists(reqPath)) {
				const content = await readManifest(reqPath, warnings);
				if (content === null) return { dependencies: [], warnings };
				const deps = content
					.split("\n")
					.map((l) => l.trim())
					.filter(
						(l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("-"),
					)
					.map((l) => l.split(/[>=<~!]/)[0].trim())
					.filter(Boolean);
				return { dependencies: deps.slice(0, MAX_DEPS), warnings };
			}
			return { dependencies: [], warnings };
		}
		case "go": {
			const goModPath = path.join(projectDir, "go.mod");
			if (!(await fs.pathExists(goModPath)))
				return { dependencies: [], warnings };
			const content = await readManifest(goModPath, warnings);
			const requireBlock = content?.match(/require\s*\(([\s\S]*?)\)/);
			if (requireBlock?.[1]) {
				const deps = requireBlock[1]
					.split("\n")
					.map((l) => l.trim())
					.filter((l) => l.length > 0 && !l.startsWith("//"))
					.map((l) => {
						const parts = l.split(/\s+/);
						const mod = parts[0] ?? "";
						return mod.split("/").pop() ?? mod;
					})
					.filter(Boolean);
				return { dependencies: deps.slice(0, MAX_DEPS), warnings };
			}
			return { dependencies: [], warnings };
		}
		case "rust": {
			const cargoPath = path.join(projectDir, "Cargo.toml");
			if (!(await fs.pathExists(cargoPath)))
				return { dependencies: [], warnings };
			const content = await readManifest(cargoPath, warnings);
			const depsSection = content?.match(
				/\[dependencies\]([\s\S]*?)(?=\n\[|$)/,
			);
			if (depsSection?.[1]) {
				const deps = depsSection[1]
					.split("\n")
					.map((l) => l.trim())
					.filter((l) => l.length > 0 && !l.startsWith("#"))
					.map((l) => l.split(/\s*=/)[0].trim())
					.filter(Boolean);
				return { dependencies: deps.slice(0, MAX_DEPS), warnings };
			}
			return { dependencies: [], warnings };
		}
		default:
			return { dependencies: [], warnings };
	}
}

/**
 * Detect top-level dependencies from project manifest files.
 * Returns up to 10 dependency names (key deps only, not devDeps).
 *
 * List-returning convenience over `detectDependenciesDetailed`. It DISCARDS the
 * read/parse warnings — an unreadable manifest is indistinguishable from an
 * honest empty list through this function. Callers that must tell those two
 * apart (like `refreshContextDir`) call `detectDependenciesDetailed` directly.
 */
export async function detectDependencies(
	projectDir: string,
	stack: string,
): Promise<string[]> {
	const { dependencies } = await detectDependenciesDetailed(projectDir, stack);
	return dependencies;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate .context/ directory content from InitOptions metadata.
 * Pure function — does NOT perform filesystem I/O.
 */
export async function generateContextDir(
	options: InitOptions,
): Promise<{ index: string; summary: string }> {
	const { projectName, stack, ciProvider, memory } = options;

	const stackCtx = getStackContext(stack);

	// Collect enabled modules for summary
	const modules: string[] = [];
	if (options.aiSync) modules.push("ai-sync");
	if (options.sdd) modules.push("sdd");
	if (options.ghagga) modules.push("ghagga");
	if (options.mock) modules.push("mock");
	if (options.contextDir) modules.push("context");

	const index = buildIndexMd(projectName, stackCtx, ciProvider, memory);
	const summary = buildSummaryMd(
		projectName,
		stack,
		ciProvider,
		memory,
		modules,
	);

	return { index, summary };
}

/**
 * Refresh .context/ directory from the forge manifest and live project state.
 * Reads manifest, detects current dependencies, regenerates INDEX.md + summary.md.
 * Returns null if the project is not forge-managed or has no .context/ dir.
 */
export async function refreshContextDir(projectDir: string): Promise<{
	index: string;
	summary: string;
	updated: boolean;
	/** Manifest read/parse warnings — surfaced so an unreadable manifest is not
	 * silently reported as a project with no dependencies. */
	warnings: string[];
} | null> {
	const manifestPath = path.join(projectDir, ".javi-forge", "manifest.json");
	const contextDirPath = path.join(projectDir, ".context");

	// Only refresh if forge-managed and .context/ exists
	if (
		!(await fs.pathExists(manifestPath)) ||
		!(await fs.pathExists(contextDirPath))
	) {
		return null;
	}

	let manifest: ForgeManifest;
	try {
		manifest = (await fs.readJson(manifestPath)) as ForgeManifest;
	} catch {
		return null;
	}

	const stackCtx = getStackContext(manifest.stack);
	const { dependencies, warnings } = await detectDependenciesDetailed(
		projectDir,
		manifest.stack,
	);

	const index = buildIndexMd(
		manifest.projectName,
		stackCtx,
		manifest.ciProvider,
		manifest.memory,
	);
	const summary = buildSummaryMd(
		manifest.projectName,
		manifest.stack,
		manifest.ciProvider,
		manifest.memory,
		manifest.modules,
		dependencies,
	);

	// Write updated files
	await fs.writeFile(path.join(contextDirPath, "INDEX.md"), index, "utf-8");
	await fs.writeFile(path.join(contextDirPath, "summary.md"), summary, "utf-8");

	// Update manifest timestamp
	manifest.updatedAt = new Date().toISOString();
	await fs.writeJson(manifestPath, manifest, { spaces: 2 });

	return { index, summary, updated: true, warnings };
}
