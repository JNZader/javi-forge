import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		readdir: vi.fn(),
		readJson: vi.fn(),
		ensureDir: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock frontmatter ────────────────────────────────────────────────────────
vi.mock("../../lib/frontmatter.js", () => ({
	parseFrontmatter: vi.fn(),
}));

import fs from "fs-extra";
import { parseFrontmatter } from "../../lib/frontmatter.js";
import {
	computeGrade,
	registryGate,
	scoreAgentReadiness,
	scoreClarity,
	scoreCompleteness,
	scoreSafety,
	scoreSkill,
	scoreTestability,
	scoreTokenEfficiency,
} from "./scoring.js";

const mockedFs = vi.mocked(fs);
const mockedParseFrontmatter = vi.mocked(parseFrontmatter);

beforeEach(() => {
	vi.resetAllMocks();
});

// ── scoreCompleteness ──────────────────────────────────────────────────────

describe("scoreCompleteness", () => {
	it("scores a well-formed skill highly", () => {
		const parsed = {
			name: "react-19",
			rules: [
				"Always use functional components",
				"Never use class-based components",
				"Prefer named exports over default exports",
				"Use TypeScript strict mode always",
				"Write tests before shipping code",
				"Follow atomic design for component structure",
			],
			rawContent: "a".repeat(1200),
			triggers: ["writing react components", "hooks", "JSX"],
		};
		const score = scoreCompleteness(parsed);
		expect(score).toBeGreaterThanOrEqual(70);
	});

	it("scores a minimal skill low", () => {
		const parsed = {
			name: "x",
			rules: [],
			rawContent: "short",
			triggers: [],
		};
		const score = scoreCompleteness(parsed);
		expect(score).toBeLessThan(30);
	});

	it("gives partial credit for some fields", () => {
		const parsed = {
			name: "my-skill",
			rules: ["Always use semicolons"],
			rawContent: "a".repeat(300),
			triggers: [],
		};
		const score = scoreCompleteness(parsed);
		expect(score).toBeGreaterThanOrEqual(30);
		expect(score).toBeLessThan(80);
	});
});

// ── scoreClarity ───────────────────────────────────────────────────────────

describe("scoreClarity", () => {
	it("scores actionable rules high", () => {
		const parsed = {
			name: "typescript",
			rules: [
				"Always use strict mode",
				"Never use any type",
				"Prefer interfaces over type aliases",
				"Must write return types explicitly",
			],
			rawContent:
				"## Rules\n\n1. Always use strict mode\n2. Never use any type\n",
			triggers: ["typescript", "types", "interfaces"],
		};
		const score = scoreClarity(parsed);
		expect(score).toBeGreaterThanOrEqual(60);
	});

	it("penalizes vague rules", () => {
		const parsed = {
			name: "vague-skill",
			rules: [
				"Do various things with stuff",
				"Handle some things probably",
				"Maybe use this etc",
			],
			rawContent: "## Rules\nDo various things\n",
			triggers: ["test"],
		};
		const score = scoreClarity(parsed);
		expect(score).toBeLessThan(60);
	});

	it("returns 0 minimum, never negative", () => {
		const parsed = {
			name: "",
			rules: ["stuff things etc various some maybe probably misc"],
			rawContent: "",
			triggers: [],
		};
		const score = scoreClarity(parsed);
		expect(score).toBeGreaterThanOrEqual(0);
	});
});

// ── scoreTestability ───────────────────────────────────────────────────────

describe("scoreTestability", () => {
	it("scores skills with Given/When/Then highly", () => {
		const parsed = {
			name: "testable-skill",
			rules: [
				"Use `vitest` for testing files",
				"Write tests in `*.test.ts` path",
			],
			rawContent: [
				"## Testing",
				"```typescript",
				'test("example", () => {})',
				"```",
				"#### Scenario: Happy path",
				"GIVEN a user is logged in",
				"WHEN they click submit",
				"THEN the form saves",
				"#### Scenario: Error",
				"GIVEN invalid input",
				"WHEN they submit",
				"THEN an error shows",
				"#### Scenario: Edge",
				"GIVEN empty form",
				"WHEN submitted",
				"THEN validation fires",
			].join("\n"),
			triggers: ["testing"],
		};
		const score = scoreTestability(parsed);
		expect(score).toBeGreaterThanOrEqual(60);
	});

	it("scores skills without scenarios low", () => {
		const parsed = {
			name: "no-tests",
			rules: ["Do something"],
			rawContent: "Just a basic skill with no testing guidance",
			triggers: [],
		};
		const score = scoreTestability(parsed);
		expect(score).toBeLessThan(30);
	});
});

