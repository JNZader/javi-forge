import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	maskSecret,
	SECRET_PATTERNS,
	scanContent,
	scanDirectory,
	shouldScanFile,
	shouldSkipDir,
} from "../secret-scanner.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-test-"));
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

// ── Pattern coverage ──

describe("SECRET_PATTERNS", () => {
	it("has at least 20 patterns", () => {
		expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(20);
	});

	it("every pattern has id, label, pattern, severity", () => {
		for (const p of SECRET_PATTERNS) {
			expect(p.id).toBeTruthy();
			expect(p.label).toBeTruthy();
			expect(p.pattern).toBeInstanceOf(RegExp);
			expect(["critical", "high", "medium"]).toContain(p.severity);
		}
	});
});

// ── Pattern detection (real examples) ──

describe("pattern detection", () => {
	it("detects AWS Access Key", () => {
		const findings = scanContent("AKIAIOSFODNN7EXAMPLE", "env.txt");
		expect(findings.some((f) => f.patternId === "aws-access-key")).toBe(true);
	});

	it("detects GitHub PAT (ghp_)", () => {
		const token = `ghp_${"A".repeat(36)}`;
		const findings = scanContent(`token = ${token}`, ".env");
		expect(findings.some((f) => f.patternId === "github-pat")).toBe(true);
	});

	it("detects GitHub Fine-Grained PAT", () => {
		const pat = `github_pat_${"A".repeat(22)}_${"B".repeat(59)}`;
		const findings = scanContent(`TOKEN=${pat}`, "config.ts");
		expect(findings.some((f) => f.patternId === "github-fine-pat")).toBe(true);
	});

	it("detects Stripe secret key", () => {
		// Build the token dynamically to avoid GitHub push protection
		const prefix = ["sk", "live"].join("_") + "_";
		const token = `${prefix}${"A".repeat(26)}`;
		const findings = scanContent(`const key = "${token}"`, "payment.ts");
		expect(findings.some((f) => f.patternId === "stripe-secret")).toBe(true);
	});

	it("detects private key header", () => {
		const findings = scanContent("-----BEGIN RSA PRIVATE KEY-----", "id_rsa");
		expect(findings.some((f) => f.patternId === "private-key")).toBe(true);
	});

	it("detects OpenSSH private key", () => {
		const findings = scanContent(
			"-----BEGIN OPENSSH PRIVATE KEY-----",
			"id_ed25519",
		);
		expect(findings.some((f) => f.patternId === "private-key")).toBe(true);
	});

	it("detects password assignment", () => {
		const findings = scanContent('password = "super_secret_123"', "config.py");
		expect(findings.some((f) => f.patternId === "password-assign")).toBe(true);
	});

	it("detects database connection string", () => {
		const findings = scanContent(
			"postgres://admin:p4ssw0rd@db.example.com:5432/mydb",
			".env",
		);
		expect(findings.some((f) => f.patternId === "db-connection")).toBe(true);
	});

	it("detects Google API key", () => {
		const key = `AIza${"A".repeat(35)}`;
		const findings = scanContent(`key = "${key}"`, "config.js");
		expect(findings.some((f) => f.patternId === "gcp-api-key")).toBe(true);
	});

	it("detects Slack webhook URL", () => {
		const findings = scanContent(
			"https://hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnop",
			"notify.sh",
		);
		expect(findings.some((f) => f.patternId === "slack-webhook")).toBe(true);
	});

	it("does NOT flag normal code", () => {
		const findings = scanContent(
			'const name = "hello world";\nconst x = 42;\nconsole.log("test");',
			"app.ts",
		);
		expect(findings).toHaveLength(0);
	});

	it("reports correct line number", () => {
		const content = 'line1\nline2\npassword = "leaked123456"\nline4';
		const findings = scanContent(content, "test.py");
		const pwFinding = findings.find((f) => f.patternId === "password-assign");
		expect(pwFinding).toBeDefined();
		expect(pwFinding!.line).toBe(3);
	});
});

