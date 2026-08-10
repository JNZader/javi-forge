import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";
import type { Stack } from "../types/index.js";
import { getDockerfileContent } from "./docker.js";

// =============================================================================
// Anti-drift parity suite (audit R2-001)
//
// There are FOUR sources of the runner Dockerfiles:
//   1. getDockerfileContent(stack)      — the canonical TS generator (runtime)
//   2. ci-local/ci-local.sh heredocs    — bash fallback generator
//   3. ci-local/ci-local.ps1 here-strings — PowerShell fallback generator
//   4. ci-local/docker/<stack>.Dockerfile — the committed, package-bundled files
//
// They have drifted before (java GRADLE_USER_HOME, go line-continuation — the
// same drift class as the stale-global/pnpm saga). This suite pins all four
// sources byte-identical per stack. getDockerfileContent is CANONICAL: any
// intentional change starts there and is propagated to the other three.
// =============================================================================

const repoRoot = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const ciLocalDir = path.join(repoRoot, "ci-local");
const dockerDir = path.join(ciLocalDir, "docker");

/**
 * Extract the Dockerfile heredoc bodies from ci-local.sh's create_dockerfile.
 * Matches `case` labels immediately followed by `cat > ... << 'DOCKERFILE'`,
 * so the other `case "$STACK_TYPE"` block (setup_ci_commands) never matches.
 * The `*` label is normalized to "default"; `a|b` labels map both keys.
 */
function extractShHeredocs(sh: string): Map<string, string> {
	const bodies = new Map<string, string>();
	const re =
		/^\s*([a-z-]+(?:\|[a-z-]+)*|\*)\)\n\s*cat > "\$docker_dir\/\$DOCKERFILE" << 'DOCKERFILE'\n([\s\S]*?)\nDOCKERFILE\n/gm;
	for (const m of sh.matchAll(re)) {
		const label = m[1] as string;
		const body = m[2] as string;
		const keys = label === "*" ? ["default"] : label.split("|");
		for (const key of keys) {
			bodies.set(key, body);
		}
	}
	return bodies;
}

/**
 * Extract the Dockerfile here-string bodies from ci-local.ps1's New-Dockerfile.
 * Matches switch labels (`'node' {`, `{ $_ -in 'a','b' } {`, `default {`)
 * immediately followed by a literal here-string `@'...'@`.
 */
function extractPs1HereStrings(ps1: string): Map<string, string> {
	const bodies = new Map<string, string>();
	const re =
		/^\s*(\{ \$_ -in [^}]+\}|'[a-z-]+'|default)\s*\{\s*\n@'\n([\s\S]*?)\n'@/gm;
	for (const m of ps1.matchAll(re)) {
		const label = m[1] as string;
		const body = m[2] as string;
		const keys =
			label === "default"
				? ["default"]
				: [...label.matchAll(/'([a-z-]+)'/g)].map((q) => q[1] as string);
		for (const key of keys) {
			bodies.set(key, body);
		}
	}
	return bodies;
}

/**
 * Per-stack parity cases. `key` is the generator case label in the shell
 * scripts ("default" = the `*`/default branch, which getDockerfileContent
 * reaches via the "elixir" stack — the only Stack value without a dedicated
 * template). `committed` is the bundled filename ensureImage resolves
 * (`${stack}.Dockerfile`).
 */
const CASES: ReadonlyArray<{ stack: Stack; key: string; committed: string }> = [
	{ stack: "node", key: "node", committed: "node.Dockerfile" },
	{ stack: "python", key: "python", committed: "python.Dockerfile" },
	{ stack: "go", key: "go", committed: "go.Dockerfile" },
	{ stack: "rust", key: "rust", committed: "rust.Dockerfile" },
	{
		stack: "java-gradle",
		key: "java-gradle",
		committed: "java-gradle.Dockerfile",
	},
	{
		stack: "java-maven",
		key: "java-maven",
		committed: "java-maven.Dockerfile",
	},
	{ stack: "elixir", key: "default", committed: "elixir.Dockerfile" },
];

describe("Dockerfile anti-drift parity (R2-001)", () => {
	let shBodies: Map<string, string>;
	let ps1Bodies: Map<string, string>;

	beforeAll(async () => {
		const sh = await fs.readFile(path.join(ciLocalDir, "ci-local.sh"), "utf-8");
		const ps1 = await fs.readFile(
			path.join(ciLocalDir, "ci-local.ps1"),
			"utf-8",
		);
		shBodies = extractShHeredocs(sh);
		ps1Bodies = extractPs1HereStrings(ps1);
	});

	it("extracts every generator branch from both shell scripts", () => {
		// 6 branches each: java (shared), node, python, go, rust, default.
		// java-gradle|java-maven maps to two keys → 7 map entries.
		const expectedKeys = [
			"java-gradle",
			"java-maven",
			"node",
			"python",
			"go",
			"rust",
			"default",
		];
		expect([...shBodies.keys()].sort()).toEqual([...expectedKeys].sort());
		expect([...ps1Bodies.keys()].sort()).toEqual([...expectedKeys].sort());
	});

	describe.each(CASES)("$stack", ({ stack, key, committed }) => {
		it("ci-local.sh heredoc matches getDockerfileContent", () => {
			expect(shBodies.get(key)).toBe(getDockerfileContent(stack));
		});

		it("ci-local.ps1 here-string matches getDockerfileContent", () => {
			expect(ps1Bodies.get(key)).toBe(getDockerfileContent(stack));
		});

		it(`bundled ci-local/docker/${committed} matches getDockerfileContent`, async () => {
			const file = path.join(dockerDir, committed);
			expect(
				await fs.pathExists(file),
				`${committed} must be committed so the package ships it (PKG-002)`,
			).toBe(true);
			const content = await fs.readFile(file, "utf-8");
			expect(content).toBe(`${getDockerfileContent(stack)}\n`);
		});
	});

	it("bundled java.Dockerfile (the shell scripts' shared filename) matches the java template", async () => {
		// ci-local.sh/.ps1 look up docker/java.Dockerfile for BOTH java stacks;
		// committing it keeps their first-run write-through from ever firing
		// inside an installed (possibly root-owned) package dir.
		const file = path.join(dockerDir, "java.Dockerfile");
		expect(await fs.pathExists(file)).toBe(true);
		const content = await fs.readFile(file, "utf-8");
		expect(content).toBe(`${getDockerfileContent("java-gradle")}\n`);
	});

	it("java-gradle and java-maven share one template", () => {
		expect(getDockerfileContent("java-gradle")).toBe(
			getDockerfileContent("java-maven"),
		);
	});
});
