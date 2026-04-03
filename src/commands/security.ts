import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs-extra'
import path from 'path'
import type { Stack, SecurityFinding, SecurityBaseline, SecurityCheckResult, SecurityCheckOptions, SecuritySeverity, SecuritySummary } from '../types/index.js'
import { detectCIStack } from './ci.js'

const execFileAsync = promisify(execFile)

// =============================================================================
// Types
// =============================================================================

export type SecurityMode = 'baseline' | 'check' | 'update' | 'allowlist'

export type SecurityStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface SecurityStep {
  id: string
  label: string
  status: SecurityStepStatus
  detail?: string
}

export type SecurityStepCallback = (step: SecurityStep) => void

// =============================================================================
// Constants
// =============================================================================

const BASELINE_DIR = '.javi-forge'
const BASELINE_FILE = 'security-baseline.json'
const BASELINE_VERSION = '2.0.0'

const SEVERITY_ORDER: Record<SecuritySeverity, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  info: 1,
}

const DEFAULT_STALE_DAYS = 30

// =============================================================================
// Audit command resolution
// =============================================================================

export function getAuditCommand(stack: Stack, buildTool: string): { cmd: string; args: string[] } | null {
  switch (stack) {
    case 'node':
      switch (buildTool) {
        case 'pnpm':  return { cmd: 'pnpm', args: ['audit', '--json'] }
        case 'yarn':  return { cmd: 'yarn', args: ['npm', 'audit', '--json'] }
        default:      return { cmd: 'npm', args: ['audit', '--json'] }
      }
    case 'python':
      return { cmd: 'pip-audit', args: ['--format=json', '--output=-'] }
    case 'go':
      return { cmd: 'govulncheck', args: ['-json', './...'] }
    case 'rust':
      return { cmd: 'cargo', args: ['audit', '--json'] }
    default:
      return null
  }
}

// =============================================================================
// Audit output parsing
// =============================================================================

export function makeFindingKey(finding: SecurityFinding): string {
  return `${finding.id}:${finding.package}`
}

export function parseNpmAudit(raw: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  try {
    const data = JSON.parse(raw)
    // npm audit v2 JSON format: { vulnerabilities: { [name]: { ... } } }
    const vulns = data.vulnerabilities ?? {}
    for (const [pkgName, info] of Object.entries(vulns)) {
      const v = info as { severity?: string; via?: Array<{ title?: string; url?: string; source?: number }> }
      // via can contain objects (direct vulns) or strings (transitive refs)
      const directVias = (v.via ?? []).filter((x): x is { title?: string; url?: string; source?: number } => typeof x === 'object')
      if (directVias.length === 0) {
        findings.push({
          id: `npm-${pkgName}`,
          severity: normalizeSeverity(v.severity),
          package: pkgName,
          title: `Vulnerability in ${pkgName}`,
        })
      } else {
        for (const via of directVias) {
          findings.push({
            id: via.source ? `GHSA-${via.source}` : `npm-${pkgName}`,
            severity: normalizeSeverity(v.severity),
            package: pkgName,
            title: via.title ?? `Vulnerability in ${pkgName}`,
            url: via.url,
          })
        }
      }
    }
  } catch {
    // If JSON parse fails, return empty — audit tool may not be available
  }
  return findings
}

export function parsePipAudit(raw: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  try {
    const data = JSON.parse(raw)
    // pip-audit JSON: array of { name, version, vulns: [{ id, fix_versions, description }] }
    const deps = Array.isArray(data) ? data : (data.dependencies ?? [])
    for (const dep of deps) {
      for (const vuln of (dep.vulns ?? [])) {
        findings.push({
          id: vuln.id ?? `pip-${dep.name}`,
          severity: normalizeSeverity(vuln.fix_versions?.length ? 'high' : 'moderate'),
          package: dep.name,
          title: vuln.description ?? `Vulnerability in ${dep.name}`,
        })
      }
    }
  } catch {
    // empty
  }
  return findings
}

