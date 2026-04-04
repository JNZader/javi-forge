import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecurityBaseline, SecurityFinding } from "../types/index.js";
import {
	baselineAgeDays,
	checkStaleness,
	computeSummary,
	detectRegressions,
	filterAllowlisted,
	filterBySeverity,
	getAuditCommand,
	makeFindingKey,
	parseAuditOutput,
	parseCargoAudit,
	parseGovulncheck,
	parseNpmAudit,
	parsePipAudit,
	readBaseline,
	severityAtOrAbove,
	writeBaseline,
} from "./security.js";

// =============================================================================
// getAuditCommand
// =============================================================================

describe("getAuditCommand", () => {
	it("returns npm audit for node + npm", () => {
		const result = getAuditCommand("node", "npm");
		expect(result).toEqual({ cmd: "npm", args: ["audit", "--json"] });
	});

	it("returns pnpm audit for node + pnpm", () => {
		const result = getAuditCommand("node", "pnpm");
		expect(result).toEqual({ cmd: "pnpm", args: ["audit", "--json"] });
	});

	it("returns yarn npm audit for node + yarn", () => {
		const result = getAuditCommand("node", "yarn");
		expect(result).toEqual({ cmd: "yarn", args: ["npm", "audit", "--json"] });
	});

	it("returns pip-audit for python", () => {
		const result = getAuditCommand("python", "pip");
		expect(result).toEqual({
			cmd: "pip-audit",
			args: ["--format=json", "--output=-"],
		});
	});

	it("returns govulncheck for go", () => {
		const result = getAuditCommand("go", "go");
		expect(result).toEqual({ cmd: "govulncheck", args: ["-json", "./..."] });
	});

	it("returns cargo audit for rust", () => {
		const result = getAuditCommand("rust", "cargo");
		expect(result).toEqual({ cmd: "cargo", args: ["audit", "--json"] });
	});

	it("returns null for unsupported stacks", () => {
		expect(getAuditCommand("java-gradle", "gradle")).toBeNull();
		expect(getAuditCommand("java-maven", "mvn")).toBeNull();
		expect(getAuditCommand("elixir", "mix")).toBeNull();
	});
});

// =============================================================================
// parseNpmAudit
// =============================================================================

describe("parseNpmAudit", () => {
	it("parses npm audit v2 JSON format", () => {
		const raw = JSON.stringify({
			vulnerabilities: {
				lodash: {
					severity: "high",
					via: [
						{
							title: "Prototype Pollution",
							url: "https://ghsa.example/1",
							source: 12345,
						},
					],
				},
			},
		});

		const findings = parseNpmAudit(raw);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toEqual({
			id: "GHSA-12345",
			severity: "high",
			package: "lodash",
			title: "Prototype Pollution",
			url: "https://ghsa.example/1",
		});
	});

	it("handles vulns with no direct via (transitive)", () => {
		const raw = JSON.stringify({
			vulnerabilities: {
				"deep-dep": {
					severity: "moderate",
					via: ["lodash"],
				},
			},
		});

		const findings = parseNpmAudit(raw);
		expect(findings).toHaveLength(1);
		expect(findings[0].id).toBe("npm-deep-dep");
	});

	it("handles multiple via entries", () => {
		const raw = JSON.stringify({
			vulnerabilities: {
				express: {
					severity: "critical",
					via: [
						{ title: "Vuln A", source: 1 },
						{ title: "Vuln B", source: 2 },
					],
				},
			},
		});

		const findings = parseNpmAudit(raw);
		expect(findings).toHaveLength(2);
	});

	it("returns empty array on invalid JSON", () => {
		expect(parseNpmAudit("not json")).toEqual([]);
	});

	it("returns empty array on empty vulnerabilities", () => {
		expect(parseNpmAudit(JSON.stringify({ vulnerabilities: {} }))).toEqual([]);
	});
});

// =============================================================================
// parsePipAudit
// =============================================================================

describe("parsePipAudit", () => {
	it("parses pip-audit JSON format", () => {
		const raw = JSON.stringify([
			{
				name: "requests",
				version: "2.25.0",
				vulns: [
					{
						id: "CVE-2023-1234",
						fix_versions: ["2.28.0"],
						description: "SSRF vuln",
					},
				],
			},
		]);

		const findings = parsePipAudit(raw);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toEqual({
			id: "CVE-2023-1234",
			severity: "high",
			package: "requests",
			title: "SSRF vuln",
		});
	});

	it("returns empty on invalid JSON", () => {
		expect(parsePipAudit("nope")).toEqual([]);
	});
});

// =============================================================================
// parseCargoAudit
// =============================================================================

