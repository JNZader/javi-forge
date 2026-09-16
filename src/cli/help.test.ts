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
// doctor --refresh-context
// =============================================================================

describe("help / FLAGS_SCHEMA — doctor --refresh-context", () => {
	it("declares a --refresh-context boolean flag defaulting to false", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("refreshContext");
		expect(FLAGS_SCHEMA.refreshContext.type).toBe("boolean");
		expect(FLAGS_SCHEMA.refreshContext.default).toBe(false);
	});

	it("documents explicit context refresh in the global help", () => {
		expect(HELP_TEXT).toContain("--refresh-context");
		expect(HELP_TEXT).toContain("Refresh .context/ during doctor");
	});
});

// =============================================================================
// Pi free-provider export
// =============================================================================

describe("help — pi free-provider export", () => {
	it("documents the pi providers export-free command", () => {
		expect(HELP_TEXT).toContain("pi providers export-free");
		expect(HELP_TEXT).toContain("ai providers export-free");
		expect(HELP_TEXT).toContain("ai providers convert");
		expect(HELP_TEXT).toContain("ai providers apply-scope");
		expect(HELP_TEXT).toContain("--runtime");
		expect(HELP_TEXT).toContain("--opencode-command");
		expect(HELP_TEXT).toContain("--opencode-agent");
		expect(HELP_TEXT).toContain("--smoke-cwd");
	});

	it("shows pi providers export-free examples", () => {
		const examples = HELP_TEXT.split("Examples")[1] ?? "";
		expect(examples).toContain("pi providers export-free");
		expect(examples).toContain("ai providers export-free --target both");
		expect(examples).toContain("ai providers convert pi opencode");
		expect(examples).toContain("ai providers apply-scope");
		expect(examples).toContain("smoke-test /tmp/opencode-smoke");
		expect(examples).toContain("/tmp/pi-free-providers");
	});

	it("declares apply-scope config flags", () => {
		expect(FLAGS_SCHEMA).toHaveProperty("runtime");
		expect(FLAGS_SCHEMA.runtime.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("opencodeCommand");
		expect(FLAGS_SCHEMA.opencodeCommand.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("opencodeAgent");
		expect(FLAGS_SCHEMA.opencodeAgent.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("smokeCwd");
		expect(FLAGS_SCHEMA.smokeCwd.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("passList");
		expect(FLAGS_SCHEMA.passList.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("piSettings");
		expect(FLAGS_SCHEMA.piSettings.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("opencodeConfig");
		expect(FLAGS_SCHEMA.opencodeConfig.type).toBe("string");
	});
});

// =============================================================================
// Preparation production preflight
// =============================================================================

describe("help — preparation preflight", () => {
	it("documents the read-only preparation preflight command", () => {
		expect(HELP_TEXT).toContain("preparation template");
		expect(HELP_TEXT).toContain("preparation outputs-template");
		expect(HELP_TEXT).toContain("preparation policy");
		expect(HELP_TEXT).toContain("preparation digest");
		expect(HELP_TEXT).toContain("preparation readiness");
		expect(HELP_TEXT).toContain("preparation preflight");
		expect(HELP_TEXT).toContain("preparation bind");
		expect(HELP_TEXT).toContain("preparation approval-message");
		expect(HELP_TEXT).toContain("preparation approval-check");
		expect(HELP_TEXT).toContain("preparation approval-revoke");
		expect(HELP_TEXT).toContain(
			"Write an operator-owned preparation config template",
		);
		expect(HELP_TEXT).toContain(
			"Write an operator-owned outputs JSON template",
		);
		expect(HELP_TEXT).toContain(
			"Print the fixed preparation policy and output names",
		);
		expect(HELP_TEXT).toContain(
			"Compute a bounded SHA-256 digest for operator pins",
		);
		expect(HELP_TEXT).toContain(
			"Verify config, outputs, and approval without consuming",
		);
		expect(HELP_TEXT).toContain("Read-only production preparation preflight");
		expect(HELP_TEXT).toContain(
			"Compute a read-only production preparation binding",
		);
		expect(HELP_TEXT).toContain("Prepare the exact approval message to sign");
		expect(HELP_TEXT).toContain(
			"Verify approval evidence without consuming it",
		);
		expect(HELP_TEXT).toContain("Revoke approval evidence without executing");
		expect(HELP_TEXT).toContain("Write a preparation config/outputs template");
		expect(HELP_TEXT).toContain("Production preparation config JSON");
		expect(HELP_TEXT).toContain("Production preparation outputs JSON");
		expect(HELP_TEXT).toContain("Production preparation binding");
		expect(HELP_TEXT).toContain("Production preparation approval evidence");
		expect(HELP_TEXT).toContain("--output");
		expect(HELP_TEXT).toContain("--file");
		expect(HELP_TEXT).toContain("--outputs");
		expect(HELP_TEXT).toContain("--binding");
		expect(HELP_TEXT).toContain("--approval");
		expect(HELP_TEXT).toContain("--nonce");
		expect(HELP_TEXT).toContain("--issued-at");
		expect(HELP_TEXT).toContain("--expires-at");
		expect(HELP_TEXT).toContain("--json");
		expect(FLAGS_SCHEMA).toHaveProperty("output");
		expect(FLAGS_SCHEMA.output.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("file");
		expect(FLAGS_SCHEMA.file.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("outputs");
		expect(FLAGS_SCHEMA.outputs.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("approval");
		expect(FLAGS_SCHEMA.approval.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("binding");
		expect(FLAGS_SCHEMA.binding.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("nonce");
		expect(FLAGS_SCHEMA.nonce.type).toBe("string");
		expect(FLAGS_SCHEMA).toHaveProperty("issuedAt");
		expect(FLAGS_SCHEMA.issuedAt.type).toBe("number");
		expect(FLAGS_SCHEMA).toHaveProperty("expiresAt");
		expect(FLAGS_SCHEMA.expiresAt.type).toBe("number");
	});

	it("shows a preparation preflight example", () => {
		const examples = HELP_TEXT.split("Examples")[1] ?? "";
		expect(examples).toContain("preparation template --output");
		expect(examples).toContain("preparation outputs-template --output");
		expect(examples).toContain("preparation policy --json");
		expect(examples).toContain("preparation digest --file");
		expect(examples).toContain("preparation readiness --config");
		expect(examples).toContain("preparation preflight --config");
		expect(examples).toContain("preparation bind --config");
		expect(examples).toContain("preparation approval-message --binding");
		expect(examples).toContain("preparation approval-check --config");
		expect(examples).toContain("preparation approval-revoke --config");
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

	it("HOOKS_HELP_TEXT documents the codex guard subcommands", () => {
		expect(HOOKS_HELP_TEXT).toContain("install codex");
		expect(HOOKS_HELP_TEXT).toContain("doctor codex");
		expect(HOOKS_HELP_TEXT).toContain("repair codex");
	});

	it("HOOKS_HELP_TEXT documents the Grok Build hook subcommands", () => {
		expect(HOOKS_HELP_TEXT).toContain("install grok");
		expect(HOOKS_HELP_TEXT).toContain("doctor grok");
		expect(HOOKS_HELP_TEXT).toContain("repair grok");
	});

	it("HOOKS_HELP_TEXT documents the Cursor hook subcommands", () => {
		expect(HOOKS_HELP_TEXT).toContain("install cursor");
		expect(HOOKS_HELP_TEXT).toContain("doctor cursor");
		expect(HOOKS_HELP_TEXT).toContain("repair cursor");
	});
});
