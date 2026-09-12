import { createHash } from "node:crypto";

export const OUTPUTS = Object.freeze([
	"app-request.json",
	"minimal.py",
	"test_minimal.py",
	"dispatch.py",
	"run_gateway.py",
	"preparation-result.json",
]);
export const POLICY = Object.freeze({
	version: 1,
	cwd: "/home/javier/.local/share/ere-gateway-runtime/structured-1",
	destination:
		"/home/javier/.local/share/ere-gateway-runtime/structured-1/attempt-3",
	entrypoint: "fixed-local-mock-tests",
	maxBytes: 1048576,
	overallMs: 30000,
	testsMs: 10000,
	lifetimeMs: 600000,
	maxExecutions: 1,
	directoryMode: 0o700,
	fileMode: 0o600,
	network: false,
	credentials: false,
	model: false,
	gateway: false,
	overwrite: false,
	symlinks: false,
});
const IDENTITY_KEYS = [
	"code",
	"dependencies",
	"executable",
	"config",
	"destination",
] as const;
interface Identities {
	code: string;
	dependencies: string;
	executable: string;
	config: string;
	destination: string;
}
interface Request {
	cwd: string;
	destination: string;
	entrypoint: string;
	args: readonly string[];
	env: Readonly<Record<string, string>>;
	stdin: string;
	importPaths: readonly string[];
	identities: Identities;
	outputs: Readonly<Record<string, string>>;
}
interface BoundPreparation {
	readonly binding: string;
	readonly policy: typeof POLICY;
	readonly identities: Readonly<Identities>;
	readonly outputs: Readonly<Record<string, string>>;
}
/** Read-only authority surface; runtime readiness is checked before any call. */
export interface ApprovalPort {
	verify(evidence: string, binding: string, now: number): unknown;
}
const issuedSnapshots = new WeakSet<object>();
function invalid(): never {
	throw new Error("invalid-contract");
}
function exactKeys(value: object, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
/** Pure binding only: supplied identities are claims, not filesystem observations.
 * Strings are immutable snapshots; no path is opened or executed here.
 */
export function bindPreparation(request: Request): BoundPreparation {
	if (
		request.cwd !== POLICY.cwd ||
		request.destination !== POLICY.destination ||
		request.entrypoint !== POLICY.entrypoint ||
		request.args.length ||
		request.stdin !== "" ||
		request.importPaths.length ||
		Object.keys(request.env).length ||
		!exactKeys(request, [
			"cwd",
			"destination",
			"entrypoint",
			"args",
			"env",
			"stdin",
			"importPaths",
			"identities",
			"outputs",
		]) ||
		!exactKeys(request.identities, IDENTITY_KEYS) ||
		!exactKeys(request.outputs, OUTPUTS)
	)
		invalid();
	const identities = Object.freeze(
		Object.fromEntries(
			IDENTITY_KEYS.map((key) => {
				const value = request.identities[key];
				if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
					invalid();
				return [key, value];
			}),
		) as unknown as Identities,
	);
	let bytes = 0;
	const outputs = Object.freeze(
		Object.fromEntries(
			OUTPUTS.map((name) => {
				const value = request.outputs[name];
				if (typeof value !== "string") invalid();
				bytes += Buffer.byteLength(value, "utf8");
				if (bytes > POLICY.maxBytes) invalid();
				return [name, value];
			}),
		),
	);
	const binding = createHash("sha256")
		.update(JSON.stringify({ policy: POLICY, identities, outputs }))
		.digest("hex");
	const snapshot = Object.freeze({
		binding,
		policy: POLICY,
		identities,
		outputs,
	});
	issuedSnapshots.add(snapshot);
	return snapshot;
}
/** Readiness gate: never contacts or consumes an authority while the isolated
 * immutable runtime is unavailable. No execution token or approval is returned.
 */
export async function inspectAuthorization(
	snapshot: BoundPreparation,
	_evidence: string,
	now: number,
	authority?: ApprovalPort,
) {
	if (!authority) return { status: "authorization-unavailable" } as const;
	if (!issuedSnapshots.has(snapshot) || !Number.isSafeInteger(now) || now < 0)
		return { status: "authorization-denied" } as const;
	return { status: "runtime-unavailable" } as const;
}
