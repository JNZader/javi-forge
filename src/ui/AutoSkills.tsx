import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import React, { useCallback, useEffect, useState } from "react";
import type { SkillInstallResult } from "../lib/auto-skill-install.js";
import { autoInstallSkills } from "../lib/auto-skill-install.js";
import { useCIMode } from "./CIContext.js";
import Header from "./Header.js";
import { theme } from "./theme.js";

interface AutoSkillsProps {
	projectDir: string;
	skillsDir?: string;
	dryRun?: boolean;
}

export default function AutoSkills({
	projectDir,
	skillsDir,
	dryRun,
}: AutoSkillsProps) {
	const { exit } = useApp();
	const isCI = useCIMode();
	const [result, setResult] = useState<SkillInstallResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const runDetection = useCallback(() => {
		setLoading(true);
		setResult(null);
		setError(null);
		autoInstallSkills({
			projectDir,
			skillsSourceDir: skillsDir,
			skillsTargetDir: skillsDir,
			dryRun: dryRun ?? false,
		})
			.then((r) => {
				setResult(r);
				setLoading(false);
			})
			.catch((e) => {
				setError(String(e));
				setLoading(false);
			});
	}, [projectDir, skillsDir, dryRun]);

	useEffect(() => {
		runDetection();
	}, [runDetection]);

	// Auto-exit in CI mode once loading finishes
	useEffect(() => {
		if (isCI && !loading) {
			const t = setTimeout(() => exit(), 100);
			return () => clearTimeout(t);
		}
		return undefined;
	}, [isCI, loading, exit]);

	useInput(
		(input, key) => {
			if (input.toLowerCase() === "r") runDetection();
			if (input.toLowerCase() === "q" || key.return || key.escape) exit();
		},
		{ isActive: !isCI },
	);

	const totalSkills = result
		? result.installed.length + result.skipped.length + result.notFound.length
		: 0;

	return (
		<Box flexDirection="column" padding={1}>
			<Header subtitle="skills auto" dryRun={dryRun} />

			{loading && (
				<Text color={theme.warning}>
					<Spinner type="dots" />
					{" Detecting project stack..."}
				</Text>
			)}

			{error && (
				<Text color={theme.error}>
					{"\u2717"} Error: {error}
				</Text>
			)}

			{result && (
				<Box flexDirection="column">
					{/* Stack Detection */}
					<Box flexDirection="column" marginBottom={1}>
						<Text bold color={theme.primary}>
							{"  "}Stack Detection
						</Text>
						<Box marginLeft={2}>
							<Text
								color={result.detection.stack ? theme.success : theme.warning}
							>
								{result.detection.stack ? "\u2713" : "\u2717"}{" "}
								{result.detection.stack
									? `Detected: ${result.detection.stack}`
									: "No stack detected"}
							</Text>
						</Box>
					</Box>

					{/* Signals */}
					{result.detection.signals.length > 0 && (
						<Box flexDirection="column" marginBottom={1}>
							<Text bold color={theme.primary}>
								{"  "}Signals ({result.detection.signals.length})
							</Text>
							{result.detection.signals.map((s, i) => (
								<Box key={`signal-${i}`} marginLeft={4}>
									<Text color={theme.muted}>{s.signal}</Text>
									<Text dimColor color={theme.muted}>
										{"  "}via {s.source}
									</Text>
									<Text color={theme.accent}>
										{"  \u2192 "}
										{s.skills.join(", ")}
									</Text>
								</Box>
							))}
						</Box>
					)}

					{/* Skills Summary */}
					<Box flexDirection="column" marginBottom={1}>
						<Text bold color={theme.primary}>
							{"  "}Skills ({totalSkills})
						</Text>

						{result.installed.length > 0 && (
							<Box flexDirection="column">
								{result.installed.map((name) => (
									<Box key={name} marginLeft={4}>
										<Text color={theme.success}>
											{dryRun ? "\u25CB" : "\u2713"} {name}
										</Text>
										<Text dimColor color={theme.muted}>
											{"  "}
											{dryRun ? "would install" : "installed"}
										</Text>
									</Box>
								))}
							</Box>
						)}

						{result.skipped.length > 0 && (
							<Box flexDirection="column">
								{result.skipped.map((name) => (
									<Box key={name} marginLeft={4}>
										<Text color={theme.muted}>
											{"\u2500"} {name}
										</Text>
										<Text dimColor color={theme.muted}>
											{"  "}already present
										</Text>
									</Box>
								))}
							</Box>
						)}

						{result.notFound.length > 0 && (
							<Box flexDirection="column">
								{result.notFound.map((name) => (
									<Box key={name} marginLeft={4}>
										<Text color={theme.warning}>
											{"?"} {name}
										</Text>
										<Text dimColor color={theme.warning}>
											{"  "}not found in source
										</Text>
									</Box>
								))}
							</Box>
						)}

						{totalSkills === 0 && (
							<Box marginLeft={4}>
								<Text color={theme.muted}>
									No skills recommended for this stack
								</Text>
							</Box>
						)}
					</Box>
				</Box>
			)}

			{/* Bottom hint */}
			{!loading && (
				<Box marginTop={1}>
					<Text color={theme.muted} dimColor>
						Press r to re-scan, q to quit
					</Text>
				</Box>
			)}
		</Box>
	);
}
