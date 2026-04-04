import { Box, Text, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { detectStack, STACK_LABELS } from "../lib/common.js";
import type { Stack } from "../types/index.js";
import { useCIMode } from "./CIContext.js";
import { theme } from "./theme.js";

const ALL_STACKS: Stack[] = [
	"node",
	"python",
	"go",
	"rust",
	"java-gradle",
	"java-maven",
	"elixir",
];

interface Props {
	projectDir: string;
	onConfirm: (stack: Stack) => void;
}

export default function StackSelector({ projectDir, onConfirm }: Props) {
	const isCI = useCIMode();
	const autoConfirmed = useRef(false);
	const [cursor, setCursor] = useState(0);
	const [detectedStack, setDetectedStack] = useState<Stack | null>(null);
	const [detecting, setDetecting] = useState(true);

	useEffect(() => {
		detectStack(projectDir).then((result) => {
			if (result) {
				setDetectedStack(result.stackType);
				const idx = ALL_STACKS.indexOf(result.stackType);
				if (idx >= 0) setCursor(idx);
			}
			setDetecting(false);
		});
	}, [projectDir]);

	// Auto-confirm in CI mode once detection is done
	useEffect(() => {
		if (isCI && !detecting && !autoConfirmed.current) {
			autoConfirmed.current = true;
			onConfirm(ALL_STACKS[cursor]);
		}
	}, [isCI, detecting]); // eslint-disable-line react-hooks/exhaustive-deps

	useInput(
		(input, key) => {
			if (detecting) return;
			if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
			if (key.downArrow)
				setCursor((c) => Math.min(ALL_STACKS.length - 1, c + 1));
			if (key.return) {
				onConfirm(ALL_STACKS[cursor]);
			}
		},
		{ isActive: !isCI },
	);

	if (detecting) {
		return (
			<Box>
				<Text color={theme.muted}>Detecting project stack...</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text bold>Select project stack:</Text>
			{detectedStack && (
				<Text color={theme.success}>
					{"  "}Auto-detected: {STACK_LABELS[detectedStack]}
				</Text>
			)}

			<Box
				marginTop={1}
				flexDirection="column"
				borderStyle="single"
				borderLeft
				borderRight={false}
				borderTop={false}
				borderBottom={false}
				borderColor={theme.muted}
				paddingLeft={1}
			>
				{ALL_STACKS.map((stack, i) => (
					<Box key={stack}>
						<Text color={i === cursor ? theme.primary : "white"}>
							{i === cursor ? "\u25b6 " : "  "}
							{stack === detectedStack ? "\u25c9" : "\u25cb"}{" "}
							{STACK_LABELS[stack]}
							{stack === detectedStack && (
								<Text color={theme.success} dimColor>
									{" "}
									(detected)
								</Text>
							)}
						</Text>
					</Box>
				))}
			</Box>

			<Box marginTop={1} gap={2}>
				<Text color={theme.primary}>{STACK_LABELS[ALL_STACKS[cursor]]}</Text>
				<Text color={theme.muted} dimColor>
					{"\u2191\u2193"} navigate Enter confirm
				</Text>
			</Box>
		</Box>
	);
}
