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
import React from "react";
import type { CIMode } from "../../commands/ci.js";
import CI from "../../ui/CI.js";
import { CIProvider as CIContextProvider } from "../../ui/CIContext.js";
import { CI_HELP_TEXT } from "../help.js";
import type { CLI, RendererCtx } from "./types.js";

export async function handleCi(cli: CLI, ctx: RendererCtx): Promise<void> {
	// Per-command help: `javi-forge ci --help` shows ci-specific usage, not the
	// global banner (autoHelp is disabled at the entrypoint).
	if (cli.flags.help === true) {
		console.log(CI_HELP_TEXT);
		process.exit(0);
	}

	// Sub-command: javi-forge ci validate → dry config validation, no execution.
	if (cli.input[1] === "validate") {
		const { validateCIConfig } = await import("../../commands/ci-validate.js");
		const result = await validateCIConfig(
			process.cwd(),
			cli.flags.config || undefined,
		);
		if (result.ok) {
			if (result.mode === "auto-detect") {
				if (cli.flags.json) {
					console.log(
						JSON.stringify(
							{ ok: true, mode: "auto-detect", runners: [] },
							null,
							2,
						),
					);
				} else {
					console.log(
						"✓ No .javi-forge/ci.yaml — auto-detect mode (no config to validate)",
					);
				}
			} else if (cli.flags.json) {
				console.log(
					JSON.stringify({ ok: true, runners: result.runners }, null, 2),
				);
			} else {
				console.log(`✓ CI config valid: ${result.configPath}`);
				console.log(`  ${result.runners.length} runner(s):`);
				for (const runner of result.runners) {
					console.log(`    - ${runner.name} (${runner.stack})`);
				}
			}
			process.exit(0);
		}
		if (cli.flags.json) {
			console.log(
				JSON.stringify({ ok: false, errors: result.errors }, null, 2),
			);
		} else {
			for (const err of result.errors) {
				console.error(`${err.path}: ${err.message}`);
			}
		}
		process.exit(1);
	}

	// Sub-command: javi-forge ci init → install git hooks
	if (cli.input[1] === "init") {
		const { installCIHooks } = await import("../../commands/ci.js");
		const { installed, upgraded, backups, errors, states } =
			await installCIHooks(process.cwd(), {
				force: cli.flags.force === true,
			});
		for (const backup of backups) {
			console.log(`⚠ Backed up the previous hook → ${backup}`);
		}
		if (installed.length > 0) {
			console.log(`✓ Installed git hooks: ${installed.join(", ")}`);
			console.log("  Hooks call javi-forge ci (with npx fallback)");
		}
		// Upgrades are reported DISTINCTLY from fresh installs: replacing an
		// older javi-forge hook is not the same event as writing a new one.
		for (const hook of upgraded) {
			const was = states.find((entry) => entry.name === hook)?.state;
			console.log(
				`↑ Upgraded ${hook}${was === undefined ? "" : ` (was ${was})`}`,
			);
		}
		for (const err of errors) {
			console.error(`✗ ${err}`);
		}
		process.exit(errors.length > 0 ? 1 : 0);
	}

	// Any other positional is an unknown subcommand — show ci usage, don't run
	// the pipeline against a typo.
	if (cli.input[1] !== undefined) {
		console.log(CI_HELP_TEXT);
		process.exit(1);
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
				config={cli.flags.config || undefined}
				stack={cli.flags.stack || undefined}
			/>
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}