describe("parseCargoAudit", () => {
	it("parses cargo audit JSON format", () => {
		const raw = JSON.stringify({
			vulnerabilities: {
				list: [
					{
						advisory: {
							id: "RUSTSEC-2023-001",
							title: "Memory safety issue",
							url: "https://rustsec.org/1",
							cvss: { severity: "HIGH" },
						},
						package: { name: "tokio" },
					},
				],
			},
		});

		const findings = parseCargoAudit(raw);
		expect(findings).toHaveLength(1);
		expect(findings[0].id).toBe("RUSTSEC-2023-001");
		expect(findings[0].severity).toBe("high");
	});

	it("returns empty on invalid JSON", () => {
		expect(parseCargoAudit("bad")).toEqual([]);
	});
});

// =============================================================================
// parseGovulncheck
// =============================================================================

describe("parseGovulncheck", () => {
	it("parses govulncheck NDJSON format", () => {
		const lines = [
			JSON.stringify({
				osv: {
					id: "GO-2023-0001",
					summary: "SQL injection",
					affected: [{ package: { name: "github.com/foo/bar" } }],
					references: [{ url: "https://go.dev/1" }],
					database_specific: { severity: "CRITICAL" },
				},
			}),
		];

		const findings = parseGovulncheck(lines.join("\n"));
		expect(findings).toHaveLength(1);
		expect(findings[0].id).toBe("GO-2023-0001");
		expect(findings[0].severity).toBe("critical");
	});

	it("skips non-osv lines", () => {
		const raw =
			'{"config": {}}\n{"osv": {"id": "GO-1", "summary": "test", "affected": [{"package": {"name": "pkg"}}]}}';
		const findings = parseGovulncheck(raw);
		expect(findings).toHaveLength(1);
	});

	it("returns empty on invalid JSON", () => {
		expect(parseGovulncheck("garbage")).toEqual([]);
	});
});

// =============================================================================
// parseAuditOutput — dispatch
// =============================================================================

describe("parseAuditOutput", () => {
	it("dispatches to correct parser for node", () => {
		const raw = JSON.stringify({
			vulnerabilities: {
				x: { severity: "low", via: [{ title: "T", source: 1 }] },
			},
		});
		const findings = parseAuditOutput("node", raw);
		expect(findings).toHaveLength(1);
	});

	it("returns empty for unsupported stack", () => {
		expect(parseAuditOutput("java-gradle", "{}")).toEqual([]);
	});
});

// =============================================================================
// makeFindingKey
// =============================================================================

describe("makeFindingKey", () => {
	it("creates composite key from id and package", () => {
		const finding: SecurityFinding = {
			id: "CVE-2023-1",
			severity: "high",
			package: "lodash",
			title: "test",
		};
		expect(makeFindingKey(finding)).toBe("CVE-2023-1:lodash");
	});
});

// =============================================================================
// detectRegressions
// =============================================================================

