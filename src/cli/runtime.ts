/**
 * Runtime adapters for the CLI entry point:
 *   - CI environment detection
 *   - TTY-aware stdin shim for Ink
 *   - update-notifier bootstrap
 *
 * Kept dependency-light: only `node:stream` and `update-notifier`.
 * Heavy command modules (`./commands/*.js`) remain lazy-loaded from the
 * dispatch handlers themselves. `react`, `ink`, and `meow` are eagerly
 * imported at the CLI entry script (`src/index.tsx`) — not here.
 *
 * Pure-data validator constants live in `./validators.js` (separated to
 * keep runtime adapters and data tables apart).
 */
import { PassThrough } from "node:stream";
import updateNotifier from "update-notifier";

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
