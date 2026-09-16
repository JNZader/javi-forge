import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelAssignmentPlan } from "./ai-provider-profiles.js";
import { writeModelAssignmentProfiles } from "./ai-provider-profiles.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "javi-forge-model-profiles-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("writeModelAssignmentProfiles", () => {
	it("generates SDD profile assignments from smoke-tested pass lists", async () => {
		const inputPath = join(dir, "smoke.pass.tsv");
		const outputDir = join(dir, "profiles");
		writeFileSync(
			inputPath,
			[
				"provider\tmodel\tname",
				"openrouter-free\tdeepseek/deepseek-chat-v3.1:free\tDeepSeek V3.1 Free",
				"google\tgemini-3.1-flash-lite\tGemini Flash Lite",
				"opencode-go\tqwen3-coder\tQwen Coder",
			].join("\n"),
		);

		const result = await writeModelAssignmentProfiles({
			inputPath,
			outputDir,
			maxCandidatesPerProfile: 2,
			now: new Date("2026-09-16T00:00:00.000Z"),
		});

		expect(result.wrote).toBe(true);
		expect(result.passModels).toBe(3);
		expect(result.profileCounts).toEqual({
			"sdd-strong": 2,
			"sdd-mid": 2,
			"sdd-cheap": 2,
		});
		expect(result.profilePrimaries["sdd-strong"]).toBe(
			"opencode-go/qwen3-coder",
		);
		expect(result.profilePrimaries["sdd-cheap"]).toBe(
			"google/gemini-3.1-flash-lite",
		);

		const plan = JSON.parse(
			readFileSync(result.files[0]!, "utf8"),
		) as ModelAssignmentPlan;
		expect(plan.generatedAt).toBe("2026-09-16T00:00:00.000Z");
		expect(plan.routing).toContainEqual({
			phase: "apply",
			profile: "sdd-mid",
			primary: "opencode-go/qwen3-coder",
		});
		expect(readFileSync(result.files[1]!, "utf8")).toContain(
			"AI Model Assignment Profile Plan",
		);
	});

	it("dry-runs without writing generated files", async () => {
		const inputPath = join(dir, "smoke.jsonl");
		const outputDir = join(dir, "profiles");
		writeFileSync(
			inputPath,
			[
				JSON.stringify({
					provider: "openrouter-free",
					model: "deepseek/free",
					name: "DeepSeek Free",
					status: "pass",
				}),
				JSON.stringify({
					provider: "openrouter-free",
					model: "broken",
					status: "failed",
				}),
			].join("\n"),
		);

		const result = await writeModelAssignmentProfiles({
			inputPath,
			outputDir,
			dryRun: true,
		});

		expect(result.wrote).toBe(false);
		expect(result.passModels).toBe(1);
		expect(existsSync(result.files[0]!)).toBe(false);
		expect(existsSync(result.files[1]!)).toBe(false);
	});

	it("refuses to overwrite an existing generated artifact", async () => {
		const inputPath = join(dir, "smoke.pass.tsv");
		const outputDir = join(dir, "profiles");
		writeFileSync(
			inputPath,
			"provider\tmodel\tname\nopenrouter-free\tdeepseek/free\tDeepSeek Free\n",
		);
		mkdirSync(outputDir, { recursive: true });
		const existing = join(
			outputDir,
			"model-assignment.profiles.generated.json",
		);
		writeFileSync(existing, "keep me");

		await expect(
			writeModelAssignmentProfiles({ inputPath, outputDir }),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(readFileSync(existing, "utf8")).toBe("keep me");
	});

	it("rejects dry-run smoke JSONL as profile evidence", async () => {
		const inputPath = join(dir, "smoke.jsonl");
		const outputDir = join(dir, "profiles");
		writeFileSync(
			inputPath,
			`${JSON.stringify({
				provider: "openrouter-free",
				model: "deepseek/free",
				name: "DeepSeek Free",
				status: "pass",
				evidence: "dry-run",
			})}\n`,
		);

		await expect(
			writeModelAssignmentProfiles({ inputPath, outputDir }),
		).rejects.toThrow(/smoke-test --dry-run/);
		expect(existsSync(outputDir)).toBe(false);
	});
});
