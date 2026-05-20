/**
 * Validator constants for `init` command flags.
 *
 * Pure-data module (no runtime imports) — separated from `runtime.ts` which
 * holds runtime adapters (CI detection, Ink stdin shim, update-notifier).
 * Consumed by dispatch handlers to validate `--stack`, `--ci`, and `--memory`
 * flag values before constructing preset props for the Ink UI.
 */

/** Valid `--stack` values accepted by the `init` command. */
export const VALID_STACKS = [
	"node",
	"python",
	"go",
	"rust",
	"java-gradle",
	"java-maven",
	"elixir",
];

/** Valid `--ci` provider values accepted by the `init` command. */
export const VALID_CI = ["github", "gitlab", "woodpecker"];

/** Valid `--memory` module values accepted by the `init` command. */
export const VALID_MEMORY = [
	"engram",
	"obsidian-brain",
	"memory-simple",
	"none",
];
