import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect, useState } from "react";
import {
	runPluginAdd,
	runPluginExport,
	runPluginExportCodex,
	runPluginExportGlobalSkillsJson,
	runPluginExportSkillsJson,
	runPluginImport,
	runPluginList,
	runPluginRemove,
	runPluginSearch,
	runPluginSync,
	runPluginValidate,
} from "../commands/plugin.js";
import type { InitStep } from "../types/index.js";
import { theme } from "./theme.js";

interface PluginProps {
	action:
		| "add"
		| "remove"
		| "list"
		| "search"
		| "validate"
		| "sync"
		| "export"
		| "import"
		| "export-skills";
	target?: string;
	dryRun: boolean;
	codex?: boolean;
}

const STATUS_ICON: Record<string, string> = {
	pending: "\u25cb",
	done: "\u2713",
	error: "\u2717",
	skipped: "\u2013",
};

const STATUS_COLOR: Record<string, string> = {
	pending: theme.muted,
	running: theme.warning,
	done: theme.success,
	error: theme.error,
	skipped: theme.muted,
};

export default function Plugin({
	action,
	target,
	dryRun,
	codex = false,
}: PluginProps) {
	const [steps, setSteps] = useState<InitStep[]>([]);
	const [done, setDone] = useState(false);

	const onStep = (step: InitStep) => {
		setSteps((prev) => {
			const idx = prev.findIndex((s) => s.id === step.id);
			if (idx >= 0) {
				const next = [...prev];
				next[idx] = step;
				return next;
			}
			return [...prev, step];
		});
	};

	useEffect(() => {
		const run = async () => {
			try {
				switch (action) {
					case "add":
						if (!target) {
							onStep({
								id: "err",
								label: "Error",
								status: "error",
								detail: "source required: javi-forge plugin add <org/repo>",
							});
							break;
						}
						await runPluginAdd(target, dryRun, onStep);
						break;
					case "remove":
						if (!target) {
							onStep({
								id: "err",
								label: "Error",
								status: "error",
								detail: "name required: javi-forge plugin remove <name>",
							});
							break;
						}
						await runPluginRemove(target, dryRun, onStep);
						break;
					case "list":
						await runPluginList(onStep);
						break;
					case "search":
						await runPluginSearch(target, onStep);
						break;
					case "validate":
						if (!target) {
							onStep({
								id: "err",
								label: "Error",
								status: "error",
								detail: "path required: javi-forge plugin validate <dir>",
							});
							break;
						}
						await runPluginValidate(target, onStep);
						break;
					case "sync":
						await runPluginSync(process.cwd(), dryRun, onStep);
						break;
					case "export":
						if (!target) {
							onStep({
								id: "err",
								label: "Error",
								status: "error",
								detail: "name required: javi-forge plugin export <name>",
							});
							break;
						}
						if (codex) {
							await runPluginExportCodex(target, onStep);
						} else {
							await runPluginExport(target, onStep);
						}
						break;
					case "import":
						if (!target) {
							onStep({
								id: "err",
								label: "Error",
								status: "error",
								detail: "path required: javi-forge plugin import <dir>",
							});
							break;
						}
						await runPluginImport(target, dryRun, onStep);
						break;
					case "export-skills":
						if (target === "global") {
							await runPluginExportGlobalSkillsJson(dryRun, onStep);
						} else {
							await runPluginExportSkillsJson(
								target ?? process.cwd(),
								dryRun,
								onStep,
							);
						}
						break;
				}
			} catch (e: unknown) {
				onStep({
					id: "fatal",
					label: "Fatal error",
					status: "error",
					detail: String(e),
				});
			}
			setDone(true);
		};
		run();
	}, [action, target, dryRun]);

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color={theme.primary}>
					javi-forge
				</Text>
				<Text> plugin {action}</Text>
				{dryRun && <Text color={theme.warning}> (dry-run)</Text>}
			</Box>

			{steps.map((step) => (
				<Box key={step.id} marginLeft={2}>
					{step.status === "running" ? (
						<Text color={theme.warning}>
							<Spinner type="dots" /> {step.label}
							{step.detail ? (
								<Text color={theme.muted} dimColor>
									{" "}
									{step.detail}
								</Text>
							) : null}
						</Text>
					) : (
						<Text color={STATUS_COLOR[step.status] as string}>
							{STATUS_ICON[step.status]} {step.label}
							{step.detail ? (
								<Text color={theme.muted} dimColor>
									{" "}
									{step.detail}
								</Text>
							) : null}
						</Text>
					)}
				</Box>
			))}

			{done && (
				<Box marginTop={1}>
					<Text color={theme.muted}>Done.</Text>
				</Box>
			)}
		</Box>
	);
}
