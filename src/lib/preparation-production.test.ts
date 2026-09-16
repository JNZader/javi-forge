import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
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
import { approvalMessage } from "./preparation-authorization.js";
import { OUTPUTS } from "./preparation-capability.js";
import { createExecutorFixture } from "./preparation-executor.js";
import {
	createPreparationProductionConfigTemplate,
	inspectPreparationApprovalCheck,
	inspectPreparationApprovalRevocation,
	inspectPreparationProductionBinding,
	inspectPreparationProductionPreflight,
	PREPARATION_PREFLIGHT_REASON,
	PREPARATION_PREFLIGHT_STATUS,
	type PreparationProductionPolicy,
	parsePreparationProductionConfig,
} from "./preparation-production.js";

let root: string;
let worker: string;
let unsupportedWorker: string;
let control: string;
let state: string;

const source = new URL("../../assets/preparation-worker.c", import.meta.url);
const keys = generateKeyPairSync("ed25519");
const digest = (data: Buffer) =>
	createHash("sha256").update(data).digest("hex");

function writeUnsupportedWorkerFixture(target: string) {
	const bytes = readFileSync(worker);
	const programHeaderOffset = Number(bytes.readBigUInt64LE(32));
	bytes.writeUInt32LE(3, programHeaderOffset);
	writeFileSync(target, bytes, { mode: 0o700 });
}

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

function approvalEvidence(preparationBinding: string, nonce = "a".repeat(64)) {
	const payload = {
		version: 1,
		purpose: "six-file-preparation",
		binding: preparationBinding,
		nonce,
		issuedAt: 1000,
		expiresAt: 601000,
		maxUses: 1,
	};
	return JSON.stringify({
		payload,
		signature: sign(
			null,
			Buffer.from(approvalMessage(payload)),
			keys.privateKey,
		).toString("base64"),
	});
}

beforeAll(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "preparation-production-test-"));
	worker = path.join(root, "worker");
	unsupportedWorker = path.join(root, "unsupported-worker");
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
	writeUnsupportedWorkerFixture(unsupportedWorker);
});

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

describe("production preparation preflight contract", () => {
	it("rejects malformed production config without runtime measurement", () => {
		expect(
			inspectPreparationProductionPreflight(
				{ ...config(), workerExecutableDigest: "not-a-digest" },
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG,
		});
	});

	it("parses an exact production config without retaining mutability", () => {
		const parsed = parsePreparationProductionConfig(config());
		expect(parsed.cwd).toBe(control);
		expect(Object.isFrozen(parsed)).toBe(true);
	});

	it("creates an exact public-key-only operator config template", () => {
		const template = createPreparationProductionConfigTemplate({
			policy: policy(),
			stateDirectory: state,
		});

		expect(Object.isFrozen(template)).toBe(true);
		expect(() => parsePreparationProductionConfig(template)).not.toThrow();
		expect(template.cwd).toBe(control);
		expect(template.destination).toBe(path.join(control, "attempt-3"));
		expect(template.workerExecutableDigest).toBe("0".repeat(64));
		expect(template.publicKeyPem).toContain("PUBLIC KEY");
		expect(template.publicKeyPem).not.toContain("PRIVATE KEY");
		expect(
			inspectPreparationProductionPreflight(template, policy()),
		).toMatchObject({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.PUBLIC_KEY_UNAVAILABLE,
		});
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

	it("computes a bounded production approval binding without executing", () => {
		const result = inspectPreparationProductionBinding(
			config(),
			outputs(),
			policy(),
		);

		expect(result.status).toBe(PREPARATION_PREFLIGHT_STATUS.READY);
		expect(result.binding).toMatch(/^[a-f0-9]{64}$/);
		expect(result.measurements).toEqual({
			executableDigest: digest(readFileSync(worker)),
			codeDigest: digest(readFileSync(source)),
			dependenciesDigest: digest(Buffer.from("[]")),
			launcherDigest: digest(readFileSync("/usr/bin/bwrap")),
		});
		expect(readdirSync(control)).toEqual([]);
		expect(readdirSync(state)).toEqual([]);
		expect(() =>
			createExecutorFixture(
				result.measurements as Parameters<typeof createExecutorFixture>[0],
				outputs(),
			),
		).toThrow("runtime-unavailable");
	});

	it("rejects malformed production outputs before binding", () => {
		expect(
			inspectPreparationProductionBinding(
				config(),
				{ ...outputs(), "extra.py": "surprise" },
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG,
		});
	});

	it("verifies approval evidence without consuming the nonce", () => {
		const binding = inspectPreparationProductionBinding(
			config(),
			outputs(),
			policy(),
		).binding;

		expect(
			inspectPreparationApprovalCheck(
				config(),
				binding ?? "",
				approvalEvidence(binding ?? ""),
				1000,
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			approval: {
				nonce: "a".repeat(64),
				issuedAt: 1000,
				expiresAt: 601000,
			},
		});
		expect(readdirSync(state)).toEqual([]);
	});

	it("rejects invalid approval evidence without terminal ledger writes", () => {
		const binding = inspectPreparationProductionBinding(
			config(),
			outputs(),
			policy(),
		).binding;

		expect(
			inspectPreparationApprovalCheck(
				config(),
				binding ?? "",
				"not approval evidence",
				1000,
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.APPROVAL_DENIED,
		});
		expect(readdirSync(state)).toEqual([]);
	});

	it("revokes approval evidence through the shared terminal ledger", () => {
		const binding = inspectPreparationProductionBinding(
			config(),
			outputs(),
			policy(),
		).binding;
		const nonce = "c".repeat(64);
		const terminal = path.join(state, `${nonce}.terminal`);
		const evidence = approvalEvidence(binding ?? "", nonce);

		expect(
			inspectPreparationApprovalRevocation(
				config(),
				binding ?? "",
				evidence,
				1000,
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			approval: {
				nonce,
				issuedAt: 1000,
				expiresAt: 601000,
			},
			terminal: "revoked",
		});
		expect(readFileSync(terminal, "utf8")).toBe("revoked\n");
		expect(
			inspectPreparationApprovalCheck(
				config(),
				binding ?? "",
				evidence,
				1000,
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: PREPARATION_PREFLIGHT_REASON.APPROVAL_DENIED,
		});
		rmSync(terminal, { force: true });
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
			reason: PREPARATION_PREFLIGHT_REASON.WORKER_EXECUTABLE_UNAVAILABLE,
		});
	});

	it("reports source measurement failures separately from worker executable failures", () => {
		expect(
			inspectPreparationProductionPreflight(
				config({ workerSourceDigest: "b".repeat(64) }),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.UNAVAILABLE,
			reason: PREPARATION_PREFLIGHT_REASON.WORKER_SOURCE_UNAVAILABLE,
		});
	});

	it("reports unsupported worker executables after digest verification", () => {
		expect(
			inspectPreparationProductionPreflight(
				config({
					workerExecutable: unsupportedWorker,
					workerExecutableDigest: digest(readFileSync(unsupportedWorker)),
				}),
				policy(),
			),
		).toEqual({
			status: PREPARATION_PREFLIGHT_STATUS.UNAVAILABLE,
			reason: PREPARATION_PREFLIGHT_REASON.WORKER_EXECUTABLE_UNSUPPORTED,
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
			reason: PREPARATION_PREFLIGHT_REASON.LAUNCHER_UNAVAILABLE,
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
