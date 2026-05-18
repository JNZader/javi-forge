import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BUILTIN_RULES,
	type SecurityAnalysisFinding,
	type SecurityAnalysisOptions,
	type SemgrepRule,
	buildReport,
	buildSummary,
	collectFiles,
	detectFileLanguage,
	filterRules,
	formatReportJson,
	formatReportText,
	loadCustomRules,
	matchRule,
	runSecurityAnalysis,
	severityAtOrAbove,
} from "./security-analysis.js";

// =============================================================================
// detectFileLanguage
// =============================================================================

describe("detectFileLanguage", () => {
	it("detects javascript extensions", () => {
		expect(detectFileLanguage("app.js")).toBe("javascript");
		expect(detectFileLanguage("module.mjs")).toBe("javascript");
		expect(detectFileLanguage("module.cjs")).toBe("javascript");
	});

	it("detects typescript extensions", () => {
		expect(detectFileLanguage("app.ts")).toBe("typescript");
		expect(detectFileLanguage("component.tsx")).toBe("typescript");
		expect(detectFileLanguage("module.mts")).toBe("typescript");
	});

	it("detects python", () => {
		expect(detectFileLanguage("app.py")).toBe("python");
	});

	it("detects go", () => {
		expect(detectFileLanguage("main.go")).toBe("go");
	});

	it("returns null for unknown extensions", () => {
		expect(detectFileLanguage("readme.md")).toBeNull();
		expect(detectFileLanguage("style.css")).toBeNull();
		expect(detectFileLanguage("data.json")).toBeNull();
	});
});

// =============================================================================
// matchRule
// =============================================================================

describe("matchRule", () => {
	const evalRule: SemgrepRule = {
		id: "tob-js-eval-injection",
		severity: "critical",
		message: "Use of eval() with dynamic input",
		category: "injection",
		pattern: "\\beval\\s*\\(",
		languages: ["javascript", "typescript"],
	};

	it("finds eval() usage in TypeScript files", () => {
		const content = 'const result = eval("code");';
		const findings = matchRule(evalRule, content, "test.ts");
		expect(findings).toHaveLength(1);
		expect(findings[0].ruleId).toBe("tob-js-eval-injection");
		expect(findings[0].severity).toBe("critical");
		expect(findings[0].line).toBe(1);
	});

	it("finds eval() usage in JavaScript files", () => {
		const content = 'eval(userInput)';
		const findings = matchRule(evalRule, content, "test.js");
		expect(findings).toHaveLength(1);
	});

	it("skips files with non-matching language", () => {
		const content = 'eval("code")';
		const findings = matchRule(evalRule, content, "test.py");
		expect(findings).toHaveLength(0);
	});

	it("skips commented lines (//)", () => {
		const content = '// eval("code")';
		const findings = matchRule(evalRule, content, "test.ts");
		expect(findings).toHaveLength(0);
	});

	it("skips commented lines (#)", () => {
		const pyRule: SemgrepRule = {
			...evalRule,
			id: "tob-py-eval-injection",
			languages: ["python"],
		};
		const content = '# eval("code")';
		const findings = matchRule(pyRule, content, "test.py");
		expect(findings).toHaveLength(0);
	});

	it("returns correct line and column numbers", () => {
		const content = 'line 1\nconst x = eval("a");\nline 3';
		const findings = matchRule(evalRule, content, "test.ts");
		expect(findings).toHaveLength(1);
		expect(findings[0].line).toBe(2);
		expect(findings[0].column).toBeGreaterThan(0);
	});

	it("finds multiple matches in one file", () => {
		const content = 'eval("a");\nconst x = 1;\neval("b");';
		const findings = matchRule(evalRule, content, "test.ts");
		expect(findings).toHaveLength(2);
	});

	it("returns empty for unknown file extensions", () => {
		const content = 'eval("code")';
		const findings = matchRule(evalRule, content, "test.txt");
		expect(findings).toHaveLength(0);
	});
});

// =============================================================================
// matchRule — specific rules
// =============================================================================

