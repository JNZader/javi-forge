import { Box } from "ink";
import path from "path";
import React, { useState } from "react";
import { initProject } from "../commands/init.js";
import type {
	CIProvider,
	HookProfile,
	InitStep,
	MemoryOption,
	Stack,
} from "../types/index.js";
import CISelector from "./CISelector.js";
import Header from "./Header.js";
import HookProfileSelector from "./HookProfileSelector.js";
import MemorySelector from "./MemorySelector.js";
import NameInput from "./NameInput.js";
import OptionSelector from "./OptionSelector.js";
import Progress from "./Progress.js";
import StackSelector from "./StackSelector.js";
import Summary from "./Summary.js";
import Welcome from "./Welcome.js";

type Stage =
	| "welcome"
	| "name"
	| "stack"
	| "ci"
	| "memory"
	| "options"
	| "hook-profile"
	| "running"
	| "done";

interface AppProps {
	dryRun?: boolean;
	presetStack?: Stack;
	presetCI?: CIProvider;
	presetMemory?: MemoryOption;
	presetName?: string;
	presetGhagga?: boolean;
	presetMock?: boolean;
	presetLocalAi?: boolean;
	presetHookProfile?: HookProfile;
}

export default function App({
	dryRun = false,
	presetStack,
	presetCI,
	presetMemory,
	presetName,
	presetGhagga = false,
	presetMock = false,
	presetLocalAi = false,
	presetHookProfile,
}: AppProps) {
	const [stage, setStage] = useState<Stage>("welcome");
	const [projectName, setProjectName] = useState(presetName ?? "");
	const [projectDir, setProjectDir] = useState(
		presetName ? path.resolve(process.cwd(), presetName) : "",
	);
	const [stack, setStack] = useState<Stack>(presetStack ?? "node");
	const [ciProvider, setCIProvider] = useState<CIProvider>(
		presetCI ?? "github",
	);
	const [memory, setMemory] = useState<MemoryOption>(presetMemory ?? "engram");
	const [aiSync, setAiSync] = useState(true);
	const [sdd, setSdd] = useState(true);
	const [contextDir, setContextDir] = useState(true);
	const [claudeMd, setClaudeMd] = useState(true);
	const [ghagga, setGhagga] = useState(presetGhagga);
	const [securityHooks, setSecurityHooks] = useState(true);
	const [hookProfile, setHookProfile] = useState<HookProfile>(
		presetHookProfile ?? "standard",
	);
	const [codeGraph, setCodeGraph] = useState(false);
	const [localAi, setLocalAi] = useState(false);
	const [steps, setSteps] = useState<InitStep[]>([]);
	const [startTime] = useState(Date.now());

	const handleNameConfirm = (name: string, dir: string) => {
		setProjectName(name);
		setProjectDir(dir);
		setStage(presetStack ? "ci" : "stack");
	};

	const handleStackConfirm = (s: Stack) => {
		setStack(s);
		setStage(presetCI ? "memory" : "ci");
	};

	const handleCIConfirm = (p: CIProvider) => {
		setCIProvider(p);
		setStage(presetMemory ? "options" : "memory");
	};

	const handleMemoryConfirm = (m: MemoryOption) => {
		setMemory(m);
		setStage("options");
	};

	const handleOptionsConfirm = (opts: {
		aiSync: boolean;
		sdd: boolean;
		contextDir: boolean;
		claudeMd: boolean;
		ghagga: boolean;
		securityHooks: boolean;
		codeGraph: boolean;
		localAi: boolean;
	}) => {
		setAiSync(opts.aiSync);
		setSdd(opts.sdd);
		setContextDir(opts.contextDir);
		setClaudeMd(opts.claudeMd);
		setGhagga(opts.ghagga);
		setSecurityHooks(opts.securityHooks);
		setCodeGraph(opts.codeGraph);
		setLocalAi(opts.localAi);
		// If securityHooks is selected, ask for profile; otherwise skip to running
		if (opts.securityHooks) {
			setStage("hook-profile");
		} else {
			void runInit({ ...opts, hookProfile });
		}
	};

	const handleHookProfileConfirm = (profile: HookProfile) => {
		setHookProfile(profile);
		void runInit({
			aiSync,
			sdd,
			contextDir,
			claudeMd,
			ghagga,
			securityHooks,
			codeGraph,
			localAi,
			hookProfile: profile,
		});
	};

	const runInit = async (opts: {
		aiSync: boolean;
		sdd: boolean;
		contextDir: boolean;
		claudeMd: boolean;
		ghagga: boolean;
		securityHooks: boolean;
		codeGraph: boolean;
		localAi: boolean;
		hookProfile: HookProfile;
	}) => {
		setStage("running");

		await initProject(
			{
				projectName,
				projectDir,
				stack,
				ciProvider,
				memory,
				aiSync: opts.aiSync,
				sdd: opts.sdd,
				ghagga: opts.ghagga,
				contextDir: opts.contextDir,
				claudeMd: opts.claudeMd,
				securityHooks: opts.securityHooks,
				hookProfile: opts.hookProfile,
				codeGraph: opts.codeGraph,
				localAi: opts.localAi,
				dockerDeploy: false,
				dockerServiceName: "app",
				mock: presetMock,
				dryRun,
			},
			(step) =>
				setSteps((prev) => {
					const idx = prev.findIndex((s) => s.id === step.id);
					if (idx >= 0) {
						const next = [...prev];
						next[idx] = step;
						return next;
					}
					return [...prev, step];
				}),
		);

		setStage("done");
	};

	const subtitle =
		stage === "running"
			? "scaffolding..."
			: stage === "done"
				? "complete"
				: undefined;

	return (
		<Box flexDirection="column" padding={1}>
			{stage !== "welcome" && <Header subtitle={subtitle} dryRun={dryRun} />}

			{stage === "welcome" && (
				<Welcome
					onDone={() => {
						// Skip stages for which presets are already provided
						if (presetName && presetStack && presetCI && presetMemory) {
							setStage("options");
						} else if (presetName && presetStack && presetCI) {
							setStage("memory");
						} else if (presetName && presetStack) {
							setStage("ci");
						} else if (presetName) {
							setStage("stack");
						} else {
							setStage("name");
						}
					}}
				/>
			)}
			{stage === "name" && (
				<NameInput
					defaultName={projectName || "my-project"}
					onConfirm={handleNameConfirm}
				/>
			)}
			{stage === "stack" && (
				<StackSelector
					projectDir={projectDir || process.cwd()}
					onConfirm={handleStackConfirm}
				/>
			)}
			{stage === "ci" && <CISelector onConfirm={handleCIConfirm} />}
			{stage === "memory" && <MemorySelector onConfirm={handleMemoryConfirm} />}
			{stage === "options" && (
				<OptionSelector
					onConfirm={handleOptionsConfirm}
					presetGhagga={presetGhagga}
					presetLocalAi={presetLocalAi}
				/>
			)}
			{stage === "hook-profile" && (
				<HookProfileSelector
					onConfirm={handleHookProfileConfirm}
					presetProfile={presetHookProfile}
				/>
			)}
			{stage === "running" && (
				<Progress
					steps={steps}
					projectName={projectName}
					contextLine={`${projectName} (${stack} + ${ciProvider})`}
					onDone={() => setStage("done")}
				/>
			)}
			{stage === "done" && (
				<Summary
					steps={steps}
					dryRun={dryRun}
					projectName={projectName}
					stack={stack}
					elapsedMs={Date.now() - startTime}
				/>
			)}
		</Box>
	);
}