// ── maskSecret ──

describe("maskSecret", () => {
	it("masks long secrets showing first 4 and last 2", () => {
		expect(maskSecret("sk_live_ABCDEFGHIJKLMN")).toBe("sk_l...MN");
	});

	it("masks short secrets completely", () => {
		expect(maskSecret("short")).toBe("****");
	});

	it("masks 8-char strings completely", () => {
		expect(maskSecret("12345678")).toBe("****");
	});

	it("masks 9-char strings showing first 4 and last 2", () => {
		expect(maskSecret("123456789")).toBe("1234...89");
	});
});

// ── File filtering ──

describe("shouldScanFile", () => {
	it("scans .ts, .js, .py, .go, .rs files", () => {
		expect(shouldScanFile("app.ts")).toBe(true);
		expect(shouldScanFile("main.py")).toBe(true);
		expect(shouldScanFile("lib.go")).toBe(true);
	});

	it("skips binary files", () => {
		expect(shouldScanFile("logo.png")).toBe(false);
		expect(shouldScanFile("font.woff2")).toBe(false);
		expect(shouldScanFile("archive.zip")).toBe(false);
	});

	it("skips lockfiles", () => {
		expect(shouldScanFile("package-lock.json")).toBe(false);
		expect(shouldScanFile("pnpm-lock.yaml")).toBe(false);
	});

	it("scans .env files", () => {
		expect(shouldScanFile(".env")).toBe(true);
	});
});

describe("shouldSkipDir", () => {
	it("skips node_modules, .git, dist", () => {
		expect(shouldSkipDir("node_modules")).toBe(true);
		expect(shouldSkipDir(".git")).toBe(true);
		expect(shouldSkipDir("dist")).toBe(true);
	});

	it("does not skip src, lib, app", () => {
		expect(shouldSkipDir("src")).toBe(false);
		expect(shouldSkipDir("lib")).toBe(false);
		expect(shouldSkipDir("app")).toBe(false);
	});
});

// ── scanDirectory (integration) ──

describe("scanDirectory", () => {
	it("scans files and finds secrets", async () => {
		const token = `ghp_${"A".repeat(36)}`;
		await fs.writeFile(
			path.join(tmpDir, "config.ts"),
			`const key = "${token}";\n`,
		);
		await fs.writeFile(path.join(tmpDir, "clean.ts"), 'const x = "hello";\n');

		const result = await scanDirectory(tmpDir);
		expect(result.filesScanned).toBe(2);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]!.patternId).toBe("github-pat");
		expect(result.findings[0]!.file).toBe("config.ts");
	});

	it("skips node_modules", async () => {
		const nmDir = path.join(tmpDir, "node_modules", "evil");
		await fs.ensureDir(nmDir);
		await fs.writeFile(path.join(nmDir, "index.js"), "AKIAIOSFODNN7EXAMPLE\n");
		await fs.writeFile(path.join(tmpDir, "app.ts"), "clean code\n");

		const result = await scanDirectory(tmpDir);
		expect(result.findings).toHaveLength(0);
	});

	it("returns correct patternsUsed count", async () => {
		await fs.writeFile(path.join(tmpDir, "a.ts"), "x\n");
		const result = await scanDirectory(tmpDir);
		expect(result.patternsUsed).toBe(SECRET_PATTERNS.length);
	});

	it("handles empty directory", async () => {
		const result = await scanDirectory(tmpDir);
		expect(result.filesScanned).toBe(0);
		expect(result.findings).toHaveLength(0);
	});

	it("finds multiple secrets in same file", async () => {
		await fs.writeFile(
			path.join(tmpDir, ".env"),
			[
				"AWS_KEY=AKIAIOSFODNN7EXAMPLE",
				"DB=postgres://admin:pass@localhost/db",
				"CLEAN=hello",
			].join("\n"),
		);
		const result = await scanDirectory(tmpDir);
		expect(result.findings.length).toBeGreaterThanOrEqual(2);
	});
});
