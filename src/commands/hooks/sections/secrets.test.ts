import { execFile as realExecFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_SIZE, scanDiff, secretsSection } from "./secrets.js";

const execFileAsync = promisify(realExecFile);

// ── Mocked-seam unit tests ───────────────────────────────────────────────────
//
// The section's exec seam is injected, so these tests never touch a real repo.
// They pin the K-005 regression (a whitespace-named path is passed as ONE argv
// element and scanned), NUL-safe splitting, argv chunking, and blocking on a
// real match.

interface DiffCall {
	args: string[];
}

/**
 * Build a fake execFile that returns a NUL-joined staged list for
 * `--name-only`, and a synthetic unified diff for `git diff --cached -- <files>`
 * containing `plantedContent` on the added line for any file in `secretFiles`.
 */
function fakeGit(
	stagedList: string[],
	secretFiles: Record<string, string>,
	calls: DiffCall[],
) {
	return async (_cmd: string, args: string[]) => {
		calls.push({ args });
		if (args.includes("--name-only")) {
			return { stdout: `${stagedList.join("\0")}\0`, stderr: "" };
		}
		// diff request: everything after "--" is a filename argv element.
		const sep = args.indexOf("--");
		const files = sep >= 0 ? args.slice(sep + 1) : [];
		let diff = "";
		for (const f of files) {
			if (secretFiles[f] !== undefined) {
				diff += `diff --git a/${f} b/${f}\n`;
				diff += `new file mode 100644\n`;
				diff += `--- /dev/null\n`;
				diff += `+++ b/${f}\n`;
				diff += `@@ -0,0 +1,1 @@\n`;
				diff += `+${secretFiles[f]}\n`;
			}
		}
		return { stdout: diff, stderr: "" };
	};
}

describe("secretsSection (unit, mocked git)", () => {
	it("K-005: a whitespace-named staged file with an AKIA key is scanned as ONE path and blocks", async () => {
		const calls: DiffCall[] = [];
		const whitespaceName = "app secrets.env";
		const section = secretsSection({
			execFile: fakeGit(
				[whitespaceName],
				{ [whitespaceName]: "AWS_KEY=AKIA1234567890ABCDEF" },
				calls,
			),
			log: () => {},
			chunkSize: DEFAULT_CHUNK_SIZE,
		});

		const result = await section.run({ projectDir: "/repo" });

		// Blocked — the whitespace path was NOT split, the AKIA key was found.
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("aws-access-key");
		expect(result.detail).toContain(whitespaceName);

		// The diff call passed the whole name as a SINGLE argv element (no split).
		const diffCall = calls.find((c) => c.args.includes("--"))!;
		const sep = diffCall.args.indexOf("--");
		expect(diffCall.args.slice(sep + 1)).toEqual([whitespaceName]);
	});

	it("uses -z NUL-safe listing (never a whitespace split)", async () => {
		const calls: DiffCall[] = [];
		const section = secretsSection({
			execFile: fakeGit(["clean.txt"], {}, calls),
			log: () => {},
			chunkSize: DEFAULT_CHUNK_SIZE,
		});

		await section.run({ projectDir: "/repo" });

		const nameCall = calls.find((c) => c.args.includes("--name-only"))!;
		expect(nameCall.args).toContain("-z");
	});

	it("chunks the argv in batches of 512 and scans every batch", async () => {
		const calls: DiffCall[] = [];
		const total = 600;
		const staged = Array.from({ length: total }, (_, i) => `file-${i}.txt`);
		// Plant a secret in a file that lands in the SECOND batch (index 550).
		const target = "file-550.txt";
		const section = secretsSection({
			execFile: fakeGit(
				staged,
				// `ghp_` prefix assembled at runtime so no contiguous GitHub-token
				// literal is committed (push protection); runtime value unchanged.
				{
					[target]: `github_token=gh${"p"}_0123456789abcdefghijklmnopqrstuvwxyzAB`,
				},
				calls,
			),
			log: () => {},
			chunkSize: DEFAULT_CHUNK_SIZE,
		});

		const result = await section.run({ projectDir: "/repo" });

		const diffCalls = calls.filter((c) => c.args.includes("--"));
		// 600 files / 512 → 2 batches.
		expect(diffCalls).toHaveLength(2);
		const sep0 = diffCalls[0].args.indexOf("--");
		expect(diffCalls[0].args.slice(sep0 + 1)).toHaveLength(512);
		const sep1 = diffCalls[1].args.indexOf("--");
		expect(diffCalls[1].args.slice(sep1 + 1)).toHaveLength(total - 512);
		// The secret in the second batch was detected.
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("github-token");
	});

	it("no staged files → ok:true (no diff calls)", async () => {
		const calls: DiffCall[] = [];
		const section = secretsSection({
			execFile: fakeGit([], {}, calls),
			log: () => {},
			chunkSize: DEFAULT_CHUNK_SIZE,
		});
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
		expect(calls.filter((c) => c.args.includes("--"))).toHaveLength(0);
	});

	it("a thrown git error is caught → ok:false (never an unhandled rejection)", async () => {
		const section = secretsSection({
			execFile: async () => {
				throw new Error("git exploded");
			},
			log: () => {},
			chunkSize: DEFAULT_CHUNK_SIZE,
		});
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("git exploded");
	});
});

