import { resolvePlatformSupport } from "../lib/platform-support.js";

export type BootstrapResult =
	| { state: "supported"; exitCode: 0 }
	| { state: "unsupported-platform"; exitCode: 1 };

export interface SupportedCli {
	runCli: () => Promise<void>;
}

export async function bootstrapCli(
	platform: string,
	loadSupportedCli: () => Promise<SupportedCli>,
	refuse: (message: string) => void,
): Promise<BootstrapResult> {
	const refusal = resolvePlatformSupport(platform);
	if (refusal) {
		refuse(`${refusal.refusalCode}: ${refusal.guidance}`);
		return { state: "unsupported-platform", exitCode: 1 };
	}
	const supportedCli = await loadSupportedCli();
	await supportedCli.runCli();
	return { state: "supported", exitCode: 0 };
}
