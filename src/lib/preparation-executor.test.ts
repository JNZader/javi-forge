import { execFileSync } from "node:child_process";
import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ApprovalAuthority,
	approvalMessage,
} from "./preparation-authorization.js";
import { OUTPUTS } from "./preparation-capability.js";
import {
	captureWorker,
	createExecutorFixture,
} from "./preparation-executor.js";

let root: string;
let executable: string;
const keys = generateKeyPairSync("ed25519");
const digest = (data: Buffer) =>
	createHash("sha256").update(data).digest("hex");
const source = new URL("../../assets/preparation-worker.c", import.meta.url);
function payload() {
	return Object.fromEntries(
		OUTPUTS.map((name) => [
			name,
			name.endsWith(".json") ? '{"fixture":true}' : "# dormant fixture\n",
		]),
	);
}
function proof(binding: string) {
	const now = Date.now();
	const p = {
		version: 1,
		purpose: "six-file-preparation",
		binding,
		nonce: randomBytes(32).toString("hex"),
		issuedAt: now,
		expiresAt: now + 600000,
		maxUses: 1,
	};
	return JSON.stringify({
		payload: p,
		signature: sign(
			null,
			Buffer.from(approvalMessage(p)),
			keys.privateKey,
		).toString("base64"),
	});
}
beforeAll(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "preparation-executor-test-"));
	executable = path.join(root, "worker");
	execFileSync(
		"/usr/bin/cc",
		[
			"-B/usr/bin/",
			"-static",
			"-O2",
			"-Wall",
			"-Wextra",
			"-Werror",
			source.pathname,
			"-o",
			executable,
		],
		{ env: {}, timeout: 10000 },
	);
});
afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});
function runtime(file = executable) {
	return captureWorker({
		executable: file,
		executableDigest: digest(readFileSync(file)),
		source: source.pathname,
		sourceDigest: digest(readFileSync(source)),
		launcher: "/usr/bin/bwrap",
		launcherDigest: digest(readFileSync("/usr/bin/bwrap")),
	});
}
function authority() {
	const state = mkdtempSync(path.join(root, "state-"));
	return { state, auth: new ApprovalAuthority(keys.publicKey, state) };
}
describe("static isolated preparation executor", () => {
	it("runs signed data-only validation and creates six files in a fresh fixture", async () => {
		const fixture = createExecutorFixture(runtime(), payload());
		const { auth } = authority();
		try {
			const result = await fixture.execute(auth, proof(fixture.binding));
			expect(result).toEqual({
				status: "prepared",
				audit: ["ready", "consumed", "validated", "prepared"],
				cleanup: "complete",
			});
			expect(result.audit).toEqual([
				"ready",
				"consumed",
				"validated",
				"prepared",
			]);
			expect(readdirSync(path.join(fixture.root, "attempt-3")).sort()).toEqual(
				[...OUTPUTS].sort(),
			);
		} finally {
			auth.close();
			fixture.dispose();
		}
	});
	it("denies wrong signature without consuming or writing", async () => {
		const fixture = createExecutorFixture(runtime(), payload());
		const { auth, state } = authority();
		try {
			expect((await fixture.execute(auth, "invalid SECRET")).status).toBe(
				"denied",
			);
			expect(readdirSync(state)).toEqual([]);
			expect(readdirSync(fixture.root)).toEqual([]);
		} finally {
			auth.close();
			fixture.dispose();
		}
	});
	it("rejects malformed JSON without executing helper strings", async () => {
		const outputs = payload();
		outputs["app-request.json"] = "{broken}";
		const fixture = createExecutorFixture(runtime(), outputs);
		const { auth, state } = authority();
		try {
			expect((await fixture.execute(auth, proof(fixture.binding))).status).toBe(
				"denied",
			);
			expect(readdirSync(fixture.root)).toEqual([]);
			expect(readdirSync(state)).toHaveLength(1);
		} finally {
			auth.close();
			fixture.dispose();
		}
	});
});

