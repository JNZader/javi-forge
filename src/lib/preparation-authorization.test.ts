import { generateKeyPairSync, sign } from "node:crypto";
import {
	chmodSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ApprovalAuthority,
	approvalMessage,
	createApprovalPayload,
} from "./preparation-authorization.js";

const keys = generateKeyPairSync("ed25519");
const roots: string[] = [];
const binding = "b".repeat(64);
function setup() {
	const root = mkdtempSync(
		path.join(os.tmpdir(), "preparation-authority-test-"),
	);
	roots.push(root);
	const authority = new ApprovalAuthority(keys.publicKey, root);
	authorityInstances.push(authority);
	return { root, authority };
}
function payload() {
	return {
		version: 1,
		purpose: "six-file-preparation",
		binding,
		nonce: "a".repeat(64),
		issuedAt: 1000,
		expiresAt: 601000,
		maxUses: 1,
	};
}
function evidence(p = payload(), key = keys.privateKey) {
	return JSON.stringify({
		payload: p,
		signature: sign(null, Buffer.from(approvalMessage(p)), key).toString(
			"base64",
		),
	});
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
describe("external signed preparation approval", () => {
	it("builds the signer payload and exact domain-separated message", () => {
		const p = createApprovalPayload(
			{
				binding,
				nonce: "a".repeat(64),
				issuedAt: 1000,
				expiresAt: 601000,
			},
			1000,
		);

		expect(p).toEqual(payload());
		expect(approvalMessage(p)).toBe(
			`javi-forge/six-file-preparation/v1\n${JSON.stringify([1, "six-file-preparation", binding, "a".repeat(64), 1000, 601000, 1])}`,
		);
	});

	it("rejects invalid signer payload inputs", () => {
		expect(() =>
			createApprovalPayload(
				{
					binding: "not-a-binding",
					nonce: "a".repeat(64),
					issuedAt: 1000,
					expiresAt: 601000,
				},
				1000,
			),
		).toThrow("approval-denied");
	});

	it("verifies without consuming and consumes only once", () => {
		const { authority, root } = setup();
		const approval = authority.verify(evidence(), binding, 1000);
		expect(readdirSync(root)).toEqual([]);
		authority.consume(approval, 1000);
		expect(() => authority.consume(approval, 1000)).toThrow("approval-denied");
		expect(
			readFileSync(path.join(root, `${payload().nonce}.terminal`), "utf8"),
		).toBe("consumed\n");
	});
	it.each([
		"signature",
		"binding",
		"expired",
		"future",
		"nonce",
		"maxUses",
		"purpose",
	])("rejects %s before consumption", (kind) => {
		const { authority, root } = setup();
		const p = payload();
		if (kind === "binding") p.binding = "c".repeat(64);
		if (kind === "expired") p.expiresAt = 1000;
		if (kind === "future") p.issuedAt = 1001;
		if (kind === "nonce") p.nonce = "../escape";
		if (kind === "maxUses") p.maxUses = 2;
		if (kind === "purpose") p.purpose = "arbitrary";
		const encoded =
			kind === "signature"
				? evidence(p, generateKeyPairSync("ed25519").privateKey)
				: evidence(p);
		expect(() => authority.verify(encoded, binding, 1000)).toThrow(
			"approval-denied",
		);
		expect(readdirSync(root)).toEqual([]);
	});
	it("durably revokes before consume", () => {
		const { authority, root } = setup();
		const approval = authority.verify(evidence(), binding, 1000);
		authority.revoke(approval, 1000);
		expect(() => restart(root).verify(evidence(), binding, 1000)).toThrow(
			"approval-denied",
		);
		expect(() => authority.consume(approval, 1000)).toThrow("approval-denied");
	});
	it("rechecks expiry before consume", () => {
		const { authority, root } = setup();
		const approval = authority.verify(evidence(), binding, 1000);
		expect(() => authority.consume(approval, 601000)).toThrow(
			"approval-denied",
		);
		expect(readdirSync(root)).toEqual([]);
	});
	it("rejects unsafe state modes and symlinks", () => {
		const { root } = setup();
		chmodSync(root, 0o777);
		expect(() => new ApprovalAuthority(keys.publicKey, root)).toThrow(
			"unsafe-directory",
		);
		chmodSync(root, 0o700);
		const alias = `${root}-link`;
		roots.push(alias);
		symlinkSync(root, alias);
		expect(() => new ApprovalAuthority(keys.publicKey, alias)).toThrow(
			"unsafe-directory",
		);
	});
	it("sanitizes malformed evidence and rejects private keys", () => {
		const { authority, root } = setup();
		expect(() => authority.verify("SECRET", binding, 1000)).toThrow(
			"approval-denied",
		);
		expect(() => new ApprovalAuthority(keys.privateKey, root)).toThrow(
			"approval-unavailable",
		);
	});
});

it("serializes competing processes on one durable nonce", async () => {
	const { fork } = await import("node:child_process");
	const { root } = setup();
	const children = [1, 2].map(() =>
		fork(
			new URL(
				"./__fixtures__/preparation-authority-child.mjs",
				import.meta.url,
			),
			[],
			{
				execArgv: [
					"--import",
					new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url)
						.pathname,
				],
				env: {},
				stdio: ["ignore", "ignore", "pipe", "ipc"],
			},
		),
	);
	try {
		const next = (child: (typeof children)[number]) =>
			new Promise<string>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error("fixture-timeout")),
					5000,
				);
				child.once("message", (value) => {
					clearTimeout(timer);
					resolve((value as { status: string }).status);
				});
				child.once("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
			});
		const ready = children.map(next);
		for (const child of children)
			child.send({
				kind: "configure",
				root,
				publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
				evidence: evidence(),
				binding,
			});
		expect(await Promise.all(ready)).toEqual(["ready", "ready"]);
		const outcomes = children.map(next);
		for (const child of children) child.send({ kind: "consume" });
		expect((await Promise.all(outcomes)).sort()).toEqual([
			"consumed",
			"denied",
		]);
		expect(
			readFileSync(path.join(root, `${payload().nonce}.terminal`), "utf8"),
		).toBe("consumed\n");
	} finally {
		await Promise.all(
			children.map(
				(child) =>
					new Promise<void>((resolve) => {
						if (child.exitCode !== null || child.signalCode !== null)
							return resolve();
						child.once("exit", () => resolve());
						child.kill("SIGKILL");
					}),
			),
		);
	}
}, 15000);

