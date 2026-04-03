import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from './theme.js'
import { useCIMode } from './CIContext.js'

interface OptionItem {
  id: string
  label: string
  description: string
  default: boolean
}

const OPTIONS: OptionItem[] = [
  { id: 'aiSync',     label: 'AI Config Sync',      description: 'Sync AI config via javi-ai',       default: true },
  { id: 'sdd',        label: 'SDD (openspec/)',     description: 'Spec-Driven Development workflow',  default: true },
  { id: 'contextDir', label: '.context/ Directory', description: 'AI-ready project context files',    default: true },
  { id: 'claudeMd',   label: 'CLAUDE.md',           description: 'AI agent project instructions',     default: true },
  { id: 'ghagga',        label: 'GHAGGA Review',       description: 'Multi-agent AI code review system',       default: false },
  { id: 'securityHooks', label: 'Security Hooks',      description: '6-layer git hooks + runtime AI guardrails', default: true },
  { id: 'codeGraph',     label: 'Code Graph',           description: 'RepoForge call-graph scaffolding + CI',      default: false },
  { id: 'localAi',      label: 'Local AI Stack',       description: 'Ollama + Open WebUI + n8n + Supabase (Docker)', default: false },
]

interface Props {
  onConfirm: (selected: { aiSync: boolean; sdd: boolean; contextDir: boolean; claudeMd: boolean; ghagga: boolean; securityHooks: boolean; codeGraph: boolean; localAi: boolean }) => void
  presetGhagga?: boolean
  presetLocalAi?: boolean
}

export default function OptionSelector({ onConfirm, presetGhagga = false, presetLocalAi = false }: Props) {
  const isCI = useCIMode()
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(() => {
    const defaults = new Set(OPTIONS.filter(o => o.default).map(o => o.id))
    if (presetGhagga) defaults.add('ghagga')
    if (presetLocalAi) defaults.add('localAi')
    return defaults
  })

  // Auto-confirm in CI mode with defaults
  useEffect(() => {
    if (isCI) {
      onConfirm({
        aiSync:        selected.has('aiSync'),
        sdd:           selected.has('sdd'),
        contextDir:    selected.has('contextDir'),
        claudeMd:      selected.has('claudeMd'),
        ghagga:        selected.has('ghagga'),
        securityHooks: selected.has('securityHooks'),
        codeGraph:     selected.has('codeGraph'),
        localAi:       selected.has('localAi'),
      })
    }
  }, [isCI]) // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(OPTIONS.length - 1, c + 1))
    if (input === ' ') {
      const opt = OPTIONS[cursor].id
      setSelected(prev => {
        const next = new Set(prev)
        next.has(opt) ? next.delete(opt) : next.add(opt)
        return next
      })
    }
    if (key.return) {
      onConfirm({
        aiSync:        selected.has('aiSync'),
        sdd:           selected.has('sdd'),
        contextDir:    selected.has('contextDir'),
        claudeMd:      selected.has('claudeMd'),
        ghagga:        selected.has('ghagga'),
        securityHooks: selected.has('securityHooks'),
        codeGraph:     selected.has('codeGraph'),
        localAi:       selected.has('localAi'),
      })
    }
  }, { isActive: !isCI })

  return (
    <Box flexDirection="column">
      <Text bold>Select additional options:</Text>

      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="single"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={theme.muted}
        paddingLeft={1}
      >
        {OPTIONS.map((opt, i) => (
          <Box key={opt.id}>
            <Text color={i === cursor ? theme.primary : 'white'}>
              {i === cursor ? '\u25b6 ' : '  '}
              {selected.has(opt.id) ? '\u25c9' : '\u25cb'} {opt.label}
            </Text>
            <Text color={theme.muted} dimColor>  {opt.description}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} gap={2}>
        <Text color={selected.size > 0 ? theme.accent : theme.muted}>
          {selected.size} selected
        </Text>
        <Text color={theme.muted} dimColor>
          {'\u2191\u2193'} navigate  Space toggle  Enter confirm
        </Text>
      </Box>
    </Box>
  )
}
