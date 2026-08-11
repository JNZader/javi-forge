import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLI } from "./types.js";

/**
 * `javi-forge tdd <init|pipeline>` output contract (hook-consolidation S3):
 * the handlers no longer write `.git/hooks` directly — they flip the
 * `hooks.*.tdd` flag in `.javi-forge/ci.yaml` and delegate the hook install to
 * the hardened `installCIHooks`. installed / upgraded / backups / errors from
 * that installer are surfaced to the console, and the exit code is 1 iff the
 * installer refused something.
 */

const installCIHooks = vi.fn();
const setHookFeature = vi.fn();

vi.mock("../../commands/ci.js", () => ({ installCIHooks }));
vi.mock("../../lib/ci-config.js", () => ({ setHookFeature }));

interface InstallResultStub {
	installed: string[];
	upgraded: string[];
	backups: string[];
	errors: string[];
	states: { name: string; state: string }[];
	notes: string[];
}

const result = (overrides: Partial<InstallResultStub>): InstallResultStub => ({
	installed: [],
	upgraded: [],
	backups: [],
	errors: [],
	states: [],
	notes: [],
	...overrides,
});

const cliStub = (input: string[], flags: Record<string, unknown>): CLI =>
	({ input, flags }) as unknown as CLI;

async function runTdd(
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

	const { handleTdd } = await import("./tdd.js");
	await expect(handleTdd(cliStub(input, flags))).rejects.toThrow(
		"process.exit",
	);

	return { out, err, exitCode };
}

describe("tdd init dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installCIHooks.mockReset();
		setHookFeature.mockReset();
		setHookFeature.mockResolvedValue("/repo/.javi-forge/ci.yaml");
	});

	it("flips hooks.pre-commit.tdd to true in ci.yaml", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-commit"] }));

		await runTdd(["tdd", "init"]);

		expect(setHookFeature).toHaveBeenCalledWith(
			process.cwd(),
			"pre-commit",
			"tdd",
			true,
		);
	});

	it("delegates the hook install to installCIHooks and passes --force through", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-commit"] }));

		await runTdd(["tdd", "init"], { force: true });

		expect(installCIHooks).toHaveBeenCalledWith(process.cwd(), { force: true });
	});

	it("defaults force to false when the flag is absent", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-commit"] }));

		await runTdd(["tdd", "init"]);

		expect(installCIHooks).toHaveBeenCalledWith(process.cwd(), {
			force: false,
		});
	});

	it("surfaces installed hooks and exits 0", async () => {
		installCIHooks.mockResolvedValue(
			result({ installed: ["pre-commit", "commit-msg"] }),
		);

		const { out, exitCode } = await runTdd(["tdd", "init"]);

		expect(out.join("\n")).toContain("pre-commit");
		expect(exitCode).toBe(0);
	});

	it("surfaces the foreign-hook backup and refusal, exiting 1 on errors", async () => {
		installCIHooks.mockResolvedValue(
			result({
				backups: ["/repo/.git/hooks/pre-commit.bak.1-0"],
				errors: [
					"pre-commit: refusing to overwrite a foreign hook — use --force",
				],
			}),
		);

		const { out, err, exitCode } = await runTdd(["tdd", "init"], {
			force: true,
		});

		expect(out.join("\n")).toContain("/repo/.git/hooks/pre-commit.bak.1-0");
		expect(err.join("\n")).toContain("--force");
		expect(exitCode).toBe(1);
	});
});

describe("tdd pipeline dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installCIHooks.mockReset();
		setHookFeature.mockReset();
		setHookFeature.mockResolvedValue("/repo/.javi-forge/ci.yaml");
	});

	it("flips hooks.pre-push.tdd to 'strict' by default", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-push"] }));

		await runTdd(["tdd", "pipeline"]);

		expect(setHookFeature).toHaveBeenCalledWith(
			process.cwd(),
			"pre-push",
			"tdd",
			"strict",
		);
	});

	it("flips hooks.pre-push.tdd to 'warn' when --mode warn is passed", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-push"] }));

		await runTdd(["tdd", "pipeline"], { mode: "warn" });

		expect(setHookFeature).toHaveBeenCalledWith(
			process.cwd(),
			"pre-push",
			"tdd",
			"warn",
		);
	});

	it("delegates the pre-push install to installCIHooks and surfaces it", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-push"] }));

		const { out, exitCode } = await runTdd(["tdd", "pipeline"], {
			mode: "strict",
		});

		expect(installCIHooks).toHaveBeenCalledWith(process.cwd(), {
			force: false,
		});
		expect(out.join("\n")).toContain("pre-push");
		expect(exitCode).toBe(0);
	});
});

describe("tdd usage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("prints usage and exits 1 for an unknown subcommand", async () => {
		const { err, exitCode } = await runTdd(["tdd", "bogus"]);
		expect(err.join("\n")).toMatch(/init|pipeline/);
		expect(exitCode).toBe(1);
	});
});
