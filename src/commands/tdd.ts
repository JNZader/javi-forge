import path from "node:path";
import fs from "fs-extra";
import type { Stack } from "../types/index.js";

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
