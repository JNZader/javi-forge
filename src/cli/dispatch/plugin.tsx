import {
	createElement,
	type ReactElement,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	PLUGIN_COMMAND_STATUS,
	type PluginCommandRequest,
	type PluginCommandResult,
	runPluginCommand,
} from "../../commands/plugin.js";
import type { InitStep } from "../../types/index.js";
import Plugin from "../../ui/Plugin.js";

/** Preserve an earlier CLI failure, even when this request succeeds. */
export function pluginCommandExitCode(
	result: PluginCommandResult,
	previous: typeof process.exitCode = undefined,
): typeof process.exitCode {
	if (previous !== undefined && previous !== 0 && previous !== "0")
		return previous;
	return result.status === PLUGIN_COMMAND_STATUS.SUCCESS ? 0 : 1;
}

function abortSearch(
	signal: NodeJS.Signals,
	controller: AbortController,
): void {
	if (controller.signal.aborted) return;
	controller.abort();
	if (signal === "SIGINT") process.exitCode = 130;
	if (signal === "SIGTERM") process.exitCode = 143;
}

/** One mounted controller is one CLI invocation, never a retry or retarget. */
export default function PluginController({
	request,
}: {
	request: PluginCommandRequest;
}): ReactElement {
	const initialRequest = useRef({ ...request }).current;
	const started = useRef(false);
	const [steps, setSteps] = useState<InitStep[]>([]);
	const [result, setResult] = useState<PluginCommandResult | null>(null);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		const controller =
			initialRequest.action === "search" ? new AbortController() : undefined;
		const sigintHandler =
			controller === undefined
				? undefined
				: () => abortSearch("SIGINT", controller);
		const sigtermHandler =
			controller === undefined
				? undefined
				: () => abortSearch("SIGTERM", controller);
		if (sigintHandler) process.on("SIGINT", sigintHandler);
		if (sigtermHandler) process.on("SIGTERM", sigtermHandler);

		const onStep = (step: InitStep) => {
			setSteps((previous) => {
				const index = previous.findIndex((item) => item.id === step.id);
				if (index < 0) return [...previous, step];
				const next = [...previous];
				next[index] = step;
				return next;
			});
		};
		void runPluginCommand(
			{ ...initialRequest, signal: controller?.signal },
			onStep,
		).then((outcome) => {
			process.exitCode = pluginCommandExitCode(outcome, process.exitCode);
			setResult(outcome);
		});

		return () => {
			if (sigintHandler) process.removeListener("SIGINT", sigintHandler);
			if (sigtermHandler) process.removeListener("SIGTERM", sigtermHandler);
		};
	}, [initialRequest]);

	return createElement(Plugin, {
		action: initialRequest.action ?? "list",
		dryRun: initialRequest.dryRun,
		steps,
		result,
	});
}
