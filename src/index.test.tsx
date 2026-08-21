import { describe, expect, it, vi } from "vitest";

const bootstrapCli = vi.fn(async () => ({
	state: "unsupported-platform" as const,
	exitCode: 1,
}));
const supportedCliModule = vi.fn();

vi.mock("./cli/bootstrap.js", () => ({ bootstrapCli }));
vi.mock("./cli/main.js", () => {
	supportedCliModule();
	return {};
});

describe("composition root unsupported-platform", () => {
	it("applies the typed unsupported exit code without loading the supported CLI", async () => {
		const oldExitCode = process.exitCode;
		process.exitCode = undefined;
		try {
			await import("./index.js");
			expect(bootstrapCli).toHaveBeenCalledOnce();
			expect(process.exitCode).toBe(1);
			expect(supportedCliModule).not.toHaveBeenCalled();
		} finally {
			process.exitCode = oldExitCode;
		}
	});
});