describe("detectRegressions", () => {
	const makeBaseline = (
		findings: SecurityFinding[],
		extra?: Partial<SecurityBaseline>,
	): SecurityBaseline => ({
		version: "2.0.0",
		createdAt: "2025-01-01T00:00:00.000Z",
		stack: "node",
		buildTool: "npm",
		findings,
		findingKeys: findings.map(makeFindingKey),
		...extra,
	});

	const finding = (
		id: string,
		pkg: string,
		severity: SecurityFinding["severity"] = "high",
	): SecurityFinding => ({
		id,
		severity,
		package: pkg,
		title: `vuln ${id}`,
	});

	it("reports no regressions when current matches baseline", () => {
		const f1 = finding("CVE-1", "a");
		const f2 = finding("CVE-2", "b");
		const baseline = makeBaseline([f1, f2]);
		const result = detectRegressions(baseline, [f1, f2]);

		expect(result.regressions).toHaveLength(0);
		expect(result.resolved).toHaveLength(0);
		expect(result.filteredRegressions).toHaveLength(0);
	});

	it("detects new findings as regressions", () => {
		const f1 = finding("CVE-1", "a");
		const f2 = finding("CVE-2", "b");
		const fNew = finding("CVE-3", "c");
		const baseline = makeBaseline([f1, f2]);
		const result = detectRegressions(baseline, [f1, f2, fNew]);

		expect(result.regressions).toHaveLength(1);
		expect(result.regressions[0].id).toBe("CVE-3");
		expect(result.filteredRegressions).toHaveLength(1);
	});

	it("detects resolved findings", () => {
		const f1 = finding("CVE-1", "a");
		const f2 = finding("CVE-2", "b");
		const baseline = makeBaseline([f1, f2]);
		const result = detectRegressions(baseline, [f1]);

		expect(result.resolved).toHaveLength(1);
		expect(result.resolved[0].id).toBe("CVE-2");
	});

	it("handles empty baseline", () => {
		const baseline = makeBaseline([]);
		const fNew = finding("CVE-1", "a");
		const result = detectRegressions(baseline, [fNew]);

		expect(result.regressions).toHaveLength(1);
	});

	it("handles empty current findings", () => {
		const f1 = finding("CVE-1", "a");
		const baseline = makeBaseline([f1]);
		const result = detectRegressions(baseline, []);

		expect(result.resolved).toHaveLength(1);
		expect(result.regressions).toHaveLength(0);
	});

	it("filters regressions by minSeverity", () => {
		const fLow = finding("CVE-1", "a", "low");
		const fHigh = finding("CVE-2", "b", "high");
		const fCritical = finding("CVE-3", "c", "critical");
		const baseline = makeBaseline([]);
		const result = detectRegressions(baseline, [fLow, fHigh, fCritical], {
			minSeverity: "high",
		});

		expect(result.regressions).toHaveLength(3);
		expect(result.filteredRegressions).toHaveLength(2);
		expect(result.filteredRegressions.map((f) => f.id)).toEqual([
			"CVE-2",
			"CVE-3",
		]);
	});

	it("excludes allowlisted findings from regressions", () => {
		const fNew = finding("CVE-1", "a");
		const fNew2 = finding("CVE-2", "b");
		const baseline = makeBaseline([], { allowlist: ["CVE-1:a"] });
		const result = detectRegressions(baseline, [fNew, fNew2]);

		expect(result.regressions).toHaveLength(1);
		expect(result.regressions[0].id).toBe("CVE-2");
	});

	it("includes summary with severity breakdown", () => {
		const fLow = finding("CVE-1", "a", "low");
		const fHigh = finding("CVE-2", "b", "high");
		const baseline = makeBaseline([fLow]);
		const result = detectRegressions(baseline, [fLow, fHigh]);

		expect(result.summary.total).toBe(2);
		expect(result.summary.bySeverity.high).toBe(1);
		expect(result.summary.bySeverity.low).toBe(1);
		expect(result.summary.regressionCount).toBe(1);
	});

	it("detects stale baseline", () => {
		const oldDate = new Date(
			Date.now() - 45 * 24 * 60 * 60 * 1000,
		).toISOString();
		const baseline = makeBaseline([], { createdAt: oldDate });
		const result = detectRegressions(baseline, [], { staleDays: 30 });

		expect(result.staleWarning).toBeDefined();
		expect(result.staleWarning).toContain("45 days old");
	});

	it("no stale warning when baseline is fresh", () => {
		const recentDate = new Date().toISOString();
		const baseline = makeBaseline([], { createdAt: recentDate });
		const result = detectRegressions(baseline, [], { staleDays: 30 });

		expect(result.staleWarning).toBeUndefined();
	});
});

// =============================================================================
// severityAtOrAbove
// =============================================================================

describe("severityAtOrAbove", () => {
	it("critical is at or above all levels", () => {
		expect(severityAtOrAbove("critical", "info")).toBe(true);
		expect(severityAtOrAbove("critical", "low")).toBe(true);
		expect(severityAtOrAbove("critical", "moderate")).toBe(true);
		expect(severityAtOrAbove("critical", "high")).toBe(true);
		expect(severityAtOrAbove("critical", "critical")).toBe(true);
	});

	it("info is only at or above info", () => {
		expect(severityAtOrAbove("info", "info")).toBe(true);
		expect(severityAtOrAbove("info", "low")).toBe(false);
		expect(severityAtOrAbove("info", "critical")).toBe(false);
	});

	it("moderate is at or above low but not high", () => {
		expect(severityAtOrAbove("moderate", "low")).toBe(true);
		expect(severityAtOrAbove("moderate", "moderate")).toBe(true);
		expect(severityAtOrAbove("moderate", "high")).toBe(false);
	});
});

// =============================================================================
// filterBySeverity
// =============================================================================

describe("filterBySeverity", () => {
	const finding = (sev: SecurityFinding["severity"]): SecurityFinding => ({
		id: `f-${sev}`,
		severity: sev,
		package: "pkg",
		title: `${sev} vuln`,
	});

	it("filters findings below threshold", () => {
		const findings = [
			finding("info"),
			finding("low"),
			finding("moderate"),
			finding("high"),
			finding("critical"),
		];
		const filtered = filterBySeverity(findings, "high");
		expect(filtered).toHaveLength(2);
		expect(filtered.map((f) => f.severity)).toEqual(["high", "critical"]);
	});

	it("returns all when threshold is info", () => {
		const findings = [finding("info"), finding("critical")];
		expect(filterBySeverity(findings, "info")).toHaveLength(2);
	});
});

// =============================================================================
// filterAllowlisted
// =============================================================================