it.each([
	"{}",
	'{"n":-1.2e+3,"a":[true,false,null,{},[]]}',
	'{"s":"escaped\\n\\u1234","unicode":"á😀"}',
])("accepts complete JSON object syntax %s", async (json) => {
	const input = payload();
	input["app-request.json"] = json;
	const f = createExecutorFixture(runtime(), input);
	const { auth } = authority();
	try {
		expect((await f.execute(auth, proof(f.binding))).status).toBe("prepared");
	} finally {
		auth.close();
		f.dispose();
	}
});
it.each([
	"[]",
	'{"a":01}',
	'{"a":1.}',
	'{"a":1e}',
	'{"a":true,}',
	'{"a":"\\x"}',
	'{"a":[1,]}',
	"{} trailing",
	'{"a":tru}',
	'{"a":"unterminated}',
	'{"a":+1}',
	'{"a":NaN}',
])("rejects invalid JSON object %s", async (json) => {
	const input = payload();
	input["app-request.json"] = json;
	const f = createExecutorFixture(runtime(), input);
	const { auth } = authority();
	try {
		expect((await f.execute(auth, proof(f.binding))).status).toBe("denied");
		expect(readdirSync(f.root)).toEqual([]);
	} finally {
		auth.close();
		f.dispose();
	}
});
it("does not consume when destination already exists", async () => {
	const f = createExecutorFixture(runtime(), payload());
	mkdirSync(path.join(f.root, "attempt-3"), { mode: 0o700 });
	const { auth, state } = authority();
	try {
		expect((await f.execute(auth, proof(f.binding))).status).toBe("denied");
		expect(readdirSync(state)).toEqual([]);
		expect(readdirSync(f.root)).toEqual(["attempt-3"]);
	} finally {
		auth.close();
		f.dispose();
	}
});
it("rejects replay after successful preparation", async () => {
	const f = createExecutorFixture(runtime(), payload());
	const { auth, state } = authority();
	const grant = proof(f.binding);
	try {
		expect((await f.execute(auth, grant)).status).toBe("prepared");
		expect((await f.execute(auth, grant)).status).toBe("denied");
		expect(readdirSync(state)).toHaveLength(1);
	} finally {
		auth.close();
		f.dispose();
	}
});
it("rejects a grant for different approved bytes", async () => {
	const first = createExecutorFixture(runtime(), payload());
	const second = createExecutorFixture(runtime(), {
		...payload(),
		"minimal.py": "different dormant bytes",
	});
	const { auth, state } = authority();
	try {
		expect((await second.execute(auth, proof(first.binding))).status).toBe(
			"denied",
		);
		expect(readdirSync(state)).toEqual([]);
	} finally {
		auth.close();
		first.dispose();
		second.dispose();
	}
});
it("runs captured executable bytes after its original path is changed", async () => {
	const { writeFileSync } = await import("node:fs");
	const original = readFileSync(executable);
	const captured = runtime();
	const f = createExecutorFixture(captured, payload());
	const { auth } = authority();
	try {
		writeFileSync(executable, "tampered source path");
		expect((await f.execute(auth, proof(f.binding))).status).toBe("prepared");
	} finally {
		writeFileSync(executable, original);
		auth.close();
		f.dispose();
	}
});
function variant(name: string, macro: string) {
	const file = path.join(root, name);
	execFileSync(
		"/usr/bin/cc",
		[
			"-B/usr/bin/",
			"-static",
			"-O2",
			"-Wall",
			"-Wextra",
			"-Werror",
			`-D${macro}`,
			source.pathname,
			"-o",
			file,
		],
		{ env: {}, timeout: 10000 },
	);
	return runtime(file);
}
it("terminates a stalled validator at the real ten-second test limit", async () => {
	const f = createExecutorFixture(
		variant("stall", "PREPARATION_FIXTURE_STALL"),
		payload(),
	);
	const { auth, state } = authority();
	const start = performance.now();
	try {
		const result = await f.execute(auth, proof(f.binding));
		expect(result.status).toBe("denied");
		expect(result.audit).toContain("consumed");
		expect(performance.now() - start).toBeGreaterThan(9000);
		expect(performance.now() - start).toBeLessThan(13000);
		expect(readdirSync(state)).toHaveLength(1);
		expect(readdirSync(f.root)).toEqual([]);
	} finally {
		auth.close();
		f.dispose();
	}
}, 15000);
it("enforces a shortened fixture overall deadline before consumption", async () => {
	const f = createExecutorFixture(
		variant("not-ready", "PREPARATION_FIXTURE_NOT_READY"),
		payload(),
		{ overallMs: 250, testsMs: 100 },
	);
	const { auth, state } = authority();
	try {
		const result = await f.execute(auth, proof(f.binding));
		expect(result.status).toBe("denied");
		expect(result.audit).not.toContain("consumed");
		expect(readdirSync(state)).toEqual([]);
		expect(readdirSync(f.root)).toEqual([]);
	} finally {
		auth.close();
		f.dispose();
	}
});
it("cleans acknowledged partial files and never reopens a consumed grant", async () => {
	const f = createExecutorFixture(
		variant("partial", "PREPARATION_FIXTURE_PARTIAL"),
		payload(),
	);
	const { auth, state } = authority();
	const grant = proof(f.binding);
	try {
		const result = await f.execute(auth, grant);
		expect(result.status).toBe("denied");
		expect(result.cleanup).toBe("complete");
		expect(readdirSync(f.root)).toEqual([]);
		expect(readdirSync(state)).toHaveLength(1);
		expect((await f.execute(auth, grant)).status).toBe("denied");
	} finally {
		auth.close();
		f.dispose();
	}
});
