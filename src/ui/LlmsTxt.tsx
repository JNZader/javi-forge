import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { InitStep } from '../types/index.js'
import { generateLlmsTxt } from '../commands/llmstxt.js'
import { theme } from './theme.js'

interface Props {
  projectDir: string
  dryRun: boolean
}

const STATUS_ICON: Record<string, string> = {
  done: '\u2713', error: '\u2717', skipped: '\u2013',
}

export default function LlmsTxt({ projectDir, dryRun }: Props) {
  const [steps, setSteps] = useState<InitStep[]>([])
  const [done, setDone] = useState(false)

  const onStep = (step: InitStep) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === step.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = step; return n }
      return [...prev, step]
    })
  }

  useEffect(() => {
    generateLlmsTxt(projectDir, dryRun, onStep)
      .catch(e => onStep({ id: 'fatal', label: 'Error', status: 'error', detail: String(e) }))
      .finally(() => setDone(true))
  }, [projectDir, dryRun])

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>javi-forge</Text>
        <Text> llms-txt</Text>
        {dryRun && <Text color={theme.warning}> (dry-run)</Text>}
      </Box>
      {steps.map(s => (
        <Box key={s.id} marginLeft={2}>
          {s.status === 'running'
            ? <Text color={theme.warning}><Spinner type="dots" /> {s.label}</Text>
            : <Text color={s.status === 'done' ? theme.success : s.status === 'error' ? theme.error : theme.muted}>
                {STATUS_ICON[s.status]} {s.label}
                {s.detail ? <Text color={theme.muted} dimColor>  {s.detail}</Text> : null}
              </Text>}
        </Box>
      ))}
      {done && <Box marginTop={1}><Text color={theme.muted}>Done.</Text></Box>}
    </Box>
  )
}