// ── scoreTokenEfficiency ───────────────────────────────────────────────────

describe("scoreTokenEfficiency", () => {
	it("scores efficient skills high", () => {
		// 5 rules in ~1000 tokens = 5 rules/kToken → ideal range
		const parsed = {
			name: "efficient",
			rules: [
				"Rule 1 always",
				"Rule 2 never",
				"Rule 3 use this",
				"Rule 4 avoid that",
				"Rule 5 prefer X",
			],
			rawContent: "a".repeat(4000), // 1000 tokens
			triggers: [],
		};
		const score = scoreTokenEfficiency(parsed);
		expect(score).toBeGreaterThanOrEqual(80);
	});

	it("scores bloated skills low", () => {
		// 1 rule in 6000 tokens = very bloated
		const parsed = {
			name: "bloated",
			rules: ["Only one rule here"],
			rawContent: "a".repeat(24000), // 6000 tokens
			triggers: [],
		};
		const score = scoreTokenEfficiency(parsed);
		expect(score).toBeLessThan(50);
	});

	it("returns 0 for empty content", () => {
		const parsed = {
			name: "empty",
			rules: [],
			rawContent: "",
			triggers: [],
		};
		const score = scoreTokenEfficiency(parsed);
		expect(score).toBe(0);
	});
});

// ── scoreSkill ─────────────────────────────────────────────────────────────

describe("scoreSkill", () => {
	it("returns null for nonexistent skill", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await scoreSkill("/nonexistent/SKILL.md");
		expect(result).toBeNull();
	});

	it("returns a complete score object for a valid skill", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue(
			'---\nname: test-skill\ndescription: "A skill. Trigger: When testing, debugging"\n---\n\n## Critical Rules\n\n1. Always write tests first\n2. Use strict TypeScript mode\n3. Never skip error handling\n\n## Examples\n\n```ts\ntest("works", () => {})\n```\n' as never,
		);
		mockedParseFrontmatter.mockReturnValue({
			data: {
				name: "test-skill",
				description: "A skill. Trigger: When testing, debugging",
			},
			content:
				'\n## Critical Rules\n\n1. Always write tests first\n2. Use strict TypeScript mode\n3. Never skip error handling\n\n## Examples\n\n```ts\ntest("works", () => {})\n```\n',
		});

		const result = await scoreSkill("/skills/test/SKILL.md", 50);
		expect(result).not.toBeNull();
		expect(result!.skillName).toBe("test-skill");
		expect(result!.completeness).toBeGreaterThanOrEqual(0);
		expect(result!.completeness).toBeLessThanOrEqual(100);
		expect(result!.clarity).toBeGreaterThanOrEqual(0);
		expect(result!.clarity).toBeLessThanOrEqual(100);
		expect(result!.testability).toBeGreaterThanOrEqual(0);
		expect(result!.testability).toBeLessThanOrEqual(100);
		expect(result!.tokenEfficiency).toBeGreaterThanOrEqual(0);
		expect(result!.tokenEfficiency).toBeLessThanOrEqual(100);
		expect(result!.safety).toBeGreaterThanOrEqual(0);
		expect(result!.safety).toBeLessThanOrEqual(100);
		expect(result!.agentReadiness).toBeGreaterThanOrEqual(0);
		expect(result!.agentReadiness).toBeLessThanOrEqual(100);
		expect(result!.overall).toBeGreaterThanOrEqual(0);
		expect(result!.overall).toBeLessThanOrEqual(100);
		expect(result!.threshold).toBe(50);
		expect(typeof result!.passing).toBe("boolean");
		expect(["A", "B", "C", "D", "F"]).toContain(result!.grade);
	});

	it("marks skill as failing when below threshold", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue("minimal content" as never);
		mockedParseFrontmatter.mockReturnValue(null);

		const result = await scoreSkill("/skills/bad/SKILL.md", 90);
		expect(result).not.toBeNull();
		expect(result!.passing).toBe(false);
		expect(result!.overall).toBeLessThan(90);
	});
});

