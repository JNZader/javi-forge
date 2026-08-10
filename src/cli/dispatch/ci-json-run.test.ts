import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLI, RendererCtx } from "./types.js";

/**
 * `javi-forge ci --json` RUN-path contract (slice 4): the `--json` flag on the
 * run path (NOT the `validate` subcommand) is a NEW headless branch — it bypasses
 * the Ink render, drives `collectGateOutcomes`, prints `{ ok, gates }`, and sets
 * the process exit code EXPLICITLY (the Ink error boundary is never reached
 * without a render). The command module is mocked so this test never renders Ink
 * nor touches the filesystem.
 */

const collectGateOutcomes = vi.fn();
const render = vi.fn();

vi.mock("../../commands/ci.js", () => ({ collectGateOutcomes }));
vi.mock("ink", () => ({ render }));

const cliStub = (flags: Record<string, unknown>): CLI =>
	({ input: ["ci"], flags }) as unknown as CLI;

async function runJson(flags: Record<string, unknown>): Promise<{
	out: string[];
	exitCode: number | undefined;
}> {
	const out: string[] = [];
	let exitCode: number | undefined;

	vi.spyOn(console, "log").mockImplementation((...args) => {
		out.push(args.join(" "));
	});
	vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		exitCode = code;
		throw new Error("process.exit");
	}) as never);

	const { handleCi } = await import("./ci.js");
	await expect(handleCi(cliStub(flags), {} as RendererCtx)).rejects.toThrow(
		"process.exit",
	);

	return { out, exitCode };
}

describe("ci --json run-path (headless gate JSON)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		collectGateOutcomes.mockReset();
		render.mockReset();
	});

	it("bypasses Ink and prints {ok:false, gates} with exit 1 on a blocking failure", async () => {
		collectGateOutcomes.mockResolvedValue({
			ok: false,
			exitCode: 1,
			gates: [
				{
					id: "blocker",
					mode: "blocking",
					scope: "all",
					status: "error",
					blocking: true,
					exitCode: 3,
				},
				{
					id: "soft",
					mode: "informative",
					scope: "all",
					status: "warning",
					blocking: false,
				},
			],
		});

		const { out, exitCode } = await runJson({ json: true });

		// The Ink render was NOT invoked — this is a headless branch.
		expect(render).not.toHaveBeenCalled();
		const parsed = JSON.parse(out.join("\n"));
		expect(parsed.ok).toBe(false);
		expect(parsed.gates).toHaveLength(2);
		expect(parsed.gates[0]).toMatchObject({
			id: "blocker",
			status: "error",
			blocking: true,
		});
		// The process exit code is set EXPLICITLY from the collected result.
		expect(exitCode).toBe(1);
	});

	it("prints {ok:true} with exit 0 when only informative gates fail", async () => {
		collectGateOutcomes.mockResolvedValue({
			ok: true,
			exitCode: 0,
			gates: [
				{
					id: "soft",
					mode: "informative",
					scope: "all",
					status: "warning",
					blocking: false,
				},
			],
		});

		const { out, exitCode } = await runJson({ json: true, quick: true });

		expect(render).not.toHaveBeenCalled();
		const parsed = JSON.parse(out.join("\n"));
		expect(parsed).toEqual({
			ok: true,
			exitCode: 0,
			gates: [
				{
					id: "soft",
					mode: "informative",
					scope: "all",
					status: "warning",
					blocking: false,
				},
			],
		});
		expect(exitCode).toBe(0);
	});

	// JDA-A-002 / JDB-101: a blocking RUNNER (not gate) failure makes runCI throw,
	// so collectGateOutcomes returns { ok:true, gates:[], exitCode:1 } — `ok` stays
	// true (the spec ties it to blocking GATES), but the run FAILED. A consumer
	// keying on the object alone must still see the failure: the JSON MUST carry a
	// top-level `exitCode` so `ok:true` is not misread as run-success.
	it("surfaces a top-level exitCode so a runner failure is visible despite ok:true", async () => {
		collectGateOutcomes.mockResolvedValue({
			ok: true,
			exitCode: 1,
			gates: [],
		});

		const { out, exitCode } = await runJson({ json: true });

		expect(render).not.toHaveBeenCalled();
		const parsed = JSON.parse(out.join("\n"));
		// ok stays true per the blocking-gate contract, but the object exposes the
		// real run result so a JSON consumer is not fooled.
		expect(parsed.ok).toBe(true);
		expect(parsed.exitCode).toBe(1);
		expect(exitCode).toBe(1);
	});

	it("drives collectGateOutcomes with the resolved run mode (quick)", async () => {
		collectGateOutcomes.mockResolvedValue({ ok: true, exitCode: 0, gates: [] });

		await runJson({ json: true, quick: true });

		expect(collectGateOutcomes).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "quick" }),
		);
	});
});