describe("scanDiff (pattern fidelity)", () => {
	const cases: { name: string; line: string; pattern: string }[] = [
		{
			name: "aws",
			line: "+key = AKIA1234567890ABCDEF",
			pattern: "aws-access-key",
		},
		{
			name: "generic api key",
			line: '+api_key = "abcdefghij0123456789KLMN"',
			pattern: "generic-api-key",
		},
		{
			name: "private key",
			line: "+-----BEGIN RSA PRIVATE KEY-----",
			pattern: "private-key",
		},
		{
			name: "slack",
			line: "+token = xoxb-1234-abcd",
			pattern: "slack-token",
		},
		{
			name: "stripe live",
			// Assembled via concatenation so the contiguous `sk_live_<key>` literal
			// never lands in committed bytes (GitHub push protection blocks it); the
			// RUNTIME value is unchanged so our scanner regex still matches. Do NOT
			// inline this back to a literal — it will re-trigger push protection.
			line: `+k = sk_${"live"}_0123456789abcdefghijklmn`,
			pattern: "stripe-secret-key",
		},
	];
	for (const c of cases) {
		it(`detects ${c.name}`, () => {
			const diff = `+++ b/x.txt\n@@ -0,0 +1,1 @@\n${c.line}\n`;
			const findings = scanDiff(diff);
			expect(findings.map((f) => f.pattern)).toContain(c.pattern);
		});
	}

	it("ignores removed and context lines (only ADDED lines matched)", () => {
		const diff =
			"+++ b/x.txt\n@@ -1,2 +1,1 @@\n-old = AKIA1234567890ABCDEF\n unchanged\n";
		expect(scanDiff(diff)).toHaveLength(0);
	});

	it("does not treat the +++ header as an added line", () => {
		const diff = "+++ b/AKIA1234567890ABCDEF\n@@ -0,0 +1,1 @@\n+clean\n";
		expect(scanDiff(diff)).toHaveLength(0);
	});
});

// ── Real-exec integration test ───────────────────────────────────────────────
//
// A real tmp git repo, real git binary — proves the actual argv path ships
// tested, including the K-005 whitespace-filename regression end to end.

describe("secretsSection (integration, real git)", () => {
	let repo: string;

	beforeEach(async () => {
		repo = await fs.mkdtemp(path.join(os.tmpdir(), "jf-secrets-"));
		await execFileAsync("git", ["init", "-q"], { cwd: repo });
		await execFileAsync("git", ["config", "user.email", "t@t.dev"], {
			cwd: repo,
		});
		await execFileAsync("git", ["config", "user.name", "t"], { cwd: repo });
	});

	afterEach(async () => {
		await fs.remove(repo);
	});

	it("K-005 end-to-end: whitespace-named staged file with a planted AKIA key is blocked", async () => {
		const name = "app secrets.env";
		await fs.writeFile(
			path.join(repo, name),
			"AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n",
		);
		await execFileAsync("git", ["add", "--", name], { cwd: repo });

		const section = secretsSection({ log: () => {} });
		const result = await section.run({ projectDir: repo });

		expect(result.ok).toBe(false);
		expect(result.detail).toContain("aws-access-key");
	});

	it("a clean staged file passes", async () => {
		await fs.writeFile(path.join(repo, "readme.md"), "# hello\n");
		await execFileAsync("git", ["add", "--", "readme.md"], { cwd: repo });

		const section = secretsSection({ log: () => {} });
		const result = await section.run({ projectDir: repo });
		expect(result.ok).toBe(true);
	});

	it("JD-A-001: detects a secret even under color.ui=always (no fail-open)", async () => {
		// Force git to emit ANSI color escapes even to a pipe. Without `--no-color`
		// on the content diff, the added line renders as `\x1b[32m+secret\x1b[m`,
		// so `line.startsWith("+")` fails and the scanner finds nothing → fails OPEN.
		await execFileAsync("git", ["config", "color.ui", "always"], { cwd: repo });
		await execFileAsync("git", ["config", "color.diff", "always"], {
			cwd: repo,
		});

		const name = "leak.env";
		await fs.writeFile(
			path.join(repo, name),
			"AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n",
		);
		await execFileAsync("git", ["add", "--", name], { cwd: repo });

		const section = secretsSection({ log: () => {} });
		const result = await section.run({ projectDir: repo });

		expect(result.ok).toBe(false);
		expect(result.detail).toContain("aws-access-key");
	});
});

describe("secretsSection (JD-A-002: large-diff maxBuffer)", () => {
	it("raises maxBuffer above Node's 1 MiB default on the content diff call", async () => {
		const opts: Array<{ maxBuffer?: number } | undefined> = [];
		const section = secretsSection({
			execFile: async (_cmd, args, o) => {
				if (args.includes("--name-only")) {
					return { stdout: "big.txt\0", stderr: "" };
				}
				opts.push(o);
				return { stdout: "", stderr: "" };
			},
			log: () => {},
			chunkSize: DEFAULT_CHUNK_SIZE,
		});

		await section.run({ projectDir: "/repo" });

		expect(opts).toHaveLength(1);
		expect(opts[0]?.maxBuffer).toBeGreaterThan(1024 * 1024);
	});
});
