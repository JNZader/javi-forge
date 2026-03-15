import React, { useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { InitStep } from '../types/index.js'
import { theme } from './theme.js'

interface Props {
  steps: InitStep[]
  onDone?: () => void
}

const STATUS_ICON: Record<string, string> = {
  pending: '\u25cb',
  done:    '\u2713',
  error:   '\u2717',
  skipped: '\u2013',
}

const STATUS_COLOR: Record<string, string> = {
  pending: theme.muted,
  running: theme.warning,
  done:    theme.success,
  error:   theme.error,
  skipped: theme.muted,
}

export default function Progress({ steps, onDone }: Props) {
  const doneRef = useRef(false)

  const total     = steps.length
  const completed = steps.filter(s => s.status === 'done' || s.status === 'skipped').length
  const hasError  = steps.some(s => s.status === 'error')
  const allFinished = total > 0 && steps.every(
    s => s.status === 'done' || s.status === 'error' || s.status === 'skipped'
  )

  useEffect(() => {
    if (allFinished && !hasError && !doneRef.current && onDone) {
      doneRef.current = true
      const t = setTimeout(onDone, 600)
      return () => clearTimeout(t)
    }
    return undefined
  }, [allFinished, hasError, onDone])

  return (
    <Box flexDirection="column">
      {total > 0 && (
        <Box marginBottom={1}>
          <Text color={theme.muted}>
            {'Progress: '}
            <Text color={completed === total ? theme.success : theme.warning}>
              {completed}/{total} steps
            </Text>
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
                {step.detail ? <Text color={theme.muted} dimColor>  {step.detail}</Text> : null}
              </Text>
            ) : (
              <Text color={STATUS_COLOR[step.status] as any}>
                {STATUS_ICON[step.status]} {step.label}
                {step.detail ? <Text color={theme.muted} dimColor>  {step.detail}</Text> : null}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
