import type { Result } from "meow";
import type { FLAGS_SCHEMA } from "../help.js";

/**
 * Type of the meow `Result` parameterized over our FLAGS_SCHEMA.
 * Shared by all dispatch handlers.
 */
export type CLI = Result<typeof FLAGS_SCHEMA>;

/**
 * Context passed to dispatch handlers that need to render Ink components.
 * `inkStdin` is the (possibly shimmed) stdin used by Ink's render.
 * `isCI` controls CIContextProvider behavior.
 */
export type RendererCtx = {
	inkStdin: NodeJS.ReadStream;
	isCI: boolean;
};
