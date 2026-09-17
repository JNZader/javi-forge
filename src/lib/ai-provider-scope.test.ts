import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyProviderScope,
	readProviderScopeInput,
	rollbackProviderScope,
} from "./ai-provider-scope.js";

async function tempDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "javi-forge-provider-scope-test-"));
}

describe("provider scope application", () => {
	it("reads pass TSV files and dedupes provider/model rows", async () => {
		const dir = await tempDir();
		const passPath = join(dir, "smoke.pass.tsv");
		await writeFile(
			passPath,
			[
				"openrouter-free\tdeepseek/free\tDeepSeek",
				"openrouter-free\tdeepseek/free\tDuplicate",
				"opencode-go\tkimi\tKimi",
				"",
			].join("\n"),
		);

		const input = await readProviderScopeInput(passPath);

		expect(input).toMatchObject({
			sourceKind: "pass-list",
			scopedProviders: ["opencode-go", "openrouter-free"],
		});
		expect(
			input.passModels.map((model) => `${model.provider}/${model.model}`),
		).toEqual(["opencode-go/kimi", "openrouter-free/deepseek/free"]);
	});

	it("reads JSONL reports and preserves tested providers with zero passes", async () => {
		const dir = await tempDir();
		const reportPath = join(dir, "smoke.jsonl");
		await writeFile(
			reportPath,
			[
				JSON.stringify({
					provider: "openrouter-free",
					model: "deepseek/free",
					name: "DeepSeek",
					status: "pass",
				}),
				JSON.stringify({
					provider: "opencode-go",
					model: "broken",
					status: "failed",
				}),
				"",
			].join("\n"),
		);

		const input = await readProviderScopeInput(reportPath);

		expect(input.scopedProviders).toEqual(["opencode-go", "openrouter-free"]);
		expect(
			input.passModels.map((model) => `${model.provider}/${model.model}`),
		).toEqual(["openrouter-free/deepseek/free"]);
	});

	it("applies pass models to Pi enabledModels with a backup", async () => {
		const dir = await tempDir();
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		await writeFile(passPath, "openrouter-free\tdeepseek/free\tDeepSeek\n");
		await writeFile(
			settingsPath,
			JSON.stringify({ theme: "Gentle", enabledModels: ["old/model"] }),
		);

		const result = await applyProviderScope({
			inputPath: passPath,
			target: "pi",
			piSettingsPath: settingsPath,
			now: new Date("2026-09-15T12:00:00Z"),
		});

		const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
			theme: string;
			enabledModels: string[];
		};
		expect(settings).toEqual({
			theme: "Gentle",
			enabledModels: ["openrouter-free/deepseek/free"],
		});
		expect(result.piEnabledModels).toBe(1);
		expect(result.backups).toEqual([`${settingsPath}.bak-20260915T120000Z`]);
		await expect(readFile(result.backups[0]!, "utf8")).resolves.toContain(
			"old/model",
		);
	});

	it("refuses to overwrite an existing exclusive backup", async () => {
		const dir = await tempDir();
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		const backupPath = `${settingsPath}.bak-20260915T120000Z`;
		await writeFile(passPath, "openrouter-free\tdeepseek/free\tDeepSeek\n");
		await writeFile(
			settingsPath,
			JSON.stringify({ enabledModels: ["old/model"] }),
		);
		await writeFile(backupPath, "existing-backup");

		await expect(
			applyProviderScope({
				inputPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
				now: new Date("2026-09-15T12:00:00Z"),
			}),
		).rejects.toMatchObject({ code: "EEXIST" });
		await expect(readFile(backupPath, "utf8")).resolves.toBe("existing-backup");
		await expect(readFile(settingsPath, "utf8")).resolves.toContain(
			"old/model",
		);
	});

	it("dry-runs without writing Pi settings", async () => {
		const dir = await tempDir();
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		await writeFile(passPath, "openrouter-free\tdeepseek/free\tDeepSeek\n");
		await writeFile(
			settingsPath,
			JSON.stringify({ enabledModels: ["old/model"] }),
		);

		const result = await applyProviderScope({
			inputPath: passPath,
			target: "pi",
			piSettingsPath: settingsPath,
			dryRun: true,
		});

		await expect(readFile(settingsPath, "utf8")).resolves.toContain(
			"old/model",
		);
		expect(result.wrote).toBe(false);
		expect(result.backups).toEqual([]);
	});

	it("refuses an empty pass-list without changing Pi settings", async () => {
		const dir = await tempDir();
		const passPath = join(dir, "smoke.pass.tsv");
		const settingsPath = join(dir, "settings.json");
		await writeFile(passPath, "\n");
		await writeFile(
			settingsPath,
			JSON.stringify({ enabledModels: ["old/model"] }),
		);

		await expect(
			applyProviderScope({
				inputPath: passPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/contains no passing models/);
		await expect(readFile(settingsPath, "utf8")).resolves.toContain(
			"old/model",
		);
	});

	it("refuses smoke-test dry-run reports without changing Pi settings", async () => {
		const dir = await tempDir();
		const reportPath = join(dir, "smoke.jsonl");
		const settingsPath = join(dir, "settings.json");
		await writeFile(
			reportPath,
			`${JSON.stringify({
				provider: "openrouter-free",
				model: "deepseek/free",
				status: "dry_run",
			})}\n`,
		);
		await writeFile(
			settingsPath,
			JSON.stringify({ enabledModels: ["old/model"] }),
		);

		await expect(
			applyProviderScope({
				inputPath: reportPath,
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/smoke-test --dry-run/);
		await expect(readFile(settingsPath, "utf8")).resolves.toContain(
			"old/model",
		);
	});

	it("refuses reports with no passing models without changing OpenCode config", async () => {
		const dir = await tempDir();
		const reportPath = join(dir, "smoke.jsonl");
		const opencodePath = join(dir, "opencode.json");
		await writeFile(
			reportPath,
			`${JSON.stringify({
				provider: "opencode-go",
				model: "broken",
				status: "failed",
			})}\n`,
		);
		await writeFile(
			opencodePath,
			JSON.stringify({
				provider: { "opencode-go": { models: { broken: {} } } },
			}),
		);

		await expect(
			applyProviderScope({
				inputPath: reportPath,
				target: "opencode",
				opencodeConfigPath: opencodePath,
			}),
		).rejects.toThrow(/contains no passing models/);
		await expect(readFile(opencodePath, "utf8")).resolves.toContain('"broken"');
	});

	it("filters only scoped OpenCode providers and preserves unrelated config", async () => {
		const dir = await tempDir();
		const reportPath = join(dir, "smoke.jsonl");
		const opencodePath = join(dir, "opencode.json");
		await writeFile(
			reportPath,
			[
				JSON.stringify({
					provider: "openrouter-free",
					model: "deepseek/free",
					status: "pass",
				}),
				JSON.stringify({
					provider: "openrouter-free",
					model: "bad/free",
					status: "bad_request",
				}),
				JSON.stringify({
					provider: "opencode-go",
					model: "broken",
					status: "failed",
				}),
				"",
			].join("\n"),
		);
		await writeFile(
			opencodePath,
			JSON.stringify({
				$schema: "https://opencode.ai/config.json",
				agent: { build: { model: "provider/model" } },
				provider: {
					"openrouter-free": {
						models: {
							"deepseek/free": { name: "DeepSeek" },
							"bad/free": { name: "Bad" },
							alias: { modelID: "deepseek/free", name: "Alias" },
						},
					},
					"opencode-go": {
						models: {
							broken: { name: "Broken" },
						},
					},
					untouched: {
						models: {
							keep: { name: "Keep" },
						},
					},
				},
			}),
		);

		const result = await applyProviderScope({
			inputPath: reportPath,
			target: "opencode",
			opencodeConfigPath: opencodePath,
			now: new Date("2026-09-15T12:00:00Z"),
		});

		const config = JSON.parse(await readFile(opencodePath, "utf8")) as {
			agent: unknown;
			provider: Record<string, { models: Record<string, unknown> }>;
		};
		expect(config.agent).toEqual({ build: { model: "provider/model" } });
		expect(Object.keys(config.provider["openrouter-free"]!.models)).toEqual([
			"deepseek/free",
			"alias",
		]);
		expect(config.provider["opencode-go"]!.models).toEqual({});
		expect(config.provider.untouched!.models).toEqual({
			keep: { name: "Keep" },
		});
		expect(result.opencodeProviderModelCounts).toEqual({
			"opencode-go": 0,
			"openrouter-free": 2,
		});
	});

	it("refuses Pi apply-scope without --pi-settings", async () => {
		await expect(
			applyProviderScope({
				inputPath: "/missing-pass.tsv",
				target: "pi",
			}),
		).rejects.toThrow("apply-scope requires --pi-settings");
	});

	it("refuses OpenCode apply-scope without --opencode-config", async () => {
		await expect(
			applyProviderScope({
				inputPath: "/missing-pass.tsv",
				target: "opencode",
			}),
		).rejects.toThrow("apply-scope requires --opencode-config");
	});
});

describe("rollbackProviderScope", () => {
	it("restores backup bytes onto dest and snapshots previous dest", async () => {
		const dir = await tempDir();
		const settingsPath = join(dir, "settings.json");
		const backupPath = join(dir, "settings.json.bak-20260916T120000Z");
		await writeFile(settingsPath, JSON.stringify({ current: true }));
		await writeFile(
			backupPath,
			`${JSON.stringify({ restored: true, extra: "keep-me" }, null, 2)}\n`,
		);

		const result = await rollbackProviderScope({
			backupPath,
			target: "pi",
			piSettingsPath: settingsPath,
			now: new Date("2026-09-16T12:00:00.000Z"),
		});

		expect(result.wrote).toBe(true);
		expect(await readFile(settingsPath, "utf8")).toBe(
			await readFile(backupPath, "utf8"),
		);
		const safetyPath = `${settingsPath}.pre-rollback-20260916T120000Z`;
		expect(result.backups).toEqual([backupPath, safetyPath]);
		expect(JSON.parse(await readFile(safetyPath, "utf8"))).toEqual({
			current: true,
		});
		expect(existsSync(`${settingsPath}.rollback-tmp-20260916T120000Z`)).toBe(
			false,
		);
	});

	it("fails when the backup is missing without changing dest", async () => {
		const dir = await tempDir();
		const settingsPath = join(dir, "settings.json");
		await writeFile(settingsPath, JSON.stringify({ kept: true }));

		await expect(
			rollbackProviderScope({
				backupPath: join(dir, "missing.bak"),
				target: "pi",
				piSettingsPath: settingsPath,
			}),
		).rejects.toThrow(/missing.bak|ENOENT|not found/i);
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
			kept: true,
		});
	});

	it("dry-runs rollback without writing dest or sibling files", async () => {
		const dir = await tempDir();
		const settingsPath = join(dir, "settings.json");
		const backupPath = join(dir, "settings.json.bak-20260916T120000Z");
		await writeFile(settingsPath, JSON.stringify({ current: true }));
		await writeFile(backupPath, JSON.stringify({ restored: true }));
		const before = await readdir(dir);

		const result = await rollbackProviderScope({
			backupPath,
			target: "pi",
			piSettingsPath: settingsPath,
			dryRun: true,
		});

		expect(result.wrote).toBe(false);
		expect(result.files).toEqual([settingsPath]);
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
			current: true,
		});
		expect(await readdir(dir)).toEqual(before);
	});

	it("refuses rollback when a pre-rollback safety copy already exists", async () => {
		const dir = await tempDir();
		const settingsPath = join(dir, "settings.json");
		const backupPath = join(dir, "settings.json.bak-restore");
		const safetyPath = `${settingsPath}.pre-rollback-20260916T120000Z`;
		await writeFile(settingsPath, JSON.stringify({ current: true }));
		await writeFile(backupPath, JSON.stringify({ restored: true }));
		await writeFile(safetyPath, "existing-safety");

		await expect(
			rollbackProviderScope({
				backupPath,
				target: "pi",
				piSettingsPath: settingsPath,
				now: new Date("2026-09-16T12:00:00.000Z"),
			}),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(await readFile(safetyPath, "utf8")).toBe("existing-safety");
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
			current: true,
		});
	});

	it("does not write real Pi or OpenCode runtime configs", async () => {
		const dir = await tempDir();
		expect(dir.startsWith(tmpdir())).toBe(true);
		expect(dir.includes(".pi")).toBe(false);
		expect(dir.includes(".config/opencode")).toBe(false);
	});
});
