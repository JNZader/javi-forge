import { resolvePlatformSupport } from "../lib/platform-support.js";

export type BootstrapResult =
	| { state: "supported"; exitCode: 0 }
	| { state: "unsupported-platform"; exitCode: 1 };

export async function bootstrapCli(
	platform: string,
	loadSupportedCli: () => Promise<unknown>,
	refuse: (message: string) => void,
): Promise<BootstrapResult> {
	const refusal = resolvePlatformSupport(platform);
	if (refusal) {
		refuse(`${refusal.refusalCode}: ${refusal.guidance}`);
		return { state: "unsupported-platform", exitCode: 1 };
	}
	await loadSupportedCli();
	return { state: "supported", exitCode: 0 };
}
