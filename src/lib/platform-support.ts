export const PLATFORM_SUPPORT_STATE = {
	MACOS_DEPRECATED: "macos-deprecated",
} as const;

export const LIFECYCLE_SUPPORT = {
	UNSUPPORTED: "unsupported",
} as const;

export const PLATFORM_REFUSAL = {
	MACOS_LIFECYCLE_UNSUPPORTED: "macos-lifecycle-unsupported",
} as const;

export interface PlatformSupport {
	platform: "darwin";
	state: typeof PLATFORM_SUPPORT_STATE.MACOS_DEPRECATED;
	lifecycle: typeof LIFECYCLE_SUPPORT.UNSUPPORTED;
	refusalCode: typeof PLATFORM_REFUSAL.MACOS_LIFECYCLE_UNSUPPORTED;
	guidance: string;
}

export const MACOS_DEPRECATION_GUIDANCE =
	"macOS is deprecated and unsupported for install, repair, and init; pin a supported release or migrate. Existing installed guards are not removed; Darwin removal is planned for 2.0.";

export function resolvePlatformSupport(
	platform: string,
): PlatformSupport | undefined {
	if (platform !== "darwin") return undefined;
	return {
		platform: "darwin",
		state: PLATFORM_SUPPORT_STATE.MACOS_DEPRECATED,
		lifecycle: LIFECYCLE_SUPPORT.UNSUPPORTED,
		refusalCode: PLATFORM_REFUSAL.MACOS_LIFECYCLE_UNSUPPORTED,
		guidance: MACOS_DEPRECATION_GUIDANCE,
	};
}
