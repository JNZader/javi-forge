/**
 * Host-independent fake `HelperTransport` for the win32 `PlatformSecureFs`
 * adapter tests. It returns canned framed responses per op so every adapter
 * branch — request build, response parse, refusal mapping, opaque identity,
 * notFound discrimination, directory-attribute assertion, and
 * transport-error → fail-closed — is exercisable on Linux with NO real Windows
 * host and NO PowerShell. The `.ps1` (Phase 3) computes Predicate A/B verdicts;
 * this fake stands in for those already-decided verdicts.
 */

import type {
	HelperOp,
	HelperRequest,
	HelperResponse,
	HelperTransport,
} from "../secure-fs-windows.js";

/** A responder decides the framed response for a single request of an op. */
export type FakeResponder = (req: HelperRequest) => HelperResponse;

export interface FakeHelperTransport extends HelperTransport {
	/** Every request the adapter sent, in order (for request-build assertions). */
	readonly requests: HelperRequest[];
	/** True once close() ran. */
	readonly closed: boolean;
	/** Register the canned responder for an op (last registration wins). */
	on(op: HelperOp, responder: FakeResponder): void;
	/** Make the NEXT request reject with a transport error (session death). */
	failNext(error: Error): void;
}

/** Build a programmable fake transport with no default behavior. */
export function makeFakeHelperTransport(): FakeHelperTransport {
	const requests: HelperRequest[] = [];
	const responders = new Map<HelperOp, FakeResponder>();
	let closed = false;
	let pendingError: Error | null = null;

	const fake: FakeHelperTransport = {
		get requests() {
			return requests;
		},
		get closed() {
			return closed;
		},
		on(op, responder) {
			responders.set(op, responder);
		},
		failNext(error) {
			pendingError = error;
		},
		async request(req) {
			requests.push(req);
			if (pendingError) {
				const err = pendingError;
				pendingError = null;
				throw err;
			}
			const responder = responders.get(req.op);
			if (!responder) {
				throw new Error(`fake transport: no responder for op ${req.op}`);
			}
			return responder(req);
		},
		async close() {
			closed = true;
		},
	};
	return fake;
}

// --- canned response builders (the .ps1 verdicts, pre-decided) --------------

/** A void-success verdict (proveOwner/proveDacl/proveContainer/write/etc. ok). */
export const okVoid = (): HelperResponse => ({ ok: true });

/** A win32 DACL refusal (Predicate A/B verdict from the .ps1). */
export const daclRefuse = (detail: string): HelperResponse => ({
	ok: false,
	refusal: "unsafe-windows-dacl",
	detail,
});

/** Named Predicate-A refuse postures (ground-truth + design fixtures). */
export const foreignWrite = (): HelperResponse =>
	daclRefuse("foreign trustee S-1-5-11 path-endangering");
export const deleteChild = (): HelperResponse =>
	daclRefuse("foreign trustee S-1-1-0 path-endangering");
export const genericWrite = (): HelperResponse =>
	daclRefuse("foreign trustee S-1-1-0 path-endangering");
export const genericAll = (): HelperResponse =>
	daclRefuse("foreign trustee S-1-1-0 path-endangering");
export const nullDacl = (): HelperResponse => daclRefuse("null DACL");
export const foreignOwner = (): HelperResponse =>
	daclRefuse("foreign owner S-1-5-21-1-2-3-1001");
/** proveContainer-only add-child refusal (CREATE_PARENT_DIR). */
export const addChild = (): HelperResponse =>
	daclRefuse("foreign trustee S-1-1-0 add-child");

/** A successful openDir/createDir value carrying handle, identity, attributes. */
export const openOk = (
	handleId: string,
	opaque: string,
	attributes: number,
): HelperResponse => ({
	ok: true,
	value: { handleId, opaque, attributes },
});

/** A genuine not-found openDir failure (ENOENT / ERROR_FILE/PATH_NOT_FOUND). */
export const openNotFound = (status: number): HelperResponse => ({
	ok: false,
	refusal: "unsafe-parent-chain",
	detail: "not found",
	status,
});

/** A present-but-unopenable openDir failure (reparse/EACCES/transient). */
export const openUnopenable = (detail: string, status = 5): HelperResponse => ({
	ok: false,
	refusal: "unsafe-parent-chain",
	detail,
	status,
});

/** A successful capture value; bytes are base64 in the JSON body. */
export const captureOk = (bytes: Buffer, opaque: string): HelperResponse => ({
	ok: true,
	value: { bytes: bytes.toString("base64"), opaque },
});
