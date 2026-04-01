import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs-extra'
import {
  getAuditCommand,
  parseNpmAudit,
  parsePipAudit,
  parseCargoAudit,
  parseGovulncheck,
  parseAuditOutput,
  makeFindingKey,
  detectRegressions,
  readBaseline,
  writeBaseline,
} from './security.js'
import type { SecurityFinding, SecurityBaseline } from '../types/index.js'

// =============================================================================
// getAuditCommand
// =============================================================================

describe('getAuditCommand', () => {
  it('returns npm audit for node + npm', () => {
    const result = getAuditCommand('node', 'npm')
    expect(result).toEqual({ cmd: 'npm', args: ['audit', '--json'] })
  })

  it('returns pnpm audit for node + pnpm', () => {
    const result = getAuditCommand('node', 'pnpm')
    expect(result).toEqual({ cmd: 'pnpm', args: ['audit', '--json'] })
  })

  it('returns yarn npm audit for node + yarn', () => {
    const result = getAuditCommand('node', 'yarn')
    expect(result).toEqual({ cmd: 'yarn', args: ['npm', 'audit', '--json'] })
  })

  it('returns pip-audit for python', () => {
    const result = getAuditCommand('python', 'pip')
    expect(result).toEqual({ cmd: 'pip-audit', args: ['--format=json', '--output=-'] })
  })

  it('returns govulncheck for go', () => {
    const result = getAuditCommand('go', 'go')
    expect(result).toEqual({ cmd: 'govulncheck', args: ['-json', './...'] })
  })

  it('returns cargo audit for rust', () => {
    const result = getAuditCommand('rust', 'cargo')
    expect(result).toEqual({ cmd: 'cargo', args: ['audit', '--json'] })
  })

  it('returns null for unsupported stacks', () => {
    expect(getAuditCommand('java-gradle', 'gradle')).toBeNull()
    expect(getAuditCommand('java-maven', 'mvn')).toBeNull()
    expect(getAuditCommand('elixir', 'mix')).toBeNull()
  })
})

// =============================================================================
// parseNpmAudit
// =============================================================================

describe('parseNpmAudit', () => {
  it('parses npm audit v2 JSON format', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        lodash: {
          severity: 'high',
          via: [
            { title: 'Prototype Pollution', url: 'https://ghsa.example/1', source: 12345 },
          ],
        },
      },
    })

    const findings = parseNpmAudit(raw)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual({
      id: 'GHSA-12345',
      severity: 'high',
      package: 'lodash',
      title: 'Prototype Pollution',
      url: 'https://ghsa.example/1',
    })
  })

  it('handles vulns with no direct via (transitive)', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        'deep-dep': {
          severity: 'moderate',
          via: ['lodash'],
        },
      },
    })

    const findings = parseNpmAudit(raw)
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('npm-deep-dep')
  })

  it('handles multiple via entries', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        express: {
          severity: 'critical',
          via: [
            { title: 'Vuln A', source: 1 },
            { title: 'Vuln B', source: 2 },
          ],
        },
      },
    })

    const findings = parseNpmAudit(raw)
    expect(findings).toHaveLength(2)
  })

  it('returns empty array on invalid JSON', () => {
    expect(parseNpmAudit('not json')).toEqual([])
  })

  it('returns empty array on empty vulnerabilities', () => {
    expect(parseNpmAudit(JSON.stringify({ vulnerabilities: {} }))).toEqual([])
  })
})

// =============================================================================
// parsePipAudit
// =============================================================================

describe('parsePipAudit', () => {
  it('parses pip-audit JSON format', () => {
    const raw = JSON.stringify([
      {
        name: 'requests',
        version: '2.25.0',
        vulns: [
          { id: 'CVE-2023-1234', fix_versions: ['2.28.0'], description: 'SSRF vuln' },
        ],
      },
    ])

    const findings = parsePipAudit(raw)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual({
      id: 'CVE-2023-1234',
      severity: 'high',
      package: 'requests',
      title: 'SSRF vuln',
    })
  })

  it('returns empty on invalid JSON', () => {
    expect(parsePipAudit('nope')).toEqual([])
  })
})

// =============================================================================
// parseCargoAudit
// =============================================================================

describe('parseCargoAudit', () => {
  it('parses cargo audit JSON format', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        list: [
          {
            advisory: {
              id: 'RUSTSEC-2023-001',
              title: 'Memory safety issue',
              url: 'https://rustsec.org/1',
              cvss: { severity: 'HIGH' },
            },
            package: { name: 'tokio' },
          },
        ],
      },
    })

    const findings = parseCargoAudit(raw)
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('RUSTSEC-2023-001')
    expect(findings[0].severity).toBe('high')
  })

  it('returns empty on invalid JSON', () => {
    expect(parseCargoAudit('bad')).toEqual([])
  })
})

// =============================================================================
// parseGovulncheck
// =============================================================================

