/**
 * Trivial Ink renderers for CLI subcommands.
 *
 * Each handler is a thin wrapper around `render(<Provider><Component .../></Provider>)`.
 * Grouped here because the bodies are 5-10 LOC apiece and share the same shape.
 *
 * Ink + React are already eagerly imported at the entrypoint, so importing the
 * concrete UI components at the top of this file does NOT worsen cold-start.
 */

import { render } from "ink";
import React from "react";
import type { CIProvider, MemoryOption, Stack } from "../../types/index.js";
import AnalyzeUI from "../../ui/AnalyzeUI.js";
import App from "../../ui/App.js";
import { CIProvider as CIContextProvider } from "../../ui/CIContext.js";
import Doctor from "../../ui/Doctor.js";
import LlmsTxt from "../../ui/LlmsTxt.js";
import Plugin from "../../ui/Plugin.js";
import { VALID_CI, VALID_MEMORY, VALID_STACKS } from "../runtime.js";
import type { CLI, RendererCtx } from "./types.js";

export function handleDoctor(_cli: CLI, ctx: RendererCtx): void {
	render(
		<CIContextProvider isCI={ctx.isCI}>
			<Doctor />
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}

export function handleAnalyze(cli: CLI, ctx: RendererCtx): void {
	render(
		<CIContextProvider isCI={ctx.isCI}>
			<AnalyzeUI dryRun={cli.flags.dryRun} />
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}

export function handleLlmsTxt(cli: CLI, ctx: RendererCtx): void {
	render(
		<CIContextProvider isCI={ctx.isCI}>
			<LlmsTxt projectDir={process.cwd()} dryRun={cli.flags.dryRun} />
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}

export function handlePlugin(cli: CLI, ctx: RendererCtx): void {
	const pluginAction = cli.input[1] as
		| "add"
		| "remove"
		| "list"
		| "search"
		| "validate"
		| "sync"
		| "export"
		| "import"
		| "export-skills"
		| undefined;
	const VALID_PLUGIN_ACTIONS = [
		"add",
		"remove",
		"list",
		"search",
		"validate",
		"sync",
		"export",
		"import",
		"export-skills",
	];
	const action =
		pluginAction && VALID_PLUGIN_ACTIONS.includes(pluginAction)
			? pluginAction
			: "list";
	const target = cli.input[2];

	render(
		<CIContextProvider isCI={ctx.isCI}>
			<Plugin
				action={action}
				target={target}
				dryRun={cli.flags.dryRun}
				codex={cli.flags.codex}
			/>
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}

export function handleInitDefault(cli: CLI, ctx: RendererCtx): void {
	const presetStack = VALID_STACKS.includes(cli.flags.stack)
		? (cli.flags.stack as Stack)
		: undefined;
	const presetCI = VALID_CI.includes(cli.flags.ci)
		? (cli.flags.ci as CIProvider)
		: undefined;
	const presetMemory = VALID_MEMORY.includes(cli.flags.memory)
		? (cli.flags.memory as MemoryOption)
		: undefined;
	const presetName = cli.flags.projectName || undefined;

	render(
		<CIContextProvider isCI={ctx.isCI}>
			<App
				dryRun={cli.flags.dryRun}
				presetStack={presetStack}
				presetCI={presetCI}
				presetMemory={presetMemory}
				presetName={presetName}
				presetGhagga={cli.flags.ghagga}
				presetMock={cli.flags.mock ?? false}
				presetLocalAi={cli.flags.localAi ?? false}
			/>
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}
