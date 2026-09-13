#!/usr/bin/env node
import { chmodSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLI_BIN_MODE = 0o755;

export function defaultCliBinPath() {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
}

export function ensureExecutableFile(filePath) {
	const stats = statSync(filePath);
	if (!stats.isFile()) {
		throw new Error(`${filePath} is not a regular file`);
	}
	chmodSync(filePath, CLI_BIN_MODE);
}

function isDirectInvocation() {
	return (
		process.argv[1] !== undefined &&
		pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
	);
}

if (isDirectInvocation()) {
	try {
		ensureExecutableFile(process.argv[2] ?? defaultCliBinPath());
	} catch (error) {
		console.error(
			`ensure-bin-executable: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