export function parseCargoAudit(raw: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  try {
    const data = JSON.parse(raw)
    const vulns = data.vulnerabilities?.list ?? []
    for (const v of vulns) {
      const advisory = v.advisory ?? {}
      findings.push({
        id: advisory.id ?? `cargo-${v.package?.name ?? 'unknown'}`,
        severity: normalizeSeverity(advisory.cvss?.severity),
        package: v.package?.name ?? 'unknown',
        title: advisory.title ?? `Vulnerability in ${v.package?.name ?? 'unknown'}`,
        url: advisory.url,
      })
    }
  } catch {
    // empty
  }
  return findings
}

export function parseGovulncheck(raw: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  try {
    // govulncheck JSON outputs one JSON object per line (NDJSON)
    const lines = raw.split('\n').filter(l => l.trim())
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.osv) {
          findings.push({
            id: entry.osv.id ?? 'unknown',
            severity: normalizeSeverity(entry.osv.database_specific?.severity),
            package: entry.osv.affected?.[0]?.package?.name ?? 'unknown',
            title: entry.osv.summary ?? entry.osv.id ?? 'Go vulnerability',
            url: entry.osv.references?.[0]?.url,
          })
        }
      } catch {
        // skip non-JSON lines
      }
    }
  } catch {
    // empty
  }
  return findings
}

function normalizeSeverity(raw?: string): SecurityFinding['severity'] {
  if (!raw) return 'moderate'
  const lower = raw.toLowerCase()
  if (lower === 'critical') return 'critical'
  if (lower === 'high') return 'high'
  if (lower === 'moderate' || lower === 'medium') return 'moderate'
  if (lower === 'low') return 'low'
  if (lower === 'info' || lower === 'none') return 'info'
  return 'moderate'
}

export function parseAuditOutput(stack: Stack, raw: string): SecurityFinding[] {
  switch (stack) {
    case 'node':   return parseNpmAudit(raw)
    case 'python': return parsePipAudit(raw)
    case 'rust':   return parseCargoAudit(raw)
    case 'go':     return parseGovulncheck(raw)
    default:       return []
  }
}

// =============================================================================
// Severity helpers
// =============================================================================

export function severityAtOrAbove(severity: SecuritySeverity, threshold: SecuritySeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold]
}

export function filterBySeverity(findings: SecurityFinding[], minSeverity: SecuritySeverity): SecurityFinding[] {
  return findings.filter(f => severityAtOrAbove(f.severity, minSeverity))
}

// =============================================================================
// Allowlist filtering
// =============================================================================

export function filterAllowlisted(findings: SecurityFinding[], allowlist: string[]): SecurityFinding[] {
  if (allowlist.length === 0) return findings
  const allowSet = new Set(allowlist)
  return findings.filter(f => !allowSet.has(makeFindingKey(f)))
}

// =============================================================================
// Staleness detection
// =============================================================================

export function checkStaleness(baseline: SecurityBaseline, staleDays: number): string | undefined {
  const refDate = baseline.updatedAt ?? baseline.createdAt
  const ageMs = Date.now() - new Date(refDate).getTime()
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
  if (ageDays > staleDays) {
    return `Baseline is ${ageDays} days old (threshold: ${staleDays}). Consider running \`javi-forge security update\`.`
  }
  return undefined
}

export function baselineAgeDays(baseline: SecurityBaseline): number {
  const refDate = baseline.updatedAt ?? baseline.createdAt
  const ageMs = Date.now() - new Date(refDate).getTime()
  return Math.floor(ageMs / (1000 * 60 * 60 * 24))
}

// =============================================================================
// Summary computation
// =============================================================================

export function computeSummary(
  current: SecurityFinding[],
  regressions: SecurityFinding[],
  resolved: SecurityFinding[],
  filteredRegressions: SecurityFinding[],
  baseline: SecurityBaseline
): SecuritySummary {
  const bySeverity: Record<SecuritySeverity, number> = {
    critical: 0, high: 0, moderate: 0, low: 0, info: 0,
  }
  for (const f of current) {
    bySeverity[f.severity]++
  }
  return {
    total: current.length,
    bySeverity,
    regressionCount: regressions.length,
    resolvedCount: resolved.length,
    filteredCount: filteredRegressions.length,
    baselineAge: baselineAgeDays(baseline),
  }
}

