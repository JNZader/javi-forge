import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Promisified `execFile` for shelling out to subprocesses with arguments
 * (safer than `exec` because arguments are NOT shell-interpreted).
 *
 * Centralized helper used across the codebase by command modules and
 * init steps that invoke external CLIs (git, javi-ai, etc.).
 */
export const execFileAsync = promisify(execFile);
