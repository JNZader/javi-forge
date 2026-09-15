import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	classifySmokeOutput,
	filterProviderSmokeModels,
	loadProviderSmokeModels,
	PROVIDER_SMOKE_RUNTIME,
	PROVIDER_SMOKE_STATUS,
	type ProviderSmokeModel,
	type ProviderSmokeRunner,
	runProviderSmokeTests,
} from "./ai-provider-smoke.js";

async function tempDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "javi-forge-provider-smoke-test-"));
}

describe("provider smoke tests", () => {
	it("loads Pi provider models, dedupes store entries, and skips local by default", async () => {
		const dir = await tempDir();
		const modelsPath = join(dir, "models.json");
		const storePath = join(dir, "models-store.json");
		await writeFile(
			modelsPath,
			JSON.stringify({
				providers: {
					"openrouter-free": {
						models: [{ id: "deepseek/free", name: "DeepSeek Free" }],
					},
					"ollama-local": { models: [{ id: "llama3", name: "Llama" }] },
				},
			}),
		);
		await writeFile(
			storePath,
			JSON.stringify({
				providers: {
					"openrouter-free": {
						models: [{ id: "deepseek/free", name: "DeepSeek Free duplicate" }],
					},
					"opencode-go": {
						models: [{ id: "kimi-k2.7-code", name: "Kimi" }],
					},
				},
			}),
		);

		const models = await loadProviderSmokeModels({
			modelsPath,
			modelsStorePath: storePath,
		});

		expect(models.map((model) => `${model.provider}/${model.model}`)).toEqual([
			"opencode-go/kimi-k2.7-code",
			"openrouter-free/deepseek/free",
		]);
	});

	it("loads Pi models-store provider maps without a providers wrapper", async () => {
		const dir = await tempDir();
		const modelsPath = join(dir, "models.json");
		const storePath = join(dir, "models-store.json");
		await writeFile(modelsPath, JSON.stringify({ providers: {} }));
		await writeFile(
			storePath,
			JSON.stringify({
				"opencode-go": {
					models: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
				},
			}),
		);

		const models = await loadProviderSmokeModels({
			modelsPath,
			modelsStorePath: storePath,
		});

		expect(models.map((model) => `${model.provider}/${model.model}`)).toEqual([
			"opencode-go/deepseek-v4-pro",
		]);
	});

	it("loads OpenCode provider models from opencode.json", async () => {
		const dir = await tempDir();
		const configPath = join(dir, "opencode.json");
		await writeFile(
			configPath,
			JSON.stringify({
				provider: {
					"openrouter-free": {
						models: {
							"cohere/north-mini-code:free": { name: "North Mini" },
							alias: { modelID: "cohere/north-mini-code:free" },
						},
					},
					"ollama-local": {
						models: {
							llama: { name: "Llama" },
						},
					},
				},
			}),
		);

		const models = await loadProviderSmokeModels({
			modelsPath: configPath,
			runtime: PROVIDER_SMOKE_RUNTIME.OPENCODE,
		});

		expect(models.map((model) => `${model.provider}/${model.model}`)).toEqual([
			"openrouter-free/alias",
			"openrouter-free/cohere/north-mini-code:free",
		]);
	});

	it("filters by provider, family, model, previous status, and limit", async () => {
		const dir = await tempDir();
		const reportPath = join(dir, "previous.jsonl");
		const models: ProviderSmokeModel[] = [
			{
				provider: "openrouter-free",
				model: "deepseek/free",
				name: "DeepSeek Free",
				local: false,
				source: "test",
			},
			{
				provider: "opencode-go",
				model: "kimi-k2.7-code",
				name: "Kimi",
				local: false,
				source: "test",
			},
		];
		await writeFile(
			reportPath,
			`${JSON.stringify({ provider: "openrouter-free", model: "deepseek/free", status: "failed" })}\n`,
		);

		const selected = await filterProviderSmokeModels(
			models,
			{ family: "deepseek", model: "free", status: "failed", limit: 1 },
			reportPath,
		);

		expect(selected).toEqual([models[0]]);
	});

	it("classifies common provider failures", () => {
		expect(
			classifySmokeOutput({
				exitCode: 1,
				stdout: "",
				stderr: "429 rate limit exceeded",
			}),
		).toBe(PROVIDER_SMOKE_STATUS.RATE_LIMITED);
		expect(
			classifySmokeOutput({
				exitCode: 1,
				stdout: "",
				stderr: "model does not exist",
			}),
		).toBe(PROVIDER_SMOKE_STATUS.MODEL_NOT_FOUND);
		expect(
			classifySmokeOutput({
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: true,
			}),
		).toBe(PROVIDER_SMOKE_STATUS.TIMEOUT);
	});

	it("writes JSONL, summary, and pass-list artifacts for a selected subset", async () => {
		const dir = await tempDir();
		const modelsPath = join(dir, "models.json");
		await writeFile(
			modelsPath,
			JSON.stringify({
				providers: {
					"openrouter-free": {
						models: [{ id: "deepseek/free", name: "DeepSeek Free" }],
					},
					"opencode-go": { models: [{ id: "kimi-k2.7-code", name: "Kimi" }] },
				},
			}),
		);
		const runner: ProviderSmokeRunner = {
			async run() {
				return { exitCode: 0, stdout: "pong", stderr: "" };
			},
		};
		const reportPath = join(dir, "smoke.jsonl");

		const result = await runProviderSmokeTests({
			modelsPath,
			modelsStorePath: modelsPath,
			outputPath: reportPath,
			filters: { provider: "openrouter-free" },
			runner,
		});

		expect(result).toMatchObject({
			selected: 1,
			ran: 1,
			counts: { pass: 1 },
			reportPath,
		});
		await expect(readFile(reportPath, "utf8")).resolves.toContain(
			'"provider":"openrouter-free"',
		);
		await expect(readFile(result.summaryPath, "utf8")).resolves.toContain(
			"Provider smoke-test summary",
		);
		await expect(readFile(result.passListPath, "utf8")).resolves.toContain(
			"openrouter-free\tdeepseek/free",
		);
	});

	it("smoke-tests OpenCode runtime subsets through the injected runner", async () => {
		const dir = await tempDir();
		const configPath = join(dir, "opencode.json");
		await writeFile(
			configPath,
			JSON.stringify({
				provider: {
					"openrouter-free": {
						models: {
							"cohere/north-mini-code:free": { name: "North Mini" },
						},
					},
				},
			}),
		);
		const seen: string[] = [];
		const runner: ProviderSmokeRunner = {
			async run(model, options) {
				seen.push(
					`${options.runtime}:${options.opencodeCommand}:${model.provider}/${model.model}`,
				);
				return { exitCode: null, stdout: "", stderr: "", timedOut: true };
			},
		};

		const result = await runProviderSmokeTests({
			runtime: PROVIDER_SMOKE_RUNTIME.OPENCODE,
			modelsPath: configPath,
			outputPath: join(dir, "smoke.jsonl"),
			opencodeCommand: "opencode-custom",
			runner,
		});

		expect(seen).toEqual([
			"opencode:opencode-custom:openrouter-free/cohere/north-mini-code:free",
		]);
		expect(result.counts).toEqual({ timeout: 1 });
	});

	it("force-kills OpenCode commands that ignore SIGTERM after timeout", async () => {
		const dir = await tempDir();
		const configPath = join(dir, "opencode.json");
		const commandPath = join(dir, "ignore-sigterm.mjs");
		await writeFile(
			configPath,
			JSON.stringify({
				provider: {
					"openrouter-free": {
						models: {
							"cohere/north-mini-code:free": { name: "North Mini" },
						},
					},
				},
			}),
		);
		await writeFile(
			commandPath,
			[
				"#!/usr/bin/env node",
				"process.on('SIGTERM', () => {});",
				"setInterval(() => {}, 1000);",
				"",
			].join("\n"),
		);
		await chmod(commandPath, 0o755);
		const started = Date.now();

		const result = await runProviderSmokeTests({
			runtime: PROVIDER_SMOKE_RUNTIME.OPENCODE,
			modelsPath: configPath,
			outputPath: join(dir, "smoke.jsonl"),
			opencodeCommand: commandPath,
			timeoutSeconds: 1,
		});

		expect(Date.now() - started).toBeLessThan(5000);
		expect(result.counts).toEqual({ timeout: 1 });
	});
});
