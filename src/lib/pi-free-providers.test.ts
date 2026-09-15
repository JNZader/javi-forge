import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	generatePiFreeProvidersConfig,
	PI_FREE_PROVIDER_ID,
	writePiFreeProvidersBundle,
} from "./pi-free-providers.js";

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function freeCatalog(id: string, extra: Record<string, unknown> = {}) {
	return {
		data: [
			{
				id,
				name: `${id} free`,
				context_length: 256_000,
				pricing: { prompt: "0", completion: "0" },
				supported_parameters: ["reasoning"],
				...extra,
			},
			{
				id: `${id}-paid`,
				name: `${id} paid`,
				context_length: 128_000,
				pricing: { prompt: "0.1", completion: "0.2" },
			},
		],
	};
}

function fetcher(): typeof fetch {
	return vi.fn(async (source: RequestInfo | URL) => {
		const url = String(source);
		if (url.includes("kilo.ai"))
			return jsonResponse(freeCatalog("kilo-auto/free"));
		if (url.includes("openrouter.ai")) {
			return jsonResponse(
				freeCatalog("vendor/model:free", {
					architecture: { input_modalities: ["text", "image"] },
				}),
			);
		}
		if (url.includes("blockrun.ai")) {
			return jsonResponse({
				models: [
					{
						id: "nvidia/nemotron-free",
						name: "Nemotron (Free)",
						billing_mode: "free",
						context_window: 1_000_000,
						max_output: 16_384,
						categories: ["chat", "reasoning"],
					},
				],
			});
		}
		return new Response("not found", { status: 404 });
	}) as unknown as typeof fetch;
}

describe("Pi free providers", () => {
	it("generates only shareable provider metadata, never literal secrets", async () => {
		const config = await generatePiFreeProvidersConfig(fetcher());

		expect(config.providers[PI_FREE_PROVIDER_ID.KILO].models).toHaveLength(1);
		expect(
			config.providers[PI_FREE_PROVIDER_ID.OPENROUTER].models,
		).toHaveLength(1);
		expect(config.providers[PI_FREE_PROVIDER_ID.BLOCKRUN].models).toHaveLength(
			1,
		);
		expect(config.providers[PI_FREE_PROVIDER_ID.VIREONIX].models[0]!.id).toBe(
			"auto",
		);
		expect(config.providers[PI_FREE_PROVIDER_ID.OLLAMA].models[0]!.id).toBe(
			"granite3.2:2b",
		);
		expect(config.providers[PI_FREE_PROVIDER_ID.OPENROUTER].apiKey).toBe(
			"$OPENROUTER_API_KEY",
		);
		expect(config.providers[PI_FREE_PROVIDER_ID.KILO].authHeader).toBe(false);
		expect(JSON.stringify(config)).not.toMatch(/sk-|ghp_|AIza|nvapi-/);
	});

	it("writes an exportable bundle and supports dry-run without writing", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "javi-forge-pi-providers-"));
		const outputDir = join(tmp, "bundle");

		const written = await writePiFreeProvidersBundle({
			outputDir,
			fetcher: fetcher(),
		});

		expect(written.wrote).toBe(true);
		expect(written.providerModelCounts[PI_FREE_PROVIDER_ID.KILO]).toBe(1);
		const generated = JSON.parse(await readFile(written.configPath, "utf8"));
		expect(generated.providers[PI_FREE_PROVIDER_ID.VIREONIX].models[0].id).toBe(
			"auto",
		);
		await expect(stat(written.readmePath)).resolves.toBeTruthy();
		await expect(stat(written.envExamplePath)).resolves.toBeTruthy();

		const dryRunDir = join(tmp, "dry-run");
		const dryRun = await writePiFreeProvidersBundle({
			outputDir: dryRunDir,
			dryRun: true,
			fetcher: fetcher(),
		});
		expect(dryRun.wrote).toBe(false);
		await expect(stat(dryRun.configPath)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
