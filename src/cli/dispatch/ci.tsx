/**
 * `javi-forge ci` handler — two branches:
 *   1. `ci init` — console-only, installs git hooks via ./commands/ci.js (lazy)
 *   2. `ci [--detect|--shell|--quick|...]` — Ink render of <CI /> (eager)
 *
 * The command module (`./commands/ci.js`) is lazy-loaded inside the function
 * to preserve cold-start performance; Ink + React are already eagerly loaded
 * at the entrypoint, so importing the UI component at the top is fine.
 */

import { render } from "ink";
import type { Result } from "meow";
import React from "react";
import type { CIMode } from "../../commands/ci.js";
import CI from "../../ui/CI.js";
import { CIProvider as CIContextProvider } from "../../ui/CIContext.js";
import type { FLAGS_SCHEMA } from "../help.js";
import type { RendererCtx } from "./simple-renderers.js";

type CLI = Result<typeof FLAGS_SCHEMA>;

export async function handleCi(cli: CLI, ctx: RendererCtx): Promise<void> {
	// Sub-command: javi-forge ci init → install git hooks
	if (cli.input[1] === "init") {
		const { installCIHooks } = await import("../../commands/ci.js");
		const { installed, errors } = await installCIHooks(process.cwd());
		if (installed.length > 0) {
			console.log(`✓ Installed git hooks: ${installed.join(", ")}`);
			console.log("  Hooks call javi-forge ci (with npx fallback)");
		}
		for (const err of errors) {
			console.error(`✗ ${err}`);
		}
		process.exit(errors.length > 0 ? 1 : 0);
	}

	const ciMode: CIMode = cli.flags.detect
		? "detect"
		: cli.flags.shell
			? "shell"
			: cli.flags.quick
				? "quick"
				: "full";

	render(
		<CIContextProvider isCI={true}>
			<CI
				projectDir={process.cwd()}
				mode={ciMode}
				noDocker={!cli.flags.docker}
				noGhagga={!cli.flags.ciGhagga}
				noSecurity={!cli.flags.security}
				timeout={cli.flags.timeout}
			/>
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}
