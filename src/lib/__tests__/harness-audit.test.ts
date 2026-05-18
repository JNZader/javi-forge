import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectAllHarnesses,
	detectHarness,
	type Harness,
	runHarnessAudit,
} from "../harness-audit.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-test-"));
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

// ── detectHarness ──

describe("detectHarness", () => {
	it("detects claude from .claude dir", async () => {
		await fs.ensureDir(path.join(tmpDir, ".claude"));
		const result = detectHarness(tmpDir);
		expect(result.harness).toBe("claude");
		expect(result.configDir).toBe(path.join(tmpDir, ".claude"));
	});

	it("detects claude from CLAUDE.md", async () => {
		await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), "# Config");
		const result = detectHarness(tmpDir);
		expect(result.harness).toBe("claude");
	});

	it("detects cursor from .cursor dir", async () => {
		await fs.ensureDir(path.join(tmpDir, ".cursor"));
		expect(detectHarness(tmpDir).harness).toBe("cursor");
	});

	it("detects cursor from .cursorrules", async () => {
		await fs.writeFile(path.join(tmpDir, ".cursorrules"), "rules");
		expect(detectHarness(tmpDir).harness).toBe("cursor");
	});

	it("detects codex from AGENTS.md", async () => {
		await fs.writeFile(path.join(tmpDir, "AGENTS.md"), "# Agents");
		expect(detectHarness(tmpDir).harness).toBe("codex");
	});

	it("detects copilot from copilot-instructions.md", async () => {
		await fs.ensureDir(path.join(tmpDir, ".github"));
		await fs.writeFile(
			path.join(tmpDir, ".github/copilot-instructions.md"),
			"# Instructions",
		);
		expect(detectHarness(tmpDir).harness).toBe("copilot");
	});

	it("detects windsurf from .windsurfrules", async () => {
		await fs.writeFile(path.join(tmpDir, ".windsurfrules"), "rules");
		expect(detectHarness(tmpDir).harness).toBe("windsurf");
	});

	it("returns none when nothing found", () => {
		const origHome = process.env.HOME;
		process.env.HOME = tmpDir; // isolate from real ~/.claude
		try {
			expect(detectHarness(tmpDir).harness).toBe("none");
		} finally {
			process.env.HOME = origHome;
		}
	});

	it("claude takes priority (checked first)", async () => {
		await fs.ensureDir(path.join(tmpDir, ".claude"));
		await fs.ensureDir(path.join(tmpDir, ".cursor"));
		expect(detectHarness(tmpDir).harness).toBe("claude");
	});
});

// ── detectAllHarnesses ──

describe("detectAllHarnesses", () => {
	it("finds multiple harnesses", async () => {
		await fs.ensureDir(path.join(tmpDir, ".claude"));
		await fs.ensureDir(path.join(tmpDir, ".cursor"));
		const results = detectAllHarnesses(tmpDir);
		const names = results.map((r) => r.harness);
		expect(names).toContain("claude");
		expect(names).toContain("cursor");
	});

	it("returns empty for bare project", () => {
		expect(detectAllHarnesses(tmpDir)).toHaveLength(0);
	});
});

// ── runHarnessAudit ──

