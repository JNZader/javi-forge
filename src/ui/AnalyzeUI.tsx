import React, { useEffect, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { runAnalyze } from '../commands/analyze.js'
import type { InitStep } from '../types/index.js'
import Header from './Header.js'
import { theme } from './theme.js'

interface Props {
  dryRun: boolean
}

export default function AnalyzeUI({ dryRun }: Props) {
  const { exit } = useApp()
  const [steps, setSteps] = useState<InitStep[]>([])
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    runAnalyze(
      process.cwd(),
      dryRun,
      (step) => setSteps(prev => {
        const idx = prev.findIndex(s => s.id === step.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = step
          return next
        }
        return [...prev, step]
      })
    ).then(() => setFinished(true))
  }, [dryRun])

  useInput((_, key) => {
    if (finished && (key.return || key.escape)) exit()
  })

  const errors = steps.filter(s => s.status === 'error').length

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="analyze" dryRun={dryRun} />

      <Box flexDirection="column">
        {steps.map(step => (
          <Box key={step.id} marginLeft={2}>
            {step.status === 'running' ? (
              <Text color={theme.warning}>
                <Spinner type="dots" />
                {' '}{step.label}
              </Text>
            ) : step.status === 'done' ? (
              <Text color={theme.success}>
                {'\u2713'} {step.label}
                {step.detail && <Text color={theme.muted} dimColor>  {step.detail}</Text>}
              </Text>
            ) : step.status === 'error' ? (
              <Text color={theme.error}>
                {'\u2717'} {step.label}
                {step.detail && <Text color={theme.muted} dimColor>  {step.detail}</Text>}
              </Text>
            ) : (
              <Text color={theme.muted}>
                {'\u2013'} {step.label}
                {step.detail && <Text dimColor>  {step.detail}</Text>}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {finished && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={errors > 0 ? theme.warning : theme.success}>
            {dryRun ? '\u25cb Dry run complete' : '\u2713 Analysis complete'}
          </Text>
          <Box marginTop={1}>
            <Text color={theme.muted} dimColor>Press Enter to exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
