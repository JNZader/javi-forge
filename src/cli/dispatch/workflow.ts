/**
 * `javi-forge workflow <show|validate|list>` handler.
 *
 * Console-only (no Ink, no React, no CIContextProvider).
 * Lazy-loads ../../commands/workflow.js INSIDE the function to preserve
 * cold-start performance — heavy command modules MUST NOT be eager-imported
 * at the top of this file.
 */

import type { CLI } from "./types.js";

export async function handleWorkflow(cli: CLI): Promise<void> {
	const workflowAction = cli.input[1] as string | undefined;
	const VALID_WORKFLOW_ACTIONS = ["show", "validate", "list"];
	if (!workflowAction || !VALID_WORKFLOW_ACTIONS.includes(workflowAction)) {
		console.error("Usage: javi-forge workflow <show|validate|list>");
		console.error("  show      Render a workflow graph as ASCII");
		console.error(
			"  validate  Validate project state against a workflow graph",
		);
		console.error(
			"  list      List available workflows and built-in templates",
		);
		console.error("");
		console.error("  Options:");
		console.error(
			"    --template <name>  Use a built-in template (ci-pipeline, release, feature-flow)",
		);
		console.error("    <file>             Path to a .dot or .mermaid file");
		process.exit(1);
	}

	const { runWorkflowShow, runWorkflowValidate, runWorkflowList } =
		await import("../../commands/workflow.js");
	const workflowTarget = cli.input[2];
	const workflowTemplate = cli.flags.template || undefined;
	const onStep = (step: {
		id: string;
		label: string;
		status: string;
		detail?: string;
	}) => {
		const icon =
			step.status === "done"
				? "\u2713"
				: step.status === "error"
					? "\u2717"
					: "\u25CB";
		console.log(`${icon} ${step.label}`);
		if (step.detail) console.log(`  ${step.detail}`);
	};

	try {
		if (workflowAction === "show") {
			const output = await runWorkflowShow(process.cwd(), onStep, {
				target: workflowTarget,
				template: workflowTemplate,
			});
			if (output) console.log(`\n${output}`);
			else process.exit(1);
		} else if (workflowAction === "validate") {
			const output = await runWorkflowValidate(process.cwd(), onStep, {
				target: workflowTarget,
				template: workflowTemplate,
			});
			if (output) console.log(`\n${output}`);
			else process.exit(1);
		} else {
			const output = await runWorkflowList(process.cwd(), onStep);
			console.log(`\n${output}`);
		}
	} catch (e) {
		console.error(`\u2717 ${e instanceof Error ? e.message : String(e)}`);
		process.exit(1);
	}
}
