import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import HookProfileSelector from './HookProfileSelector.js'
import { CIProvider } from './CIContext.js'

/**
 * HookProfileSelector — single-select for hook reliability profiles.
 *
 * Risk: selected profile drives profile.json content. Wrong default or
 * broken selection = wrong hook behavior for all devs on that project.
 */

function renderWithCI(ui: React.ReactElement, isCI = false) {
  return render(
    React.createElement(CIProvider, { isCI }, ui)
  )
}

describe('HookProfileSelector', () => {
  it('renders all three profiles', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    const frame = lastFrame()!
    expect(frame).toContain('Minimal')
    expect(frame).toContain('Standard')
    expect(frame).toContain('Strict')
  })

  it('renders profile descriptions', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    const frame = lastFrame()!
    expect(frame).toContain('pre-commit only')
    expect(frame).toContain('pre-push')
    expect(frame).toContain('commit-msg')
  })

  it('defaults to Standard profile (index 1)', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    // Standard should be highlighted (shown with filled circle ◉)
    const frame = lastFrame()!
    // The cursor arrow should be next to Standard
    const lines = frame.split('\n')
    const standardLine = lines.find(l => l.includes('Standard'))
    expect(standardLine).toBeDefined()
    expect(standardLine).toContain('▶')
  })

  it('shows navigation hint', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    const frame = lastFrame()!
    expect(frame).toContain('navigate')
    expect(frame).toContain('confirm')
  })

  it('auto-confirms with standard profile in CI mode', async () => {
    const onConfirm = vi.fn()
    renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm }),
      true
    )

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    expect(onConfirm.mock.calls[0][0]).toBe('standard')
  })

  it('respects presetProfile prop', async () => {
    const onConfirm = vi.fn()
    renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm, presetProfile: 'strict' }),
      true
    )

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    expect(onConfirm.mock.calls[0][0]).toBe('strict')
  })

  it('confirms selection on Enter', async () => {
    const onConfirm = vi.fn()
    const { stdin } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    stdin.write('\r')

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    // Default is standard
    expect(onConfirm.mock.calls[0][0]).toBe('standard')
  })

  it('navigates down to strict and confirms', async () => {
    const onConfirm = vi.fn()
    const { stdin, lastFrame } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    // cursor starts at Standard (1), move down to Strict (2)
    stdin.write('\u001B[B') // down arrow

    // Wait for the cursor to move (Strict line should now have the arrow)
    await vi.waitFor(() => {
      const frame = lastFrame()!
      const lines = frame.split('\n')
      const strictLine = lines.find(l => l.includes('Strict'))
      expect(strictLine).toContain('▶')
    })

    stdin.write('\r')

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    expect(onConfirm.mock.calls[0][0]).toBe('strict')
  })

  it('navigates up to minimal and confirms', async () => {
    const onConfirm = vi.fn()
    const { stdin, lastFrame } = renderWithCI(
      React.createElement(HookProfileSelector, { onConfirm })
    )

    // cursor starts at Standard (1), move up to Minimal (0)
    stdin.write('\u001B[A') // up arrow

    // Wait for the cursor to move (Minimal line should now have the arrow)
    await vi.waitFor(() => {
      const frame = lastFrame()!
      const lines = frame.split('\n')
      const minimalLine = lines.find(l => l.includes('Minimal'))
      expect(minimalLine).toContain('▶')
    })

    stdin.write('\r')

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    expect(onConfirm.mock.calls[0][0]).toBe('minimal')
  })
})
