import { lstat } from "node:fs/promises";

export function leadingQuotedPath(command: string): string | undefined {
	if (!command.startsWith('"')) return undefined;
	let index = 1;
	while (index < command.length) {
		const char = command[index];
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === '"') {
			return JSON.parse(command.slice(0, index + 1)) as string;
		}
		index += 1;
	}
	return undefined;
}

export async function execPathIsFile(execPath: string): Promise<boolean> {
	try {
		const stat = await lstat(execPath);
		return stat.isFile();
	} catch {
		return false;
	}
}

export async function commandFormExecEvidence(options: {
	host: string;
	command: string | undefined;
	probeExecPath?: (execPath: string) => Promise<boolean>;
}): Promise<{ blockers: string[]; residual: string[] }> {
	const execPath =
		typeof options.command === "string"
			? leadingQuotedPath(options.command)
			: undefined;
	if (!execPath) {
		return {
			blockers: [
				`${options.host} hook command does not record a quoted execPath`,
			],
			residual: [],
		};
	}
	const probe = options.probeExecPath ?? execPathIsFile;
	if (!(await probe(execPath))) {
		return {
			blockers: [
				`${options.host} recorded execPath is not a file: ${execPath}`,
			],
			residual: [],
		};
	}
	return {
		blockers: [],
		residual: [
			`This process seeing the recorded execPath is not proof ${options.host} spawned the hook`,
		],
	};
}
