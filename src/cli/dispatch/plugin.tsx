import {
	createElement,
	type ReactElement,
	useEffect,
	useRef,
	useState,
} from "react";
import {
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
	return result.status === "success" ? 0 : 1;
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
		const onStep = (step: InitStep) => {
			setSteps((previous) => {
				const index = previous.findIndex((item) => item.id === step.id);
				if (index < 0) return [...previous, step];
				const next = [...previous];
				next[index] = step;
				return next;
			});
		};
		void runPluginCommand(initialRequest, onStep).then((outcome) => {
			process.exitCode = pluginCommandExitCode(outcome, process.exitCode);
			setResult(outcome);
		});
	}, [initialRequest]);

	return createElement(Plugin, {
		action: initialRequest.action ?? "list",
		dryRun: initialRequest.dryRun,
		steps,
		result,
	});
}
