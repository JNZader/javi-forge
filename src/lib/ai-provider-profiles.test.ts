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
import type {
	ModelAssignmentPlan,
	ModelAssignmentProfileOverlay,
} from "./ai-provider-profiles.js";
import {
	writeModelAssignmentProfileExport,
	writeModelAssignmentProfiles,
} from "./ai-provider-profiles.js";

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

	it("generates a smoke-evidence-gated community backend OpenCode Go pilot preset", async () => {
		const inputPath = join(dir, "smoke.jsonl");
		const outputDir = join(dir, "profiles");
		const passingModels = [
			["deepseek-v4-flash", "DeepSeek V4 Flash"],
			["deepseek-v4-pro", "DeepSeek V4 Pro"],
			["gpt-5.6-luna", "GPT-5.6 Luna"],
			["minimax-m3", "MiniMax-M3"],
			["qwen3.7-plus", "Qwen3.7 Plus"],
			["mimo-v2.5", "MiMo V2.5"],
			["hy3", "Hy3"],
		];
		writeFileSync(
			inputPath,
			passingModels
				.map(([model, name]) =>
					JSON.stringify({
						provider: "opencode-go",
						model,
						name,
						status: "pass",
					}),
				)
				.join("\n"),
		);

		const result = await writeModelAssignmentProfiles({
			inputPath,
			outputDir,
			maxCandidatesPerProfile: 4,
			preset: "community-backend-opencode-go",
			now: new Date("2026-09-16T02:00:00.000Z"),
		});

		expect(result.profilePrimaries).toMatchObject({
			"sdd-strong": "opencode-go/deepseek-v4-pro",
			"sdd-mid": "opencode-go/gpt-5.6-luna",
			"sdd-cheap": "opencode-go/deepseek-v4-flash",
		});
		const plan = JSON.parse(
			readFileSync(result.files[0]!, "utf8"),
		) as ModelAssignmentPlan;
		expect(plan.preset).toBe("community-backend-opencode-go");
		expect(plan.routing).toContainEqual({
			phase: "sdd-design",
			profile: "sdd-strong",
			primary: "opencode-go/qwen3.7-plus",
		});
		expect(plan.routing).toContainEqual({
			phase: "jd-judge-b",
			profile: "sdd-strong",
			primary: "opencode-go/hy3",
		});
		expect(plan.warnings.join(" ")).toContain("role-specific pilot probes");
		expect(readFileSync(result.files[1]!, "utf8")).toContain(
			"Preset: `community-backend-opencode-go`",
		);
	});

	it("rejects community presets when a referenced model did not pass", async () => {
		const inputPath = join(dir, "smoke.pass.tsv");
		const outputDir = join(dir, "profiles");
		writeFileSync(
			inputPath,
			"provider\tmodel\tname\nopencode-go\tdeepseek-v4-flash\tDeepSeek V4 Flash\n",
		);

		await expect(
			writeModelAssignmentProfiles({
				inputPath,
				outputDir,
				preset: "community-backend-opencode-go",
			}),
		).rejects.toThrow(/models missing from pass evidence/);
		expect(existsSync(outputDir)).toBe(false);
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
				status: "dry_run",
			})}\n`,
		);

		await expect(
			writeModelAssignmentProfiles({ inputPath, outputDir }),
		).rejects.toThrow(/smoke-test --dry-run/);
		expect(existsSync(outputDir)).toBe(false);
	});
});

describe("writeModelAssignmentProfileExport", () => {
	async function createProfilePlan(
		models = [
			"opencode-go\tqwen3-coder\tQwen Coder",
			"google\tgemini-3.1-flash-lite\tGemini Flash Lite",
		],
	): Promise<string> {
		const inputPath = join(dir, "smoke.pass.tsv");
		const planDir = join(dir, "plan");
		writeFileSync(inputPath, ["provider\tmodel\tname", ...models].join("\n"));
		const result = await writeModelAssignmentProfiles({
			inputPath,
			outputDir: planDir,
		});
		return result.files[0]!;
	}

	it("writes a non-applied Pi overlay with split provider and model references", async () => {
		const inputPath = await createProfilePlan();
		const outputDir = join(dir, "preview");

		const result = await writeModelAssignmentProfileExport({
			inputPath,
			outputDir,
			target: "pi",
			now: new Date("2026-09-16T01:00:00.000Z"),
		});

		expect(result.files).toEqual([
			join(outputDir, "pi.model-profiles.generated.json"),
		]);
		const overlay = JSON.parse(
			readFileSync(result.files[0]!, "utf8"),
		) as ModelAssignmentProfileOverlay;
		expect(overlay).toMatchObject({
			generatedAt: "2026-09-16T01:00:00.000Z",
			sourcePlanPath: inputPath,
			target: "pi",
		});
		expect(overlay.profiles["sdd-mid"].candidates[0]).toMatchObject({
			provider: "opencode-go",
			model: "qwen3-coder",
			ref: "opencode-go/qwen3-coder",
		});
		expect(overlay.warnings.join(" ")).toContain("not runtime configuration");
	});

	it("writes Pi and OpenCode overlays for both without writing a Codex config", async () => {
		const inputPath = await createProfilePlan();
		const outputDir = join(dir, "preview");

		const result = await writeModelAssignmentProfileExport({
			inputPath,
			outputDir,
			target: "both",
		});

		expect(result.files).toEqual([
			join(outputDir, "pi.model-profiles.generated.json"),
			join(outputDir, "opencode.model-profiles.generated.json"),
		]);
		for (const path of result.files) expect(existsSync(path)).toBe(true);
		expect(
			existsSync(join(outputDir, "codex.model-profiles.generated.md")),
		).toBe(false);
	});

	it("preflights every target path before writing either overlay", async () => {
		const inputPath = await createProfilePlan();
		const outputDir = join(dir, "preview");
		mkdirSync(outputDir, { recursive: true });
		const existing = join(outputDir, "opencode.model-profiles.generated.json");
		writeFileSync(existing, "keep me");

		await expect(
			writeModelAssignmentProfileExport({
				inputPath,
				outputDir,
				target: "both",
			}),
		).rejects.toMatchObject({ code: "EEXIST", path: existing });
		expect(
			existsSync(join(outputDir, "pi.model-profiles.generated.json")),
		).toBe(false);
		expect(readFileSync(existing, "utf8")).toBe("keep me");
	});

	it("preserves source plan warnings in overlays, reports, and results", async () => {
		const inputPath = await createProfilePlan([]);
		const sourceWarning = "No passing models were found in the input.";
		const overlayResult = await writeModelAssignmentProfileExport({
			inputPath,
			outputDir: join(dir, "overlay"),
			target: "pi",
		});
		const overlay = JSON.parse(
			readFileSync(overlayResult.files[0]!, "utf8"),
		) as ModelAssignmentProfileOverlay;
		expect(overlay.warnings).toContain(sourceWarning);
		expect(overlayResult.warnings).toContain(sourceWarning);

		const reportResult = await writeModelAssignmentProfileExport({
			inputPath,
			outputDir: join(dir, "report"),
			target: "codex",
		});
		expect(reportResult.warnings).toContain(sourceWarning);
		expect(readFileSync(reportResult.files[0]!, "utf8")).toContain(
			sourceWarning,
		);
	});

	it("dry-runs and refuses to overwrite an existing preview", async () => {
		const inputPath = await createProfilePlan();
		const outputDir = join(dir, "preview");
		const dryRun = await writeModelAssignmentProfileExport({
			inputPath,
			outputDir,
			target: "codex",
			dryRun: true,
		});
		expect(dryRun.wrote).toBe(false);
		expect(existsSync(dryRun.files[0]!)).toBe(false);

		mkdirSync(outputDir, { recursive: true });
		const existing = join(outputDir, "codex.model-profiles.generated.md");
		writeFileSync(existing, "keep me");
		await expect(
			writeModelAssignmentProfileExport({
				inputPath,
				outputDir,
				target: "codex",
			}),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(readFileSync(existing, "utf8")).toBe("keep me");
	});
});
