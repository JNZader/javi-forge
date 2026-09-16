import { type KeyObject, verify as verifySignature } from "node:crypto";
import {
	closeSync,
	constants as FS,
	fchmodSync,
	fsyncSync,
	lstatSync,
	openSync,
	writeSync,
} from "node:fs";
import { POLICY } from "./preparation-capability.js";
import { ProtectedDirectory } from "./preparation-stager.js";

export interface ApprovalPayload {
	version: number;
	purpose: string;
	binding: string;
	nonce: string;
	issuedAt: number;
	expiresAt: number;
	maxUses: number;
}

export interface ApprovalPayloadInput {
	binding: string;
	nonce: string;
	issuedAt: number;
	expiresAt: number;
}
export interface VerifiedApproval {
	readonly payload: Readonly<ApprovalPayload>;
}
const KEYS = [
	"version",
	"purpose",
	"binding",
	"nonce",
	"issuedAt",
	"expiresAt",
	"maxUses",
];
const HEX = /^[a-f0-9]{64}$/;
function deny(): never {
	throw new Error("approval-denied");
}
export function createApprovalPayload(
	input: ApprovalPayloadInput,
	now: number,
): ApprovalPayload {
	if (
		!HEX.test(input.binding) ||
		!HEX.test(input.nonce) ||
		!Number.isSafeInteger(now) ||
		!Number.isSafeInteger(input.issuedAt) ||
		!Number.isSafeInteger(input.expiresAt) ||
		input.issuedAt < 0 ||
		input.issuedAt > now ||
		input.expiresAt <= now ||
		input.expiresAt - input.issuedAt > POLICY.lifetimeMs
	) {
		deny();
	}
	return Object.freeze({
		version: 1,
		purpose: "six-file-preparation",
		binding: input.binding,
		nonce: input.nonce,
		issuedAt: input.issuedAt,
		expiresAt: input.expiresAt,
		maxUses: 1,
	});
}
/** Domain-separated canonical message. No signing function or private key exists here. */
export function approvalMessage(p: ApprovalPayload) {
	return `javi-forge/six-file-preparation/v1\n${JSON.stringify([p.version, p.purpose, p.binding, p.nonce, p.issuedAt, p.expiresAt, p.maxUses])}`;
}
function validTime(p: ApprovalPayload, now: number) {
	return (
		Number.isSafeInteger(now) &&
		Number.isSafeInteger(p.issuedAt) &&
		Number.isSafeInteger(p.expiresAt) &&
		p.issuedAt >= 0 &&
		p.issuedAt <= now &&
		p.expiresAt > now &&
		p.expiresAt - p.issuedAt <= POLICY.lifetimeMs
	);
}

/** Explicit operator-configured Ed25519 public key plus durable terminal ledger.
 * verify is read-only. consume is an INTERNAL future-executor primitive; the public
 * preparation route never calls it while runtime readiness is unavailable.
 * Caller must close the instance. Ledger is a trusted local filesystem, not NFS;
 * root/effective UID and the clock are trusted. Never delete terminal claim files.
 */
export class ApprovalAuthority {
	readonly #key: KeyObject;
	readonly #directory: ProtectedDirectory;
	readonly #verified = new WeakSet<object>();
	constructor(publicKey: KeyObject | undefined, stateDirectory: string) {
		if (
			!publicKey ||
			publicKey.type !== "public" ||
			publicKey.asymmetricKeyType !== "ed25519"
		)
			throw new Error("approval-unavailable");
		this.#key = publicKey;
		this.#directory = new ProtectedDirectory(stateDirectory);
	}
	verify(encoded: string, binding: string, now: number): VerifiedApproval {
		try {
			if (
				typeof encoded !== "string" ||
				Buffer.byteLength(encoded) > 4096 ||
				!HEX.test(binding)
			)
				deny();
			const envelope = JSON.parse(encoded);
			if (
				!envelope ||
				typeof envelope !== "object" ||
				Object.keys(envelope).sort().join() !== "payload,signature"
			)
				deny();
			const p = envelope.payload as ApprovalPayload;
			if (
				!p ||
				typeof p !== "object" ||
				Object.keys(p).sort().join() !== [...KEYS].sort().join() ||
				p.version !== 1 ||
				p.purpose !== "six-file-preparation" ||
				p.maxUses !== 1 ||
				typeof p.binding !== "string" ||
				p.binding !== binding ||
				typeof p.nonce !== "string" ||
				!HEX.test(p.nonce) ||
				!validTime(p, now) ||
				typeof envelope.signature !== "string" ||
				!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
			)
				deny();
			const signature = Buffer.from(envelope.signature, "base64");
			if (
				signature.length !== 64 ||
				!verifySignature(
					null,
					Buffer.from(approvalMessage(p)),
					this.#key,
					signature,
				)
			)
				deny();
			this.#directory.assertCurrent();
			try {
				lstatSync(this.#directory.child(`${p.nonce}.terminal`));
				deny();
			} catch (error) {
				if (
					!(
						error &&
						typeof error === "object" &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					deny();
			}
			const approval = Object.freeze({ payload: Object.freeze({ ...p }) });
			this.#verified.add(approval);
			return approval;
		} catch {
			deny();
		}
	}
	#terminal(approval: VerifiedApproval, now: number, event: string) {
		let file: number | undefined;
		try {
			if (!this.#verified.has(approval) || !validTime(approval.payload, now))
				deny();
			this.#directory.assertCurrent();
			// consume and revoke compete for the SAME exclusive inode: first wins across
			// processes. Failure after creation burns the nonce; no rollback or lease expiry.
			file = openSync(
				this.#directory.child(`${approval.payload.nonce}.terminal`),
				FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW,
				0o600,
			);
			fchmodSync(file, 0o600);
			const data = Buffer.from(`${event}\n`);
			if (writeSync(file, data) !== data.length) deny();
			fsyncSync(file);
			fsyncSync(this.#directory.fd);
			this.#directory.assertCurrent();
		} catch {
			deny();
		} finally {
			if (file !== undefined) closeSync(file);
		}
	}
	consume(approval: VerifiedApproval, now: number) {
		this.#terminal(approval, now, "consumed");
	}
	revoke(approval: VerifiedApproval, now: number) {
		this.#terminal(approval, now, "revoked");
	}
	close() {
		this.#directory.close();
	}
}
