import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

export interface CliCommand {
	executable: string;
	args: string[];
	mode: "dist" | "source";
}

export interface ProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ProcessOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeout?: number;
}

export function cliSubprocessEnv(
	overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		TMPDIR: process.env.TMPDIR,
		TMP: process.env.TMP,
		TEMP: process.env.TEMP,
		XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
		XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
		XDG_DATA_HOME: process.env.XDG_DATA_HOME,
		XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
		FORCE_COLOR: "0",
		CI: "1",
		NODE_OPTIONS: "",
		NODE_PATH: "",
		...overrides,
	};

	for (const key of Object.keys(env)) {
		if (key.startsWith("VITEST")) delete env[key];
	}

	return env;
}

export function runFileBackedProcess(
	executable: string,
	args: string[],
	options: ProcessOptions = {},
): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const ioRoot = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-e2e-io-"));
		const stdoutPath = path.join(ioRoot, "stdout");
		const stderrPath = path.join(ioRoot, "stderr");
		const stdoutFd = fs.openSync(stdoutPath, "w");
		const stderrFd = fs.openSync(stderrPath, "w");
		let settled = false;
		let timedOut = false;
		const cleanup = () => {
			for (const descriptor of [stdoutFd, stderrFd]) {
				try {
					fs.closeSync(descriptor);
				} catch {}
			}
			try {
				fs.rmSync(ioRoot, { recursive: true, force: true });
			} catch {}
		};
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				callback();
			} finally {
				cleanup();
			}
		};
		const child = spawn(executable, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", stdoutFd, stderrFd],
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeout ?? 30_000);
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) =>
			finish(() => {
				if (timedOut) {
					reject(
						new Error(`process timed out after ${options.timeout ?? 30_000}ms`),
					);
					return;
				}
				resolve({
					stdout: fs.readFileSync(stdoutPath, "utf8"),
					stderr: fs.readFileSync(stderrPath, "utf8"),
					exitCode: code ?? 1,
				});
			}),
		);
	});
}

export async function runCliSubprocess(
	args: string[],
	options: ProcessOptions = {},
): Promise<ProcessResult> {
	const command = await resolveCliCommand();
	return runFileBackedProcess(command.executable, [...command.args, ...args], {
		...options,
		env: cliSubprocessEnv(options.env),
	});
}

export async function resolveCliCommand(): Promise<CliCommand> {
	const sourceCommand: CliCommand = {
		executable: process.execPath,
		args: [
			"--import",
			path.resolve(__dirname, "../../node_modules/tsx/dist/loader.mjs"),
			path.resolve(__dirname, "../index.tsx"),
		],
		mode: "source",
	};

	if (process.env.JAVI_FORGE_E2E_CLI !== "dist") {
		return sourceCommand;
	}

	const distPath = path.resolve(__dirname, "../../dist/index.js");
	if (await fs.pathExists(distPath)) {
		return {
			executable: process.execPath,
			args: [distPath],
			mode: "dist",
		};
	}
	throw new Error(
		"JAVI_FORGE_E2E_CLI=dist requested but dist/index.js is absent",
	);
}
