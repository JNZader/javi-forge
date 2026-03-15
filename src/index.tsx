#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import meow from 'meow'
import App from './ui/App.js'
import Doctor from './ui/Doctor.js'
import AnalyzeUI from './ui/AnalyzeUI.js'
import { CIProvider as CIContextProvider } from './ui/CIContext.js'
import type { Stack, CIProvider, MemoryOption } from './types/index.js'

const cli = meow(`
  Usage
    $ javi-forge [command] [options]

  Commands
    init        Bootstrap a new project (default)
    analyze     Run repoforge skills analysis
    doctor      Show health report

  Options
    --dry-run       Preview changes without writing files
    --stack         Project stack (node, python, go, rust, java-gradle, java-maven, elixir)
    --ci            CI provider (github, gitlab, woodpecker)
    --memory        Memory module (engram, obsidian-brain, memory-simple, none)
    --project-name  Project name (skips name prompt)
    --ghagga        Enable GHAGGA review system
    --batch         Non-interactive mode (auto-proceed, no keyboard input)
    --version       Show version
    --help          Show this help

  Examples
    $ javi-forge
    $ javi-forge init --dry-run
    $ javi-forge init --stack node --ci github
    $ javi-forge init --dry-run --project-name app --stack node --ci github --batch
    $ javi-forge analyze
    $ javi-forge analyze --dry-run
    $ javi-forge doctor
`, {
  importMeta: import.meta,
  flags: {
    dryRun:      { type: 'boolean', default: false },
    stack:       { type: 'string',  default: '' },
    ci:          { type: 'string',  default: '' },
    memory:      { type: 'string',  default: '' },
    projectName: { type: 'string',  default: '' },
    ghagga:      { type: 'boolean', default: false },
    batch:       { type: 'boolean', default: false },
  }
})

const subcommand = cli.input[0] ?? 'init'

const VALID_STACKS = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven', 'elixir']
const VALID_CI = ['github', 'gitlab', 'woodpecker']
const VALID_MEMORY = ['engram', 'obsidian-brain', 'memory-simple', 'none']

const isCI = cli.flags.batch || process.env['CI'] === '1' || process.env['CI'] === 'true'

switch (subcommand) {
  case 'doctor': {
    render(
      <CIContextProvider isCI={isCI}>
        <Doctor />
      </CIContextProvider>
    )
    break
  }

  case 'analyze': {
    render(
      <CIContextProvider isCI={isCI}>
        <AnalyzeUI dryRun={cli.flags.dryRun} />
      </CIContextProvider>
    )
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
        />
      </CIContextProvider>
    )
    break
  }
}
