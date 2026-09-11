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
import { resolvePlatformSupport } from "../../lib/platform-support.js";
import type { CIProvider, MemoryOption, Stack } from "../../types/index.js";
import AnalyzeUI from "../../ui/AnalyzeUI.js";
import App from "../../ui/App.js";
import { CIProvider as CIContextProvider } from "../../ui/CIContext.js";
import LlmsTxt from "../../ui/LlmsTxt.js";
import { VALID_CI, VALID_MEMORY, VALID_STACKS } from "../validators.js";
import DoctorController from "./doctor.js";
import PluginController from "./plugin.js";
import type { CLI, RendererCtx } from "./types.js";

export interface RendererDeps {
	platform?: string;
	render?: typeof render;
	error?: (message: string) => void;
	setExitCode?: (code: number) => void;
}

export function handleDoctor(
	cli: CLI,
	ctx: RendererCtx,
	deps: RendererDeps = {},
): void {
	const platformSupport = resolvePlatformSupport(
		deps.platform ?? process.platform,
	);
	if (platformSupport) {
		(deps.error ?? console.error)(
			`${platformSupport.refusalCode}: ${platformSupport.guidance}`,
		);
		(
			deps.setExitCode ??
			((code) => {
				process.exitCode = code;
			})
		)(1);
		return;
	}
	(deps.render ?? render)(
		<CIContextProvider isCI={ctx.isCI}>
			<DoctorController
				dryRun={cli.flags.dryRun}
				refreshContext={cli.flags.refreshContext}
			/>
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
	render(
		<CIContextProvider isCI={ctx.isCI}>
			<PluginController
				request={{
					action: cli.input[1],
					target: cli.input[2],
					projectDir: process.cwd(),
					dryRun: cli.flags.dryRun,
					codex: cli.flags.codex,
					force: cli.flags.force,
				}}
			/>
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}

export function handleInitDefault(cli: CLI, ctx: RendererCtx): void {
	const platformSupport = resolvePlatformSupport(process.platform);
	if (platformSupport) {
		console.error(
			`${platformSupport.refusalCode}: ${platformSupport.guidance}`,
		);
		process.exitCode = 1;
		return;
	}
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
