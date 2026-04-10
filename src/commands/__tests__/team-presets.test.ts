import { describe, expect, it } from "vitest";
import type { AgentResult } from "../team-presets.js";
import {
	aggregateResults,
	createDispatch,
	formatTeamResult,
	getPreset,
	listPresets,
	TEAM_PRESETS,
} from "../team-presets.js";

describe("TEAM_PRESETS", () => {
	it("has review preset", () => {
		expect(TEAM_PRESETS.review).toBeDefined();
		expect(TEAM_PRESETS.review.roles.length).toBeGreaterThanOrEqual(2);
	});

	it("has debug preset", () => {
		expect(TEAM_PRESETS.debug).toBeDefined();
	});

	it("has security preset", () => {
		expect(TEAM_PRESETS.security).toBeDefined();
		expect(TEAM_PRESETS.security.aggregation).toBe("all-must-pass");
	});

	it("has tdd-cycle preset", () => {
		expect(TEAM_PRESETS["tdd-cycle"]).toBeDefined();
		expect(TEAM_PRESETS["tdd-cycle"].maxParallel).toBe(1);
	});

	it("all roles have required fields", () => {
		for (const preset of Object.values(TEAM_PRESETS)) {
			for (const role of preset.roles) {
				expect(role.id).toBeTruthy();
				expect(role.name).toBeTruthy();
				expect(role.skill).toBeTruthy();
				expect(role.perspective).toBeTruthy();
			}
		}
	});
});

describe("getPreset", () => {
	it("finds preset by name", () => {
		expect(getPreset("review")).not.toBeNull();
		expect(getPreset("review")?.name).toBe("review");
	});

	it("returns null for unknown preset", () => {
		expect(getPreset("nonexistent")).toBeNull();
	});
});

describe("listPresets", () => {
	it("lists all presets", () => {
		const presets = listPresets();
		expect(presets.length).toBe(4);
		expect(presets.map((p) => p.name)).toContain("review");
		expect(presets.map((p) => p.name)).toContain("debug");
	});

	it("includes role counts", () => {
		const presets = listPresets();
		for (const p of presets) {
			expect(p.roleCount).toBeGreaterThan(0);
		}
	});
});

describe("createDispatch", () => {
	it("creates dispatch from valid preset", () => {
		const dispatch = createDispatch("review", ["src/app.ts"]);
		expect(dispatch).not.toBeNull();
		expect(dispatch?.preset).toBe("review");
		expect(dispatch?.targetFiles).toEqual(["src/app.ts"]);
		expect(dispatch?.roles.length).toBeGreaterThan(0);
	});

	it("returns null for unknown preset", () => {
		expect(createDispatch("fake", [])).toBeNull();
	});

	it("passes context through", () => {
		const dispatch = createDispatch("review", [], { branch: "main" });
		expect(dispatch?.context.branch).toBe("main");
	});
});

describe("aggregateResults", () => {
	const preset = TEAM_PRESETS.review;
	const passResults: AgentResult[] = [
		{ roleId: "quality", roleName: "Quality", passed: true, findings: [], severity: "info", durationMs: 1000 },
		{ roleId: "security", roleName: "Security", passed: true, findings: [], severity: "info", durationMs: 2000 },
		{ roleId: "testing", roleName: "Testing", passed: true, findings: [], severity: "info", durationMs: 1500 },
	];

	it("passes when all agents pass (all-must-pass)", () => {
		const result = aggregateResults(preset, passResults);
		expect(result.passed).toBe(true);
		expect(result.summary).toContain("All 3 agents passed");
	});

	it("fails when any agent fails (all-must-pass)", () => {
		const failResults = [
			...passResults.slice(0, 2),
			{ roleId: "testing", roleName: "Testing", passed: false, findings: ["Missing tests"], severity: "high" as const, durationMs: 1500 },
		];
		const result = aggregateResults(preset, failResults);
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("1/3");
	});

	it("passes with majority (majority aggregation)", () => {
		const majorityPreset = { ...preset, aggregation: "majority" as const };
		const mixedResults: AgentResult[] = [
			{ roleId: "a", roleName: "A", passed: true, findings: [], severity: "info", durationMs: 100 },
			{ roleId: "b", roleName: "B", passed: true, findings: [], severity: "info", durationMs: 100 },
			{ roleId: "c", roleName: "C", passed: false, findings: ["issue"], severity: "medium", durationMs: 100 },
		];
		const result = aggregateResults(majorityPreset, mixedResults);
		expect(result.passed).toBe(true);
	});

	it("passes with any-pass", () => {
		const anyPreset = { ...preset, aggregation: "any-pass" as const };
		const mixedResults: AgentResult[] = [
			{ roleId: "a", roleName: "A", passed: false, findings: ["nope"], severity: "high", durationMs: 100 },
			{ roleId: "b", roleName: "B", passed: true, findings: [], severity: "info", durationMs: 100 },
		];
		const result = aggregateResults(anyPreset, mixedResults);
		expect(result.passed).toBe(true);
	});

	it("includes critical findings count in summary", () => {
		const failResults: AgentResult[] = [
			{ roleId: "sec", roleName: "Security", passed: false, findings: ["SQL injection", "XSS"], severity: "critical", durationMs: 1000 },
		];
		const result = aggregateResults(preset, failResults);
		expect(result.summary).toContain("2 critical findings");
	});

	it("uses max duration as total", () => {
		const result = aggregateResults(preset, passResults);
		expect(result.totalDurationMs).toBe(2000);
	});
});

describe("formatTeamResult", () => {
	it("formats passing result", () => {
		const result = aggregateResults(TEAM_PRESETS.review, [
			{ roleId: "q", roleName: "Quality", passed: true, findings: [], severity: "info", durationMs: 1000 },
		]);
		const output = formatTeamResult(result);
		expect(output).toContain("✅");
		expect(output).toContain("review");
		expect(output).toContain("✓ Quality");
	});

	it("formats failing result with findings", () => {
		const result = aggregateResults(TEAM_PRESETS.review, [
			{ roleId: "s", roleName: "Security", passed: false, findings: ["XSS found", "Open redirect"], severity: "critical", durationMs: 2000 },
		]);
		const output = formatTeamResult(result);
		expect(output).toContain("❌");
		expect(output).toContain("✗ Security");
		expect(output).toContain("XSS found");
	});

	it("truncates findings at 3", () => {
		const result = aggregateResults(TEAM_PRESETS.review, [
			{
				roleId: "s",
				roleName: "Security",
				passed: false,
				findings: ["f1", "f2", "f3", "f4", "f5"],
				severity: "high",
				durationMs: 1000,
			},
		]);
		const output = formatTeamResult(result);
		expect(output).toContain("+2 more");
	});
});
