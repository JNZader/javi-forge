import { describe, expect, it } from "vitest";
import {
	CI_HELP_TEXT,
	FLAGS_SCHEMA,
	HELP_TEXT,
	HOOKS_HELP_TEXT,
} from "./help.js";

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

	it("shows a --config usage example", () => {
		const examples = HELP_TEXT.split("Examples")[1] ?? "";
		expect(examples).toContain("ci --config");
	});
});

// =============================================================================
// ci init --force (design D4)
// =============================================================================

describe("help / FLAGS_SCHEMA — ci init --force", () => {
	it("declares a --force boolean flag defaulting to false", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("force");
		expect(FLAGS_SCHEMA.force.type).toBe("boolean");
		expect(FLAGS_SCHEMA.force.default).toBe(false);
	});

	it("documents --force and the .bak guarantee under CI hooks", () => {
		const hooksSection = HELP_TEXT.split("CI hooks")[1] ?? "";
		expect(hooksSection).toContain("--force");
		expect(hooksSection).toContain(".bak");
	});

	it("shows a ci init --force usage example", () => {
		const examples = HELP_TEXT.split("Examples")[1] ?? "";
		expect(examples).toContain("ci init --force");
	});
});

// =============================================================================
// ci validate (JF-DOCS-1)
// =============================================================================

describe("help / FLAGS_SCHEMA — ci validate + --help + --json", () => {
	it("declares a --json boolean flag", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("json");
		expect(FLAGS_SCHEMA.json.type).toBe("boolean");
	});

	it("declares a --help boolean flag (autoHelp is handled manually)", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("help");
		expect(FLAGS_SCHEMA.help.type).toBe("boolean");
	});

	it("documents the ci validate subcommand in the global help", () => {
		expect(HELP_TEXT).toContain("ci validate");
	});
});

// =============================================================================
// CI_HELP_TEXT — per-command help for `ci`
// =============================================================================

describe("CI_HELP_TEXT — per-command help", () => {
	it("lists the init and validate subcommands", () => {
		expect(CI_HELP_TEXT).toContain("init");
		expect(CI_HELP_TEXT).toContain("validate");
	});

	it("documents the flags ci accepts", () => {
		for (const flag of [
			"--quick",
			"--no-docker",
			"--no-security",
			"--no-ci-ghagga",
			"--force",
			"--config",
			"--stack",
			"--json",
		]) {
			expect(CI_HELP_TEXT).toContain(flag);
		}
	});
});

// =============================================================================
// hooks dispatcher help (hook-consolidation S1a)
// =============================================================================

describe("help — hooks command", () => {
	it("documents `hooks run` in the global help", () => {
		expect(HELP_TEXT).toContain("hooks run");
	});

	it("HOOKS_HELP_TEXT documents the run subcommand and hook names", () => {
		expect(HOOKS_HELP_TEXT).toContain("hooks run");
		expect(HOOKS_HELP_TEXT).toContain("pre-commit");
		expect(HOOKS_HELP_TEXT).toContain("pre-push");
	});

	it("HOOKS_HELP_TEXT documents the claude guard subcommands and --force", () => {
		expect(HOOKS_HELP_TEXT).toContain("install claude");
		expect(HOOKS_HELP_TEXT).toContain("doctor claude");
		expect(HOOKS_HELP_TEXT).toContain("repair claude");
		expect(HOOKS_HELP_TEXT).toContain("--force");
	});
});
