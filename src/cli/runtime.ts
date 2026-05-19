/**
 * Runtime utilities for the CLI entry point:
 *   - Validator constants for `init` flags
 *   - CI environment detection
 *   - TTY-aware stdin shim for Ink
 *   - update-notifier bootstrap
 *
 * Kept dependency-light: only `node:stream` and `update-notifier`.
 * Heavy runtimes (react, ink, meow, command modules) are NOT imported
 * here — they remain lazy-loaded from `src/index.tsx`.
 */
import { PassThrough } from "node:stream";
import updateNotifier from "update-notifier";

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

/** Detects whether the CLI is running in a non-interactive / CI context. */
export function detectCI(flags: { batch?: boolean }): boolean {
	return (
		flags.batch === true || process.env.CI === "1" || process.env.CI === "true"
	);
}

/**
 * Returns a stdin stream suitable for Ink. When stdin is a TTY, the real
 * `process.stdin` is returned; otherwise a `PassThrough` stand-in is supplied
 * so Ink does not crash trying to enable raw mode on a non-TTY pipe.
 */
export function createInkStdin(): NodeJS.ReadStream {
	const isTTY = process.stdin.isTTY === true;
	if (isTTY) return process.stdin;
	const fakeStdin = new PassThrough() as unknown as NodeJS.ReadStream;
	Object.defineProperty(fakeStdin, "isTTY", { value: false });
	return fakeStdin;
}

/** Schedules a non-blocking background update check (cached for 24h). */
export function setupUpdateNotifier(pkg: {
	name: string;
	version: string;
}): void {
	updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 }).notify();
}
