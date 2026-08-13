import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillInstallResult } from "../lib/auto-skill-install.js";
import type { SkillScanResult } from "../lib/skill-scanner.js";

// ── Mock the auto-install lib (the gate itself is tested in lib suites) ─────
vi.mock("../lib/auto-skill-install.js", () => ({
	autoInstallSkills: vi.fn(),
}));

import { autoInstallSkills } from "../lib/auto-skill-install.js";
import AutoSkills from "./AutoSkills.js";
import { CIProvider } from "./CIContext.js";

const mockAutoInstall = vi.mocked(autoInstallSkills);

/**
 * AutoSkills — skillguard refusal exit code (FU-1 / R4-002).
 *
 * A refused auto-install (gate-blocked batch) must set a non-zero exit code so
 * scripted consumers can tell a refusal apart from success; a clean batch
 * (including force-lifted unscannable installs, which are NOT blocked) keeps
 * exit 0. The component sets `process.exitCode` — never `process.exit()` — so
 * the Ink tree keeps rendering and unmounting normally.
 */

function blockedScan(skillName: string): SkillScanResult {
	return {
		skillPath: `/fake/skills/${skillName}/SKILL.md`,
		skillName,
		verdict: "block",
		threats: [],
		summary: { total: 1, critical: 1, high: 0, moderate: 0, low: 0 },
	};
}

function result(overrides: Partial<SkillInstallResult>): SkillInstallResult {
	return {
		installed: [],
		skipped: [],
		notFound: [],
		blocked: [],
		detection: { stack: "node", signals: [], recommendedSkills: ["a"] },
		...overrides,
	};
}

describe("AutoSkills — skillguard refusal exit code (FU-1/R4-002)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = undefined;
	});

	it("exits non-zero when the batch is refused (blocked skills)", async () => {
		mockAutoInstall.mockResolvedValue(
			result({ blocked: [blockedScan("evil-skill")] }),
		);

		const { unmount } = render(
			<CIProvider isCI={false}>
				<AutoSkills projectDir="/tmp/project" />
			</CIProvider>,
		);

		await vi.waitFor(() => {
			expect(process.exitCode).toBe(1);
		});
		unmount();
	});

	it("keeps exit 0 on a clean install", async () => {
		mockAutoInstall.mockResolvedValue(result({ installed: ["a"] }));

		const { unmount } = render(
			<CIProvider isCI={false}>
				<AutoSkills projectDir="/tmp/project" />
			</CIProvider>,
		);

		await vi.waitFor(() => {
			expect(process.exitCode).toBe(0);
		});
		unmount();
	});

	it("exits non-zero when the scan throws (gate deny — nothing copied)", async () => {
		mockAutoInstall.mockRejectedValue(new Error("scan exploded"));

		const { unmount } = render(
			<CIProvider isCI={false}>
				<AutoSkills projectDir="/tmp/project" />
			</CIProvider>,
		);

		await vi.waitFor(() => {
			expect(process.exitCode).toBe(1);
		});
		unmount();
	});
});
