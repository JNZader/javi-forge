import React, { useEffect, useState, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { runDoctor } from '../commands/doctor.js'
import type { DoctorResult } from '../types/index.js'
import Header from './Header.js'
import { theme } from './theme.js'
import { useCIMode } from './CIContext.js'

type CheckStatus = 'ok' | 'fail' | 'skip'

const STATUS_ICON: Record<CheckStatus, string> = {
  ok:   '\u2713',
  fail: '\u2717',
  skip: '\u2013',
}

const STATUS_COLOR: Record<CheckStatus, string> = {
  ok:   theme.success,
  fail: theme.error,
  skip: theme.muted,
}

export default function Doctor() {
  const { exit } = useApp()
  const isCI = useCIMode()
  const [result, setResult] = useState<DoctorResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const runCheck = useCallback(() => {
    setLoading(true)
    setResult(null)
    setError(null)
    runDoctor()
      .then(r => { setResult(r); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  useEffect(() => { runCheck() }, [runCheck])

  // Auto-exit in CI mode once loading finishes
  useEffect(() => {
    if (isCI && !loading) {
      const t = setTimeout(() => exit(), 100)
      return () => clearTimeout(t)
    }
    return undefined
  }, [isCI, loading, exit])

  useInput((input, key) => {
    if (input.toLowerCase() === 'r') runCheck()
    if (input.toLowerCase() === 'q' || key.return || key.escape) exit()
  }, { isActive: !isCI })

  // Compute health score
  const allChecks = result?.sections.flatMap(s => s.checks) ?? []
  const passed  = allChecks.filter(c => c.status === 'ok').length
  const total   = allChecks.filter(c => c.status !== 'skip').length

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="doctor" />

      {loading && (
        <Text color={theme.warning}>
          <Spinner type="dots" />
          {' Running checks...'}
        </Text>
      )}

      {error && (
        <Text color={theme.error}>{'\u2717'} Error: {error}</Text>
      )}

      {result && (
        <Box flexDirection="column">
          {/* Health score */}
          <Box marginBottom={1}>
            <Text bold>Health: </Text>
            <Text bold color={passed === total ? theme.success : theme.warning}>
              {passed}/{total} checks passed
            </Text>
          </Box>

          {result.sections.map((section, si) => {
            const sectionHasFail = section.checks.some(c => c.status === 'fail')
            return (
              <Box key={`section-${si}`} flexDirection="column" marginBottom={1}>
                <Text bold color={sectionHasFail ? theme.warning : theme.success}>
                  {'  '}{section.title}
                </Text>
                {section.checks.map((check, ci) => (
                  <Box key={`section-${si}-check-${ci}-${check.label}`}>
                    <Text color={STATUS_COLOR[check.status]}>
                      {'  '}
                      {STATUS_ICON[check.status]}
                      {' '}
                      {check.label}
                      {check.detail
                        ? <Text color={theme.muted} dimColor>{'  '}{check.detail}</Text>
                        : null}
                    </Text>
                  </Box>
                ))}
              </Box>
            )
          })}
        </Box>
      )}

      {/* Bottom hint */}
      {!loading && (
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Press r to refresh, q to quit
          </Text>
        </Box>
      )}
    </Box>
  )
}
