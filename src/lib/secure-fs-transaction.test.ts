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
	desired: Buffer.from("ASSET-BYTES"),
	capturePrior: false,
	forceBackup: false,
	wasAbsent: true,
	...over,
});
const settings = (
	over: Partial<TransactionComponent> = {},
): TransactionComponent => ({
	path: SETTINGS,
	desired: Buffer.from("SETTINGS-BYTES"),
	capturePrior: false,
	forceBackup: false,
	wasAbsent: true,
	...over,
});

const freshFake = () => {
	const fake = makeFakeSecureFs();
	fake.seedDir("/");
	fake.seedDir(PROJECT);
	return fake;
};

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

describe("runTransaction — fresh install (host-independent fake)", () => {
	it("creates both segments at 0o700 one at a time and commits asset then settings", async () => {
		const fake = freshFake();
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(true);
		expect(outcome.committed).toEqual([ASSET, SETTINGS]);
		expect(outcome.backups).toEqual([]);
		expect(fake.dirs.has(CLAUDE)).toBe(true);
		expect(fake.dirs.has(HOOKS)).toBe(true);
		expect(fake.dirModes.get(CLAUDE)).toBe(0o700);
		expect(fake.dirModes.get(HOOKS)).toBe(0o700);
		expect(fake.fileText(ASSET)).toBe("ASSET-BYTES");
		expect(fake.fileText(SETTINGS)).toBe("SETTINGS-BYTES");
		// No leftover temp files remain after the renames.
		const leftovers = [...fake.files.keys()].filter((k) =>
			k.includes(".javi-forge.tmp."),
		);
		expect(leftovers).toEqual([]);
	});

	it("stages new files at mode 0o600 (staged temp renamed to target)", async () => {
		const fake = freshFake();
		await run(fake, asset(), settings());
		expect(fake.files.get(ASSET)?.mode).toBe(0o600);
		expect(fake.files.get(SETTINGS)?.mode).toBe(0o600);
	});

	it("writes only the settings segment when the asset is a no-op", async () => {
		const fake = freshFake();
		const outcome = await run(fake, asset({ desired: null }), settings());
		expect(outcome.ok).toBe(true);
		expect(outcome.committed).toEqual([SETTINGS]);
		expect(fake.dirs.has(CLAUDE)).toBe(true);
		// .claude/hooks is only created when the asset itself is written.
		expect(fake.dirs.has(HOOKS)).toBe(false);
	});
});

describe("runTransaction — pre-commit aborts leave every target untouched", () => {
	it("aborts with zero mutation when a controlling directory has an extended ACL", async () => {
		const fake = freshFake();
		fake.faults.aclRefuse = (target) => target === PROJECT;
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.files.has(SETTINGS)).toBe(false);
		// No segment created either — the gate refused before segment creation.
		expect(fake.dirs.has(CLAUDE)).toBe(false);
	});

	it("aborts before commit on identity drift after staging a temp (JD-B-005)", async () => {
		const fake = makeFakeSecureFs();
		for (const d of ["/", PROJECT, CLAUDE, HOOKS]) fake.seedDir(d);
		fake.seedFile(ASSET, Buffer.from("OLD-ASSET"), 0o600);
		// hooks parent is revalidated before capture (1) and after writeExclusive (2).
		fake.faults.revalidateRefuse = (target, idx) =>
			target === HOOKS && idx === 2;
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings(),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(outcome.errors.join(" ")).toMatch(/revalidate-staged/);
		// The asset target keeps its prior bytes; only a temp may exist.
		expect(fake.fileText(ASSET)).toBe("OLD-ASSET");
	});

	it("aborts when an exclusive temp create fails (EEXIST / fsync fault)", async () => {
		const fake = freshFake();
		// Fail the first exclusive write (the asset staging temp).
		fake.faults.writeRefuse = (name) => name.includes(".javi-forge.tmp.");
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.files.has(SETTINGS)).toBe(false);
	});

	it("aborts at the pre-first-rename full-gate re-prove (JD-007)", async () => {
		const fake = freshFake();
		// Ownership passes at preflight/segment gate; refuse only on the re-prove
		// of projectDir (its 2nd ownership check).
		fake.faults.ownershipRefuse = (dirPath, idx) =>
			dirPath === PROJECT && idx >= 2;
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(outcome.errors.join(" ")).toMatch(/recheck-own/);
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.files.has(SETTINGS)).toBe(false);
	});
});
