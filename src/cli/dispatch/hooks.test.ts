import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLI } from "./types.js";

/**
 * `javi-forge hooks run <name>` dispatch: forwards the hook name to runHook and
 * exits with its code. Any other subcommand / missing name → usage + exit 1.
 */

const runHook = vi.fn();
const runClaudeHookCommand = vi.fn();

vi.mock("../../commands/hooks.js", () => ({ runHook }));
vi.mock("../../commands/claude-hooks.js", () => ({ runClaudeHookCommand }));

const cliStub = (input: string[], flags: Record<string, unknown> = {}): CLI =>
	({ input, flags }) as unknown as CLI;

async function run(
	input: string[],
	flags: Record<string, unknown> = {},
): Promise<{ out: string[]; err: string[]; exitCode: number | undefined }> {
	const out: string[] = [];
	const err: string[] = [];
	let exitCode: number | undefined;

	vi.spyOn(console, "log").mockImplementation((...args) => {
		out.push(args.join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...args) => {
		err.push(args.join(" "));
	});
	vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		exitCode = code;
		throw new Error("process.exit");
	}) as never);

	const { handleHooks } = await import("./hooks.js");
	await expect(handleHooks(cliStub(input, flags))).rejects.toThrow(
		"process.exit",
	);

	return { out, err, exitCode };
}

describe("hooks dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		runHook.mockReset();
		runClaudeHookCommand.mockReset();
	});

	it("dispatches `hooks run pre-commit` to runHook and exits with its code", async () => {
		runHook.mockResolvedValue(0);

		const { exitCode } = await run(["hooks", "run", "pre-commit"]);

		expect(runHook).toHaveBeenCalledWith("pre-commit", process.cwd());
		expect(exitCode).toBe(0);
	});

	it("propagates a non-zero runHook exit code", async () => {
		runHook.mockResolvedValue(1);

		const { exitCode } = await run(["hooks", "run", "pre-push"]);

		expect(exitCode).toBe(1);
	});

	it("prints usage and exits 1 when the hook name is missing", async () => {
		const { err, exitCode } = await run(["hooks", "run"]);

		expect(runHook).not.toHaveBeenCalled();
		expect(err.join("\n")).toMatch(/pre-commit.*pre-push/);
		expect(exitCode).toBe(1);
	});

	it("shows hooks help on --help and exits 0", async () => {
		const { out, exitCode } = await run(["hooks"], { help: true });

		expect(out.join("\n")).toContain("hooks run");
		expect(exitCode).toBe(0);
	});

	it("shows help and exits 1 on an unknown subcommand", async () => {
		const { exitCode } = await run(["hooks", "bogus"]);

		expect(runHook).not.toHaveBeenCalled();
		expect(runClaudeHookCommand).not.toHaveBeenCalled();
		expect(exitCode).toBe(1);
	});

	it("routes `hooks install claude` and exits with its code", async () => {
		runClaudeHookCommand.mockResolvedValue(0);

		const { exitCode } = await run(["hooks", "install", "claude"]);

		expect(runClaudeHookCommand).toHaveBeenCalledWith(
			"install",
			process.cwd(),
			{ force: false },
		);
		expect(exitCode).toBe(0);
	});

	it("routes `hooks doctor claude` and exits with its code", async () => {
		runClaudeHookCommand.mockResolvedValue(1);

		const { exitCode } = await run(["hooks", "doctor", "claude"]);

		expect(runClaudeHookCommand).toHaveBeenCalledWith("doctor", process.cwd(), {
			force: false,
		});
		expect(exitCode).toBe(1);
	});

	it("routes `hooks repair claude --force` forwarding force:true", async () => {
		runClaudeHookCommand.mockResolvedValue(0);

		const { exitCode } = await run(["hooks", "repair", "claude"], {
			force: true,
		});

		expect(runClaudeHookCommand).toHaveBeenCalledWith("repair", process.cwd(), {
			force: true,
		});
		expect(exitCode).toBe(0);
	});

	it("rejects a wrong target with usage + exit 1, never calling the command", async () => {
		const { err, exitCode } = await run(["hooks", "install", "foo"]);

		expect(runClaudeHookCommand).not.toHaveBeenCalled();
		expect(err.join("\n")).toContain("javi-forge hooks install claude");
		expect(exitCode).toBe(1);
	});

	it("rejects a missing target with usage + exit 1", async () => {
		const { err, exitCode } = await run(["hooks", "doctor"]);

		expect(runClaudeHookCommand).not.toHaveBeenCalled();
		expect(err.join("\n")).toContain("javi-forge hooks doctor claude");
		expect(exitCode).toBe(1);
	});
});
