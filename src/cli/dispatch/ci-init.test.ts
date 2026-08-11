import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLI, RendererCtx } from "./types.js";

/**
 * `javi-forge ci init` output contract (design D4/D9): upgrades are reported
 * DISTINCTLY from fresh installs, backups are surfaced, refusals go to stderr,
 * and the exit code is 1 iff something was refused.
 */

const installCIHooks = vi.fn();

vi.mock("../../commands/ci.js", () => ({ installCIHooks }));

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

const cliStub = (flags: Record<string, unknown>): CLI =>
	({ input: ["ci", "init"], flags }) as unknown as CLI;

async function runInit(flags: Record<string, unknown> = {}): Promise<{
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

describe("ci init dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installCIHooks.mockReset();
	});

	it("passes --force through to installCIHooks", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-commit"] }));

		await runInit({ force: true });

		expect(installCIHooks).toHaveBeenCalledWith(process.cwd(), {
			force: true,
		});
	});

	it("defaults force to false when the flag is absent", async () => {
		installCIHooks.mockResolvedValue(result({ installed: ["pre-commit"] }));

		await runInit();

		expect(installCIHooks).toHaveBeenCalledWith(process.cwd(), {
			force: false,
		});
	});

	it("reports upgrades distinctly from fresh installs", async () => {
		installCIHooks.mockResolvedValue(
			result({
				installed: ["commit-msg"],
				upgraded: ["pre-commit"],
				states: [{ name: "pre-commit", state: "legacy-v0" }],
			}),
		);

		const { out, exitCode } = await runInit();

		const joined = out.join("\n");
		expect(joined).toContain("Installed");
		expect(joined).toContain("commit-msg");
		expect(joined).toMatch(/Upgraded pre-commit/);
		expect(joined).toContain("legacy-v0");
		expect(exitCode).toBe(0);
	});

	it("surfaces the legacy-hooksPath migration note", async () => {
		installCIHooks.mockResolvedValue(
			result({
				installed: ["pre-commit", "pre-push", "commit-msg"],
				notes: [
					"legacy javi-forge hooksPath removed; hooks now live in .git/hooks",
				],
			}),
		);

		const { out, exitCode } = await runInit();

		expect(out.join("\n")).toContain("hooksPath removed");
		expect(exitCode).toBe(0);
	});

	it("surfaces backups", async () => {
		installCIHooks.mockResolvedValue(
			result({
				installed: ["pre-commit"],
				backups: ["/repo/.git/hooks/pre-commit.bak"],
			}),
		);

		const { out } = await runInit({ force: true });

		expect(out.join("\n")).toContain("/repo/.git/hooks/pre-commit.bak");
	});

	it("exits 1 and prints refusals on stderr", async () => {
		installCIHooks.mockResolvedValue(
			result({
				installed: ["pre-push"],
				errors: ["pre-commit: refusing to overwrite"],
			}),
		);

		const { err, exitCode } = await runInit();

		expect(err.join("\n")).toContain("pre-commit: refusing to overwrite");
		expect(exitCode).toBe(1);
	});
});
