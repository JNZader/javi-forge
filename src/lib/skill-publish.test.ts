import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishSkill } from "./skill-publish.js";

// =============================================================================
// Real-fs tests for publishSkill.
//
// The previous version mocked fs-extra AND ./frontmatter.js, so every
// assertion verified that the mocked frontmatter shape produced the expected
// manifest shape — bypassing the actual SKILL.md → manifest pipeline. Mock
// refactor (M6) drops both mocks: each test writes a real SKILL.md (with
// YAML frontmatter) to a tmpdir and runs the actual publish flow.
//
// This catches drift between the publish command and the frontmatter parser
// that the mock-asserted version never could.
// =============================================================================

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-skill-pub-"));
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

/** Build a skill directory with a real SKILL.md containing frontmatter. */
async function writeSkill(
	dirName: string,
	frontmatter: Record<string, unknown>,
	body = "# Skill body\n",
): Promise<string> {
	const skillDir = path.join(tmpDir, dirName);
	await fs.ensureDir(skillDir);
	const yamlLines = Object.entries(frontmatter).map(([k, v]) => {
		if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
		return `${k}: ${v}`;
	});
	const content = `---\n${yamlLines.join("\n")}\n---\n${body}`;
	await fs.writeFile(path.join(skillDir, "SKILL.md"), content);
	return skillDir;
}

describe("publishSkill", () => {
	it("fails when SKILL.md does not exist", async () => {
		const skillDir = path.join(tmpDir, "react-19");
		await fs.ensureDir(skillDir);
		// No SKILL.md inside the dir.

		const result = await publishSkill({ skillDir });
		expect(result.success).toBe(false);
		expect(result.error).toContain("SKILL.md not found");
	});

	it("generates plugin.json from SKILL.md frontmatter", async () => {
		const skillDir = await writeSkill("react-19", {
			name: "react-19",
			version: "2.0.0",
			description: "React 19 patterns and best practices for modern components",
		});

		const result = await publishSkill({ skillDir });
		expect(result.success).toBe(true);
		expect(result.manifest?.name).toBe("react-19");
		expect(result.manifest?.version).toBe("2.0.0");
		expect(result.manifest?.skills).toEqual(["react-19"]);

		// The real implementation writes the plugin.json next to SKILL.md.
		// We can verify it landed on disk.
		const pluginJsonPath = path.join(skillDir, "plugin.json");
		expect(await fs.pathExists(pluginJsonPath)).toBe(true);
		const written = await fs.readJson(pluginJsonPath);
		expect(written.name).toBe("react-19");
	});

	it("falls back to directory name when frontmatter has no name", async () => {
		// SKILL.md present but its frontmatter is empty.
		const skillDir = path.join(tmpDir, "my-skill");
		await fs.ensureDir(skillDir);
		await fs.writeFile(
			path.join(skillDir, "SKILL.md"),
			"# Some Skill\nContent here\n",
		);

		const result = await publishSkill({ skillDir });
		expect(result.success).toBe(true);
		expect(result.manifest?.name).toBe("my-skill");
	});

	it("rejects non-kebab-case names", async () => {
		const skillDir = await writeSkill("MySkill", { name: "MySkill" });
		const result = await publishSkill({ skillDir });
		expect(result.success).toBe(false);
		expect(result.error).toContain("kebab-case");
	});

	it("rejects too-short descriptions", async () => {
		const skillDir = await writeSkill("test-skill", {
			name: "test-skill",
			description: "short",
		});
		const result = await publishSkill({ skillDir });
		expect(result.success).toBe(false);
		expect(result.error).toContain("at least 10 characters");
	});

	it("includes author and repository when provided", async () => {
		const skillDir = await writeSkill("test-skill", {
			name: "test-skill",
			description: "A test skill with enough description length",
		});

		const result = await publishSkill({
			skillDir,
			author: "JNZader",
			repository: "https://github.com/JNZader/test-skill",
			tags: ["testing", "typescript"],
		});
		expect(result.success).toBe(true);
		expect(result.manifest?.author).toBe("JNZader");
		expect(result.manifest?.repository).toBe(
			"https://github.com/JNZader/test-skill",
		);
		expect(result.manifest?.tags).toEqual(["testing", "typescript"]);
	});

	it("extracts tags from description when none provided", async () => {
		const skillDir = await writeSkill("react-patterns", {
			name: "react-patterns",
			description: "React and TypeScript patterns for testing components",
		});

		const result = await publishSkill({ skillDir });
		expect(result.success).toBe(true);
		expect(result.manifest?.tags).toContain("react");
		expect(result.manifest?.tags).toContain("typescript");
		expect(result.manifest?.tags).toContain("testing");
	});

	it("respects dryRun flag — does not write plugin.json to disk", async () => {
		const skillDir = await writeSkill("dry-skill", {
			name: "dry-skill",
			description: "A dry run test skill for validation",
		});

		const result = await publishSkill({ skillDir, dryRun: true });
		expect(result.success).toBe(true);
		// dryRun must not produce side effects on disk.
		expect(await fs.pathExists(path.join(skillDir, "plugin.json"))).toBe(false);
	});

	it("truncates description over 200 chars", async () => {
		const longDesc = "A".repeat(250);
		const skillDir = await writeSkill("long-desc", {
			name: "long-desc",
			description: longDesc,
		});

		const result = await publishSkill({ skillDir, dryRun: true });
		expect(result.success).toBe(true);
		expect(result.manifest?.description.length).toBeLessThanOrEqual(200);
		expect(result.manifest?.description).toContain("...");
	});
});
