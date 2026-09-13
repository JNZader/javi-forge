// javi-forge-managed: opencode-skillguard v1
async function importPolicyRuntime() {
	try {
		return await import("./javi-forge-skillguard-pre-tool-use.mjs");
	} catch (error) {
		if (
			!isObject(error) ||
			!("code" in error) ||
			error.code !== "ERR_MODULE_NOT_FOUND"
		)
			throw error;
		return import("../claude-hooks/javi-forge-skillguard-pre-tool-use.mjs");
	}
}

const { AGENT_CONFIGS, evaluateEvent } = await importPolicyRuntime();

const TOOL_NAME_MAP = Object.freeze({
	apply_patch: "apply_patch",
	bash: "Bash",
	edit: "Edit",
	powershell: "PowerShell",
	pwsh: "PowerShell",
	read: "Read",
	shell: "Bash",
	write: "Write",
});

function isObject(value) {
	return typeof value === "object" && value !== null;
}

function firstString(...values) {
	for (const value of values) if (typeof value === "string") return value;
	return undefined;
}

function mapToolName(tool) {
	return typeof tool === "string" ? TOOL_NAME_MAP[tool] : undefined;
}

function normalizeOpenCodeToolEvent(input, output, fallbackCwd = process.cwd()) {
	const tool = mapToolName(input?.tool);
	if (tool === undefined) return null;
	const args = isObject(output?.args)
		? output.args
		: isObject(input?.input)
			? input.input
			: isObject(input?.args)
				? input.args
				: {};
	const cwd = firstString(args.cwd, input.cwd, input.directory, fallbackCwd);
	const toolInput =
		tool === "Bash" || tool === "PowerShell" || tool === "apply_patch"
			? { command: firstString(args.command, args.cmd) }
			: { file_path: firstString(args.file_path, args.filePath, args.path, args.file) };
	return {
		hook_event_name: "PreToolUse",
		tool_name: tool,
		tool_input: toolInput,
		cwd,
	};
}

export function evaluateOpenCodeToolEvent(
	input,
	output,
	fallbackCwd = process.cwd(),
) {
	const event = normalizeOpenCodeToolEvent(input, output, fallbackCwd);
	if (event === null) return { allowed: true };
	return evaluateEvent(event, AGENT_CONFIGS.opencode);
}

function denyMessage(toolName, decision) {
	const tool = typeof toolName === "string" ? toolName : "tool";
	return `javi-forge OpenCode denied ${tool} [${decision.ruleId ?? "unknown"}]: global guard policy denied the invocation`;
}

function failClosedMessage(error) {
	const id =
		error instanceof Error && /^[a-z-]+$/.test(error.message)
			? error.message
			: "internal-error";
	return `javi-forge OpenCode failed closed [${id}]: policy evaluation could not complete`;
}

export async function guardOpenCodeTool(input, output, fallbackCwd) {
	let decision;
	try {
		decision = evaluateOpenCodeToolEvent(input, output, fallbackCwd);
	} catch (error) {
		throw new Error(failClosedMessage(error));
	}
	if (!decision.allowed) throw new Error(denyMessage(input?.tool, decision));
}

function resolveFallbackCwd(ctx) {
	return firstString(
		ctx?.location?.project?.canonical,
		ctx?.location?.project?.directory,
		ctx?.worktree,
		ctx?.directory,
		process.cwd(),
	);
}

export async function JaviForgeSkillGuard(ctx = {}) {
	const fallbackCwd = resolveFallbackCwd(ctx);
	return {
		"tool.execute.before": async (input, output) =>
			guardOpenCodeTool(input, output, fallbackCwd),
	};
}

export default {
	id: "javi-forge.skillguard",
	async setup(ctx) {
		const fallbackCwd = resolveFallbackCwd(ctx);
		await ctx.tool.hook("execute.before", (event) =>
			guardOpenCodeTool(event, undefined, fallbackCwd),
		);
	},
	async server(ctx = {}) {
		return JaviForgeSkillGuard(ctx);
	},
};
