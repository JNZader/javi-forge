import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUTPUTS } from "./preparation-capability.js";
import { createExecutorFixture } from "./preparation-executor.js";
import {
	inspectPreparationProductionPreflight,
	PREPARATION_PREFLIGHT_REASON,
	PREPARATION_PREFLIGHT_STATUS,
	type PreparationProductionPolicy,
	parsePreparationProductionConfig,
} from "./preparation-production.js";

let root: string;
let worker: string;
let control: string;
let state: string;

const source = new URL("../../assets/preparation-worker.c", import.meta.url);
const keys = generateKeyPairSync("ed25519");
const digest = (data: Buffer) =>
	createHash("sha256").update(data).digest("hex");

function publicKeyPem() {
	return keys.publicKey.export({ format: "pem", type: "spki" }).toString();
}

function policy(): PreparationProductionPolicy {
	return {
		cwd: control,
		destination: path.join(control, "attempt-3"),
		overallMs: 30000,
		testsMs: 10000,
	};
}

function config(overrides: Record<string, unknown> = {}) {
	return {
		workerExecutable: worker,
		workerExecutableDigest: digest(readFileSync(worker)),
		workerSource: source.pathname,
		workerSourceDigest: digest(readFileSync(source)),
		launcher: "/usr/bin/bwrap",
		launcherDigest: digest(readFileSync("/usr/bin/bwrap")),
		publicKeyPem: publicKeyPem(),
		stateDirectory: state,
		cwd: control,
		destination: path.join(control, "attempt-3"),
		...overrides,
	};
}

function outputs() {
	return Object.fromEntries(OUTPUTS.map((name) => [name, "inert"]));
}

beforeAll(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "preparation-production-test-"));
	worker = path.join(root, "worker");
	control = path.join(root, "control");
	state = path.join(root, "state");
	mkdirSync(control, { mode: 0o700 });
	mkdirSync(state, { mode: 0o700 });
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
			worker,
		],
		{ env: {}, timeout: 10000 },
	);
});

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

describe("production preparation preflight contract", () => {
	it("parses an exact production config without retaining mutability", () => {
		const parsed = parsePreparationProductionConfig(config());
		expect(parsed.cwd).toBe(control);
		expect(Object.isFrozen(parsed)).toBe(true);
	});

	it("reports ready with bounded measurements for a valid config", () => {
		const result = inspectPreparationProductionPreflight(config(), policy());
		expect(result).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			measurements: {
				executableDigest: digest(readFileSync(worker)),
				codeDigest: digest(readFileSync(source)),
				dependenciesDigest: digest(Buffer.from("[]")),
				launcherDigest: digest(readFileSync("/usr/bin/bwrap")),
			},
		});
		expect(readdirSync(control)).toEqual([]);
		expect(readdirSync(state)).toEqual([]);
	});

	it("does not leak a captured worker execution token", () => {
		const result = inspectPreparationProductionPreflight(config(), policy());
		expect(result.status).toBe(PREPARATION_PREFLIGHT_STATUS.READY);
		expect(() =>
			createExecutorFixture(
				result.measurements as Parameters<typeof createExecutorFixture>[0],
				outputs(),
			),
		).toThrow("runtime-unavailable");
	});

	it("rejects policy cwd and destination mismatches", () => {
		expect(
			inspectPreparationProductionPreflight(
				config({ cwd: `${control}-other` }),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH,
		});
		expect(
			inspectPreparationProductionPreflight(
				config({ destination: path.join(control, "other") }),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH,
		});
	});

	it("reports runtime unavailable for changed worker measurements", () => {
		expect(
			inspectPreparationProductionPreflight(
				config({ workerExecutableDigest: "b".repeat(64) }),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.UNAVAILABLE,
			reason: PREPARATION_PREFLIGHT_REASON.RUNTIME_UNAVAILABLE,
		});
	});

	it("reports runtime unavailable when the pinned launcher changed", () => {
		expect(
			inspectPreparationProductionPreflight(
				config({ launcherDigest: "c".repeat(64) }),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.UNAVAILABLE,
			reason: PREPARATION_PREFLIGHT_REASON.RUNTIME_UNAVAILABLE,
		});
	});

	it("rejects unsafe state directories", () => {
		chmodSync(state, 0o777);
		try {
			expect(inspectPreparationProductionPreflight(config(), policy())).toEqual(
				{
					status: PREPARATION_PREFLIGHT_STATUS.DENIED,
					reason: PREPARATION_PREFLIGHT_REASON.STATE_DIRECTORY_UNSAFE,
				},
			);
		} finally {
			chmodSync(state, 0o700);
		}
	});

	it("rejects invalid public keys before runtime measurement", () => {
		expect(
			inspectPreparationProductionPreflight(
				config({ publicKeyPem: "not a public key" }),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.PUBLIC_KEY_UNAVAILABLE,
		});
	});

	it("reports an occupied destination without executing or consuming authority", () => {
		mkdirSync(path.join(control, "attempt-3"), { mode: 0o700 });
		try {
			expect(inspectPreparationProductionPreflight(config(), policy())).toEqual(
				{
					status: PREPARATION_PREFLIGHT_STATUS.UNAVAILABLE,
					reason: PREPARATION_PREFLIGHT_REASON.DESTINATION_PRESENT,
				},
			);
		} finally {
			rmSync(path.join(control, "attempt-3"), { recursive: true, force: true });
		}
		expect(readFileSync(worker).byteLength).toBeGreaterThan(0);
		expect(readdirSync(state)).toEqual([]);
	});

	it("rejects destination symlink state", () => {
		writeFileSync(path.join(root, "target"), "");
		symlinkSync(path.join(root, "target"), path.join(control, "attempt-3"));
		try {
			expect(inspectPreparationProductionPreflight(config(), policy())).toEqual(
				{
					status: PREPARATION_PREFLIGHT_STATUS.DENIED,
					reason: PREPARATION_PREFLIGHT_REASON.DESTINATION_UNSAFE,
				},
			);
		} finally {
			rmSync(path.join(control, "attempt-3"), { force: true });
		}
	});
});
