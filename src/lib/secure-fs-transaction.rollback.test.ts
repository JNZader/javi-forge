import { describe, expect, it } from "vitest";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	runTransaction,
	type TransactionComponent,
} from "./secure-fs-transaction.js";

const PROJECT = "/proj";
const CLAUDE = "/proj/.claude";
const HOOKS = "/proj/.claude/hooks";
const ASSET = "/proj/.claude/hooks/asset.mjs";
const SETTINGS = "/proj/.claude/settings.json";

const clock = () => new Date("2026-08-16T19:00:00.123Z");
const makeNonce = () => {
	let n = 0;
	return () => (++n).toString(16).padStart(8, "0");
};

const asset = (
	over: Partial<TransactionComponent> = {},
): TransactionComponent => ({
	path: ASSET,
	desired: Buffer.from("NEW-ASSET"),
	capturePrior: false,
	forceBackup: false,
	wasAbsent: true,
	...over,
});
const settings = (
	over: Partial<TransactionComponent> = {},
): TransactionComponent => ({
	path: SETTINGS,
	desired: Buffer.from("NEW-SETTINGS"),
	capturePrior: false,
	forceBackup: false,
	wasAbsent: true,
	...over,
});

const run = (
	fake: ReturnType<typeof makeFakeSecureFs>,
	a: TransactionComponent,
	s: TransactionComponent,
) =>
	runTransaction({
		secureFs: fake,
		clock,
		nonce: makeNonce(),
		projectDir: PROJECT,
		asset: a,
		settings: s,
	});

const seededUpgradeFake = () => {
	const fake = makeFakeSecureFs();
	for (const d of ["/", PROJECT, CLAUDE, HOOKS]) fake.seedDir(d);
	fake.seedFile(ASSET, Buffer.from("OLD-ASSET"), 0o640);
	fake.seedFile(SETTINGS, Buffer.from("OLD-SETTINGS"), 0o644);
	return fake;
};

