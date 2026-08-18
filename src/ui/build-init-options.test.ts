import { describe, expect, it } from "vitest";
import type { HookProfile } from "../types/index.js";
import {
	buildInitOptions,
	type InitOptionsContext,
	type InitOptionsWizardResult,
} from "./build-init-options.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseWizard: InitOptionsWizardResult = {
	aiSync: true,
	sdd: true,
	contextDir: true,
	claudeMd: true,
	ghagga: false,
	securityHooks: true,
	codeGraph: false,
	localAi: false,
	hookProfile: "standard",
};

const baseContext: InitOptionsContext = {
	projectName: "acme",
	projectDir: "/tmp/acme",
	stack: "node",
	ciProvider: "github",
	memory: "engram",
	mock: false,
	dryRun: false,
};

const wizard = (
	over: Partial<InitOptionsWizardResult> = {},
): InitOptionsWizardResult => ({ ...baseWizard, ...over });

const context = (
	over: Partial<InitOptionsContext> = {},
): InitOptionsContext => ({ ...baseContext, ...over });

const ALL_PROFILES: HookProfile[] = ["minimal", "standard", "strict"];

describe("buildInitOptions — claudePreToolUseGuard derivation (R2-001)", () => {
	// This is the coverage gap Slice 4a flagged: the guard must track
	// securityHooks exactly, or managed-guard installation is silently disabled.

	it("derives claudePreToolUseGuard === securityHooks (true)", () => {
		const result = buildInitOptions(wizard({ securityHooks: true }), context());
		expect(result.claudePreToolUseGuard).toBe(true);
		expect(result.claudePreToolUseGuard).toBe(result.securityHooks);
	});

	it("derives claudePreToolUseGuard === securityHooks (false)", () => {
		const result = buildInitOptions(
			wizard({ securityHooks: false }),
			context(),
		);
		expect(result.claudePreToolUseGuard).toBe(false);
		expect(result.claudePreToolUseGuard).toBe(result.securityHooks);
	});

	it.each(
		ALL_PROFILES,
	)("installs the guard for hookProfile=%s when securityHooks is true (incl. minimal)", (hookProfile) => {
		const result = buildInitOptions(
			wizard({ securityHooks: true, hookProfile }),
			context(),
		);
		expect(result.claudePreToolUseGuard).toBe(true);
		expect(result.hookProfile).toBe(hookProfile);
	});

	it.each(
		ALL_PROFILES,
	)("never installs the guard when securityHooks is false, regardless of hookProfile=%s", (hookProfile) => {
		const result = buildInitOptions(
			wizard({ securityHooks: false, hookProfile }),
			context(),
		);
		expect(result.claudePreToolUseGuard).toBe(false);
	});
});

describe("buildInitOptions — other derived fields", () => {
	it("passes dryRun through from context", () => {
		expect(buildInitOptions(wizard(), context({ dryRun: true })).dryRun).toBe(
			true,
		);
		expect(buildInitOptions(wizard(), context({ dryRun: false })).dryRun).toBe(
			false,
		);
	});

	it("passes mock (presetMock) through from context", () => {
		expect(buildInitOptions(wizard(), context({ mock: true })).mock).toBe(true);
		expect(buildInitOptions(wizard(), context({ mock: false })).mock).toBe(
			false,
		);
	});

	it("hardcodes dockerDeploy=false and dockerServiceName='app'", () => {
		const result = buildInitOptions(wizard(), context());
		expect(result.dockerDeploy).toBe(false);
		expect(result.dockerServiceName).toBe("app");
	});

	it("passes wizard toggles and context identity through unchanged", () => {
		const result = buildInitOptions(
			wizard({
				aiSync: false,
				sdd: false,
				ghagga: true,
				contextDir: false,
				claudeMd: false,
				codeGraph: true,
				localAi: true,
			}),
			context({
				projectName: "widget",
				projectDir: "/srv/widget",
				stack: "python",
				ciProvider: "gitlab",
				memory: "memory-simple",
			}),
		);
		expect(result).toMatchObject({
			projectName: "widget",
			projectDir: "/srv/widget",
			stack: "python",
			ciProvider: "gitlab",
			memory: "memory-simple",
			aiSync: false,
			sdd: false,
			ghagga: true,
			contextDir: false,
			claudeMd: false,
			codeGraph: true,
			localAi: true,
		});
	});
});
