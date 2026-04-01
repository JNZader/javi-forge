#!/usr/bin/env node
import path from 'path'
import React from 'react'
import { render } from 'ink'
import { PassThrough } from 'node:stream'
import meow from 'meow'
import updateNotifier from 'update-notifier'
import { createRequire } from 'module'
import App from './ui/App.js'
import Doctor from './ui/Doctor.js'
import AnalyzeUI from './ui/AnalyzeUI.js'
import Plugin from './ui/Plugin.js'
import Skills from './ui/Skills.js'
import LlmsTxt from './ui/LlmsTxt.js'
import CI from './ui/CI.js'
import { CIProvider as CIContextProvider } from './ui/CIContext.js'
import type { Stack, CIProvider, MemoryOption } from './types/index.js'
import type { CIMode } from './commands/ci.js'
import type { SecurityMode } from './commands/security.js'

// Check for updates in background (non-blocking, cached 24h)
const _require = createRequire(import.meta.url)
const pkg = _require('../package.json') as { name: string; version: string }
updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 }).notify()

const cli = meow(`
  Usage
    $ javi-forge [command] [options]

  Commands
    init              Bootstrap a new project (default)
    ci                Run CI simulation (lint + compile + test + security + ghagga)
    tdd init          Install TDD-enforcing pre-commit hook (auto-detects stack)
    analyze           Run repoforge skills analysis
    doctor            Show health report
    plugin add        Install a plugin from GitHub (org/repo)
    plugin remove     Remove an installed plugin
    plugin list       List installed plugins
    plugin search     Search the plugin registry
    plugin validate   Validate a local plugin directory
    plugin sync       Auto-detect and wire installed plugins
    plugin export     Export plugin to Agent Skills spec format (skills.json)
    plugin export     --codex: Export plugin to Codex-compatible TOML subagent files
    plugin import     Import an Agent Skills spec package as a javi-forge plugin
    skills doctor     Show skills health report (add --deep for conflict detection)
    skills budget     Show token cost of loaded skills (add -b N for custom budget)
    skills score      Score a skill on quality dimensions (completeness, clarity, testability, token-efficiency)
    skills benchmark  Benchmark a skill with structural quality checks
    skills auto-install  Auto-detect project stack and install matching AI skills
    skill publish     Package a skill directory for marketplace distribution (generates plugin.json)
    security baseline Create security baseline from current audit findings
    security check    Check for regressions against baseline (exits non-zero if found)
    security update   Re-snapshot baseline (acknowledge current vulns)
    llms-txt          Generate AI-friendly llms.txt for current project

  Options
    --dry-run       Preview changes without writing files
    --stack         Project stack (node, python, go, rust, java-gradle, java-maven, elixir)
    --ci            CI provider (github, gitlab, woodpecker)
    --memory        Memory module (engram, obsidian-brain, memory-simple, none)
    --project-name  Project name (skips name prompt)
    --ghagga        Enable GHAGGA review system
    --mock          Enable mock-first mode (no real API keys needed)
    --batch         Non-interactive mode (auto-proceed, no keyboard input)
    --deep          Enable deep analysis (conflict + duplicate detection)
    --budget, -b    Token budget limit for skills (default: 8000)
    --skills-dir    Custom skills directory path
    --author        Author name for skill publish
    --repo          Repository URL for skill publish
    --version       Show version
    --help          Show this help

  CI options (javi-forge ci)
    --quick         Lint + compile only (fast, for pre-commit)
    --shell         Open interactive shell in CI container
    --detect        Show detected stack and exit
    --no-docker     Run commands natively (no Docker)
    --no-ci-ghagga  Skip GHAGGA review
    --no-security   Skip Semgrep security scan
    --timeout N     Per-step timeout in seconds (default: 600)

  CI hooks (javi-forge ci init)
    Install git hooks that call javi-forge ci.
    No files copied — hooks reference the global CLI.

  Examples
    $ javi-forge
    $ javi-forge init --dry-run
    $ javi-forge init --stack node --ci github
    $ javi-forge ci
    $ javi-forge ci init
    $ javi-forge tdd init
    $ javi-forge ci --quick
    $ javi-forge ci --no-ci-ghagga --no-security
    $ javi-forge ci --no-docker
    $ javi-forge ci --shell
    $ javi-forge analyze
    $ javi-forge doctor
    $ javi-forge plugin add mapbox/agent-skills
    $ javi-forge plugin list
`, {
  importMeta: import.meta,
  flags: {
    dryRun:      { type: 'boolean', default: false },
    stack:       { type: 'string',  default: '' },
    ci:          { type: 'string',  default: '' },
    memory:      { type: 'string',  default: '' },
    projectName: { type: 'string',  default: '' },
    ghagga:      { type: 'boolean', default: false },
    mock:        { type: 'boolean', default: false },
    batch:       { type: 'boolean', default: false },
    // CI flags
    quick:       { type: 'boolean', default: false },
    shell:       { type: 'boolean', default: false },
    detect:      { type: 'boolean', default: false },
    docker:      { type: 'boolean', default: true },
    ciGhagga:    { type: 'boolean', default: true },
    security:    { type: 'boolean', default: true },
    timeout:     { type: 'number',  default: 600 },
    // Plugin flags
    codex:       { type: 'boolean', default: false },
    // Skills flags
    deep:        { type: 'boolean', default: false },
    budget:      { type: 'number',  shortFlag: 'b', default: 8000 },
    skillsDir:   { type: 'string',  default: '' },
    // Skill publish flags
    author:      { type: 'string',  default: '' },
    repo:        { type: 'string',  default: '' },
  }
})

