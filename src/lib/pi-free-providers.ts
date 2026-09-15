import { join } from "node:path";
import {
	defaultPiFreeProvidersBundleDir,
	FREE_PROVIDER_ID,
	type FreeProviderId,
	generateFreeProviderBundle,
	type PiProvidersConfig,
	PROVIDER_BUNDLE_TARGET,
	renderPiProvidersConfig,
	type WriteFreeProviderBundleOptions,
	writeFreeProvidersBundle,
} from "./ai-provider-bundles.js";

export const PI_FREE_PROVIDER_ID = FREE_PROVIDER_ID;

export type PiFreeProviderId = FreeProviderId;

export type PiFreeProvidersConfig = PiProvidersConfig;

export interface PiFreeProvidersBundleResult {
	configPath: string;
	readmePath: string;
	envExamplePath: string;
	providerModelCounts: Record<string, number>;
	wrote: boolean;
}

export interface WritePiFreeProvidersBundleOptions
	extends Omit<WriteFreeProviderBundleOptions, "target"> {}

export { defaultPiFreeProvidersBundleDir };

export async function generatePiFreeProvidersConfig(
	fetcher: typeof fetch = fetch,
): Promise<PiFreeProvidersConfig> {
	return renderPiProvidersConfig(await generateFreeProviderBundle(fetcher));
}

export async function writePiFreeProvidersBundle(
	options: WritePiFreeProvidersBundleOptions = {},
): Promise<PiFreeProvidersBundleResult> {
	const result = await writeFreeProvidersBundle({
		...options,
		target: PROVIDER_BUNDLE_TARGET.PI,
	});
	const outputDir = result.outputDir;
	return {
		configPath: join(outputDir, "models.free.generated.json"),
		readmePath: join(outputDir, "README.md"),
		envExamplePath: join(outputDir, "env.example"),
		providerModelCounts: result.providerModelCounts,
		wrote: result.wrote,
	};
}
