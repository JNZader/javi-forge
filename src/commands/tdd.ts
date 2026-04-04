import fs from "fs-extra";
import path from "path";
import type { Stack } from "../types/index.js";
import { detectCIStack } from "./ci.js";

// =============================================================================
// Types
// =============================================================================

export interface TddHookResult {
	installed: string[];
	errors: string[];
}

// =============================================================================
// Test command resolution
// =============================================================================

/**
 * Resolve the correct test command for TDD hook based on stack and build tool.
 * Returns null if no test command can be determined.
 */
export async function getTddTestCommand(
	stack: Stack,
	buildTool: string,
	projectDir: string,
): Promise<string | null> {
	switch (stack) {
		case "node": {
			const pkgPath = path.join(projectDir, "package.json");
			try {
				const pkgContent = await fs.readFile(pkgPath, "utf-8");
				if (!pkgContent.includes('"test"')) return null;
				return buildTool === "npm" ? "npm test" : `${buildTool} run test`;
			} catch {
				return null;
			}
		}
		case "python":
			return "pytest";
		case "go":
			return "go test ./...";
		default:
			return null;
	}
}

// =============================================================================
// Hook generation
// =============================================================================

/**
 * Generate a TDD-enforcing pre-commit hook script.
 * If testCmd is null, generates a warning-only hook.
 */
export function generateTddHook(testCmd: string | null, stack: Stack): string {
	if (!testCmd) {
		return `#!/bin/bash
# =============================================================================
# TDD PRE-COMMIT: No test command detected for stack "${stack}"
# =============================================================================
# Install a test runner and re-run: javi-forge tdd init
# =============================================================================

echo "TDD HOOK: No test command configured for stack '${stack}' — skipping."
exit 0
`;
	}

	return `#!/bin/bash
# =============================================================================
# TDD PRE-COMMIT: Enforced test-driven development
# =============================================================================
# Flow: Tests MUST pass before commit is allowed.
# Stack: ${stack} | Command: ${testCmd}
# To skip: git commit --no-verify
# =============================================================================

set -e

echo "TDD PRE-COMMIT: Running tests..."
echo "  Stack: ${stack}"
echo "  Command: ${testCmd}"
echo ""

${testCmd} || {
    echo ""
    echo "TDD FAILED — Tests did not pass."
    echo "  Fix failing tests before committing."
    echo "  To skip: git commit --no-verify"
    exit 1
}

echo ""
echo "TDD PASSED — All tests green. Commit allowed."
`;
}

// =============================================================================
// Hook installation
// =============================================================================

/**
 * Install TDD pre-commit hook into .git/hooks/.
 * Detects the project stack automatically and generates the appropriate hook.
 */
export async function installTddHooks(
	projectDir: string,
): Promise<TddHookResult> {
	const gitDir = path.join(projectDir, ".git");
	if (!(await fs.pathExists(gitDir))) {
		return {
			installed: [],
			errors: ["Not a git repository. Run git init first."],
		};
	}

	const hooksDir = path.join(gitDir, "hooks");
	await fs.ensureDir(hooksDir);

	// Detect stack
	let stackInfo: Awaited<ReturnType<typeof detectCIStack>> | undefined;
	try {
		stackInfo = await detectCIStack(projectDir);
	} catch {
		return { installed: [], errors: ["Failed to detect project stack."] };
	}

	const testCmd = await getTddTestCommand(
		stackInfo.stackType,
		stackInfo.buildTool,
		projectDir,
	);
	const hookContent = generateTddHook(testCmd, stackInfo.stackType);

	const installed: string[] = [];
	const errors: string[] = [];

	const hookPath = path.join(hooksDir, "pre-commit");
	try {
		await fs.writeFile(hookPath, hookContent, { mode: 0o755 });
		installed.push("pre-commit");
	} catch (e) {
		errors.push(`pre-commit: ${e instanceof Error ? e.message : String(e)}`);
	}

	return { installed, errors };
}
