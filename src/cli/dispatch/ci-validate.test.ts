import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLI, RendererCtx } from "./types.js";

/**
 * `javi-forge ci validate` dispatch contract: pure parse-and-report over
 * validateCIConfig. Valid → OK summary + exit 0; invalid → `path: message`
 * lines on stderr + exit 1; `--json` emits the machine shape in both cases.
 * The command module is mocked so this test never touches the filesystem or
 * Docker.
 */

const validateCIConfig = vi.fn();

vi.mock("../../commands/ci-validate.js", () => ({ validateCIConfig }));

const cliStub = (flags: Record<string, unknown>): CLI =>
	({ input: ["ci", "validate"], flags }) as unknown as CLI;

async function runValidate(flags: Record<string, unknown> = {}): Promise<{
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
	await expect(handleCi(cliStub(flags), {} as RendererCtx)).rejects.toThrow(
		"process.exit",
	);

	return { out, err, exitCode };
}

describe("ci validate dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		validateCIConfig.mockReset();
	});

	it("prints an OK summary with runner names+stacks and exits 0", async () => {
		validateCIConfig.mockResolvedValue({
			ok: true,
			configPath: "/repo/.javi-forge/ci.yaml",
			runners: [
				{ name: "api", stack: "go" },
				{ name: "web", stack: "node" },
			],
		});

		const { out, exitCode } = await runValidate();

		const joined = out.join("\n");
		expect(joined).toContain("/repo/.javi-forge/ci.yaml");
		expect(joined).toContain("api");
		expect(joined).toContain("go");
		expect(joined).toContain("web");
		expect(joined).toContain("node");
		expect(exitCode).toBe(0);
	});

	it("emits {ok:true, runners} JSON on --json and exits 0", async () => {
		validateCIConfig.mockResolvedValue({
			ok: true,
			configPath: "/repo/.javi-forge/ci.yaml",
			runners: [{ name: "api", stack: "go" }],
		});

		const { out, exitCode } = await runValidate({ json: true });

		const parsed = JSON.parse(out.join("\n"));
		expect(parsed).toEqual({
			ok: true,
			runners: [{ name: "api", stack: "go" }],
		});
		expect(exitCode).toBe(0);
	});

	it("prints each error as `path: message` on stderr and exits 1", async () => {
		validateCIConfig.mockResolvedValue({
			ok: false,
			configPath: "/repo/.javi-forge/ci.yaml",
			errors: [
				{ path: "version", message: "must be the number 1" },
				{ path: "runners", message: 'duplicate runner name "api"' },
			],
		});

		const { err, exitCode } = await runValidate();

		const joined = err.join("\n");
		expect(joined).toContain("version: must be the number 1");
		expect(joined).toContain('runners: duplicate runner name "api"');
		expect(exitCode).toBe(1);
	});

	it("emits {ok:false, errors} JSON on --json and exits 1", async () => {
		validateCIConfig.mockResolvedValue({
			ok: false,
			configPath: null,
			errors: [{ path: "x", message: "no .javi-forge/ci.yaml found at x" }],
		});

		const { out, exitCode } = await runValidate({ json: true });

		const parsed = JSON.parse(out.join("\n"));
		expect(parsed).toEqual({
			ok: false,
			errors: [{ path: "x", message: "no .javi-forge/ci.yaml found at x" }],
		});
		expect(exitCode).toBe(1);
	});

	it("passes an explicit --config through to validateCIConfig", async () => {
		validateCIConfig.mockResolvedValue({
			ok: true,
			configPath: "/custom/ci.yaml",
			runners: [{ name: "api", stack: "go" }],
		});

		await runValidate({ config: "/custom/ci.yaml" });

		expect(validateCIConfig).toHaveBeenCalledWith(
			process.cwd(),
			"/custom/ci.yaml",
		);
	});
});
