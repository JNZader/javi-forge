import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const child = `
import fs from "node:fs"; import { createPosixSecureFs } from "./src/lib/secure-fs-posix.ts"; import { runTransaction } from "./src/lib/secure-fs-transaction.ts";
const projectDir = fs.mkdtempSync(process.env.HOME + "/jf-filehandle-"); const pass = async () => ({ ok: true }); const base = createPosixSecureFs({ proveClean: pass, proveNoEndangeringAcl: pass });
const secureFs = { ...base, proveOwnershipAndMode: async (target) => target === projectDir ? { ok: false, refusal: "unsafe-parent-chain", detail: "intended-refusal" } : pass() };
const outcome = await runTransaction({ secureFs, clock: () => new Date(0), nonce: () => "00000001", projectDir, layout: { containers: [], components: [] } });
console.log(outcome.errors.includes("ownership " + projectDir + ": intended-refusal") ? "REFUSED" : "WRONG"); fs.rmSync(projectDir, { recursive: true, force: true });
for (let turn = 0; turn < 8; turn += 1) { global.gc(); await new Promise(setImmediate); }
`;
const nodeArgs = "--expose-gc --import=tsx --input-type=module".split(" ");
nodeArgs.push("--eval", child);
function runChild(): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const ioRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "javi-forge-filehandle-"),
		);
		const stdoutPath = path.join(ioRoot, "stdout");
		const stderrPath = path.join(ioRoot, "stderr");
		const stdoutFd = fs.openSync(stdoutPath, "w");
		const stderrFd = fs.openSync(stderrPath, "w");
		const cleanup = () => fs.rmSync(ioRoot, { recursive: true, force: true });
		const childProcess = spawn(process.execPath, nodeArgs, {
			stdio: ["ignore", stdoutFd, stderrFd],
			env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
		});
		childProcess.on("error", (error) => {
			for (const descriptor of [stdoutFd, stderrFd]) fs.closeSync(descriptor);
			cleanup();
			reject(error);
		});
		childProcess.on("close", () => {
			for (const descriptor of [stdoutFd, stderrFd]) fs.closeSync(descriptor);
			const stdout = fs.readFileSync(stdoutPath, "utf8");
			const stderr = fs.readFileSync(stderrPath, "utf8");
			cleanup();
			resolve({ stdout, stderr });
		});
	});
}
describe.skipIf(process.platform === "win32")("real FileHandle cleanup", () => {
	it("reports refusal without leaked-handle diagnostics", async () => {
		const { stdout, stderr } = await runChild();
		expect(stdout).toContain("REFUSED");
		expect(stderr).not.toMatch(/DEP0137|ERR_INVALID_STATE|garbage|descriptor/i);
	});
});