const authorityInstances: ApprovalAuthority[] = [];
function restart(root: string) {
	const authority = new ApprovalAuthority(keys.publicKey, root);
	authorityInstances.push(authority);
	return authority;
}
afterEach(() => {
	for (const authority of authorityInstances.splice(0)) authority.close();
});
it("rejects replay from a newly opened authority", () => {
	const { authority, root } = setup();
	authority.consume(authority.verify(evidence(), binding, 1000), 1000);
	expect(() => restart(root).verify(evidence(), binding, 1000)).toThrow(
		"approval-denied",
	);
});
it.each([
	NaN,
	Infinity,
	-1,
	601000,
])("refuses clock %s before touching the terminal ledger", (now) => {
	const { authority, root } = setup();
	expect(() => authority.verify(evidence(), binding, now)).toThrow(
		"approval-denied",
	);
	expect(readdirSync(root)).toEqual([]);
});
it("rejects altered signed bytes and oversized evidence", () => {
	const { authority, root } = setup();
	const encoded = evidence().replace('"issuedAt":1000', '"issuedAt":999');
	expect(() => authority.verify(encoded, binding, 1000)).toThrow(
		"approval-denied",
	);
	expect(() => authority.verify("S".repeat(4097), binding, 1000)).toThrow(
		"approval-denied",
	);
	expect(readdirSync(root)).toEqual([]);
});
