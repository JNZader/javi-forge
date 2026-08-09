import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLI, RendererCtx } from "./types.js";

/**
 * Per-command help for `ci`: `ci --help` and `ci <unknown-subcommand>` print
 * the ci-specific usage (subcommands + ci flags) instead of rendering the
 * pipeline. The global `--help` is handled in the entrypoint, not here.
 */

const cliStub = (input: string[], flags: Record<string, unknown> = {}): CLI =>
	({ input, flags }) as unknown as CLI;

async function runCi(cli: CLI): Promise<{
	out: string[];
	err: string[];
	exitCode: number | undefined;
}> {
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

	const { handleCi } = await import("./ci.js");
	await expect(handleCi(cli, {} as RendererCtx)).rejects.toThrow(
		"process.exit",
	);

	return { out, err, exitCode };
}

describe("ci --help dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("prints ci usage listing init and validate subcommands, exits 0", async () => {
		const { out, exitCode } = await runCi(cliStub(["ci"], { help: true }));

		const joined = out.join("\n");
		expect(joined).toContain("init");
		expect(joined).toContain("validate");
		expect(joined).toContain("--quick");
		expect(joined).toContain("--json");
		expect(exitCode).toBe(0);
	});

	it("prints ci usage for an unknown subcommand and exits 1", async () => {
		const { out, exitCode } = await runCi(cliStub(["ci", "bogus"]));

		expect(out.join("\n")).toContain("validate");
		expect(exitCode).toBe(1);
	});
});