describe("matchRule — built-in rules", () => {
	const findRule = (id: string) => BUILTIN_RULES.find((r) => r.id === id)!;

	it("detects Function constructor", () => {
		const rule = findRule("tob-js-function-constructor");
		const findings = matchRule(rule, 'new Function("return 1")', "app.ts");
		expect(findings).toHaveLength(1);
	});

	it("detects MD5 usage", () => {
		const rule = findRule("tob-weak-hash-md5");
		const findings = matchRule(
			rule,
			'const hash = createHash("md5");',
			"app.ts",
		);
		expect(findings).toHaveLength(1);
	});

	it("detects SHA-1 usage", () => {
		const rule = findRule("tob-weak-hash-sha1");
		const findings = matchRule(
			rule,
			'const hash = createHash("sha1");',
			"app.ts",
		);
		expect(findings).toHaveLength(1);
	});

	it("detects hardcoded secrets", () => {
		const rule = findRule("tob-hardcoded-secret");
		const findings = matchRule(
			rule,
			'const api_key = "sk-1234567890abcdef";',
			"config.ts",
		);
		expect(findings).toHaveLength(1);
	});

	it("detects unsafe pickle deserialization in Python", () => {
		const rule = findRule("tob-unsafe-deserialize");
		const findings = matchRule(
			rule,
			"data = pickle.loads(raw_bytes)",
			"app.py",
		);
		expect(findings).toHaveLength(1);
	});

	it("detects JWT none algorithm", () => {
		const rule = findRule("tob-jwt-none-algorithm");
		const findings = matchRule(
			rule,
			'jwt.verify(token, secret, { algorithm: "none" })',
			"auth.ts",
		);
		expect(findings).toHaveLength(1);
	});

	it("detects debug mode in Python", () => {
		const rule = findRule("tob-debug-enabled");
		const findings = matchRule(rule, "DEBUG = True", "settings.py");
		expect(findings).toHaveLength(1);
	});

	it("detects command injection via exec with template literals", () => {
		const rule = findRule("tob-cmd-injection");
		const findings = matchRule(
			rule,
			"exec(`ls ${userInput}`)",
			"server.ts",
		);
		expect(findings).toHaveLength(1);
	});
});

// =============================================================================
// severityAtOrAbove
// =============================================================================

describe("severityAtOrAbove", () => {
	it("critical is at or above all levels", () => {
		expect(severityAtOrAbove("critical", "info")).toBe(true);
		expect(severityAtOrAbove("critical", "critical")).toBe(true);
	});

	it("info is only at or above info", () => {
		expect(severityAtOrAbove("info", "info")).toBe(true);
		expect(severityAtOrAbove("info", "low")).toBe(false);
	});

	it("moderate is at or above low but not high", () => {
		expect(severityAtOrAbove("moderate", "low")).toBe(true);
		expect(severityAtOrAbove("moderate", "high")).toBe(false);
	});
});

// =============================================================================
// buildSummary
// =============================================================================

describe("buildSummary", () => {
	const makeFinding = (
		severity: SecurityAnalysisFinding["severity"],
		category = "injection",
	): SecurityAnalysisFinding => ({
		ruleId: "test",
		engine: "semgrep",
		severity,
		message: "test",
		file: "test.ts",
		line: 1,
		category,
	});

	it("counts findings by severity", () => {
		const findings = [
			makeFinding("critical"),
			makeFinding("critical"),
			makeFinding("high"),
			makeFinding("low"),
		];
		const summary = buildSummary(findings, "high");
		expect(summary.total).toBe(4);
		expect(summary.bySeverity.critical).toBe(2);
		expect(summary.bySeverity.high).toBe(1);
		expect(summary.bySeverity.low).toBe(1);
	});

	it("counts findings by category", () => {
		const findings = [
			makeFinding("high", "injection"),
			makeFinding("high", "injection"),
			makeFinding("moderate", "cryptography"),
		];
		const summary = buildSummary(findings, "high");
		expect(summary.byCategory.injection).toBe(2);
		expect(summary.byCategory.cryptography).toBe(1);
	});

	it("passes when no findings at or above threshold", () => {
		const findings = [makeFinding("low"), makeFinding("moderate")];
		const summary = buildSummary(findings, "high");
		expect(summary.passed).toBe(true);
	});

	it("fails when findings at or above threshold exist", () => {
		const findings = [makeFinding("critical")];
		const summary = buildSummary(findings, "high");
		expect(summary.passed).toBe(false);
	});

	it("handles empty findings", () => {
		const summary = buildSummary([], "high");
		expect(summary.total).toBe(0);
		expect(summary.passed).toBe(true);
	});
});