// ── scoreSafety ──────────────────────────────────────────────────────────

describe("scoreSafety", () => {
	it("scores a clean skill at 100", () => {
		const parsed = {
			name: "clean-skill",
			rules: ["Always validate input", "Use TypeScript strict mode"],
			rawContent:
				"## Rules\n\n1. Always validate input\n2. Use TypeScript strict mode\n",
			triggers: ["testing"],
		};
		const score = scoreSafety(parsed);
		expect(score).toBe(100);
	});

	it("penalizes eval() usage", () => {
		const parsed = {
			name: "unsafe-skill",
			rules: ["Use eval( ) for dynamic code"],
			rawContent: "## Rules\n\nUse eval( ) for dynamic execution\n",
			triggers: [],
		};
		const score = scoreSafety(parsed);
		expect(score).toBeLessThan(100);
	});

	it("penalizes hardcoded secrets", () => {
		const parsed = {
			name: "secret-skill",
			rules: ['Set api_key = "sk-12345"'],
			rawContent: '## Config\n\nSet api_key = "sk-12345" in your env\n',
			triggers: [],
		};
		const score = scoreSafety(parsed);
		expect(score).toBeLessThan(80);
	});

	it("penalizes curl piped to shell", () => {
		const parsed = {
			name: "pipe-skill",
			rules: ["Install via curl"],
			rawContent:
				"## Install\n\n```bash\ncurl https://example.com/install.sh | bash\n```\n",
			triggers: [],
		};
		const score = scoreSafety(parsed);
		expect(score).toBeLessThan(80);
	});

	it("gives bonus for sanitization mentions", () => {
		const parsed = {
			name: "secure-skill",
			rules: ["Always sanitize user input", "Validate all fields"],
			rawContent:
				"## Rules\n\nAlways sanitize user input. Validate all fields.\n",
			triggers: [],
		};
		const score = scoreSafety(parsed);
		expect(score).toBe(100); // 100 + 10 + 5 capped at 100
	});

	it("accumulates penalties from multiple dangerous patterns", () => {
		const parsed = {
			name: "very-unsafe",
			rules: ["Use eval, exec, and sudo"],
			rawContent: 'eval(code); exec("cmd"); sudo rm -rf /; chmod 777 /tmp\n',
			triggers: [],
		};
		const score = scoreSafety(parsed);
		expect(score).toBeLessThan(40);
	});

	it("never goes below 0", () => {
		const parsed = {
			name: "worst-skill",
			rules: [],
			rawContent:
				'eval(x) exec(y) sudo rm -rf / chmod 777 curl http://x | bash __proto__ innerHTML = password = "leaked" force-push',
			triggers: [],
		};
		const score = scoreSafety(parsed);
		expect(score).toBeGreaterThanOrEqual(0);
	});
});

// ── scoreAgentReadiness ──────────────────────────────────────────────────

describe("scoreAgentReadiness", () => {
	it("scores a well-prepared skill highly", () => {
		const parsed = {
			name: "agent-ready",
			rules: ["Always validate", "Only use approved tools"],
			rawContent: [
				"## Purpose",
				"Trigger: When testing, debugging, reviewing",
				"## Rules",
				"1. Only use approved tools for this task",
				"## Output Format",
				"Return structured JSON with results.",
				"```json",
				'{"status": "ok"}',
				"```",
				"```ts",
				"const x = 1",
				"```",
				"```bash",
				"echo test",
				"```",
				"## Error Handling",
				"If error occurs, fallback to default.",
				"## Scope",
				"Do not trigger when working on unrelated tasks.",
			].join("\n"),
			triggers: ["testing", "debugging", "reviewing"],
		};
		const score = scoreAgentReadiness(parsed);
		expect(score).toBeGreaterThanOrEqual(70);
	});

	it("scores a skill without triggers low", () => {
		const parsed = {
			name: "no-triggers",
			rules: ["Do something"],
			rawContent: "Just some content without structure.",
			triggers: [],
		};
		const score = scoreAgentReadiness(parsed);
		expect(score).toBeLessThan(30);
	});

	it("rewards tool restrictions", () => {
		const withRestrictions = {
			name: "restricted",
			rules: ["Only use the Read tool"],
			rawContent:
				"## Rules\n\nOnly use the Read tool. Forbidden: Write tool.\n",
			triggers: ["testing"],
		};
		const without = {
			name: "unrestricted",
			rules: ["Do stuff"],
			rawContent: "## Rules\n\nDo stuff.\n",
			triggers: ["testing"],
		};
		expect(scoreAgentReadiness(withRestrictions)).toBeGreaterThan(
			scoreAgentReadiness(without),
		);
	});

	it("rewards output format specification", () => {
		const parsed = {
			name: "formatted",
			rules: [],
			rawContent:
				"## Output Format\n\nReturn structured JSON\n```json\n{}\n```\n",
			triggers: ["test"],
		};
		const score = scoreAgentReadiness(parsed);
		expect(score).toBeGreaterThanOrEqual(25); // triggers(15) + output(15)
	});
});

