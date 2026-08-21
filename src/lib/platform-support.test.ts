import { describe, expect, it } from "vitest";
import {
	LIFECYCLE_SUPPORT,
	PLATFORM_REFUSAL,
	PLATFORM_SUPPORT_STATE,
	resolvePlatformSupport,
} from "./platform-support.js";

describe("resolvePlatformSupport", () => {
	it("returns the stable deprecated lifecycle policy for exact darwin", () => {
		expect(resolvePlatformSupport("darwin")).toEqual({
			platform: "darwin",
			state: PLATFORM_SUPPORT_STATE.MACOS_DEPRECATED,
			lifecycle: LIFECYCLE_SUPPORT.UNSUPPORTED,
			refusalCode: PLATFORM_REFUSAL.MACOS_LIFECYCLE_UNSUPPORTED,
			guidance: expect.stringContaining("pin a supported release or migrate"),
		});
	});

	it.each([
		"linux",
		"win32",
		"darwin-arm64",
		"unknown",
	])("does not alias %s to Darwin", (platform) => {
		expect(resolvePlatformSupport(platform)).toBeUndefined();
	});
});