// =============================================================================
// filterRules
// =============================================================================

describe("filterRules", () => {
	const rules: SemgrepRule[] = [
		{
			id: "rule-a",
			severity: "high",
			message: "A",
			category: "cat",
			pattern: "a",
			languages: ["typescript"],
		},
		{
			id: "rule-b",
			severity: "low",
			message: "B",
			category: "cat",
			pattern: "b",
			languages: ["typescript"],
		},
		{
			id: "rule-c",
			severity: "critical",
			message: "C",
			category: "cat",
			pattern: "c",
			languages: ["typescript"],
		},
	];

	it("returns all rules when no filters specified", () => {
		expect(filterRules(rules)).toHaveLength(3);
	});

	it("filters by includeRules", () => {
		const filtered = filterRules(rules, { includeRules: ["rule-a", "rule-c"] });
		expect(filtered).toHaveLength(2);
		expect(filtered.map((r) => r.id)).toEqual(["rule-a", "rule-c"]);
	});

	it("filters by excludeRules", () => {
		const filtered = filterRules(rules, { excludeRules: ["rule-b"] });
		expect(filtered).toHaveLength(2);
		expect(filtered.map((r) => r.id)).toEqual(["rule-a", "rule-c"]);
	});

	it("include + exclude work together", () => {
		const filtered = filterRules(rules, {
			includeRules: ["rule-a", "rule-b", "rule-c"],
			excludeRules: ["rule-b"],
		});
		expect(filtered).toHaveLength(2);
	});
});

// =============================================================================
// buildReport
// =============================================================================

describe("buildReport", () => {
	it("creates report with correct structure", () => {
		const findings: SecurityAnalysisFinding[] = [
			{
				ruleId: "test",
				engine: "semgrep",
				severity: "high",
				message: "test",
				file: "test.ts",
				line: 1,
				category: "injection",
			},
		];
		const report = buildReport(findings, "/project");
		expect(report.engine).toBe("semgrep");
		expect(report.projectDir).toBe("/project");
		expect(report.findings).toHaveLength(1);
		expect(report.summary.total).toBe(1);
		expect(report.timestamp).toBeTruthy();
	});

	it("uses custom failThreshold", () => {
		const report = buildReport([], "/project", { failThreshold: "critical" });
		expect(report.summary.failThreshold).toBe("critical");
	});
});

// =============================================================================
// formatReportText
// =============================================================================

describe("formatReportText", () => {
	it("formats a passing report", () => {
		const report = buildReport([], "/project");
		const text = formatReportText(report);
		expect(text).toContain("PASS");
		expect(text).toContain("Findings: 0");
	});

	it("formats a failing report with findings", () => {
		const findings: SecurityAnalysisFinding[] = [
			{
				ruleId: "tob-js-eval-injection",
				engine: "semgrep",
				severity: "critical",
				message: "eval() usage",
				file: "app.ts",
				line: 10,
				column: 5,
				category: "injection",
				cwe: "CWE-94",
			},
		];
		const report = buildReport(findings, "/project");
		const text = formatReportText(report);
		expect(text).toContain("FAIL");
		expect(text).toContain("CRITICAL");
		expect(text).toContain("CWE-94");
		expect(text).toContain("app.ts:10:5");
	});
});

// =============================================================================
// formatReportJson
// =============================================================================

describe("formatReportJson", () => {
	it("produces valid JSON", () => {
		const report = buildReport([], "/project");
		const json = formatReportJson(report);
		expect(() => JSON.parse(json)).not.toThrow();
	});
});

// =============================================================================
// collectFiles
// =============================================================================

