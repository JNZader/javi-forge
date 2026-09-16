import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyModelAssignmentProfileOverlay,
	rollbackModelAssignmentProfileOverlay,
} from "./ai-provider-profile-apply.js";
import type { ModelAssignmentProfileOverlay } from "./ai-provider-profiles.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "javi-forge-profile-apply-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const PRIMARY = "opencode-go/qwen3.7-plus";

function passTsv(
	path: string,
	rows = ["opencode-go\tqwen3.7-plus\tQwen"],
): void {
	writeFileSync(path, ["provider\tmodel\tname", ...rows].join("\n"));
}

function overlayJson(options: {
	target?: "pi" | "opencode" | "codex";
	primary?: string | null;
	routing?: ModelAssignmentProfileOverlay["routing"];
	extra?: Record<string, unknown>;
}): ModelAssignmentProfileOverlay & Record<string, unknown> {
	const primary = options.primary === undefined ? PRIMARY : options.primary;
	const candidate =
		primary === null
			? []
			: [
					{
						provider: primary.slice(0, primary.indexOf("/")),
						model: primary.slice(primary.indexOf("/") + 1),
						ref: primary,
					},
				];
	const profile = (
		name: ModelAssignmentProfileOverlay["profiles"]["sdd-strong"]["profile"],
		phases: string[],
	) => ({
		profile: name,
		purpose: name,
		phases,
		primaryRef: primary,
		candidates: candidate,
	});
	return {
		generatedAt: "2026-09-16T00:00:00.000Z",
		sourcePlanPath: "/plan.json",
		target: options.target ?? "pi",
		profiles: {
			"sdd-strong": profile("sdd-strong", ["sdd-design"]),
			"sdd-mid": profile("sdd-mid", ["sdd-apply"]),
			"sdd-cheap": profile("sdd-cheap", ["sdd-spec"]),
		},
		routing: options.routing ?? [
			{ phase: "sdd-design", profile: "sdd-strong", primary },
		],
		warnings: [],
		...options.extra,
	};
}

function writeOverlay(
	path: string,
	options: Parameters<typeof overlayJson>[0] = {},
): void {
	writeFileSync(path, `${JSON.stringify(overlayJson(options), null, 2)}\n`);
}

