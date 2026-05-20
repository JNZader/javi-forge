import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		writeJson: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

import fs from "fs-extra";
import { stepAgentSkills } from "./agent-skills.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeJson.mockResolvedValue(undefined as never);
});

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
	return {
		projectName: "test-project",
		projectDir: "/test/project",
		stack: "node",
		ciProvider: "github",
		memory: "engram",
		aiSync: true,
		sdd: true,
		ghagga: true,
		mock: false,
		contextDir: true,
		claudeMd: true,
		securityHooks: true,
		hookProfile: "standard",
		codeGraph: false,
		dockerDeploy: false,
		dockerServiceName: "app",
		localAi: false,
		dryRun: false,
		...overrides,
	};
}

async function collect(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepAgentSkills({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepAgentSkills", () => {
	it("agent-skills step generates skills.json in project root", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("skills.json")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions());
		const skillsStep = steps.find(
			(s) => s.id === "agent-skills" && s.status === "done",
		);
		expect(skillsStep).toBeDefined();
		expect(skillsStep!.detail).toContain("skills.json");

		const writeJsonCalls = mockedFs.writeJson.mock.calls;
		const skillsCall = writeJsonCalls.find((call: unknown[]) =>
			String(call[0]).endsWith("skills.json"),
		);
		expect(skillsCall).toBeDefined();
		const manifest = skillsCall![1] as {
			name: string;
			version: string;
			skills: unknown[];
		};
		expect(manifest.name).toBe("test-project");
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.skills).toEqual([]);
	});

	it("agent-skills step reports already exists when skills.json is present", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		const steps = await collect(makeOptions());
		const skillsStep = steps.find(
			(s) =>
				s.id === "agent-skills" &&
				s.status === "done" &&
				s.detail === "already exists",
		);
		expect(skillsStep).toBeDefined();
	});

	it("agent-skills dry-run does not write skills.json", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("skills.json")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ dryRun: true }));
		const skillsStep = steps.find(
			(s) => s.id === "agent-skills" && s.status === "done",
		);
		expect(skillsStep).toBeDefined();
		expect(skillsStep!.detail).toContain("dry-run");

		const skillsWrites = mockedFs.writeJson.mock.calls.filter(
			(call: unknown[]) => String(call[0]).endsWith("skills.json"),
		);
		expect(skillsWrites).toHaveLength(0);
	});
});