describe("collectFiles", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "javi-forge-secanalysis-"),
		);
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("collects TypeScript and JavaScript files", async () => {
		await fs.writeFile(path.join(tmpDir, "app.ts"), "code");
		await fs.writeFile(path.join(tmpDir, "lib.js"), "code");
		await fs.writeFile(path.join(tmpDir, "readme.md"), "text");

		const files = await collectFiles(tmpDir);
		expect(files).toHaveLength(2);
		expect(files.some((f) => f.endsWith("app.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("lib.js"))).toBe(true);
	});

	it("ignores node_modules", async () => {
		await fs.ensureDir(path.join(tmpDir, "node_modules"));
		await fs.writeFile(path.join(tmpDir, "node_modules", "dep.js"), "code");
		await fs.writeFile(path.join(tmpDir, "app.ts"), "code");

		const files = await collectFiles(tmpDir);
		expect(files).toHaveLength(1);
	});

	it("ignores .git directory", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeFile(path.join(tmpDir, ".git", "hooks.js"), "code");

		const files = await collectFiles(tmpDir);
		expect(files).toHaveLength(0);
	});

	it("walks subdirectories", async () => {
		await fs.ensureDir(path.join(tmpDir, "src", "lib"));
		await fs.writeFile(path.join(tmpDir, "src", "lib", "util.ts"), "code");

		const files = await collectFiles(tmpDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toContain("util.ts");
	});

	it("handles empty directory", async () => {
		const files = await collectFiles(tmpDir);
		expect(files).toHaveLength(0);
	});
});

// =============================================================================
// loadCustomRules
// =============================================================================

describe("loadCustomRules", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-rules-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("loads valid custom rule from JSON file", async () => {
		const rule: SemgrepRule = {
			id: "custom-1",
			severity: "high",
			message: "Custom rule",
			category: "custom",
			pattern: "dangerous()",
			languages: ["typescript"],
		};
		await fs.writeJson(path.join(tmpDir, "custom.json"), rule);

		const rules = await loadCustomRules(tmpDir);
		expect(rules).toHaveLength(1);
		expect(rules[0].id).toBe("custom-1");
	});

	it("loads array of rules from single file", async () => {
		const rules = [
			{
				id: "c-1",
				severity: "high",
				message: "A",
				category: "x",
				pattern: "a",
				languages: ["typescript"],
			},
			{
				id: "c-2",
				severity: "low",
				message: "B",
				category: "x",
				pattern: "b",
				languages: ["typescript"],
			},
		];
		await fs.writeJson(path.join(tmpDir, "rules.json"), rules);

		const loaded = await loadCustomRules(tmpDir);
		expect(loaded).toHaveLength(2);
	});

	it("skips invalid rule files", async () => {
		await fs.writeFile(path.join(tmpDir, "bad.json"), "not valid json");
		const rules = await loadCustomRules(tmpDir);
		expect(rules).toHaveLength(0);
	});

	it("skips non-JSON files", async () => {
		await fs.writeFile(path.join(tmpDir, "readme.md"), "text");
		const rules = await loadCustomRules(tmpDir);
		expect(rules).toHaveLength(0);
	});

	it("returns empty for non-existent directory", async () => {
		const rules = await loadCustomRules("/tmp/nonexistent-rules-dir");
		expect(rules).toHaveLength(0);
	});

	it("skips rules with missing required fields", async () => {
		await fs.writeJson(path.join(tmpDir, "incomplete.json"), {
			id: "x",
			// missing severity, message, category, pattern, languages
		});
		const rules = await loadCustomRules(tmpDir);
		expect(rules).toHaveLength(0);
	});
});

// =============================================================================
// runSecurityAnalysis (integration)
// =============================================================================

