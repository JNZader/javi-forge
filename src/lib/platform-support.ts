export const HOST_SUPPORT_STATE = {
	SUPPORTED: "supported",
	UNSUPPORTED: "unsupported-platform",
} as const;

export const HOST_SUPPORT_GUIDANCE =
	"javi-forge supports Linux and Windows only.";

export type SupportedHostPlatform = "linux" | "win32";

export interface SupportedHost {
	state: typeof HOST_SUPPORT_STATE.SUPPORTED;
	platform: SupportedHostPlatform;
}

export interface PlatformSupport {
	state: typeof HOST_SUPPORT_STATE.UNSUPPORTED;
	refusalCode: typeof HOST_SUPPORT_STATE.UNSUPPORTED;
	guidance: typeof HOST_SUPPORT_GUIDANCE;
}

export type HostSupportResult = SupportedHost | PlatformSupport;

/**
 * Classifies every host value without aliases or fallthrough.
 */
export function classifyHostPlatform(platform: string): HostSupportResult {
	if (platform === "linux" || platform === "win32") {
		return { state: HOST_SUPPORT_STATE.SUPPORTED, platform };
	}
	return {
		state: HOST_SUPPORT_STATE.UNSUPPORTED,
		refusalCode: HOST_SUPPORT_STATE.UNSUPPORTED,
		guidance: HOST_SUPPORT_GUIDANCE,
	};
}

/** Returns an unsupported result for legacy callers, otherwise undefined. */
export function resolvePlatformSupport(
	platform: string,
): PlatformSupport | undefined {
	const result = classifyHostPlatform(platform);
	return result.state === HOST_SUPPORT_STATE.UNSUPPORTED ? result : undefined;
}
