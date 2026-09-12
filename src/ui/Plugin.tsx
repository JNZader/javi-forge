import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";
import type { PluginCommandResult } from "../commands/plugin.js";
import type { InitStep } from "../types/index.js";
import { theme } from "./theme.js";

interface PluginProps {
	action: string;
	dryRun: boolean;
	steps: readonly InitStep[];
	result: PluginCommandResult | null;
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

export default function Plugin({ action, dryRun, steps, result }: PluginProps) {
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

			{result && (
				<Box marginTop={1}>
					<Text
						color={result.status === "success" ? theme.success : theme.error}
					>
						{result.status === "success"
							? "Done."
							: result.status === "refused"
								? "Refused."
								: "Failed."}
					</Text>
				</Box>
			)}
		</Box>
	);
}
