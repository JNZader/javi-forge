import { describe, expect, it } from "vitest";
import { execPathIsFile, leadingQuotedPath } from "./command-hook-exec-path.js";

describe("leadingQuotedPath", () => {
	it("parses a JSON-quoted command prefix", () => {
		expect(
			leadingQuotedPath(`${JSON.stringify("/usr/bin/node")} "/tmp/policy.mjs"`),
		).toBe("/usr/bin/node");
	});

	it("returns undefined when the command is not quoted", () => {
		expect(leadingQuotedPath("node policy.mjs")).toBeUndefined();
	});
});

describe("execPathIsFile", () => {
	it("accepts this process execPath", async () => {
		await expect(execPathIsFile(process.execPath)).resolves.toBe(true);
	});

	it("rejects a missing path", async () => {
		await expect(execPathIsFile("/missing/javi-forge-node")).resolves.toBe(
			false,
		);
	});
});