describe("runHarnessAudit", () => {
	it("returns F grade for empty project", () => {
		const origHome = process.env.HOME;
		process.env.HOME = tmpDir; // isolate from real ~/.claude
		try {
			const result = runHarnessAudit(tmpDir);
			expect(result.harness).toBe("none");
			expect(result.grade).toBe("F");
			expect(result.totalScore).toBe(0);
		} finally {
			process.env.HOME = origHome;
		}
	});

	it("scores higher with CLAUDE.md", async () => {
		await fs.ensureDir(path.join(tmpDir, ".claude"));
		await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), "# Config");

		const result = runHarnessAudit(tmpDir);
		expect(result.harness).toBe("claude");
		expect(result.totalScore).toBeGreaterThan(0);
		expect(result.categories.length).toBeGreaterThan(1);
	});

	it("scores higher with skills", async () => {
		const configDir = path.join(tmpDir, ".claude");
		await fs.ensureDir(configDir);
		await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), "# Config");

		// Without skills
		const before = runHarnessAudit(tmpDir);

		// Add skills
		for (let i = 0; i < 6; i++) {
			await fs.ensureDir(path.join(configDir, "skills", `skill-${i}`));
			await fs.writeFile(
				path.join(configDir, "skills", `skill-${i}`, "SKILL.md"),
				"---\nname: test\n---",
			);
		}
		await fs.ensureDir(path.join(configDir, "skills", "_shared"));
		await fs.writeFile(
			path.join(configDir, "skills", "_shared", "convention.md"),
			"shared",
		);

		const after = runHarnessAudit(tmpDir);
		expect(after.totalScore).toBeGreaterThan(before.totalScore);
	});

	it("scores higher with hooks in settings", async () => {
		const configDir = path.join(tmpDir, ".claude");
		await fs.ensureDir(configDir);

		// Without hooks
		const before = runHarnessAudit(tmpDir);

		// Add settings with hooks
		await fs.writeJson(path.join(configDir, "settings.json"), {
			hooks: { preCommit: "lint-staged" },
		});

		const after = runHarnessAudit(tmpDir);
		expect(after.totalScore).toBeGreaterThan(before.totalScore);
	});

	it("categories have correct structure", async () => {
		await fs.ensureDir(path.join(tmpDir, ".claude"));
		const result = runHarnessAudit(tmpDir);

		for (const cat of result.categories) {
			expect(cat.name).toBeTruthy();
			expect(cat.maxScore).toBeGreaterThan(0);
			expect(cat.score).toBeGreaterThanOrEqual(0);
			expect(cat.score).toBeLessThanOrEqual(cat.maxScore);
			for (const check of cat.checks) {
				expect(check.id).toBeTruthy();
				expect(check.label).toBeTruthy();
				expect(typeof check.passed).toBe("boolean");
				expect(check.points).toBeGreaterThan(0);
			}
		}
	});

	it("maxScore is sum of all check points", async () => {
		await fs.ensureDir(path.join(tmpDir, ".claude"));
		const result = runHarnessAudit(tmpDir);
		const expectedMax = result.categories.reduce(
			(sum, cat) => sum + cat.checks.reduce((s, c) => s + c.points, 0),
			0,
		);
		expect(result.maxScore).toBe(expectedMax);
	});

	it("grade A requires >= 90%", async () => {
		// Build a near-perfect setup
		const configDir = path.join(tmpDir, ".claude");
		await fs.ensureDir(configDir);
		await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), "# Config");
		await fs.writeJson(path.join(configDir, "settings.json"), { hooks: true });
		await fs.ensureDir(path.join(configDir, "projects", "test", "memory"));
		await fs.writeFile(
			path.join(configDir, "projects", "test", "memory", "MEMORY.md"),
			"# Memory",
		);
		for (let i = 0; i < 6; i++) {
			await fs.ensureDir(path.join(configDir, "skills", `skill-${i}`));
		}
		await fs.ensureDir(path.join(configDir, "skills", "_shared"));
		await fs.writeFile(
			path.join(configDir, "skills", "_shared", "c.md"),
			"shared",
		);
		await fs.ensureDir(path.join(tmpDir, ".husky"));
		await fs.writeFile(path.join(tmpDir, ".husky", "pre-commit"), "#!/bin/sh");

		const result = runHarnessAudit(tmpDir);
		expect(result.grade).toBe("A");
		expect(result.totalScore / result.maxScore).toBeGreaterThanOrEqual(0.9);
	});

	it("uses generic audit for non-claude harnesses", async () => {
		await fs.ensureDir(path.join(tmpDir, ".cursor"));
		const result = runHarnessAudit(tmpDir);
		// Generic audit has fewer categories
		expect(result.categories).toHaveLength(1);
		expect(result.categories[0]!.name).toBe("Basic Setup");
	});
});
