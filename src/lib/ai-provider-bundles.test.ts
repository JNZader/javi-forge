import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	bundleFromOpenCodeConfig,
	bundleFromPiProvidersConfig,
	convertProviderBundle,
	generateFreeProviderBundle,
	PROVIDER_BUNDLE_SOURCE,
	PROVIDER_BUNDLE_TARGET,
	renderOpenCodeProvidersConfig,
	renderPiProvidersConfig,
	writeFreeProvidersBundle,
} from "./ai-provider-bundles.js";

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function fetcher(): typeof fetch {
	return vi.fn(async (source: RequestInfo | URL) => {
		const url = String(source);
		if (url.includes("kilo.ai")) {
			return jsonResponse({
				data: [
					{
						id: "kilo-auto/free",
						name: "Auto Free",
						pricing: { prompt: "0", completion: "0" },
					},
				],
			});
		}
		if (url.includes("openrouter.ai")) {
			return jsonResponse({
				data: [
					{
						id: "vendor/model:free",
						name: "Vendor Model (free)",
						context_length: 32_000,
						top_provider: { max_completion_tokens: 4096 },
						pricing: { prompt: "0", completion: "0" },
					},
					{
						id: "vendor/model:free-paid",
						name: "Vendor Model paid",
						pricing: { prompt: "1", completion: "1" },
					},
				],
			});
		}
		if (url.includes("blockrun.ai")) {
			return jsonResponse({
				models: [
					{
						id: "block/free",
						name: "Block Free",
						billing_mode: "free",
					},
				],
			});
		}
		return new Response("not found", { status: 404 });
	}) as unknown as typeof fetch;
}