const subcommand = cli.input[0] ?? 'init'

const VALID_STACKS = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven', 'elixir']
const VALID_CI = ['github', 'gitlab', 'woodpecker']
const VALID_MEMORY = ['engram', 'obsidian-brain', 'memory-simple', 'none']

const isCI = cli.flags.batch || process.env['CI'] === '1' || process.env['CI'] === 'true'

// When stdin doesn't support raw mode (pipes, subprocesses, CI), provide a fake
// stdin stream so Ink doesn't crash trying to enable raw mode on a non-TTY pipe.
const isTTY = process.stdin.isTTY === true
const fakeStdin = new PassThrough() as unknown as NodeJS.ReadStream
Object.defineProperty(fakeStdin, 'isTTY', { value: false })
const inkStdin = isTTY ? process.stdin : fakeStdin

switch (subcommand) {
  case 'tdd': {
    if (cli.input[1] === 'init') {
      const { installTddHooks } = await import('./commands/tdd.js')
      const { installed, errors } = await installTddHooks(process.cwd())
      if (installed.length > 0) {
        console.log(`\u2713 Installed TDD hooks: ${installed.join(', ')}`)
        console.log('  Pre-commit hook enforces tests must pass before commit')
      }
      for (const err of errors) {
        console.error(`\u2717 ${err}`)
      }
      process.exit(errors.length > 0 ? 1 : 0)
    } else {
      console.error('Usage: javi-forge tdd init')
      console.error('  init  Install TDD-enforcing pre-commit hook')
      process.exit(1)
    }
    break
  }

  case 'ci': {
    // Sub-command: javi-forge ci init → install git hooks
    if (cli.input[1] === 'init') {
      const { installCIHooks } = await import('./commands/ci.js')
      const { installed, errors } = await installCIHooks(process.cwd())
      if (installed.length > 0) {
        console.log(`✓ Installed git hooks: ${installed.join(', ')}`)
        console.log('  Hooks call javi-forge ci (with npx fallback)')
      }
      for (const err of errors) {
        console.error(`✗ ${err}`)
      }
      process.exit(errors.length > 0 ? 1 : 0)
      break
    }

    const ciMode: CIMode = cli.flags.detect ? 'detect'
      : cli.flags.shell   ? 'shell'
      : cli.flags.quick   ? 'quick'
      : 'full'

    render(
      <CIContextProvider isCI={true}>
        <CI
          projectDir={process.cwd()}
          mode={ciMode}
          noDocker={!cli.flags.docker}
          noGhagga={!cli.flags.ciGhagga}
          noSecurity={!cli.flags.security}
          timeout={cli.flags.timeout}
        />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }

  case 'doctor': {
    render(
      <CIContextProvider isCI={isCI}>
        <Doctor />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }

  case 'analyze': {
    render(
      <CIContextProvider isCI={isCI}>
        <AnalyzeUI dryRun={cli.flags.dryRun} />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }

  case 'llms-txt': {
    render(
      <CIContextProvider isCI={isCI}>
        <LlmsTxt projectDir={process.cwd()} dryRun={cli.flags.dryRun} />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }

  case 'plugin': {
    const pluginAction = cli.input[1] as 'add' | 'remove' | 'list' | 'search' | 'validate' | 'sync' | 'export' | 'import' | undefined
    const VALID_PLUGIN_ACTIONS = ['add', 'remove', 'list', 'search', 'validate', 'sync', 'export', 'import']
    const action = pluginAction && VALID_PLUGIN_ACTIONS.includes(pluginAction) ? pluginAction : 'list'
    const target = cli.input[2]

    render(
      <CIContextProvider isCI={isCI}>
        <Plugin action={action} target={target} dryRun={cli.flags.dryRun} codex={cli.flags.codex} />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }

  case 'skills': {
    const skillsAction = cli.input[1] as string | undefined
    const VALID_SKILLS_ACTIONS = ['doctor', 'budget', 'score', 'benchmark', 'auto-install']
    if (!skillsAction || !VALID_SKILLS_ACTIONS.includes(skillsAction)) {
      console.error('Usage: javi-forge skills <doctor|budget|score|benchmark|auto-install>')
      console.error('  doctor        Show skills health report (add --deep for conflict detection)')
      console.error('  budget        Show token cost of loaded skills (add -b N for custom budget)')
      console.error('  score         Score a skill on quality dimensions (0-100)')
      console.error('  benchmark     Benchmark a skill with structural quality checks')
      console.error('  auto-install  Auto-detect project stack and install matching AI skills')
      process.exit(1)
      break
    }

    // Auto-install is a non-interactive CLI command
    if (skillsAction === 'auto-install') {
      const { autoInstallSkills, formatAutoInstallSummary } = await import('./lib/auto-skill-install.js')
      const result = await autoInstallSkills({
        projectDir: process.cwd(),
        skillsSourceDir: cli.flags.skillsDir || undefined,
        skillsTargetDir: cli.flags.skillsDir || undefined,
        dryRun: cli.flags.dryRun,
      })
      console.log(formatAutoInstallSummary(result))
      const hasIssues = result.notFound.length > 0
      process.exit(hasIssues ? 1 : 0)
      break
    }

    // Score and benchmark are non-interactive CLI commands
    if (skillsAction === 'score' || skillsAction === 'benchmark') {
      const targetSkill = cli.input[2]
      if (!targetSkill) {
        console.error(`Usage: javi-forge skills ${skillsAction} <skill-name>`)
        process.exit(1)
        break
      }

      const skillsDir = cli.flags.skillsDir || path.join(
        process.env['HOME'] ?? '~', '.claude', 'skills'
      )
      const skillPath = path.join(skillsDir, targetSkill, 'SKILL.md')

      if (skillsAction === 'score') {
        const { scoreSkill } = await import('./commands/skills.js')
        const result = await scoreSkill(skillPath, cli.flags.budget)
        if (!result) {
          console.error(`\u2717 Skill not found: ${skillPath}`)
          process.exit(1)
          break
        }
        console.log(`\nSkill: ${result.skillName}`)
        console.log(`  Completeness:      ${result.completeness}/100`)
        console.log(`  Clarity:           ${result.clarity}/100`)
        console.log(`  Testability:       ${result.testability}/100`)
        console.log(`  Token Efficiency:  ${result.tokenEfficiency}/100`)
        console.log(`  Overall:           ${result.overall}/100`)
        console.log(`  Threshold:         ${result.threshold}`)
        console.log(`  Status:            ${result.passing ? '\u2713 PASSING' : '\u2717 FAILING'}`)
        process.exit(result.passing ? 0 : 1)
      } else {
        const { benchmarkSkill } = await import('./commands/skills.js')
        const result = await benchmarkSkill(skillPath)
        if (!result) {
          console.error(`\u2717 Skill not found: ${skillPath}`)
          process.exit(1)
          break
        }
        console.log(`\nBenchmark: ${result.skillName}`)
        for (const check of result.checks) {
          const icon = check.passed ? '\u2713' : '\u2717'
          console.log(`  ${icon} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
        }
        console.log(`\n  Pass rate: ${result.passRate}%`)
        process.exit(result.passRate >= 50 ? 0 : 1)
      }
      break
    }

    const skillsMode = skillsAction as 'doctor' | 'budget'
    render(
      <CIContextProvider isCI={isCI}>
        <Skills
          mode={skillsMode}
          budget={cli.flags.budget}
          deep={cli.flags.deep}
          skillsDir={cli.flags.skillsDir || undefined}
        />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }

  case 'skill': {
    const skillAction = cli.input[1] as string | undefined

    if (skillAction !== 'publish') {
      console.error('Usage: javi-forge skill <publish>')
      console.error('  publish  Package a skill directory for marketplace distribution')
      process.exit(1)
      break
    }

    const targetDir = cli.input[2] ?? process.cwd()
    const { publishSkill } = await import('./lib/skill-publish.js')
    const result = await publishSkill({
      skillDir: path.resolve(targetDir),
      author: cli.flags.author || undefined,
      repository: cli.flags.repo || undefined,
      dryRun: cli.flags.dryRun,
    })

    if (result.success) {
      console.log(`\u2713 Published: ${result.manifest?.name}@${result.manifest?.version}`)
      console.log(`  plugin.json: ${result.pluginJsonPath}`)
      if (result.manifest?.tags?.length) {
        console.log(`  tags: ${result.manifest.tags.join(', ')}`)
      }
      if (cli.flags.dryRun) {
        console.log('  (dry-run: no files written)')
      }
    } else {
      console.error(`\u2717 ${result.error}`)
      process.exit(1)
    }
    break
  }

  case 'security': {
    const securityAction = cli.input[1] as string | undefined
    const VALID_SECURITY_ACTIONS = ['baseline', 'check', 'update']
    if (!securityAction || !VALID_SECURITY_ACTIONS.includes(securityAction)) {
      console.error('Usage: javi-forge security <baseline|check|update>')
      console.error('  baseline  Create security baseline from current audit findings')
      console.error('  check     Check for regressions against baseline')
      console.error('  update    Re-snapshot baseline (acknowledge current vulns)')
      process.exit(1)
      break
    }

    const { runSecurity } = await import('./commands/security.js')
    const mode = securityAction as SecurityMode
    try {
      const result = await runSecurity(mode, process.cwd(), (step) => {
        const icon = step.status === 'done' ? '\u2713'
          : step.status === 'error' ? '\u2717'
          : step.status === 'skipped' ? '-'
          : '\u25CB'
        console.log(`${icon} ${step.label}`)
        if (step.detail) console.log(`  ${step.detail}`)
      })

      if (mode === 'check' && result && result.regressions.length > 0) {
        process.exit(1)
      }
    } catch {
      process.exit(1)
    }
    break
  }

  case 'init':
  default: {
    const presetStack = VALID_STACKS.includes(cli.flags.stack)
      ? cli.flags.stack as Stack
      : undefined
    const presetCI = VALID_CI.includes(cli.flags.ci)
      ? cli.flags.ci as CIProvider
      : undefined
    const presetMemory = VALID_MEMORY.includes(cli.flags.memory)
      ? cli.flags.memory as MemoryOption
      : undefined
    const presetName = cli.flags.projectName || undefined

    render(
      <CIContextProvider isCI={isCI}>
        <App
          dryRun={cli.flags.dryRun}
          presetStack={presetStack}
          presetCI={presetCI}
          presetMemory={presetMemory}
          presetName={presetName}
          presetGhagga={cli.flags.ghagga}
          presetMock={cli.flags.mock ?? false}
        />
      </CIContextProvider>,
      { stdin: inkStdin }
    )
    break
  }
}
