import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import {
	ASSET_SHA_PLACEHOLDER,
	L1_BASH_DANGEROUS,
	L1_ONE_BYTE_EDITED,
	L2_BASH_SENSITIVE_READ,
	L3_WRITE_EDIT_PROTECTED,
	L4_BASH_POST_SECRET_SCAN,
	MANAGED_ASSET_ARG,
	MANAGED_MATCHER,
	MANAGED_STATUS_PREFIX,
	managedGroup,
	managedHandler,
	managedStatusMessage,
	SAMPLE_ASSET_SHA256,
	settingsContainer,
} from "./__fixtures__/claude-hook-ownership.js";
import {
	buildManagedContainer,
	canonicalizeSettingsEntry,
	classifyLegacy,
	classifySettingsEntry,
	deepStructuralEqual,
	type FlagVerdict,
	normalizeStatusMessage,
	parseVersionFromStatus,
	planForceReplace,
	planLegacyCohortExcision,
	planManagedClaudeHookMerge,
	planManagedClaudeHookRemoval,
	MANAGED_MATCHER as SETTINGS_MANAGED_MATCHER,
	type SettingsIdentityManifest,
	scanExecutionFlags,
	validateSettingsShape,
} from "./claude-hook-settings.js";

interface Manifest {
	settingsEntries: {
		current: { version: number; canonicalSha256: string } | null;
		historical: { version: number; canonicalSha256: string }[];
	};
}