describe("AI provider bundles", () => {
	it("renders free providers to Pi and OpenCode without literal secrets", async () => {
		const bundle = await generateFreeProviderBundle(fetcher());

		const pi = renderPiProvidersConfig(bundle);
		const opencode = renderOpenCodeProvidersConfig(bundle);

		expect(pi.providers["openrouter-free"]?.apiKey).toBe("$OPENROUTER_API_KEY");
		expect(opencode.provider["openrouter-free"]?.options?.apiKey).toBe(
			"{env:OPENROUTER_API_KEY}",
		);
		expect(
			opencode.provider["openrouter-free"]?.models?.["vendor/model:free"]
				?.limit,
		).toEqual({ context: 32_000, output: 4096 });
		expect(
			opencode.provider["openrouter-free"]?.models?.["vendor/model:free-paid"],
		).toBeUndefined();
		expect(JSON.stringify(opencode)).not.toMatch(/sk-|ghp_|AIza|nvapi-/);
	});

	it("writes a both-target bundle and supports dry-run", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "javi-forge-ai-providers-"));
		const outputDir = join(tmp, "bundle");

		const written = await writeFreeProvidersBundle({
			outputDir,
			target: PROVIDER_BUNDLE_TARGET.BOTH,
			fetcher: fetcher(),
		});

		expect(written.wrote).toBe(true);
		await expect(
			stat(join(outputDir, "models.free.generated.json")),
		).resolves.toBeTruthy();
		await expect(
			stat(join(outputDir, "opencode.providers.generated.json")),
		).resolves.toBeTruthy();

		const dryRunDir = join(tmp, "dry-run");
		const dryRun = await writeFreeProvidersBundle({
			outputDir: dryRunDir,
			target: PROVIDER_BUNDLE_TARGET.BOTH,
			dryRun: true,
			fetcher: fetcher(),
		});

		expect(dryRun.wrote).toBe(false);
		await expect(
			stat(join(dryRunDir, "models.free.generated.json")),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("converts Pi providers to OpenCode provider metadata", async () => {
		const bundle = bundleFromPiProvidersConfig({
			providers: {
				"pi-provider": {
					baseUrl: "https://pi.example/v1",
					api: "openai-completions",
					apiKey: "$PI_EXAMPLE_KEY",
					models: [
						{
							id: "model-a",
							name: "Model A",
							contextWindow: 1000,
							maxTokens: 200,
							input: ["text"],
							reasoning: false,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
							},
						},
					],
				},
			},
		});

		const converted = renderOpenCodeProvidersConfig(bundle);

		expect(converted.provider["pi-provider"]?.options?.apiKey).toBe(
			"{env:PI_EXAMPLE_KEY}",
		);
		expect(
			converted.provider["pi-provider"]?.models?.["model-a"]?.limit,
		).toEqual({ context: 1000, output: 200 });
	});

	it("redacts literal API keys when converting Pi providers", () => {
		const bundle = bundleFromPiProvidersConfig({
			providers: {
				"secret-provider": {
					baseUrl: "https://secret.example/v1",
					api: "openai-completions",
					apiKey: "sk-real-secret",
					models: [],
				},
			},
		});

		const converted = renderOpenCodeProvidersConfig(bundle);

		expect(converted.provider["secret-provider"]?.options?.apiKey).toBe(
			"{env:SECRET_PROVIDER_API_KEY}",
		);
		expect(JSON.stringify(converted)).not.toContain("sk-real-secret");
	});

	it("converts OpenCode providers to Pi provider metadata", () => {
		const bundle = bundleFromOpenCodeConfig({
			provider: {
				opencode: {
					name: "OpenCode Example",
					options: {
						baseURL: "https://opencode.example/v1",
						apiKey: "{env:OPENCODE_EXAMPLE_KEY}",
					},
					models: {
						coder: {
							name: "Coder",
							modelID: "vendor/coder",
							limit: { context: 2000, output: 300 },
						},
					},
				},
			},
		});

		const converted = renderPiProvidersConfig(bundle);

		expect(converted.providers.opencode.apiKey).toBe("$OPENCODE_EXAMPLE_KEY");
		expect(converted.providers.opencode.models[0]).toMatchObject({
			id: "vendor/coder",
			contextWindow: 2000,
			maxTokens: 300,
		});
	});

	it("redacts literal API keys when converting OpenCode providers", () => {
		const bundle = bundleFromOpenCodeConfig({
			provider: {
				opencode: {
					options: {
						baseURL: "https://opencode.example/v1",
						apiKey: "sk-real-secret",
					},
					models: {},
				},
			},
		});

		const converted = renderPiProvidersConfig(bundle);

		expect(converted.providers.opencode.apiKey).toBe("$OPENCODE_API_KEY");
		expect(JSON.stringify(converted)).not.toContain("sk-real-secret");
	});

	it("rejects OpenCode providers without a custom baseURL when converting to Pi", () => {
		expect(() =>
			bundleFromOpenCodeConfig({
				provider: {
					openrouter: {
						models: {
							"vendor/model": { name: "Vendor Model" },
						},
					},
				},
			}),
		).toThrow(/has no custom baseURL/);
	});

	it("converts provider config files without mutating runtime config", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "javi-forge-provider-convert-"));
		const inputPath = join(tmp, "models.json");
		const outputDir = join(tmp, "out");
		await writeFile(
			inputPath,
			JSON.stringify({
				providers: {
					"pi-provider": {
						baseUrl: "https://pi.example/v1",
						api: "openai-completions",
						apiKey: "anonymous",
						authHeader: false,
						models: [],
					},
				},
			}),
		);

		const result = await convertProviderBundle({
			from: PROVIDER_BUNDLE_SOURCE.PI,
			to: PROVIDER_BUNDLE_SOURCE.OPENCODE,
			inputPath,
			outputDir,
		});

		expect(result.wrote).toBe(true);
		const converted = JSON.parse(
			await readFile(
				join(outputDir, "opencode.providers.converted.json"),
				"utf8",
			),
		);
		expect(converted.provider["pi-provider"].options.apiKey).toBeUndefined();
		expect(await readFile(inputPath, "utf8")).toContain("pi-provider");
	});
});
