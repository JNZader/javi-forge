import fs from "fs-extra";
import path from "path";
import type {
	WorkflowGraph,
	WorkflowValidationResult,
} from "../../types/index.js";

/**
 * Built-in check functions that map node `check` attributes to project validations.
 * Each check receives the project directory and returns { pass, detail }.
 */
const BUILTIN_CHECKS: Record<
	string,
	(projectDir: string) => Promise<{ pass: boolean; detail: string }>
> = {
	"has-linter": async (dir) => {
		const eslintConfig = [
			".eslintrc",
			".eslintrc.js",
			".eslintrc.json",
			".eslintrc.yml",
			"eslint.config.js",
			"eslint.config.mjs",
			"eslint.config.ts",
		];
		const ruffConfig = ["ruff.toml", ".ruff.toml"];
		const golangci = [".golangci.yml", ".golangci.yaml"];
		const configs = [...eslintConfig, ...ruffConfig, ...golangci];

		for (const cfg of configs) {
			if (await fs.pathExists(path.join(dir, cfg))) {
				return { pass: true, detail: `Found ${cfg}` };
			}
		}

		// Check package.json for eslint dependency
		const pkgPath = path.join(dir, "package.json");
		if (await fs.pathExists(pkgPath)) {
			try {
				const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>;
				const deps = {
					...(pkg["devDependencies"] as Record<string, string> | undefined),
					...(pkg["dependencies"] as Record<string, string> | undefined),
				};
				if (deps["eslint"] || deps["biome"] || deps["oxlint"]) {
					return { pass: true, detail: "Linter found in package.json" };
				}
			} catch {
				/* ignore */
			}
		}

		return { pass: false, detail: "No linter configuration found" };
	},

	"has-tests": async (dir) => {
		const testPatterns = [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"src/**/*.spec.ts",
			"tests/",
			"test/",
			"__tests__/",
			"src/**/*_test.go",
			"*_test.go",
			"tests/test_*.py",
			"test_*.py",
		];
		for (const pattern of testPatterns) {
			const target = path.join(dir, pattern.split("*")[0] ?? "");
			if (await fs.pathExists(target)) {
				return {
					pass: true,
					detail: `Found test path: ${pattern.split("*")[0]}`,
				};
			}
		}
		return { pass: false, detail: "No test files or directories found" };
	},

	"has-ci": async (dir) => {
		const ciPaths = [
			".github/workflows",
			".gitlab-ci.yml",
			".woodpecker.yml",
			".woodpecker/",
			"Jenkinsfile",
			".circleci/config.yml",
		];
		for (const p of ciPaths) {
			if (await fs.pathExists(path.join(dir, p))) {
				return { pass: true, detail: `Found ${p}` };
			}
		}
		return { pass: false, detail: "No CI configuration found" };
	},

	"has-dockerfile": async (dir) => {
		const dockerfiles = [
			"Dockerfile",
			"docker-compose.yml",
			"docker-compose.yaml",
			"compose.yml",
			"compose.yaml",
		];
		for (const f of dockerfiles) {
			if (await fs.pathExists(path.join(dir, f))) {
				return { pass: true, detail: `Found ${f}` };
			}
		}
		return { pass: false, detail: "No Dockerfile or compose file found" };
	},

	"has-security": async (dir) => {
		const secPaths = [
			".javi-forge/security-baseline.json",
			"semgrep.yml",
			".semgrep.yml",
			".snyk",
		];
		for (const p of secPaths) {
			if (await fs.pathExists(path.join(dir, p))) {
				return { pass: true, detail: `Found ${p}` };
			}
		}
		return { pass: false, detail: "No security scanning configuration found" };
	},

	"has-docs": async (dir) => {
		const docPaths = ["docs/", "README.md", "doc/", "documentation/"];
		for (const p of docPaths) {
			if (await fs.pathExists(path.join(dir, p))) {
				return { pass: true, detail: `Found ${p}` };
			}
		}
		return { pass: false, detail: "No documentation found" };
	},

	"has-changelog": async (dir) => {
		const files = ["CHANGELOG.md", "CHANGES.md", "HISTORY.md"];
		for (const f of files) {
			if (await fs.pathExists(path.join(dir, f))) {
				return { pass: true, detail: `Found ${f}` };
			}
		}
		return { pass: false, detail: "No changelog found" };
	},

	"has-license": async (dir) => {
		const files = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"];
		for (const f of files) {
			if (await fs.pathExists(path.join(dir, f))) {
				return { pass: true, detail: `Found ${f}` };
			}
		}
		return { pass: false, detail: "No license file found" };
	},
};

/**
 * Validate a project directory against a workflow graph.
 * Nodes with a `check` attribute are evaluated against built-in checks.
 * Nodes without a `check` attribute are skipped.
 */
export async function validateWorkflow(
	graph: WorkflowGraph,
	projectDir: string,
): Promise<WorkflowValidationResult[]> {
	const results: WorkflowValidationResult[] = [];

	for (const node of graph.nodes) {
		if (!node.check) {
			results.push({
				node: node.id,
				status: "skip",
				detail: "No check defined",
			});
			continue;
		}

		const checkFn = BUILTIN_CHECKS[node.check];
		if (!checkFn) {
			results.push({
				node: node.id,
				status: "skip",
				detail: `Unknown check: ${node.check}`,
			});
			continue;
		}

		try {
			const { pass, detail } = await checkFn(projectDir);
			results.push({
				node: node.id,
				status: pass ? "pass" : "fail",
				detail,
			});
		} catch (e) {
			results.push({
				node: node.id,
				status: "fail",
				detail: `Check error: ${e instanceof Error ? e.message : String(e)}`,
			});
		}
	}

	return results;
}

/** Expose check names for testing and documentation */
export function getAvailableChecks(): string[] {
	return Object.keys(BUILTIN_CHECKS);
}