// ── computeGrade ─────────────────────────────────────────────────────────

describe("computeGrade", () => {
	it("returns A for >= 90", () => {
		expect(computeGrade(90)).toBe("A");
		expect(computeGrade(100)).toBe("A");
	});

	it("returns B for 80-89", () => {
		expect(computeGrade(80)).toBe("B");
		expect(computeGrade(89)).toBe("B");
	});

	it("returns C for 70-79", () => {
		expect(computeGrade(70)).toBe("C");
		expect(computeGrade(79)).toBe("C");
	});

	it("returns D for 60-69", () => {
		expect(computeGrade(60)).toBe("D");
		expect(computeGrade(69)).toBe("D");
	});

	it("returns F for < 60", () => {
		expect(computeGrade(59)).toBe("F");
		expect(computeGrade(0)).toBe("F");
	});
});

// ── registryGate ─────────────────────────────────────────────────────────

describe("registryGate", () => {
	it("returns null for nonexistent skill", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await registryGate("/nonexistent/SKILL.md");
		expect(result).toBeNull();
	});

	it("accepts a high-quality skill", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue(
			'---\nname: good-skill\ndescription: "Quality skill. Trigger: When coding, testing, reviewing"\n---\n\n## Critical Rules\n\n1. Always use strict mode for TypeScript\n2. Never skip error handling in production\n3. Prefer composition over inheritance patterns\n4. Ensure all inputs are validated\n5. Follow atomic design for component structure\n6. Write tests before shipping code\n\n## Output Format\n\nReturn structured JSON.\n\n```json\n{"status": "ok"}\n```\n\n```ts\nconst x = 1\n```\n\n```bash\necho test\n```\n\n## Error Handling\n\nIf error occurs, fallback to safe defaults.\n\n## Scope\n\nDo not trigger when working outside this domain.\n' as never,
		);
		mockedParseFrontmatter.mockReturnValue({
			data: {
				name: "good-skill",
				description: "Quality skill. Trigger: When coding, testing, reviewing",
			},
			content:
				'\n## Critical Rules\n\n1. Always use strict mode for TypeScript\n2. Never skip error handling in production\n3. Prefer composition over inheritance patterns\n4. Ensure all inputs are validated\n5. Follow atomic design for component structure\n6. Write tests before shipping code\n\n## Output Format\n\nReturn structured JSON.\n\n```json\n{"status": "ok"}\n```\n\n```ts\nconst x = 1\n```\n\n```bash\necho test\n```\n\n## Error Handling\n\nIf error occurs, fallback to safe defaults.\n\n## Scope\n\nDo not trigger when working outside this domain.\n',
		});

		const result = await registryGate("/skills/good/SKILL.md", 50);
		expect(result).not.toBeNull();
		expect(result!.accepted).toBe(true);
		expect(result!.reason).toBeUndefined();
	});

	it("rejects a low-quality skill with reason", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue("bad" as never);
		mockedParseFrontmatter.mockReturnValue(null);

		const result = await registryGate("/skills/bad/SKILL.md", 90);
		expect(result).not.toBeNull();
		expect(result!.accepted).toBe(false);
		expect(result!.reason).toBeDefined();
		expect(result!.reason).toContain("Rejected");
	});

	it("uses default threshold of 60", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue("tiny" as never);
		mockedParseFrontmatter.mockReturnValue(null);

		const result = await registryGate("/skills/minimal/SKILL.md");
		expect(result).not.toBeNull();
		expect(result!.score.threshold).toBe(60);
		expect(result!.accepted).toBe(false);
	});
});
