import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { bootstrapCli } from "./bootstrap.js";

describe("bootstrapCli", () => {
	it.each([
		"linux",
		"win32",
	])("resolves package metadata from both %s CLI layouts", (platform) => {
		const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
		const repositoryPackage = path.resolve(cliDirectory, "../../package.json");
		const source = fs.readFileSync(path.join(cliDirectory, "main.ts"), "utf8");
		const packageSpecifier = source.match(
			/_require\("([^"]*package\.json)"\)/,
		)?.[1];

		expect(platform).toMatch(/linux|win32/);
		expect(packageSpecifier).toBeDefined();
		expect(path.resolve(cliDirectory, packageSpecifier ?? "")).toBe(
			repositoryPackage,
		);
		expect(
			path.resolve(
				path.join(path.dirname(repositoryPackage), "dist", "cli"),
				packageSpecifier ?? "",
			),
		).toBe(repositoryPackage);
	});

	it.each([
		"darwin",
		"freebsd",
		"unknown",
	])("refuses %s before loading the supported CLI", async (platform) => {
		const load = vi.fn();
		const refuse = vi.fn();
		expect(await bootstrapCli(platform, load, refuse)).toEqual({
			state: "unsupported-platform",
			exitCode: 1,
		});
		expect(load).not.toHaveBeenCalled();
		expect(refuse).toHaveBeenCalledWith(
			expect.stringContaining("unsupported-platform"),
		);
	});
});