// =============================================================================
// Regression detection
// =============================================================================

export function detectRegressions(
  baseline: SecurityBaseline,
  current: SecurityFinding[],
  options: SecurityCheckOptions = {}
): SecurityCheckResult {
  const baselineKeySet = new Set(baseline.findingKeys)
  const currentKeys = current.map(makeFindingKey)
  const currentKeySet = new Set(currentKeys)

  let regressions = current.filter(f => !baselineKeySet.has(makeFindingKey(f)))
  const resolved = baseline.findings.filter(f => !currentKeySet.has(makeFindingKey(f)))

  // Apply allowlist filtering
  const allowlist = baseline.allowlist ?? []
  regressions = filterAllowlisted(regressions, allowlist)

  // Apply severity threshold
  const minSeverity = options.minSeverity ?? 'low'
  const filteredRegressions = filterBySeverity(regressions, minSeverity)

  // Check staleness
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS
  const staleWarning = checkStaleness(baseline, staleDays)

  const summary = computeSummary(current, regressions, resolved, filteredRegressions, baseline)

  return { baseline, current, regressions, resolved, filteredRegressions, staleWarning, summary }
}

// =============================================================================
// Baseline file I/O
// =============================================================================

function baselinePath(projectDir: string): string {
  return path.join(projectDir, BASELINE_DIR, BASELINE_FILE)
}

export async function readBaseline(projectDir: string): Promise<SecurityBaseline | null> {
  const bp = baselinePath(projectDir)
  if (!await fs.pathExists(bp)) return null
  try {
    return await fs.readJson(bp)
  } catch {
    return null
  }
}

export async function writeBaseline(projectDir: string, baseline: SecurityBaseline): Promise<void> {
  const bp = baselinePath(projectDir)
  await fs.ensureDir(path.dirname(bp))
  await fs.writeJson(bp, baseline, { spaces: 2 })
}

// =============================================================================
// Run audit tool
// =============================================================================

