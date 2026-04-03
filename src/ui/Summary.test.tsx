import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import Summary from './Summary.js'
import { CIProvider } from './CIContext.js'
import type { InitStep } from '../types/index.js'

/**
 * Summary — final output shown to user after scaffolding.
 *
 * Risk: inaccurate summary misleads user about what happened.
 * Must correctly reflect step statuses, counts, and next steps.
 */

// ink's useApp().exit() must be mocked — it's not available outside <App>
vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')
  return {
    ...actual,
    useApp: () => ({ exit: vi.fn() }),
  }
})

function renderWithCI(ui: React.ReactElement, isCI = false) {
  return render(
    React.createElement(CIProvider, { isCI }, ui)
  )
}

function makeSteps(overrides: Partial<InitStep>[] = []): InitStep[] {
  const base: InitStep[] = [
    { id: 'sdd', label: 'SDD setup', status: 'done' },
    { id: 'context', label: 'Context directory', status: 'done' },
    { id: 'claude', label: 'CLAUDE.md', status: 'skipped', detail: 'already exists' },
  ]
  return overrides.length > 0
    ? overrides.map((o, i) => ({ ...base[i % base.length], ...o }))
    : base
}

describe('Summary', () => {
  it('shows project scaffolded title when no errors', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
      })
    )

    expect(lastFrame()!).toContain('Project scaffolded')
  })

  it('shows dry run title when dryRun is true', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: true,
        projectName: 'my-app',
      })
    )

    const frame = lastFrame()!
    expect(frame).toContain('Dry run complete')
    expect(frame).toContain('No changes were made')
  })

  it('displays project name', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'awesome-project',
      })
    )

    expect(lastFrame()!).toContain('awesome-project')
  })

  it('displays stack when provided', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
        stack: 'node',
      })
    )

    expect(lastFrame()!).toContain('node')
  })

  it('shows elapsed time when provided', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
        elapsedMs: 2500,
      })
    )

    expect(lastFrame()!).toContain('2.5s')
  })

  it('counts done and skipped steps correctly', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
      })
    )

    const frame = lastFrame()!
    // 2 done, 1 skipped
    expect(frame).toContain('2 steps completed')
    expect(frame).toContain('1 steps skipped')
  })

  it('shows error count and details when steps have errors', () => {
    const steps: InitStep[] = [
      { id: 'ok', label: 'Good step', status: 'done' },
      { id: 'bad', label: 'Bad step', status: 'error', detail: 'permission denied' },
    ]

    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps,
        dryRun: false,
        projectName: 'my-app',
      })
    )

    const frame = lastFrame()!
    expect(frame).toContain('1 errors')
    expect(frame).toContain('Bad step')
    expect(frame).toContain('permission denied')
  })

  it('shows next steps when no errors and not dry run', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
      })
    )

    const frame = lastFrame()!
    expect(frame).toContain('Next steps')
    expect(frame).toContain('cd my-app')
    expect(frame).toContain('npx javi-ai sync')
    expect(frame).toContain('javi-forge doctor')
  })

  it('shows install hint for node stack', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
        stack: 'node',
      })
    )

    expect(lastFrame()!).toContain('pnpm install')
  })

  it('shows install hint for python stack', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
        stack: 'python',
      })
    )

    expect(lastFrame()!).toContain('pip install -r requirements.txt')
  })

  it('shows install hint for go stack', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: false,
        projectName: 'my-app',
        stack: 'go',
      })
    )

    expect(lastFrame()!).toContain('go mod tidy')
  })

  it('hides next steps on dry run', () => {
    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps: makeSteps(),
        dryRun: true,
        projectName: 'my-app',
      })
    )

    expect(lastFrame()!).not.toContain('Next steps')
  })

  it('hides next steps when there are errors', () => {
    const steps: InitStep[] = [
      { id: 'bad', label: 'Fail', status: 'error', detail: 'boom' },
    ]

    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps,
        dryRun: false,
        projectName: 'my-app',
      })
    )

    expect(lastFrame()!).not.toContain('Next steps')
  })

  it('renders step labels with status indicators', () => {
    const steps: InitStep[] = [
      { id: 'a', label: 'Done step', status: 'done' },
      { id: 'b', label: 'Skipped step', status: 'skipped' },
      { id: 'c', label: 'Error step', status: 'error' },
    ]

    const { lastFrame } = renderWithCI(
      React.createElement(Summary, {
        steps,
        dryRun: false,
        projectName: 'my-app',
      })
    )

    const frame = lastFrame()!
    expect(frame).toContain('Done step')
    expect(frame).toContain('Skipped step')
    expect(frame).toContain('Error step')
  })
})