describe('parseGovulncheck', () => {
  it('parses govulncheck NDJSON format', () => {
    const lines = [
      JSON.stringify({
        osv: {
          id: 'GO-2023-0001',
          summary: 'SQL injection',
          affected: [{ package: { name: 'github.com/foo/bar' } }],
          references: [{ url: 'https://go.dev/1' }],
          database_specific: { severity: 'CRITICAL' },
        },
      }),
    ]

    const findings = parseGovulncheck(lines.join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('GO-2023-0001')
    expect(findings[0].severity).toBe('critical')
  })

  it('skips non-osv lines', () => {
    const raw = '{"config": {}}\n{"osv": {"id": "GO-1", "summary": "test", "affected": [{"package": {"name": "pkg"}}]}}'
    const findings = parseGovulncheck(raw)
    expect(findings).toHaveLength(1)
  })

  it('returns empty on invalid JSON', () => {
    expect(parseGovulncheck('garbage')).toEqual([])
  })
})

// =============================================================================
// parseAuditOutput — dispatch
// =============================================================================

describe('parseAuditOutput', () => {
  it('dispatches to correct parser for node', () => {
    const raw = JSON.stringify({ vulnerabilities: { x: { severity: 'low', via: [{ title: 'T', source: 1 }] } } })
    const findings = parseAuditOutput('node', raw)
    expect(findings).toHaveLength(1)
  })

  it('returns empty for unsupported stack', () => {
    expect(parseAuditOutput('java-gradle', '{}')).toEqual([])
  })
})

// =============================================================================
// makeFindingKey
// =============================================================================

describe('makeFindingKey', () => {
  it('creates composite key from id and package', () => {
    const finding: SecurityFinding = {
      id: 'CVE-2023-1',
      severity: 'high',
      package: 'lodash',
      title: 'test',
    }
    expect(makeFindingKey(finding)).toBe('CVE-2023-1:lodash')
  })
})

// =============================================================================
// detectRegressions
// =============================================================================

describe('detectRegressions', () => {
  const makeBaseline = (findings: SecurityFinding[]): SecurityBaseline => ({
    version: '1.0.0',
    createdAt: '2025-01-01T00:00:00.000Z',
    stack: 'node',
    buildTool: 'npm',
    findings,
    findingKeys: findings.map(makeFindingKey),
  })

  const finding = (id: string, pkg: string): SecurityFinding => ({
    id, severity: 'high', package: pkg, title: `vuln ${id}`,
  })

  it('reports no regressions when current matches baseline', () => {
    const f1 = finding('CVE-1', 'a')
    const f2 = finding('CVE-2', 'b')
    const baseline = makeBaseline([f1, f2])
    const result = detectRegressions(baseline, [f1, f2])

    expect(result.regressions).toHaveLength(0)
    expect(result.resolved).toHaveLength(0)
  })

  it('detects new findings as regressions', () => {
    const f1 = finding('CVE-1', 'a')
    const f2 = finding('CVE-2', 'b')
    const fNew = finding('CVE-3', 'c')
    const baseline = makeBaseline([f1, f2])
    const result = detectRegressions(baseline, [f1, f2, fNew])

    expect(result.regressions).toHaveLength(1)
    expect(result.regressions[0].id).toBe('CVE-3')
  })

  it('detects resolved findings', () => {
    const f1 = finding('CVE-1', 'a')
    const f2 = finding('CVE-2', 'b')
    const baseline = makeBaseline([f1, f2])
    const result = detectRegressions(baseline, [f1])

    expect(result.resolved).toHaveLength(1)
    expect(result.resolved[0].id).toBe('CVE-2')
  })

  it('handles empty baseline', () => {
    const baseline = makeBaseline([])
    const fNew = finding('CVE-1', 'a')
    const result = detectRegressions(baseline, [fNew])

    expect(result.regressions).toHaveLength(1)
  })

  it('handles empty current findings', () => {
    const f1 = finding('CVE-1', 'a')
    const baseline = makeBaseline([f1])
    const result = detectRegressions(baseline, [])

    expect(result.resolved).toHaveLength(1)
    expect(result.regressions).toHaveLength(0)
  })
})

// =============================================================================
// Baseline file I/O
// =============================================================================

describe('baseline I/O', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'javi-forge-sec-'))
  })

  afterEach(async () => {
    await fs.remove(tmpDir)
  })

  it('writeBaseline creates .javi-forge dir and writes JSON', async () => {
    const baseline: SecurityBaseline = {
      version: '1.0.0',
      createdAt: '2025-01-01T00:00:00.000Z',
      stack: 'node',
      buildTool: 'npm',
      findings: [],
      findingKeys: [],
    }

    await writeBaseline(tmpDir, baseline)

    const filePath = path.join(tmpDir, '.javi-forge', 'security-baseline.json')
    expect(await fs.pathExists(filePath)).toBe(true)
    const content = await fs.readJson(filePath)
    expect(content.version).toBe('1.0.0')
  })

  it('readBaseline returns null when file does not exist', async () => {
    const result = await readBaseline(tmpDir)
    expect(result).toBeNull()
  })

  it('readBaseline returns baseline when file exists', async () => {
    const baseline: SecurityBaseline = {
      version: '1.0.0',
      createdAt: '2025-01-01T00:00:00.000Z',
      stack: 'node',
      buildTool: 'npm',
      findings: [{ id: 'CVE-1', severity: 'high', package: 'test', title: 'Test vuln' }],
      findingKeys: ['CVE-1:test'],
    }
    await writeBaseline(tmpDir, baseline)

    const result = await readBaseline(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.findings).toHaveLength(1)
  })

  it('readBaseline returns null on corrupted JSON', async () => {
    const filePath = path.join(tmpDir, '.javi-forge', 'security-baseline.json')
    await fs.ensureDir(path.dirname(filePath))
    await fs.writeFile(filePath, 'not valid json')

    const result = await readBaseline(tmpDir)
    expect(result).toBeNull()
  })
})
