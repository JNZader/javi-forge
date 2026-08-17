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

// A fake seeded as if a prior install already exists: root..project, .claude,
// .claude/hooks, and the two managed files present with prior bytes.
const installedFake = (over: { withHooks?: boolean } = {}) => {
	const fake = makeFakeSecureFs();
	for (const d of ["/", PROJECT, CLAUDE]) fake.seedDir(d);
	if (over.withHooks !== false) fake.seedDir(HOOKS);
	fake.seedFile(ASSET, Buffer.from("OLD-ASSET"), 0o600);
	fake.seedFile(SETTINGS, Buffer.from("OLD-SETTINGS"), 0o600);
	return fake;
};

describe("runTransaction — managed-container proof (Round-4/5/6 seam)", () => {
	it("refuses an asset-only repair when .claude fails proveManagedContainer (JDA-401)", async () => {
		// asset drifted (write), settings current (desired=null): the round-3
		// create/write add-child check never fired on .claude (the grandparent);
		// proveManagedContainer must now catch a foreign add-child on it.
		const fake = installedFake();
		fake.faults.managedContainerRefuse = (dirPath) => dirPath === CLAUDE;
		const outcome = await run(
			fake,
			asset({ capturePrior: true, wasAbsent: false }),
			settings({ desired: null }),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(outcome.errors.join(" ")).toMatch(/container .*\.claude/);
		// Zero mutation: the drifted asset keeps its prior bytes, no temp remains.
		expect(fake.fileText(ASSET)).toBe("OLD-ASSET");
		expect(
			[...fake.files.keys()].filter((k) => k.includes(".javi-forge.tmp.")),
		).toEqual([]);
	});

	it("refuses a settings-only repair when existing .claude/hooks fails proveManagedContainer (JDB5-001)", async () => {
		// settings drifted (write), asset current (desired=null): under Round-4 the
		// hooks dir was never opened on a settings-only run. Round-5 opens+proves it
		// whenever it EXISTS, so a foreign add/delete-child on it now refuses.
		const fake = installedFake();
		fake.faults.managedContainerRefuse = (dirPath) => dirPath === HOOKS;
		const outcome = await run(
			fake,
			asset({ desired: null }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(outcome.errors.join(" ")).toMatch(/container .*hooks/);
		expect(fake.fileText(SETTINGS)).toBe("OLD-SETTINGS");
	});

	it("commits a settings-only repair when existing .claude/hooks is clean (JDB5-001 positive)", async () => {
		const fake = installedFake();
		const outcome = await run(
			fake,
			asset({ desired: null }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(true);
		expect(outcome.committed).toEqual([SETTINGS]);
		expect(fake.fileText(SETTINGS)).toBe("SETTINGS-BYTES");
		// The clean existing hooks container was opened + proved, not created anew.
		expect(fake.dirs.has(HOOKS)).toBe(true);
	});

	it("skips (neither creates nor proves) an absent .claude/hooks on a settings-only repair (genuine notFound + !createIfAbsent)", async () => {
		const fake = installedFake({ withHooks: false });
		const outcome = await run(
			fake,
			asset({ desired: null }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(true);
		expect(outcome.committed).toEqual([SETTINGS]);
		// No asset written this run → nothing to secure → hooks not created.
		expect(fake.dirs.has(HOOKS)).toBe(false);
	});

	it("fails closed when an existing managed container is present-but-unopenable on a settings-only repair (JDA6-001, createIfAbsent=false)", async () => {
		// hooks EXISTS but openDirNoFollow returns a non-notFound refusal (a junction
		// / EACCES). It MUST refuse the whole transaction, never return null/skip.
		const fake = installedFake();
		fake.faults.openDirUnopenable = (dirPath) => dirPath === HOOKS;
		const outcome = await run(
			fake,
			asset({ desired: null }),
			settings({ capturePrior: true, wasAbsent: false }),
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(fake.fileText(SETTINGS)).toBe("OLD-SETTINGS");
	});

	it("fails closed when a managed container is present-but-unopenable on a fresh install (JDA6-001, createIfAbsent=true)", async () => {
		// Symmetric branch: even when createIfAbsent=true, a non-notFound refusal
		// must fail closed BEFORE createDirExclusive, not fall through to create.
		const fake = freshFake();
		fake.seedDir(CLAUDE); // .claude exists so we reach the hooks open
		fake.faults.openDirUnopenable = (dirPath) => dirPath === HOOKS;
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.files.has(SETTINGS)).toBe(false);
	});

	it("re-proves managed containers in the pre-commit re-prove loop (JDB7-003 / TOCTOU parity)", async () => {
		// proveManagedContainer(.claude) passes at ensure time but a foreign add-child
		// is planted before the first rename: the 2nd container check must catch it.
		const fake = freshFake();
		fake.faults.managedContainerRefuse = (dirPath, idx) =>
			dirPath === CLAUDE && idx >= 2;
		const outcome = await run(fake, asset(), settings());
		expect(outcome.ok).toBe(false);
		expect(outcome.committed).toEqual([]);
		expect(outcome.errors.join(" ")).toMatch(/recheck-container/);
		expect(fake.files.has(ASSET)).toBe(false);
		expect(fake.files.has(SETTINGS)).toBe(false);
	});
});
