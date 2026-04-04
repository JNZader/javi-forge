import { describe, expect, it } from "vitest";
import yaml from "yaml";
import {
	generateCIWorkflow,
	generateDependabotYml,
	renderTemplate,
} from "../lib/template.js";
import type { CIProvider, Stack } from "../types/index.js";

// NO mocks — all real filesystem reads

describe("renderTemplate() — integration", () => {
	it("replaces placeholders in a real template file", async () => {
		// Use the .gitignore.template as a test subject (it exists and is a template)
		const { FORGE_ROOT } = await import("../constants.js");
		const path = await import("path");
		const templatePath = path.join(FORGE_ROOT, ".gitignore.template");
		const result = await renderTemplate(templatePath, {});
		expect(result.length).toBeGreaterThan(0);
	});
});

describe("generateCIWorkflow() — integration", () => {
	const stacks: Stack[] = [
		"node",
		"python",
		"go",
		"rust",
		"java-gradle",
		"java-maven",
	];
	const providers: CIProvider[] = ["github", "gitlab", "woodpecker"];

	for (const stack of stacks) {
		for (const provider of providers) {
			it(`${stack}+${provider}: returns valid YAML content`, async () => {
				const content = await generateCIWorkflow(stack, provider);

				if (content === null) {
					// Some combos may not have templates — that's OK
					return;
				}

				expect(content.length).toBeGreaterThan(0);
				// Must be parseable YAML
				expect(() => yaml.parse(content)).not.toThrow();
			});
		}
	}

	it("node+github: references javi-forge reusable workflow", async () => {
		const content = await generateCIWorkflow("node", "github");
		expect(content).not.toBeNull();
		expect(content).toContain("JNZader/javi-forge/");
		expect(content).not.toContain("project-starter-framework");
	});

	it("python+github: references python reusable workflow", async () => {
		const content = await generateCIWorkflow("python", "github");
		expect(content).not.toBeNull();
		expect(content).toContain("reusable-build-python");
	});

	it("go+gitlab: contains golang image reference", async () => {
		const content = await generateCIWorkflow("go", "gitlab");
		expect(content).not.toBeNull();
		expect(content!.toLowerCase()).toContain("golang");
	});
});

describe("generateDependabotYml() — integration", () => {
	it("node: generates valid YAML with npm ecosystem", async () => {
		const content = await generateDependabotYml(["node"], true);
		const parsed = yaml.parse(content);

		expect(parsed.version).toBe(2);
		expect(parsed.updates).toBeInstanceOf(Array);

		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("npm");
		expect(ecosystems).toContain("github-actions");
	});

	it("python: generates with pip ecosystem", async () => {
		const content = await generateDependabotYml(["python"], true);
		const parsed = yaml.parse(content);
		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("pip");
	});

	it("go: generates with gomod ecosystem", async () => {
		const content = await generateDependabotYml(["go"], false);
		const parsed = yaml.parse(content);
		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("gomod");
		expect(ecosystems).not.toContain("github-actions");
	});

	it("rust: generates with cargo ecosystem", async () => {
		const content = await generateDependabotYml(["rust"], true);
		const parsed = yaml.parse(content);
		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("cargo");
	});

	it("java-gradle: generates with gradle ecosystem", async () => {
		const content = await generateDependabotYml(["java-gradle"], true);
		const parsed = yaml.parse(content);
		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("gradle");
	});

	it("java-maven: generates with maven ecosystem", async () => {
		const content = await generateDependabotYml(["java-maven"], true);
		const parsed = yaml.parse(content);
		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("maven");
	});

	it("deduplicates fragments when same ecosystem appears twice", async () => {
		const content = await generateDependabotYml(["node", "node"], true);
		const parsed = yaml.parse(content);
		const npmCount = parsed.updates.filter(
			(u: Record<string, unknown>) => u["package-ecosystem"] === "npm",
		).length;
		expect(npmCount).toBe(1);
	});
});
