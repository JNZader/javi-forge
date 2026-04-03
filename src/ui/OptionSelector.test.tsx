import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import OptionSelector from './OptionSelector.js'
import { CIProvider } from './CIContext.js'

/**
 * OptionSelector — multi-select with keyboard navigation.
 *
 * Risk: user selects options that drive scaffolding behavior.
 * Wrong defaults or broken toggle = wrong project output.
 */

function renderWithCI(ui: React.ReactElement, isCI = false) {
  return render(
    React.createElement(CIProvider, { isCI }, ui)
  )
}

describe('OptionSelector', () => {
  it('renders all option labels', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm })
    )

    const frame = lastFrame()!
    expect(frame).toContain('AI Config Sync')
    expect(frame).toContain('SDD (openspec/)')
    expect(frame).toContain('.context/ Directory')
    expect(frame).toContain('CLAUDE.md')
    expect(frame).toContain('GHAGGA Review')
    expect(frame).toContain('Security Hooks')
    expect(frame).toContain('Code Graph')
    expect(frame).toContain('Local AI Stack')
  })

  it('shows selection count with defaults', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm })
    )

    // Defaults: aiSync, sdd, contextDir, claudeMd, securityHooks = 5 selected
    const frame = lastFrame()!
    expect(frame).toContain('5 selected')
  })

  it('shows navigation hint', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm })
    )

    const frame = lastFrame()!
    expect(frame).toContain('navigate')
    expect(frame).toContain('toggle')
    expect(frame).toContain('confirm')
  })

  it('applies presetGhagga when true', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm, presetGhagga: true })
    )

    // 5 defaults + ghagga = 6 selected
    const frame = lastFrame()!
    expect(frame).toContain('6 selected')
  })

  it('applies presetLocalAi when true', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm, presetLocalAi: true })
    )

    // 5 defaults + localAi = 6 selected
    const frame = lastFrame()!
    expect(frame).toContain('6 selected')
  })

  it('applies both presets together', () => {
    const onConfirm = vi.fn()
    const { lastFrame } = renderWithCI(
      React.createElement(OptionSelector, {
        onConfirm,
        presetGhagga: true,
        presetLocalAi: true,
      })
    )

    // 5 defaults + ghagga + localAi = 7 selected
    const frame = lastFrame()!
    expect(frame).toContain('7 selected')
  })

  it('auto-confirms with defaults in CI mode', async () => {
    const onConfirm = vi.fn()
    renderWithCI(
      React.createElement(OptionSelector, { onConfirm }),
      true
    )

    // CI mode triggers useEffect → onConfirm with defaults
    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    const call = onConfirm.mock.calls[0][0]
    expect(call).toEqual({
      aiSync: true,
      sdd: true,
      contextDir: true,
      claudeMd: true,
      ghagga: false,
      securityHooks: true,
      codeGraph: false,
      localAi: false,
    })
  })

  it('auto-confirms with presets in CI mode', async () => {
    const onConfirm = vi.fn()
    renderWithCI(
      React.createElement(OptionSelector, {
        onConfirm,
        presetGhagga: true,
        presetLocalAi: true,
      }),
      true
    )

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    const call = onConfirm.mock.calls[0][0]
    expect(call.ghagga).toBe(true)
    expect(call.localAi).toBe(true)
  })

  it('toggles option on space keypress', async () => {
    const onConfirm = vi.fn()
    const { stdin, lastFrame } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm })
    )

    // Initial: 5 selected (aiSync is first, is default ON)
    expect(lastFrame()!).toContain('5 selected')

    // Space toggles cursor item (first = aiSync) OFF
    stdin.write(' ')
    await vi.waitFor(() => {
      expect(lastFrame()!).toContain('4 selected')
    })

    // Space again toggles it back ON
    stdin.write(' ')
    await vi.waitFor(() => {
      expect(lastFrame()!).toContain('5 selected')
    })
  })

  it('confirms selection on Enter', async () => {
    const onConfirm = vi.fn()
    const { stdin } = renderWithCI(
      React.createElement(OptionSelector, { onConfirm })
    )

    stdin.write('\r')

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    expect(onConfirm.mock.calls[0][0]).toEqual({
      aiSync: true,
      sdd: true,
      contextDir: true,
      claudeMd: true,
      ghagga: false,
      securityHooks: true,
      codeGraph: false,
      localAi: false,
    })
  })
})