describe("filterAllowlisted", () => {
	it("removes findings matching allowlist keys", () => {
		const findings: SecurityFinding[] = [
			{ id: "CVE-1", severity: "high", package: "a", title: "A" },
			{ id: "CVE-2", severity: "low", package: "b", title: "B" },
		];
		const result = filterAllowlisted(findings, ["CVE-1:a"]);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("CVE-2");
	});

	it("returns all findings when allowlist is empty", () => {
		const findings: SecurityFinding[] = [
			{ id: "CVE-1", severity: "high", package: "a", title: "A" },
		];
		expect(filterAllowlisted(findings, [])).toHaveLength(1);
	});
});

// =============================================================================
// checkStaleness
// =============================================================================

describe("checkStaleness", () => {
	const makeBaseline = (
		createdAt: string,
		updatedAt?: string,
	): SecurityBaseline => ({
		version: "2.0.0",
		createdAt,
		updatedAt,
		stack: "node",
		buildTool: "npm",
		findings: [],
		findingKeys: [],
	});

	it("returns warning when baseline exceeds staleDays", () => {
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		expect(checkStaleness(makeBaseline(old), 30)).toBeDefined();
	});

	it("returns undefined when baseline is fresh", () => {
		expect(
			checkStaleness(makeBaseline(new Date().toISOString()), 30),
		).toBeUndefined();
	});

	it("uses updatedAt when available", () => {
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		const recent = new Date().toISOString();
		expect(checkStaleness(makeBaseline(old, recent), 30)).toBeUndefined();
	});
});

// =============================================================================
// baselineAgeDays
// =============================================================================

describe("baselineAgeDays", () => {
	it("returns age in days", () => {
		const daysAgo = new Date(
			Date.now() - 10 * 24 * 60 * 60 * 1000,
		).toISOString();
		const baseline: SecurityBaseline = {
			version: "2.0.0",
			createdAt: daysAgo,
			stack: "node",
			buildTool: "npm",
			findings: [],
			findingKeys: [],
		};
		expect(baselineAgeDays(baseline)).toBe(10);
	});
});

// =============================================================================
// computeSummary
// =============================================================================

describe("computeSummary", () => {
	it("computes severity breakdown", () => {
		const current: SecurityFinding[] = [
			{ id: "1", severity: "high", package: "a", title: "a" },
			{ id: "2", severity: "high", package: "b", title: "b" },
			{ id: "3", severity: "low", package: "c", title: "c" },
		];
		const baseline: SecurityBaseline = {
			version: "2.0.0",
			createdAt: new Date().toISOString(),
			stack: "node",
			buildTool: "npm",
			findings: [],
			findingKeys: [],
		};
		const summary = computeSummary(
			current,
			[current[2]],
			[],
			[current[2]],
			baseline,
		);
		expect(summary.total).toBe(3);
		expect(summary.bySeverity.high).toBe(2);
		expect(summary.bySeverity.low).toBe(1);
		expect(summary.regressionCount).toBe(1);
		expect(summary.filteredCount).toBe(1);
	});
});

// =============================================================================
// Baseline file I/O
// =============================================================================

describe("baseline I/O", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-sec-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("writeBaseline creates .javi-forge dir and writes JSON", async () => {
		const baseline: SecurityBaseline = {
			version: "1.0.0",
			createdAt: "2025-01-01T00:00:00.000Z",
			stack: "node",
			buildTool: "npm",
			findings: [],
			findingKeys: [],
		};

		await writeBaseline(tmpDir, baseline);

		const filePath = path.join(tmpDir, ".javi-forge", "security-baseline.json");
		expect(await fs.pathExists(filePath)).toBe(true);
		const content = await fs.readJson(filePath);
		expect(content.version).toBe("1.0.0");
	});

	it("readBaseline returns null when file does not exist", async () => {
		const result = await readBaseline(tmpDir);
		expect(result).toBeNull();
	});

	it("readBaseline returns baseline when file exists", async () => {
		const baseline: SecurityBaseline = {
			version: "1.0.0",
			createdAt: "2025-01-01T00:00:00.000Z",
			stack: "node",
			buildTool: "npm",
			findings: [
				{ id: "CVE-1", severity: "high", package: "test", title: "Test vuln" },
			],
			findingKeys: ["CVE-1:test"],
		};
		await writeBaseline(tmpDir, baseline);

		const result = await readBaseline(tmpDir);
		expect(result).not.toBeNull();
		expect(result!.findings).toHaveLength(1);
	});

	it("readBaseline returns null on corrupted JSON", async () => {
		const filePath = path.join(tmpDir, ".javi-forge", "security-baseline.json");
		await fs.ensureDir(path.dirname(filePath));
		await fs.writeFile(filePath, "not valid json");

		const result = await readBaseline(tmpDir);
		expect(result).toBeNull();
	});
});
