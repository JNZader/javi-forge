import { describe, expect, it } from "vitest";
import { FLAGS_SCHEMA, HELP_TEXT } from "./help.js";

// =============================================================================
// CI flag plumbing for mixed-stack CI (plan tasks 2)
// =============================================================================

describe("help / FLAGS_SCHEMA — CI runner options", () => {
	it("declares a --config string flag", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("config");
		expect(FLAGS_SCHEMA.config.type).toBe("string");
	});

	it("declares a --stack string flag (shared with init)", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("stack");
		expect(FLAGS_SCHEMA.stack.type).toBe("string");
	});

	it("documents --config under CI options", () => {
		expect(HELP_TEXT).toContain("--config");
	});

	it("documents that --stack is a single-stack override, not for hybrid repos", () => {
		// The CI section must steer hybrid repositories to --config.
		const ciSection = HELP_TEXT.split("CI options")[1] ?? "";
		expect(ciSection).toContain("--stack");
		expect(ciSection.toLowerCase()).toMatch(/hybrid/);
	});
});
