import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect } from "react";
import { useCIMode } from "./CIContext.js";
import Header from "./Header.js";
import { theme } from "./theme.js";

interface Props {
	onDone: () => void;
}

export default function Welcome({ onDone }: Props) {
	const isCI = useCIMode();

	useEffect(() => {
		// Skip welcome delay in CI mode
		const timer = setTimeout(onDone, isCI ? 0 : 1500);
		return () => clearTimeout(timer);
	}, [onDone, isCI]);

	return (
		<Box flexDirection="column" padding={1}>
			<Header />

			<Box flexDirection="column" marginTop={1} marginLeft={2}>
				<Text>Bootstrap AI-ready projects with:</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						<Text color={theme.primary}>{"\u25c6"} Templates </Text>
						<Text color={theme.muted}> Go, Java, Node, Python, Rust CI</Text>
					</Text>
					<Text>
						<Text color={theme.success}>{"\u25c6"} Memory </Text>
						<Text color={theme.muted}> Engram, Obsidian Brain</Text>
					</Text>
					<Text>
						<Text color={theme.accent}>{"\u25c6"} SDD </Text>
						<Text color={theme.muted}> Spec-Driven Development</Text>
					</Text>
					<Text>
						<Text color={theme.warning}>{"\u25c6"} Review </Text>
						<Text color={theme.muted}> GHAGGA code review</Text>
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.muted}>
						<Spinner type="dots" /> Detecting your environment...
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
