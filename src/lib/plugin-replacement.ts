import type { Stats } from "node:fs";
import path from "node:path";
import fs from "fs-extra";

const CLEANUP = {
	COMPLETE: "complete",
	MANUAL_REVIEW: "manual-review",
} as const;
type CleanupDisposition = (typeof CLEANUP)[keyof typeof CLEANUP];
export interface PluginReplacementDiagnostics {
	warning?: string;
	cleanup?: CleanupDisposition;
	/** Locations to inspect, not a promise that an uncertain move left each present. */
	recoveryPaths?: string[];
}
interface PublicationResult extends PluginReplacementDiagnostics {
	success: boolean;
	error?: string;
	cleanup: CleanupDisposition;
}
export interface PluginReplacementIO {
	move(from: string, to: string): Promise<void>;
	remove(target: string): Promise<void>;
}
const defaultIO: PluginReplacementIO = {
	move: (from, to) => fs.move(from, to, { overwrite: false }),
	remove: (target) => fs.remove(target),
};
const MUTATION = {
	APPLIED: "applied",
	NOT_APPLIED: "not-applied",
	UNKNOWN: "unknown",
} as const;
interface MoveResult {
	mutation: (typeof MUTATION)[keyof typeof MUTATION];
	error?: string;
}
const same = (a: Stats | null, b: Stats | null): boolean =>
	a !== null && b !== null && a.dev === b.dev && a.ino === b.ino;
async function present(target: string): Promise<Stats | null> {
	try {
		return await fs.lstat(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
async function managed(target: string, name: string): Promise<Stats | null> {
	const identity = await present(target);
	if (!identity) return null;
	if (!identity.isDirectory() || identity.isSymbolicLink())
		throw new Error(`refuse foreign plugin destination: ${target}`);
	const marker = path.join(target, ".installed.json");
	const markerStat = await present(marker);
	if (!markerStat?.isFile() || markerStat.isSymbolicLink())
		throw new Error(`refuse missing or unsafe ownership metadata: ${target}`);
	const meta: unknown = await fs.readJson(marker);
	if (
		!meta ||
		typeof meta !== "object" ||
		!("name" in meta) ||
		meta.name !== name ||
		!("manifest" in meta) ||
		!meta.manifest ||
		typeof meta.manifest !== "object" ||
		!("name" in meta.manifest) ||
		meta.manifest.name !== name
	)
		throw new Error(`refuse mismatched plugin ownership: ${target}`);
	return identity;
}
/**
 * Plugin-only staged publication. No continuously atomic replacement, durable
 * commit, or concurrent-installer guarantee: detected collisions never overwrite.
 * On uncertainty preserve all recovery locations, rather than guessing cleanup.
 */
export async function publishPluginReplacement(
	pluginsDir: string,
	name: string,
	prepare: (stage: string) => Promise<void>,
	io: PluginReplacementIO = defaultIO,
): Promise<PublicationResult> {
	const root = path.resolve(pluginsDir);
	const destination = path.resolve(root, name);
	let workspace: string | undefined;
	let stage = "";
	let backup = "";
	const failure = (error: unknown): PublicationResult => ({
		success: false,
		error: `${String(error)}${workspace ? `; manual recovery: stage=${stage}; backup=${backup}; destination=${destination}` : ""}`,
		cleanup: workspace ? "manual-review" : "complete",
		...(workspace ? { recoveryPaths: [stage, backup] } : {}),
	});
	async function move(
		from: string,
		to: string,
		identity: Stats,
	): Promise<MoveResult> {
		let error: string | undefined;
		try {
			if (!same(await present(from), identity))
				return { mutation: "unknown", error: "source identity changed" };
			if (await present(to))
				return { mutation: "not-applied", error: "destination collision" };
			try {
				await io.move(from, to);
			} catch (cause) {
				error = String(cause);
			}
			const source = await present(from);
			const target = await present(to);
			if (!source && same(target, identity))
				return { mutation: "applied", error };
			if (same(source, identity) && !target)
				return {
					mutation: "not-applied",
					error: error ?? "move did not apply",
				};
		} catch (cause) {
			error = String(cause);
		}
		return { mutation: "unknown", error: error ?? "move identities uncertain" };
	}
	try {
		if (
			!name.trim() ||
			name.includes("/") ||
			name.includes("\\") ||
			path.dirname(destination) !== root ||
			destination === root
		)
			throw new Error("refuse plugin destination outside direct containment");
		await fs.ensureDir(root);
		const rootIdentity = await present(root);
		if (!rootIdentity?.isDirectory() || rootIdentity.isSymbolicLink())
			throw new Error("refuse unsafe plugins root");
		const prior = await managed(destination, name);
		workspace = await fs.mkdtemp(path.join(root, ".replacement-"));
		const workspaceIdentity = await present(workspace);
		stage = path.join(workspace, "stage");
		backup = path.join(workspace, "previous");
		await fs.mkdir(stage);
		await prepare(stage);
		const staged = await managed(stage, name);
		if (!staged) throw new Error("missing complete plugin stage");
		if (!same(await present(root), rootIdentity))
			throw new Error("plugins root changed");
		const current = await managed(destination, name);
		if (prior ? !same(current, prior) : current !== null)
			throw new Error("plugin destination changed");
		if (prior) {
			const saved = await move(destination, backup, prior);
			if (saved.mutation !== "applied")
				return failure(`backup ${saved.mutation}: ${saved.error}`);
			if (saved.error) {
				const restored = await move(backup, destination, prior);
				return failure(
					`backup move rejected after applying; restore ${restored.mutation}: ${restored.error ?? saved.error}`,
				);
			}
		}
		const promoted = await move(stage, destination, staged);
		if (promoted.mutation !== "applied") {
			if (
				promoted.mutation === "not-applied" &&
				prior &&
				!(await present(destination))
			) {
				const restored = await move(backup, destination, prior);
				return failure(
					`promotion failed; restore ${restored.mutation}: ${restored.error ?? promoted.error}`,
				);
			}
			return failure(`promotion ${promoted.mutation}: ${promoted.error}`);
		}
		// Only discard the owned backup after publication and identity readback.
		try {
			if (
				!same(await present(workspace), workspaceIdentity) ||
				(prior && !same(await present(backup), prior)) ||
				(await present(stage))
			)
				throw new Error("cleanup identity changed");
			await io.remove(workspace);
		} catch (error) {
			return {
				success: true,
				cleanup: "manual-review",
				recoveryPaths: [stage, backup],
				warning: `backup cleanup not confirmed; inspect ${workspace}: ${String(error)}`,
			};
		}
		return {
			success: true,
			cleanup: "complete",
			...(promoted.error
				? {
						warning: `publication applied despite rejected move: ${promoted.error}`,
					}
				: {}),
		};
	} catch (error) {
		return failure(error);
	}
}
