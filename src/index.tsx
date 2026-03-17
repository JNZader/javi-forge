#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import meow from 'meow'
import App from './ui/App.js'
import Doctor from './ui/Doctor.js'
import AnalyzeUI from './ui/AnalyzeUI.js'
import Plugin from './ui/Plugin.js'
import LlmsTxt from './ui/LlmsTxt.js'
import { CIProvider as CIContextProvider } from './ui/CIContext.js'
import type { Stack, CIProvider, MemoryOption } from './types/index.js'

const cli = meow(`
  Usage
    $ javi-forge [command] [options]

  Commands
    init              Bootstrap a new project (default)
    analyze           Run repoforge skills analysis
    doctor            Show health report
    plugin add        Install a plugin from GitHub (org/repo)
    plugin remove     Remove an installed plugin
    plugin list       List installed plugins
    plugin search     Search the plugin registry
    plugin validate   Validate a local plugin directory
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
    $ javi-forge plugin add mapbox/agent-skills
    $ javi-forge plugin list
    $ javi-forge plugin search ai
    $ javi-forge plugin validate ./my-plugin
    $ javi-forge plugin remove my-plugin
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

  case 'llms-txt': {
    render(
      <CIContextProvider isCI={isCI}>
        <LlmsTxt projectDir={process.cwd()} dryRun={cli.flags.dryRun} />
      </CIContextProvider>
    )
    break
  }

  case 'plugin': {
    const pluginAction = cli.input[1] as 'add' | 'remove' | 'list' | 'search' | 'validate' | undefined
    const VALID_PLUGIN_ACTIONS = ['add', 'remove', 'list', 'search', 'validate']
    const action = pluginAction && VALID_PLUGIN_ACTIONS.includes(pluginAction) ? pluginAction : 'list'
    const target = cli.input[2]

    render(
      <CIContextProvider isCI={isCI}>
        <Plugin action={action} target={target} dryRun={cli.flags.dryRun} />
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
          presetMock={cli.flags.mock ?? false}
        />
      </CIContextProvider>
    )
    break
  }
}
