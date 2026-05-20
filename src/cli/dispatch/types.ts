/**
 * Shared types for the CLI dispatch layer.
 *
 * `CLI` is the meow `Result` parameterized over FLAGS_SCHEMA — imported
 * by all dispatch handlers for the `cli` parameter type.
 *
 * `RendererCtx` carries the Ink-render-specific context (stdin shim +
 * CI flag) — imported by Ink-rendering handlers only.
 */
import type { Result } from "meow";
import type { FLAGS_SCHEMA } from "../help.js";

/**
 * Type of the meow `Result` parameterized over our FLAGS_SCHEMA.
 * Shared by all dispatch handlers as the `cli` parameter type.
 */
export type CLI = Result<typeof FLAGS_SCHEMA>;

/**
 * Context passed to dispatch handlers that need to render Ink components.
 * - `inkStdin`: the (possibly shimmed) stdin used by Ink's render — built via
 *   `createInkStdin()` in `src/cli/runtime.ts` (a `PassThrough` stand-in when
 *   stdin is not a TTY, the real `process.stdin` otherwise).
 * - `isCI`: controls `CIContextProvider` behavior — derived from
 *   `detectCI(cli.flags)` in `src/cli/runtime.ts`.
 */
export type RendererCtx = {
	inkStdin: NodeJS.ReadStream;
	isCI: boolean;
};
