import React, { useEffect, useState, useRef } from 'react'
import { Box, Text, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { runCI } from '../commands/ci.js'
import type { CIStep, CIOptions } from '../commands/ci.js'
import Header from './Header.js'
import { theme } from './theme.js'

// =============================================================================
// Icons
// =============================================================================

const STATUS_ICON: Record<CIStep['status'], string> = {
  pending: '○',
  running: '●',
  done:    '✓',
  error:   '✗',
  skipped: '–',
}

const STATUS_COLOR: Record<CIStep['status'], string> = {
  pending: theme.muted,
  running: theme.warning,
  done:    theme.success,
  error:   theme.error,
  skipped: theme.muted,
}

// =============================================================================
// Props
// =============================================================================

interface CIProps extends CIOptions {
  /** Called when CI finishes (success or failure) */
  onDone?: (success: boolean) => void
}

// =============================================================================
// Component
// =============================================================================

export default function CI(props: CIProps) {
  const { exit } = useApp()
  const [steps, setSteps] = useState<CIStep[]>([])
  const [done, setDone] = useState(false)
  const [success, setSuccess] = useState<boolean | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const onStep = (step: CIStep) => {
      setSteps(prev => {
        const idx = prev.findIndex(s => s.id === step.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = step
          return next
        }
        return [...prev, step]
      })
    }

    runCI(props, onStep)
      .then(() => {
        setSuccess(true)
        setDone(true)
        props.onDone?.(true)
        setTimeout(() => exit(), 200)
      })
      .catch(() => {
        setSuccess(false)
        setDone(true)
        props.onDone?.(false)
        // Give user time to read the error before exiting with failure code
        setTimeout(() => {
          exit()
          process.exitCode = 1
        }, 300)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mode = props.mode ?? 'full'
  const subtitle = mode === 'quick' ? 'ci — quick' : mode === 'shell' ? 'ci — shell' : 'ci'

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={subtitle} />

      {/* Steps list */}
      <Box flexDirection="column" marginBottom={1}>
        {steps.map(step => (
          <Box key={step.id}>
            <Text color={STATUS_COLOR[step.status]}>
              {step.status === 'running'
                ? <Spinner type="dots" />
                : `${STATUS_ICON[step.status]} `
              }
              {step.label}
              {step.detail
                ? <Text color={theme.muted} dimColor>{'  '}{step.detail}</Text>
                : null
              }
            </Text>
          </Box>
        ))}
      </Box>

      {/* Final result */}
      {done && success === true && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.success} bold>✓ CI passed — safe to push!</Text>
        </Box>
      )}

      {done && success === false && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.error} bold>✗ CI failed — fix the issues above before pushing.</Text>
          <Text color={theme.muted} dimColor>  To skip: git push --no-verify</Text>
        </Box>
      )}

      {/* Spinner while running */}
      {!done && steps.length === 0 && (
        <Text color={theme.warning}>
          <Spinner type="dots" />
          {' Starting CI...'}
        </Text>
      )}
    </Box>
  )
}
