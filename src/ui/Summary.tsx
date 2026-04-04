import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect } from "react";
import type { InitStep } from "../types/index.js";
import { useCIMode } from "./CIContext.js";
import { theme } from "./theme.js";

interface Props {
	steps: InitStep[];
	dryRun: boolean;
	projectName: string;
	stack?: string;
	elapsedMs?: number;
}

/** Map stack to the install command hint */
function getInstallHint(stack?: string): string | null {
	switch (stack) {
		case "node":
			return "pnpm install";
		case "python":
			return "pip install -r requirements.txt";
		case "go":
			return "go mod tidy";
		case "rust":
			return "cargo build";
		case "java-gradle":
			return "./gradlew build";
		case "java-maven":
			return "mvn install";
		case "elixir":
			return "mix deps.get";
		default:
			return null;
	}
}

export default function Summary({
	steps,
	dryRun,
	projectName,
	stack,
	elapsedMs,
}: Props) {
	const { exit } = useApp();
	const isCI = useCIMode();

	const done = steps.filter((s) => s.status === "done").length;
	const skipped = steps.filter((s) => s.status === "skipped").length;
	const errors = steps.filter((s) => s.status === "error");
	const elapsed =
		elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : null;

	// Auto-exit in CI mode
	useEffect(() => {
		if (isCI) {
			const t = setTimeout(() => exit(), 100);
			return () => clearTimeout(t);
		}
		return undefined;
	}, [isCI, exit]);

	useInput(
		(_, key) => {
			if (key.return || key.escape) exit();
		},
		{ isActive: !isCI },
	);

	const installHint = getInstallHint(stack);

	return (
		<Box flexDirection="column">
			{/* Title */}
			<Text bold color={errors.length > 0 ? theme.warning : theme.success}>
				{dryRun ? "\u25cb Dry run complete" : "\u2713 Project scaffolded"}
				{elapsed && <Text color={theme.muted}> Completed in {elapsed}</Text>}
			</Text>

			{/* Project info */}
			<Box marginTop={1}>
				<Text color={theme.muted}> Project: </Text>
				<Text color={theme.primary} bold>
					{projectName}
				</Text>
				{stack && <Text color={theme.muted}> ({stack})</Text>}
			</Box>

			{/* Dry run note */}
			{dryRun && (
				<Box marginTop={1}>
					<Text color={theme.warning} bold>
						{" "}
						No changes were made (dry run)
					</Text>
				</Box>
			)}

			{/* Step details */}
			<Box marginTop={1} flexDirection="column">
				{steps.map((step) => (
					<Box key={step.id} marginLeft={2}>
						{step.status === "done" ? (
							<Text color={theme.success}>
								{"\u2713"} {step.label}
								{step.detail ? (
									<Text color={theme.muted} dimColor>
										{" "}
										{step.detail}
									</Text>
								) : null}
							</Text>
						) : step.status === "skipped" ? (
							<Text color={theme.muted}>
								{"\u2013"} {step.label}
								{step.detail ? <Text dimColor> {step.detail}</Text> : null}
							</Text>
						) : step.status === "error" ? (
							<Text color={theme.error}>
								{"\u2717"} {step.label}
								{step.detail ? (
									<Text color={theme.muted} dimColor>
										{" "}
										{step.detail}
									</Text>
								) : null}
							</Text>
						) : null}
					</Box>
				))}
			</Box>

			{/* Totals */}
			<Box marginTop={1} flexDirection="column">
				<Text color={theme.success}>
					{" "}
					{"\u2713"} {done} steps completed
				</Text>
				{skipped > 0 && (
					<Text color={theme.muted}>
						{" "}
						{"\u2013"} {skipped} steps skipped
					</Text>
				)}
				{errors.length > 0 && (
					<Box flexDirection="column">
						<Text color={theme.error}>
							{" "}
							{"\u2717"} {errors.length} errors:
						</Text>
						{errors.map((e) => (
							<Text key={`err-${e.id}`} color={theme.error}>
								{" "}
								{"\u2022"} {e.label}: {e.detail}
							</Text>
						))}
					</Box>
				)}
			</Box>

			{/* Next steps */}
			{!dryRun && errors.length === 0 && (
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.muted} bold>
						{" "}
						Next steps:
					</Text>
					<Text color={theme.primary}> cd {projectName}</Text>
					{installHint && <Text color={theme.primary}> {installHint}</Text>}
					<Text color={theme.primary}> npx javi-ai sync</Text>
					<Text color={theme.primary}> javi-forge doctor</Text>
				</Box>
			)}

			{/* Exit hint */}
			<Box marginTop={1}>
				<Text color={theme.muted} dimColor>
					Press Enter to exit
				</Text>
			</Box>
		</Box>
	);
}