describe("applyModelAssignmentProfileOverlay", () => {
	it("rejects a missing pass-list", async () => {
		const overlayPath = join(dir, "pi.model-profiles.generated.json");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath);
		writeFileSync(
			settingsPath,
			JSON.stringify({
				defaultProvider: "keep",
				defaultModel: "keep-model",
				enabledModels: ["keep/a"],
			}),
		);

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/pass-list/);
	});

	it("rejects an empty pass-list", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "empty.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath);
		writeFileSync(passPath, "provider\tmodel\tname\n");
		writeFileSync(settingsPath, JSON.stringify({ enabledModels: [] }));

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/no passing models/);
	});

	it("rejects dry-run smoke JSONL as pass evidence", async () => {
		const overlayPath = join(dir, "overlay.json");
		const reportPath = join(dir, "smoke.jsonl");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath);
		writeFileSync(
			reportPath,
			`${JSON.stringify({
				provider: "opencode-go",
				model: "qwen3.7-plus",
				status: "dry_run",
				evidence: "dry-run",
			})}\n`,
		);
		writeFileSync(settingsPath, JSON.stringify({ enabledModels: [] }));

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: reportPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/smoke-test --dry-run/);
	});

	it("rejects an unknown routing primary", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath, { primary: "opencode-go/not-tested" });
		passTsv(passPath);
		writeFileSync(settingsPath, JSON.stringify({ enabledModels: [] }));

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/not-tested/);
	});

	it("rejects overlay target mismatch", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath, { target: "opencode" });
		passTsv(passPath);
		writeFileSync(settingsPath, JSON.stringify({ enabledModels: [] }));

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/target/);
	});

	it("refuses Codex and both targets", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		passTsv(passPath);
		writeOverlay(overlayPath, { target: "codex" });

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "codex",
				piSettingsPath: join(dir, "settings.json"),
			}),
		).rejects.toThrow(/codex|both/i);

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "both",
				piSettingsPath: join(dir, "settings.json"),
			}),
		).rejects.toThrow(/both/i);
	});

	it("requires explicit Pi settings and OpenCode config paths in the library", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		writeOverlay(overlayPath);
		passTsv(passPath);

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "pi",
			}),
		).rejects.toThrow(/pi-settings/);

		writeOverlay(overlayPath, { target: "opencode" });
		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "opencode",
			}),
		).rejects.toThrow(/opencode-config/);
	});

	it("dry-runs Pi apply without writing files or backups", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath);
		passTsv(passPath);
		const original = JSON.stringify(
			{
				defaultProvider: "keep-provider",
				defaultModel: "keep-model",
				enabledModels: ["keep/a", "keep/b"],
				modelProfiles: { profiles: {}, routing: [] },
			},
			null,
			2,
		);
		writeFileSync(settingsPath, original);

		const result = await applyModelAssignmentProfileOverlay({
			overlayPath,
			passListPath: passPath,
			target: "pi",
			piSettingsPath: settingsPath,
			dryRun: true,
			now: new Date("2026-09-16T12:00:00.000Z"),
		});

		expect(result.wrote).toBe(false);
		expect(result.dryRun).toBe(true);
		expect(result.files).toEqual([settingsPath]);
		expect(result.backups).toEqual([`${settingsPath}.bak-20260916T120000Z`]);
		expect(readFileSync(settingsPath, "utf8")).toBe(original);
		expect(existsSync(`${settingsPath}.bak-20260916T120000Z`)).toBe(false);
	});

	it("applies Pi modelProfiles without changing defaults or secrets", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath);
		passTsv(passPath);
		const settings = {
			defaultProvider: "keep-provider",
			defaultModel: "keep-model",
			enabledModels: ["keep/a", "keep/b"],
			apiKey: "secret-must-remain",
			env: { OPENAI_API_KEY: "do-not-touch" },
			modelProfiles: { extra: true, profiles: {}, routing: [] },
		};
		writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

		const result = await applyModelAssignmentProfileOverlay({
			overlayPath,
			passListPath: passPath,
			target: "pi",
			piSettingsPath: settingsPath,
			now: new Date("2026-09-16T12:00:00.000Z"),
		});

		const next = JSON.parse(
			readFileSync(settingsPath, "utf8"),
		) as typeof settings & {
			modelProfiles: { extra: boolean; profiles: unknown; routing: unknown };
		};
		expect(JSON.stringify(next.defaultProvider)).toBe(
			JSON.stringify(settings.defaultProvider),
		);
		expect(JSON.stringify(next.defaultModel)).toBe(
			JSON.stringify(settings.defaultModel),
		);
		expect(JSON.stringify(next.enabledModels)).toBe(
			JSON.stringify(settings.enabledModels),
		);
		expect(next.apiKey).toBe("secret-must-remain");
		expect(next.env).toEqual({ OPENAI_API_KEY: "do-not-touch" });
		expect(next.modelProfiles.extra).toBe(true);
		expect(next.modelProfiles.routing).toEqual([
			{ phase: "sdd-design", profile: "sdd-strong", primary: PRIMARY },
		]);
		expect(result.wrote).toBe(true);
		expect(result.backups).toEqual([`${settingsPath}.bak-20260916T120000Z`]);
		expect(readFileSync(result.backups[0]!, "utf8")).toContain("keep-provider");
	});

	it("refuses overlays that would change Pi defaults", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		writeOverlay(overlayPath, {
			extra: {
				defaultProvider: "hijack",
				defaultModel: "hijack-model",
				enabledModels: ["hijack/model"],
			},
		});
		passTsv(passPath);
		writeFileSync(
			settingsPath,
			JSON.stringify({
				defaultProvider: "keep-provider",
				defaultModel: "keep-model",
				enabledModels: ["keep/a"],
			}),
		);

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/defaultProvider|defaultModel|enabledModels/);
		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({
			defaultProvider: "keep-provider",
			defaultModel: "keep-model",
			enabledModels: ["keep/a"],
		});
	});

	it("applies OpenCode routing models without creating agents or touching provider secrets", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const configPath = join(dir, "opencode.json");
		writeOverlay(overlayPath, {
			target: "opencode",
			routing: [
				{ phase: "sdd-design", profile: "sdd-strong", primary: PRIMARY },
				{ phase: "sdd-apply", profile: "sdd-mid", primary: PRIMARY },
			],
		});
		passTsv(passPath);
		const config = {
			provider: {
				"opencode-go": {
					npm: "@ai-sdk/openai",
					options: { apiKey: "secret-provider-key" },
					models: { "qwen3.7-plus": {} },
				},
			},
			agent: {
				"sdd-design": { model: "old/design", prompt: "keep-design" },
				"sdd-apply": { model: "old/apply", prompt: "keep-apply" },
				"sdd-explore": { model: "keep/explore", prompt: "keep-explore" },
			},
			permission: { bash: "ask" },
		};
		writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

		await applyModelAssignmentProfileOverlay({
			overlayPath,
			passListPath: passPath,
			target: "opencode",
			opencodeConfigPath: configPath,
			now: new Date("2026-09-16T12:00:00.000Z"),
		});

		const next = JSON.parse(readFileSync(configPath, "utf8")) as typeof config;
		expect(next.provider).toEqual(config.provider);
		expect(next.permission).toEqual({ bash: "ask" });
		expect(next.agent["sdd-design"]).toEqual({
			model: PRIMARY,
			prompt: "keep-design",
		});
		expect(next.agent["sdd-apply"]).toEqual({
			model: PRIMARY,
			prompt: "keep-apply",
		});
		expect(next.agent["sdd-explore"]).toEqual({
			model: "keep/explore",
			prompt: "keep-explore",
		});
	});

	it("fails closed when an OpenCode routed phase is missing", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const configPath = join(dir, "opencode.json");
		writeOverlay(overlayPath, { target: "opencode" });
		passTsv(passPath);
		writeFileSync(
			configPath,
			JSON.stringify({
				provider: { "opencode-go": { models: {} } },
				agent: { "sdd-apply": { model: "old" } },
			}),
		);

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "opencode",
				opencodeConfigPath: configPath,
			}),
		).rejects.toThrow(/sdd-design/);
		expect(JSON.parse(readFileSync(configPath, "utf8")).agent).toEqual({
			"sdd-apply": { model: "old" },
		});
	});

	it("refuses protected OpenCode agents even if the overlay names them", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const configPath = join(dir, "opencode.json");
		writeOverlay(overlayPath, {
			target: "opencode",
			routing: [{ phase: "build", profile: "sdd-strong", primary: PRIMARY }],
		});
		passTsv(passPath);
		writeFileSync(
			configPath,
			JSON.stringify({
				provider: {},
				agent: { build: { model: "keep/build", prompt: "protected" } },
			}),
		);

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "opencode",
				opencodeConfigPath: configPath,
			}),
		).rejects.toThrow(/protected|build/);
		expect(JSON.parse(readFileSync(configPath, "utf8")).agent.build.model).toBe(
			"keep/build",
		);
	});

	it("refuses to overwrite an existing exclusive backup", async () => {
		const overlayPath = join(dir, "overlay.json");
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		const backupPath = `${settingsPath}.bak-20260916T120000Z`;
		writeOverlay(overlayPath);
		passTsv(passPath);
		writeFileSync(
			settingsPath,
			JSON.stringify({
				defaultProvider: "keep-provider",
				defaultModel: "keep-model",
				enabledModels: ["keep/a"],
			}),
		);
		writeFileSync(backupPath, "existing-backup");

		await expect(
			applyModelAssignmentProfileOverlay({
				overlayPath,
				passListPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
				now: new Date("2026-09-16T12:00:00.000Z"),
			}),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(readFileSync(backupPath, "utf8")).toBe("existing-backup");
		expect(JSON.parse(readFileSync(settingsPath, "utf8")).defaultProvider).toBe(
			"keep-provider",
		);
	});
});

