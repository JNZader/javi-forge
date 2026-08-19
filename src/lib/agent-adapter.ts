/**
 * Agent adapter registry (agent-agnostic slice 2). One descriptor per host
 * (`claude`, `codex`) capturing the per-agent facts the SkillGuard installer and
 * doctor need: config paths, the protected managed set, the project-root source,
 * the settings-schema validator (SHARED — both hosts use the identical hooks
 * schema), the managed marker, the deny protocol, and the trust model.
 *
 * This descriptor is additive: Codex is routed through it, while Claude keeps its
 * existing, byte-identical runtime path (the descriptor only DESCRIBES Claude; it
 * does not change how the Claude command executes). The CLI dispatch decides the
 * valid `hooks <sub> <agent>` target set through `isAgentId` (backed by the
 * `AGENT_ADAPTERS` keys) — this registry is the single source of agent truth, and
 * a new agent added here cannot be silently dropped: the dispatch's command-loader
 * map is typed `Record<AgentId, …>`, so omitting a loader is a compile error.
 */

import path from "node:path";
import { ASSET_NAME } from "./__fixtures__/claude-hook-ownership.js";
import { validateSettingsShape } from "./claude-hook-settings.js";
import {
	codexConfigPaths,
	codexTrustGrantCommand,
	hasCodexTrustEntry,
} from "./codex-hook-manager.js";

export type AgentId = "claude" | "codex";

export type TrustState = "trusted" | "untrusted" | "unknown";

export interface TrustDescriptor {
	/** Detect whether the installed hook is TRUSTED from the host config text. */
	detect(configText: string, hooksFile: string): TrustState;
	/** The exact step a human runs to grant trust (no non-interactive path exists). */
	grantCommand(hooksFile: string): string;
}

export interface AgentAdapter {
	id: AgentId;
	/** Resolve the two host config files from a base dir (project root or home). */
	configPaths(baseDir: string): { hooksFile: string; settingsFile: string };
	/** Relative protected paths the guard refuses writes to (from AGENT_CONFIGS). */
	managedSet: readonly string[];
	/** Project-root source: an env var, or null → the envelope `cwd` (Codex). */
	projectDir: { envVar: string | null };
	/** SHARED settings-schema validator — the hooks container shape is identical. */
	settingsSchema: typeof validateSettingsShape;
	/** The managed asset marker for this host. */
	marker: string;
	/** Deny protocol emitted by the shared `.mjs` — the same on both hosts. */
	emitDeny: "exit2+stderr";
	/** Hook-trust model, or null when the host has none (Claude). */
	trust: TrustDescriptor | null;
}

const CLAUDE_MANAGED_SET = [
	".claude/settings.json",
	".claude/settings.local.json",
	".claude/CLAUDE.md",
	"CLAUDE.md",
	".javi-forge/ci.yaml",
	".claude/hooks/",
	".claude/agents/",
	".claude/skills/",
] as const;

const CODEX_MANAGED_SET = [
	".codex/hooks.json",
	".claude/settings.json",
	".claude/settings.local.json",
	".claude/CLAUDE.md",
	"CLAUDE.md",
	".javi-forge/ci.yaml",
	".claude/hooks/",
	".claude/agents/",
	".claude/skills/",
] as const;

export const claudeAdapter: AgentAdapter = {
	id: "claude",
	configPaths(projectDir) {
		return {
			hooksFile: path.join(projectDir, ".claude", "hooks", ASSET_NAME),
			settingsFile: path.join(projectDir, ".claude", "settings.json"),
		};
	},
	managedSet: CLAUDE_MANAGED_SET,
	projectDir: { envVar: "CLAUDE_PROJECT_DIR" },
	settingsSchema: validateSettingsShape,
	marker: "// javi-forge-managed: claude-pretooluse v1",
	emitDeny: "exit2+stderr",
	trust: null,
};

export const codexAdapter: AgentAdapter = {
	id: "codex",
	configPaths(homeDir) {
		const paths = codexConfigPaths(homeDir);
		return { hooksFile: paths.hooksFile, settingsFile: paths.configFile };
	},
	managedSet: CODEX_MANAGED_SET,
	projectDir: { envVar: null },
	settingsSchema: validateSettingsShape,
	marker: "// javi-forge-managed: codex-pretooluse v1",
	emitDeny: "exit2+stderr",
	trust: {
		detect(configText, hooksFile) {
			return hasCodexTrustEntry(configText, hooksFile)
				? "trusted"
				: "untrusted";
		},
		grantCommand: codexTrustGrantCommand,
	},
};

export const AGENT_ADAPTERS: Record<AgentId, AgentAdapter> = {
	claude: claudeAdapter,
	codex: codexAdapter,
};

/**
 * Whether a raw CLI token names a known agent adapter. Backed by the
 * `AGENT_ADAPTERS` registry so there is ONE source deciding valid targets: adding
 * an adapter to the registry automatically widens the accepted CLI set.
 */
export function isAgentId(value: unknown): value is AgentId {
	return typeof value === "string" && Object.hasOwn(AGENT_ADAPTERS, value);
}