async function runAuditTool(
  projectDir: string,
  auditCmd: { cmd: string; args: string[] }
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(auditCmd.cmd, auditCmd.args, {
      cwd: projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (err: unknown) {
    // npm audit exits non-zero when vulns are found — that's expected
    // We still want the stdout (JSON output)
    if (err && typeof err === 'object' && 'stdout' in err) {
      const stdout = (err as { stdout: string }).stdout
      if (stdout && stdout.trim().length > 0) return stdout
    }
    throw err
  }
}

// =============================================================================
// Main security commands
// =============================================================================

function report(onStep: SecurityStepCallback, id: string, label: string, status: SecurityStepStatus, detail?: string) {
  onStep({ id, label, status, detail })
}

export async function runSecurity(
  mode: SecurityMode,
  projectDir: string,
  onStep: SecurityStepCallback,
  options: SecurityCheckOptions = {}
): Promise<SecurityCheckResult | null> {
  // ── Detect stack ────────────────────────────────────────────────────────
  report(onStep, 'detect', 'Detecting stack', 'running')
  let stackInfo: Awaited<ReturnType<typeof detectCIStack>>
  try {
    stackInfo = await detectCIStack(projectDir)
    report(onStep, 'detect', `Stack: ${stackInfo.stackType} (${stackInfo.buildTool})`, 'done')
  } catch (e) {
    report(onStep, 'detect', 'Detecting stack', 'error', String(e))
    throw e
  }

  // ── Resolve audit command ──────────────────────────────────────────────
  const auditCmd = getAuditCommand(stackInfo.stackType, stackInfo.buildTool)
  if (!auditCmd) {
    report(onStep, 'audit', 'Security audit', 'error',
      `No audit tool for stack "${stackInfo.stackType}". Supported: node, python, go, rust`)
    throw new Error(`Unsupported stack for security audit: ${stackInfo.stackType}`)
  }

  // ── Run audit ──────────────────────────────────────────────────────────
  report(onStep, 'audit', `Running ${auditCmd.cmd} audit`, 'running')
  let raw: string
  try {
    raw = await runAuditTool(projectDir, auditCmd)
    report(onStep, 'audit', `Audit complete`, 'done')
  } catch (e) {
    report(onStep, 'audit', `Audit failed`, 'error',
      `${auditCmd.cmd} not found or failed. Install it first.`)
    throw e
  }

  // ── Parse findings ─────────────────────────────────────────────────────
  const findings = parseAuditOutput(stackInfo.stackType, raw)

  switch (mode) {
    case 'baseline':
    case 'update': {
      report(onStep, 'save', mode === 'update' ? 'Updating baseline' : 'Creating baseline', 'running')

      // Preserve createdAt and allowlist on update
      let createdAt = new Date().toISOString()
      let allowlist: string[] = []
      if (mode === 'update') {
        const existing = await readBaseline(projectDir)
        if (existing) {
          createdAt = existing.createdAt
          allowlist = existing.allowlist ?? []
        }
      }

      const baseline: SecurityBaseline = {
        version: BASELINE_VERSION,
        createdAt,
        updatedAt: mode === 'update' ? new Date().toISOString() : undefined,
        stack: stackInfo.stackType,
        buildTool: stackInfo.buildTool,
        findings,
        findingKeys: findings.map(makeFindingKey),
        allowlist,
      }
      await writeBaseline(projectDir, baseline)
      report(onStep, 'save',
        `Baseline saved with ${findings.length} finding(s)`, 'done',
        baselinePath(projectDir))
      return null
    }

    case 'check': {
      report(onStep, 'check', 'Checking for regressions', 'running')
      const existing = await readBaseline(projectDir)
      if (!existing) {
        report(onStep, 'check', 'No baseline found', 'error',
          'Run `javi-forge security baseline` first to create a baseline')
        throw new Error('No security baseline found. Run `javi-forge security baseline` first.')
      }

      const result = detectRegressions(existing, findings, options)

      // Staleness warning
      if (result.staleWarning) {
        report(onStep, 'stale', 'Baseline staleness', 'skipped', result.staleWarning)
      }

      // Summary line
      const { summary } = result
      const sevBreakdown = Object.entries(summary.bySeverity)
        .filter(([, count]) => count > 0)
        .map(([sev, count]) => `${count} ${sev}`)
        .join(', ')
      if (sevBreakdown) {
        report(onStep, 'summary', `Current findings: ${summary.total} (${sevBreakdown})`, 'done')
      }

      // Use filteredRegressions (severity-filtered + allowlist-filtered) for pass/fail
      if (result.filteredRegressions.length === 0) {
        const resolvedMsg = result.resolved.length > 0
          ? ` (${result.resolved.length} resolved)`
          : ''
        const belowThreshold = result.regressions.length > result.filteredRegressions.length
          ? ` (${result.regressions.length - result.filteredRegressions.length} below threshold)`
          : ''
        report(onStep, 'check', `No actionable regressions${resolvedMsg}${belowThreshold}`, 'done')
      } else {
        const details = result.filteredRegressions
          .map(r => `  ${r.severity.toUpperCase()} ${r.package}: ${r.title}`)
          .join('\n')
        report(onStep, 'check',
          `${result.filteredRegressions.length} regression(s) found`, 'error', details)
      }

      return result
    }

    case 'allowlist': {
      report(onStep, 'allowlist', 'Updating allowlist', 'running')
      const existing = await readBaseline(projectDir)
      if (!existing) {
        report(onStep, 'allowlist', 'No baseline found', 'error',
          'Run `javi-forge security baseline` first to create a baseline')
        throw new Error('No security baseline found. Run `javi-forge security baseline` first.')
      }

      // Add all current findings to the allowlist
      const currentKeys = findings.map(makeFindingKey)
      const existingAllowlist = new Set(existing.allowlist ?? [])
      for (const key of currentKeys) {
        existingAllowlist.add(key)
      }

      existing.allowlist = [...existingAllowlist]
      existing.updatedAt = new Date().toISOString()
      await writeBaseline(projectDir, existing)
      report(onStep, 'allowlist',
        `Allowlist updated: ${existingAllowlist.size} finding(s) allowed`, 'done',
        baselinePath(projectDir))
      return null
    }
  }
}
