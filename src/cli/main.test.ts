import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	meow: vi.fn(),
	init: vi.fn(),
	doctor: vi.fn(),
	notifier: vi.fn(),
	stdin: vi.fn(),
	detectCI: vi.fn(),
}));

vi.mock("meow", () => ({ default: mocks.meow }));
vi.mock("./runtime.js", () => ({
	setupUpdateNotifier: mocks.notifier,
	createInkStdin: mocks.stdin,
	detectCI: mocks.detectCI,
}));
vi.mock("./dispatch/simple-renderers.js", () => ({
	handleInitDefault: mocks.init,
	handleDoctor: mocks.doctor,
	handleAnalyze: vi.fn(),
	handleLlmsTxt: vi.fn(),
	handlePlugin: vi.fn(),
}));
vi.mock("./dispatch/ai.js", () => ({ handleAi: vi.fn() }));
vi.mock("./dispatch/ci.js", () => ({ handleCi: vi.fn() }));
vi.mock("./dispatch/hooks.js", () => ({ handleHooks: vi.fn() }));
vi.mock("./dispatch/security.js", () => ({ handleSecurity: vi.fn() }));
vi.mock("./dispatch/skill-publish.js", () => ({ handleSkillPublish: vi.fn() }));
vi.mock("./dispatch/skills-cmd.js", () => ({ handleSkillsCmd: vi.fn() }));
vi.mock("./dispatch/tdd.js", () => ({ handleTdd: vi.fn() }));
vi.mock("./dispatch/workflow.js", () => ({ handleWorkflow: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(process, "exit").mockImplementation((() => {
		throw new Error("process.exit");
	}) as never);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runCli command routing", () => {
	it.each([
		false,
		true,
	])("rejects unknown commands before startup or init (batch=%s)", async (batch) => {
		const { runCli } = await import("./main.js");
		mocks.meow.mockReturnValue({
			input: ["inti"],
			flags: {
				batch,
				stack: "node",
				ci: "github",
				memory: "none",
				projectName: "example",
			},
		});

		await expect(runCli()).rejects.toThrow("process.exit");

		expect(process.exit).toHaveBeenCalledWith(1);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('Unknown command "inti"'),
		);
		expect(mocks.init).not.toHaveBeenCalled();
		expect(mocks.notifier).not.toHaveBeenCalled();
		expect(mocks.stdin).not.toHaveBeenCalled();
		expect(mocks.detectCI).not.toHaveBeenCalled();
	});

	it.each([
		{ input: [] },
		{ input: ["init"] },
	])("preserves explicit and no-argument init ($input)", async ({ input }) => {
		const { runCli } = await import("./main.js");
		const cli = { input, flags: {} };
		mocks.meow.mockReturnValue(cli);

		await runCli();

		expect(mocks.init).toHaveBeenCalledExactlyOnceWith(cli, expect.any(Object));
		expect(mocks.notifier).toHaveBeenCalledOnce();
		expect(process.exit).not.toHaveBeenCalled();
	});

	it("dispatches doctor without initializing or starting the update notifier", async () => {
		const { runCli } = await import("./main.js");
		mocks.meow.mockReturnValue({ input: ["doctor"], flags: {} });

		await runCli();

		expect(mocks.doctor).toHaveBeenCalledOnce();
		expect(mocks.notifier).not.toHaveBeenCalled();
		expect(mocks.init).not.toHaveBeenCalled();
	});

	it("skips the update notifier for dry-runs", async () => {
		const { runCli } = await import("./main.js");
		const cli = { input: ["init"], flags: { dryRun: true } };
		mocks.meow.mockReturnValue(cli);

		await runCli();

		expect(mocks.init).toHaveBeenCalledExactlyOnceWith(cli, expect.any(Object));
		expect(mocks.notifier).not.toHaveBeenCalled();
	});
});