const manifest = (): Manifest =>
	JSON.parse(
		fs.readFileSync(path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"), "utf8"),
	) as Manifest;

/** Real released settings identity from the packaged manifest (populated in 3.1). */
const releasedIdentity = (): SettingsIdentityManifest => {
	const m = manifest().settingsEntries;
	return { current: m.current, historical: m.historical };
};

const OTHER_HASH = "f".repeat(64);
const OTHER_IDENTITY: SettingsIdentityManifest = {
	current: { version: 1, canonicalSha256: OTHER_HASH },
	historical: [],
};

describe("validateSettingsShape / classifySettingsEntry malformed shapes", () => {
	it.each([
		["null", null],
		["array", []],
		["string", "hooks"],
		["number", 7],
		["hooks not object", { hooks: [] }],
		["PreToolUse not array", { hooks: { PreToolUse: {} } }],
	])("classifies %s container as malformed", (_name, parsed) => {
		expect(validateSettingsShape(parsed)).toBe(false);
		expect(
			classifySettingsEntry(parsed, SAMPLE_ASSET_SHA256, OTHER_IDENTITY).state,
		).toBe("malformed");
	});

	it.each([
		["empty object", {}],
		["empty PreToolUse", { hooks: { PreToolUse: [] } }],
		["hooks absent", { model: "x" }],
	])("accepts %s as a valid shape", (_name, parsed) => {
		expect(validateSettingsShape(parsed)).toBe(true);
	});
});

describe("classifySettingsEntry marker identity", () => {
	it("classifies the exact managed group as managed-current (manifest-bound)", () => {
		const parsed = settingsContainer([managedGroup()]);
		const result = classifySettingsEntry(
			parsed,
			SAMPLE_ASSET_SHA256,
			releasedIdentity(),
		);
		expect(result.state).toBe("managed-current");
		expect(result.canonicalSha256).toBe(
			manifest().settingsEntries.current?.canonicalSha256,
		);
		expect(result.version).toBe(1);
	});

	it("classifies a prior released identity as released-outdated (manifest-bound)", () => {
		const current = manifest().settingsEntries.current;
		expect(current).not.toBeNull();
		const identity: SettingsIdentityManifest = {
			current: { version: 1, canonicalSha256: OTHER_HASH },
			historical: [current as { version: number; canonicalSha256: string }],
		};
		const parsed = settingsContainer([managedGroup()]);
		expect(
			classifySettingsEntry(parsed, SAMPLE_ASSET_SHA256, identity).state,
		).toBe("released-outdated");
	});

	it("classifies a marked but unknown-hash group as edited-managed", () => {
		const edited = managedGroup();
		edited.hooks[0].timeout = 45;
		const parsed = settingsContainer([edited]);
		expect(
			classifySettingsEntry(parsed, SAMPLE_ASSET_SHA256, releasedIdentity())
				.state,
		).toBe("edited-managed");
	});

	it("never trusts a forged statusMessage hash — edits still classify edited-managed", () => {
		const forged = managedGroup();
		// statusMessage forges the current canonical hash; timeout is edited so the
		// recomputed canonical hash differs from every known manifest identity.
		const currentHash =
			manifest().settingsEntries.current?.canonicalSha256 ?? OTHER_HASH;
		forged.hooks[0].statusMessage = `${MANAGED_STATUS_PREFIX}${currentHash}`;
		forged.hooks[0].timeout = 45;
		const result = classifySettingsEntry(
			settingsContainer([forged]),
			SAMPLE_ASSET_SHA256,
			releasedIdentity(),
		);
		expect(result.state).toBe("edited-managed");
	});

	it("classifies more than one exact marker as edited-managed", () => {
		const parsed = settingsContainer([managedGroup(), managedGroup()]);
		expect(
			classifySettingsEntry(parsed, SAMPLE_ASSET_SHA256, releasedIdentity())
				.state,
		).toBe("edited-managed");
	});

	it("classifies a marker inside an invalid container as edited-managed", () => {
		const badGroup = { matcher: 123, hooks: [managedHandler()] };
		expect(
			classifySettingsEntry(
				settingsContainer([badGroup]),
				SAMPLE_ASSET_SHA256,
				releasedIdentity(),
			).state,
		).toBe("edited-managed");
	});

	it("classifies a resembling unmarked handler as foreign", () => {
		const resemble = {
			matcher: MANAGED_MATCHER,
			hooks: [
				{
					type: "command",
					command: "node",
					args: [MANAGED_ASSET_ARG],
					timeout: 30,
					statusMessage: "totally-different-marker",
				},
			],
		};
		expect(
			classifySettingsEntry(
				settingsContainer([resemble]),
				SAMPLE_ASSET_SHA256,
				releasedIdentity(),
			).state,
		).toBe("foreign");
	});

	it("classifies an empty container as absent", () => {
		expect(
			classifySettingsEntry({}, SAMPLE_ASSET_SHA256, releasedIdentity()).state,
		).toBe("absent");
	});
});

describe("classifyLegacy — exact cohort only", () => {
	it("recognizes the complete one-of-each cohort as exact-legacy", () => {
		const parsed = settingsContainer(
			[L1_BASH_DANGEROUS, L2_BASH_SENSITIVE_READ, L3_WRITE_EDIT_PROTECTED],
			[L4_BASH_POST_SECRET_SCAN],
		);
		expect(classifyLegacy(parsed)).toEqual({
			state: "exact-legacy",
			detail: "cohort",
		});
	});

	it("leaves non-cohort siblings unclaimed while still recognizing the cohort", () => {
		const parsed = settingsContainer(
			[
				{ matcher: "Read", hooks: [] },
				L1_BASH_DANGEROUS,
				L2_BASH_SENSITIVE_READ,
				L3_WRITE_EDIT_PROTECTED,
			],
			[L4_BASH_POST_SECRET_SCAN],
		);
		expect(classifyLegacy(parsed).state).toBe("exact-legacy");
	});

	it.each([
		["one member", [L1_BASH_DANGEROUS], []],
		["two members", [L1_BASH_DANGEROUS, L2_BASH_SENSITIVE_READ], []],
		[
			"three members",
			[L1_BASH_DANGEROUS, L2_BASH_SENSITIVE_READ, L3_WRITE_EDIT_PROTECTED],
			[],
		],
	])("classifies a %s partial cohort as foreign", (_name, pre, post) => {
		expect(classifyLegacy(settingsContainer(pre, post))).toEqual({
			state: "foreign",
			detail: "partial-legacy",
		});
	});

	it("classifies a duplicated cohort member as foreign", () => {
		const parsed = settingsContainer(
			[
				L1_BASH_DANGEROUS,
				L1_BASH_DANGEROUS,
				L2_BASH_SENSITIVE_READ,
				L3_WRITE_EDIT_PROTECTED,
			],
			[L4_BASH_POST_SECRET_SCAN],
		);
		expect(classifyLegacy(parsed).state).toBe("foreign");
	});

	it("classifies a one-byte-edited cohort member as foreign", () => {
		const parsed = settingsContainer(
			[L1_ONE_BYTE_EDITED, L2_BASH_SENSITIVE_READ, L3_WRITE_EDIT_PROTECTED],
			[L4_BASH_POST_SECRET_SCAN],
		);
		expect(classifyLegacy(parsed).state).toBe("foreign");
	});

	it("classifies no cohort trace as absent", () => {
		expect(
			classifyLegacy(settingsContainer([{ matcher: "Read", hooks: [] }])),
		).toEqual({ state: "absent" });
	});
});

describe("deepStructuralEqual", () => {
	it("is order-sensitive for arrays", () => {
		expect(deepStructuralEqual([1, 2], [1, 2])).toBe(true);
		expect(deepStructuralEqual([1, 2], [2, 1])).toBe(false);
	});

	it("is key-set-exact but key-order-insensitive for objects", () => {
		expect(deepStructuralEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		expect(deepStructuralEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
	});

	it("is strict for scalars and null", () => {
		expect(deepStructuralEqual("x", "x")).toBe(true);
		expect(deepStructuralEqual(1, "1")).toBe(false);
		expect(deepStructuralEqual(null, undefined)).toBe(false);
	});
});

describe("canonical serialization — deterministic and asset-SHA independent", () => {
	const canonicalOf = (group: ReturnType<typeof managedGroup>): string =>
		canonicalizeSettingsEntry(group, group.hooks[0]).canonicalSha256;

	it("is invariant under asset-SHA rotation (Decision ②)", () => {
		const a = canonicalOf(managedGroup(SAMPLE_ASSET_SHA256));
		const b = canonicalOf(managedGroup("a".repeat(64)));
		expect(a).toBe(b);
	});

	it("normalizes the asset-SHA token to the fixed placeholder before hashing", () => {
		const { serialization } = canonicalizeSettingsEntry(
			managedGroup(),
			managedHandler(),
		);
		expect(serialization).toContain(
			`${MANAGED_STATUS_PREFIX}${ASSET_SHA_PLACEHOLDER}`,
		);
		expect(serialization).not.toContain(SAMPLE_ASSET_SHA256);
		expect(serialization.endsWith("\n")).toBe(true);
	});

	it("produces identical bytes regardless of source key insertion order", () => {
		const reordered = {
			hooks: [
				{
					statusMessage: managedStatusMessage(),
					timeout: 30,
					args: [MANAGED_ASSET_ARG],
					command: "node",
					type: "command",
				},
			],
			matcher: MANAGED_MATCHER,
		};
		const ordered = canonicalizeSettingsEntry(managedGroup(), managedHandler());
		const shuffled = canonicalizeSettingsEntry(reordered, reordered.hooks[0]);
		expect(shuffled.serialization).toBe(ordered.serialization);
		expect(shuffled.canonicalSha256).toBe(ordered.canonicalSha256);
	});

	it("matches an independent SHA-256 over the canonical bytes", () => {
		const { serialization, canonicalSha256 } = canonicalizeSettingsEntry(
			managedGroup(),
			managedHandler(),
		);
		expect(canonicalSha256).toBe(
			createHash("sha256").update(serialization, "utf8").digest("hex"),
		);
	});
});

describe("parseVersionFromStatus / normalizeStatusMessage", () => {
	it("parses the marker version", () => {
		expect(parseVersionFromStatus(managedStatusMessage())).toBe(1);
		expect(parseVersionFromStatus("no-version")).toBeUndefined();
	});

	it("leaves a non-managed statusMessage untouched", () => {
		expect(normalizeStatusMessage("something-else")).toBe("something-else");
		expect(normalizeStatusMessage(42)).toBe("");
	});
});

describe("removal / merge planning preserves siblings and refuses foreign", () => {
	const sibling = { type: "command", command: "echo", args: ["hi"] };

	it("plans managed removal keeping unrelated sibling handlers", () => {
		const group = managedGroup();
		(group.hooks as unknown[]).push(sibling);
		const plan = planManagedClaudeHookRemoval(
			settingsContainer([group]),
			SAMPLE_ASSET_SHA256,
			releasedIdentity(),
		);
		expect(plan.refused).toBe(false);
		expect(plan.preservedSiblings).toBe(1);
		expect(plan.removeGroup).toBe(false);
		expect(plan.handlerIndex).toBe(0);
	});

	it("marks the group for removal when the managed handler is alone", () => {
		const plan = planManagedClaudeHookRemoval(
			settingsContainer([managedGroup()]),
			SAMPLE_ASSET_SHA256,
			releasedIdentity(),
		);
		expect(plan.refused).toBe(false);
		expect(plan.removeGroup).toBe(true);
		expect(plan.preservedSiblings).toBe(0);
	});

	it("refuses to plan removal of foreign content", () => {
		const foreign = settingsContainer([{ matcher: "Read", hooks: [sibling] }]);
		expect(
			planManagedClaudeHookRemoval(
				foreign,
				SAMPLE_ASSET_SHA256,
				releasedIdentity(),
			).refused,
		).toBe(true);
	});

	it("plans install for an absent settings entry and noop for current", () => {
		expect(
			planManagedClaudeHookMerge({}, SAMPLE_ASSET_SHA256, releasedIdentity())
				.action,
		).toBe("install");
		expect(
			planManagedClaudeHookMerge(
				settingsContainer([managedGroup()]),
				SAMPLE_ASSET_SHA256,
				releasedIdentity(),
			).action,
		).toBe("noop");
	});

	it("refuses to merge over foreign content", () => {
		const foreign = settingsContainer([{ matcher: "Read", hooks: [sibling] }]);
		const plan = planManagedClaudeHookMerge(
			foreign,
			SAMPLE_ASSET_SHA256,
			releasedIdentity(),
		);
		expect(plan.action).toBe("refuse");
		expect(plan.refused).toBe(true);
	});
});

describe("planLegacyCohortExcision (Slice 3a write-plan helper)", () => {
	it("locates the four cohort objects by index and preserves every sibling", () => {
		const readGroup = { matcher: "Read", hooks: [] };
		const otherGroup = { matcher: "Grep", hooks: [] };
		const postSibling = { matcher: "Bash", hooks: [] };
		const parsed = settingsContainer(
			[
				readGroup,
				L1_BASH_DANGEROUS,
				L2_BASH_SENSITIVE_READ,
				otherGroup,
				L3_WRITE_EDIT_PROTECTED,
			],
			[L4_BASH_POST_SECRET_SCAN, postSibling],
		);
		const plan = planLegacyCohortExcision(parsed);
		expect(plan.refused).toBe(false);
		// L1 idx 1, L2 idx 2, L3 idx 4 — ascending, siblings at 0 and 3 preserved.
		expect(plan.removePreIndices).toEqual([1, 2, 4]);
		expect(plan.removePostIndices).toEqual([0]);
		// Two Pre siblings survive excision → managed group appends at index 2.
		expect(plan.insertPreAt).toBe(2);
	});

	it("returns ascending indices even when cohort members appear out of order", () => {
		const parsed = settingsContainer(
			[L3_WRITE_EDIT_PROTECTED, L1_BASH_DANGEROUS, L2_BASH_SENSITIVE_READ],
			[L4_BASH_POST_SECRET_SCAN],
		);
		const plan = planLegacyCohortExcision(parsed);
		expect(plan.removePreIndices).toEqual([0, 1, 2]);
		expect(plan.insertPreAt).toBe(0);
	});

	it("refuses when the parsed value is not an exact legacy cohort", () => {
		const parsed = settingsContainer([{ matcher: "Read", hooks: [] }]);
		const plan = planLegacyCohortExcision(parsed);
		expect(plan.refused).toBe(true);
		expect(plan.reason).toMatch(/refuse/);
	});
});

describe("planForceReplace (Slice 3a write-plan helper, §324 matcher-exactness)", () => {
	it("matcher exact → eligible in place regardless of siblings", () => {
		const group = managedGroup();
		(group.hooks as unknown[]).push({
			type: "command",
			command: "echo",
			args: ["hi"],
		});
		group.hooks[0].timeout = 45; // edits canonical identity → edited-managed
		const plan = planForceReplace(
			settingsContainer([group]),
			SAMPLE_ASSET_SHA256,
		);
		expect(plan.refused).toBe(false);
		expect(plan.matcherExact).toBe(true);
		expect(plan.siblingHandlers).toBe(1);
		expect(plan.groupIndex).toBe(0);
		expect(plan.handlerIndex).toBe(0);
	});

	it("matcher edited with 0 siblings → eligible in place", () => {
		const edited = {
			matcher: "Bash",
			hooks: [{ ...managedHandler(), timeout: 45 }],
		};
		const plan = planForceReplace(
			settingsContainer([edited]),
			SAMPLE_ASSET_SHA256,
		);
		expect(plan.refused).toBe(false);
		expect(plan.matcherExact).toBe(false);
		expect(plan.siblingHandlers).toBe(0);
		expect(plan.groupIndex).toBe(0);
		expect(plan.handlerIndex).toBe(0);
	});

	it("matcher edited with siblings > 0 → refused even under force (§324)", () => {
		const edited = {
			matcher: "Bash",
			hooks: [
				{ ...managedHandler(), timeout: 45 },
				{ type: "command", command: "echo", args: ["hi"] },
			],
		};
		const plan = planForceReplace(
			settingsContainer([edited]),
			SAMPLE_ASSET_SHA256,
		);
		expect(plan.refused).toBe(true);
		expect(plan.matcherExact).toBe(false);
		expect(plan.siblingHandlers).toBe(1);
		expect(plan.reason).toMatch(/§324|sibling/);
	});

	it("refuses when there is no single marker-proven handler", () => {
		const parsed = settingsContainer([{ matcher: "Read", hooks: [] }]);
		const plan = planForceReplace(parsed, SAMPLE_ASSET_SHA256);
		expect(plan.refused).toBe(true);
	});
});

describe("buildManagedContainer (Slice 3a container synthesis)", () => {
	it("synthesizes a managed-only PreToolUse container from the asset SHA", () => {
		const container = buildManagedContainer(SAMPLE_ASSET_SHA256);
		expect(Object.keys(container)).toEqual(["hooks"]);
		const group = container.hooks.PreToolUse[0];
		expect(container.hooks.PreToolUse).toHaveLength(1);
		expect(group.matcher).toBe(SETTINGS_MANAGED_MATCHER);
		expect(group.hooks[0].statusMessage).toBe(
			`${MANAGED_STATUS_PREFIX}${SAMPLE_ASSET_SHA256}`,
		);
		expect(group.hooks[0].args).toEqual([MANAGED_ASSET_ARG]);
	});

	it("produces a container that classifies as managed-current for its own SHA", () => {
		const container = buildManagedContainer(SAMPLE_ASSET_SHA256);
		const group = container.hooks.PreToolUse[0];
		const { canonicalSha256 } = canonicalizeSettingsEntry(
			group,
			group.hooks[0],
		);
		const identity: SettingsIdentityManifest = {
			current: { version: 1, canonicalSha256 },
			historical: [],
		};
		expect(
			classifySettingsEntry(container, SAMPLE_ASSET_SHA256, identity).state,
		).toBe("managed-current");
	});
});

describe("scanExecutionFlags (Slice 4b/C flag classifier — invalid ⇒ true)", () => {
	const NOT_SET: FlagVerdict = { set: false };
	const EXPLICIT: FlagVerdict = { set: true, reason: "explicit" };
	const invalid = (shape: string): FlagVerdict => ({
		set: true,
		reason: "invalid",
		shape,
	});

	/**
	 * The full documented shape matrix. Claude Code treats an INVALID (non-boolean)
	 * value as `true`, so every non-boolean present value is `set` with the shape
	 * named — including the counterintuitive string `"false"`, which is not a
	 * boolean and therefore does NOT clear the flag.
	 */
	const SHAPES: [name: string, value: unknown, expected: FlagVerdict][] = [
		["boolean true", true, EXPLICIT],
		["boolean false", false, NOT_SET],
		["string 'true'", "true", invalid("string")],
		["string 'false'", "false", invalid("string")],
		["number 1", 1, invalid("number")],
		["number 0", 0, invalid("number")],
		["null", null, invalid("null")],
		["object", {}, invalid("object")],
		["array", [], invalid("array")],
	];

	it.each(SHAPES)("classifies disableAllHooks %s", (_name, value, expected) => {
		expect(scanExecutionFlags({ disableAllHooks: value })).toEqual({
			disableAllHooks: expected,
			allowManagedHooksOnly: NOT_SET,
		});
	});

	it.each(
		SHAPES,
	)("classifies allowManagedHooksOnly %s", (_name, value, expected) => {
		expect(scanExecutionFlags({ allowManagedHooksOnly: value })).toEqual({
			disableAllHooks: NOT_SET,
			allowManagedHooksOnly: expected,
		});
	});

	it("treats an absent key and an explicit undefined as not set", () => {
		expect(scanExecutionFlags({})).toEqual({
			disableAllHooks: NOT_SET,
			allowManagedHooksOnly: NOT_SET,
		});
		expect(
			scanExecutionFlags({
				disableAllHooks: undefined,
				allowManagedHooksOnly: undefined,
			}),
		).toEqual({ disableAllHooks: NOT_SET, allowManagedHooksOnly: NOT_SET });
	});

	it("classifies both flags independently in the same source", () => {
		expect(
			scanExecutionFlags({ disableAllHooks: true, allowManagedHooksOnly: 1 }),
		).toEqual({
			disableAllHooks: EXPLICIT,
			allowManagedHooksOnly: invalid("number"),
		});
	});

	it("yields 'not a flag' for non-object input (unreadability is upstream)", () => {
		for (const notObj of [null, undefined, 42, "x", [], true]) {
			expect(scanExecutionFlags(notObj)).toEqual({
				disableAllHooks: NOT_SET,
				allowManagedHooksOnly: NOT_SET,
			});
		}
	});
});