describe("rollbackModelAssignmentProfileOverlay", () => {
	it("fails when the backup is missing", async () => {
		const settingsPath = join(dir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ kept: true }));

		await expect(
			rollbackModelAssignmentProfileOverlay({
				backupPath: join(dir, "missing.bak"),
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/missing.bak|ENOENT|not found/i);
		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
			kept: true,
		});
	});

	it("dry-runs rollback without writing", async () => {
		const settingsPath = join(dir, "settings.json");
		const backupPath = join(dir, "settings.json.bak-20260916T120000Z");
		writeFileSync(settingsPath, JSON.stringify({ current: true }));
		writeFileSync(backupPath, JSON.stringify({ restored: true }));

		const result = await rollbackModelAssignmentProfileOverlay({
			backupPath,
			target: "pi",
			piSettingsPath: settingsPath,
			dryRun: true,
		});

		expect(result.wrote).toBe(false);
		expect(result.files).toEqual([settingsPath]);
		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
			current: true,
		});
	});

	it("restores a backup onto the target path", async () => {
		const settingsPath = join(dir, "settings.json");
		const backupPath = join(dir, "settings.json.bak-20260916T120000Z");
		writeFileSync(settingsPath, JSON.stringify({ current: true }));
		writeFileSync(
			backupPath,
			`${JSON.stringify({ restored: true }, null, 2)}\n`,
		);

		const result = await rollbackModelAssignmentProfileOverlay({
			backupPath,
			target: "pi",
			piSettingsPath: settingsPath,
		});

		expect(result.wrote).toBe(true);
		expect(readFileSync(settingsPath, "utf8")).toBe(
			readFileSync(backupPath, "utf8"),
		);
	});
});

describe("workspace safety", () => {
	it("does not write real Pi or OpenCode runtime configs", () => {
		expect(dir.startsWith(tmpdir())).toBe(true);
		expect(dir.includes(".pi")).toBe(false);
		expect(dir.includes(".config/opencode")).toBe(false);
	});
});
