import { describe, expect, it } from "vitest";
import {
	classifyHostPlatform,
	HOST_SUPPORT_GUIDANCE,
	HOST_SUPPORT_STATE,
} from "./platform-support.js";

describe("classifyHostPlatform", () => {
	it.each(["linux", "win32"] as const)("supports exact %s", (platform) => {
		expect(classifyHostPlatform(platform)).toEqual({
			state: HOST_SUPPORT_STATE.SUPPORTED,
			platform,
		});
	});

	it.each([
		"darwin",
		"darwin-arm64",
		"freebsd",
		"unknown",
	])("refuses unsupported %s with the same stable unsupported-platform outcome", (platform) => {
		expect(classifyHostPlatform(platform)).toEqual({
			state: HOST_SUPPORT_STATE.UNSUPPORTED,
			refusalCode: "unsupported-platform",
			guidance: HOST_SUPPORT_GUIDANCE,
		});
	});
});
