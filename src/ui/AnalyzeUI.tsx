import React, { useEffect, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { runAnalyze } from '../commands/analyze.js'
import type { InitStep } from '../types/index.js'
import Header from './Header.js'
import { theme } from './theme.js'
import { useCIMode } from './CIContext.js'

interface Props {
  dryRun: boolean
}

export default function AnalyzeUI({ dryRun }: Props) {
  const { exit } = useApp()
  const isCI = useCIMode()
  const [steps, setSteps] = useState<InitStep[]>([])
  const [finished, setFinished] = useState(false)
  const [startTime] = useState(Date.now())

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

  // Auto-exit in CI mode once finished
  useEffect(() => {
    if (isCI && finished) {
      const t = setTimeout(() => exit(), 100)
      return () => clearTimeout(t)
    }
    return undefined
  }, [isCI, finished, exit])

  useInput((_, key) => {
    if (finished && (key.return || key.escape)) exit()
  }, { isActive: !isCI })

  const doneCount  = steps.filter(s => s.status === 'done').length
  const errorCount = steps.filter(s => s.status === 'error').length
  const notInstalled = steps.some(
    s => s.status === 'error' && s.detail?.includes('not found')
  )
  const elapsed = finished
    ? `${((Date.now() - startTime) / 1000).toFixed(1)}s`
    : null

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="analyze" dryRun={dryRun} />

      {/* Scanning context */}
      {!finished && steps.length === 0 && (
        <Box marginLeft={2}>
          <Text color={theme.warning}>
            <Spinner type="dots" />
            {' '}Checking for repoforge...
          </Text>
        </Box>
      )}

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

      {/* Install instructions when repoforge is missing */}
      {finished && notInstalled && (
        <Box marginTop={1} flexDirection="column" marginLeft={2}>
          <Text color={theme.warning} bold>repoforge is not installed</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.muted}>  Install it with:</Text>
            <Text color={theme.primary}>    pip install repoforge</Text>
            <Text color={theme.muted}>  Then run:</Text>
            <Text color={theme.primary}>    javi-forge analyze</Text>
          </Box>
        </Box>
      )}

      {finished && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={errorCount > 0 ? theme.warning : theme.success}>
            {dryRun ? '\u25cb Dry run complete' : '\u2713 Analysis complete'}
            {elapsed && <Text color={theme.muted}>  Completed in {elapsed}</Text>}
          </Text>
          {doneCount > 0 && (
            <Text color={theme.success}>  {'\u2713'} {doneCount} checks passed</Text>
          )}
          {errorCount > 0 && (
            <Text color={theme.error}>  {'\u2717'} {errorCount} errors</Text>
          )}
          <Box marginTop={1}>
            <Text color={theme.muted} dimColor>Press Enter to exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