describe("runTransaction — capture, backup, and mode preservation", () => {
	it("routine upgrade preserves the exact prior mode and leaves backups empty", async () => {
		const fake = seededUpgradeFake();
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(true);
		expect(outcome.backups).toEqual([]);
		expect(fake.hasBackup(HOOKS)).toBe(false);
		expect(fake.hasBackup(CLAUDE)).toBe(false);
		// Prior mode carried onto the replacement.
		expect(fake.files.get(ASSET)?.mode).toBe(0o640);
		expect(fake.files.get(SETTINGS)?.mode).toBe(0o644);
	});

	it("forced edited-managed replacement writes exactly one persistent backup with the ISO-ms name", async () => {
		const fake = seededUpgradeFake();
		const outcome = await run(
			fake,
			asset({ capturePrior: false, wasAbsent: false }),
			settings({ capturePrior: true, forceBackup: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(true);
		expect(outcome.backups).toHaveLength(1);
		expect(outcome.backups[0]).toMatch(
			/\/proj\/\.claude\/settings\.json\.javi-forge\.bak\.20260816T190000123Z\.[0-9a-f]{8}$/,
		);
		const backupPath = outcome.backups[0] as string;
		expect(fake.fileText(backupPath)).toBe("OLD-SETTINGS");
		expect(fake.files.get(backupPath)?.mode).toBe(0o644);
	});
});

describe("runTransaction — rename fault refuses the whole operation", () => {
	it("fails and rolls back with no committed target when the first rename fails", async () => {
		const fake = makeFakeSecureFs();
		fake.seedDir("/");
		fake.seedDir(PROJECT);
		fake.faults.renameRefuse = (to) => to === "asset.mjs";
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.files.has(SETTINGS)).toBe(false);
		expect(outcome.errors.join(" ")).toMatch(/rename asset\.mjs/);
	});
});

describe("runTransaction — guarded reverse-order rollback", () => {
	it("restores the first target's prior bytes when the second commit fails", async () => {
		const fake = seededUpgradeFake();
		fake.faults.renameRefuse = (to) => to === "settings.json";
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		// The asset committed, then the settings rename failed → asset restored.
		expect(fake.fileText(ASSET)).toBe("OLD-ASSET");
		expect(fake.files.get(ASSET)?.mode).toBe(0o640);
		// The settings target keeps its complete prior bytes.
		expect(fake.fileText(SETTINGS)).toBe("OLD-SETTINGS");
	});

	it("unlinks a previously-absent first target on second-target failure", async () => {
		const fake = makeFakeSecureFs();
		for (const d of ["/", PROJECT, CLAUDE, HOOKS]) fake.seedDir(d);
		// Only settings pre-exists; asset is a fresh install.
		fake.seedFile(SETTINGS, Buffer.from("OLD-SETTINGS"), 0o644);
		fake.faults.renameRefuse = (to) => to === "settings.json";
		const outcome = await run(
			fake,
			asset({ wasAbsent: true }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		// The freshly-created asset is unlinked by rollback.
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.fileText(SETTINGS)).toBe("OLD-SETTINGS");
	});

	it("records-and-continues when the prior-mode restore fails (JD-B-003)", async () => {
		const fake = seededUpgradeFake();
		fake.faults.renameRefuse = (to) => to === "settings.json";
		// applyExactMode on the asset's staged temp: the 1st call is the forward
		// stage (must succeed), the 2nd is the rollback's prior-mode restore.
		let assetModeCalls = 0;
		fake.faults.applyModeRefuse = (target) => {
			if (!target.startsWith(`${ASSET}.javi-forge.tmp.`)) return false;
			assetModeCalls += 1;
			return assetModeCalls >= 2;
		};
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		// Restoring BYTES matters more than the mode: the rename still happened.
		expect(fake.fileText(ASSET)).toBe("OLD-ASSET");
		// The restored file keeps the safe staging mode instead of prior 0o640.
		expect(fake.files.get(ASSET)?.mode).toBe(0o600);
		// An INFORMATIONAL note, never a STOP (the rollback did not halt).
		const joined = outcome.errors.join(" ");
		expect(joined).toMatch(
			/note: restored .*asset\.mjs; prior-mode restore failed, verify permissions \(.*\)/,
		);
		expect(joined).not.toMatch(/STOP:/);
	});

	it("removes only tx-created empty segments when it aborts before staging", async () => {
		const fake = makeFakeSecureFs();
		fake.seedDir("/");
		fake.seedDir(PROJECT);
		// Asset capture is required but the source read fails → abort after the
		// two segments are created but before any temp is staged.
		fake.faults.captureRefuse = (target) => target === ASSET;
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings(),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		// Both created segments were empty → removed by rollback.
		expect(fake.dirs.has(HOOKS)).toBe(false);
		expect(fake.dirs.has(CLAUDE)).toBe(false);
	});
});

describe("runTransaction — rollback STOPS on lost proof (never clobbers)", () => {
	it("stops and emits manual-recovery guidance when the gate no longer holds", async () => {
		const fake = seededUpgradeFake();
		fake.faults.renameRefuse = (to) => to === "settings.json";
		// Ownership passes at preflight (1) and the pre-rename re-prove (2); it
		// then fails on the 3rd check, which is rollback's gateStillValid guard.
		fake.faults.ownershipRefuse = (dirPath, idx) =>
			dirPath === PROJECT && idx >= 3;
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.errors.join(" ")).toMatch(/STOP: lost parent-chain proof/);
		// The committed asset is NOT restored — cleanup stopped for manual recovery.
		expect(fake.fileText(ASSET)).toBe("NEW-ASSET");
	});

	it("stops when the restore-rename itself fails (payload staged for manual recovery)", async () => {
		const fake = seededUpgradeFake();
		let assetRenames = 0;
		// settings.json rename fails → triggers rollback of the committed asset.
		// asset.mjs renames twice: forward commit (1st, must succeed) then the
		// rollback restore-rename (2nd, forced to fail).
		fake.faults.renameRefuse = (to) => {
			if (to === "settings.json") return true;
			if (to === "asset.mjs") {
				assetRenames += 1;
				return assetRenames >= 2;
			}
			return false;
		};
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		// The failed restore-rename must emit a STOP with manual-recovery guidance.
		expect(outcome.errors.join(" ")).toMatch(
			/STOP: cannot restore .*asset\.mjs.*staged at .*for manual recovery/,
		);
		// The prior bytes were NOT restored (the rename failed); the committed
		// payload stays in place rather than being silently left half-restored.
		expect(fake.fileText(ASSET)).toBe("NEW-ASSET");
	});

	it("stops when the committed target's hash drifted after commit (concurrent edit)", async () => {
		const fake = seededUpgradeFake();
		fake.faults.renameRefuse = (to) => to === "settings.json";
		fake.faults.captureShaOverride = (target) =>
			target === ASSET ? "f".repeat(64) : undefined;
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.errors.join(" ")).toMatch(/changed after commit/);
		// The concurrent change is preserved, not clobbered.
		expect(fake.fileText(ASSET)).toBe("NEW-ASSET");
	});
});