describe("runSecurityAnalysis", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-scan-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("detects eval injection in a TypeScript file", async () => {
		await fs.writeFile(
			path.join(tmpDir, "server.ts"),
			'const result = eval(userInput);\n',
		);

		const report = await runSecurityAnalysis(tmpDir);
		expect(report.findings.length).toBeGreaterThan(0);
		expect(report.findings[0].ruleId).toBe("tob-js-eval-injection");
		expect(report.findings[0].severity).toBe("critical");
		expect(report.summary.passed).toBe(false);
	});

	it("detects hardcoded secrets", async () => {
		await fs.writeFile(
			path.join(tmpDir, "config.ts"),
			'const secret = "my-super-secret-key-value";\n',
		);

		const report = await runSecurityAnalysis(tmpDir);
		const secretFindings = report.findings.filter(
			(f) => f.ruleId === "tob-hardcoded-secret",
		);
		expect(secretFindings.length).toBeGreaterThan(0);
	});

	it("passes with clean code", async () => {
		await fs.writeFile(
			path.join(tmpDir, "app.ts"),
			'const x = 1;\nconst y = x + 2;\nexport { y };\n',
		);

		const report = await runSecurityAnalysis(tmpDir);
		expect(report.findings).toHaveLength(0);
		expect(report.summary.passed).toBe(true);
	});

	it("respects failThreshold option", async () => {
		await fs.writeFile(
			path.join(tmpDir, "app.ts"),
			'const hash = createHash("md5");\n',
		);

		// MD5 is "high" severity, so threshold "critical" should pass
		const report = await runSecurityAnalysis(tmpDir, {
			failThreshold: "critical",
		});
		expect(report.summary.passed).toBe(true);

		// But threshold "high" should fail
		const report2 = await runSecurityAnalysis(tmpDir, {
			failThreshold: "high",
		});
		expect(report2.summary.passed).toBe(false);
	});

	it("handles empty project", async () => {
		const report = await runSecurityAnalysis(tmpDir);
		expect(report.findings).toHaveLength(0);
		expect(report.summary.passed).toBe(true);
	});

	it("uses relative file paths in findings", async () => {
		await fs.ensureDir(path.join(tmpDir, "src"));
		await fs.writeFile(
			path.join(tmpDir, "src", "bad.ts"),
			'eval("code");\n',
		);

		const report = await runSecurityAnalysis(tmpDir);
		expect(report.findings[0].file).toBe(path.join("src", "bad.ts"));
	});

	it("loads and applies custom rules", async () => {
		const rulesDir = path.join(tmpDir, ".security-rules");
		await fs.ensureDir(rulesDir);
		await fs.writeJson(path.join(rulesDir, "custom.json"), {
			id: "custom-console-log",
			severity: "low",
			message: "console.log should be removed",
			category: "quality",
			pattern: "console\\.log",
			languages: ["typescript"],
		});

		await fs.writeFile(
			path.join(tmpDir, "app.ts"),
			'console.log("hello");\n',
		);

		const report = await runSecurityAnalysis(tmpDir, { rulesDir });
		const customFindings = report.findings.filter(
			(f) => f.ruleId === "custom-console-log",
		);
		expect(customFindings).toHaveLength(1);
	});

	it("excludes rules by ID", async () => {
		await fs.writeFile(
			path.join(tmpDir, "app.ts"),
			'const result = eval("code");\n',
		);

		const report = await runSecurityAnalysis(tmpDir, {
			excludeRules: ["tob-js-eval-injection"],
		});
		const evalFindings = report.findings.filter(
			(f) => f.ruleId === "tob-js-eval-injection",
		);
		expect(evalFindings).toHaveLength(0);
	});
});

// =============================================================================
// BUILTIN_RULES integrity
// =============================================================================

describe("BUILTIN_RULES", () => {
	it("all rules have unique IDs", () => {
		const ids = BUILTIN_RULES.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("all rules have valid severity", () => {
		const validSeverities = ["critical", "high", "moderate", "low", "info"];
		for (const rule of BUILTIN_RULES) {
			expect(validSeverities).toContain(rule.severity);
		}
	});

	it("all rules have valid regex patterns", () => {
		for (const rule of BUILTIN_RULES) {
			expect(() => new RegExp(rule.pattern, "gi")).not.toThrow();
		}
	});

	it("all rules have at least one language", () => {
		for (const rule of BUILTIN_RULES) {
			expect(rule.languages.length).toBeGreaterThan(0);
		}
	});

	it("covers major vulnerability categories", () => {
		const categories = new Set(BUILTIN_RULES.map((r) => r.category));
		expect(categories.has("injection")).toBe(true);
		expect(categories.has("cryptography")).toBe(true);
		expect(categories.has("authentication")).toBe(true);
		expect(categories.has("path-traversal")).toBe(true);
	});
});
