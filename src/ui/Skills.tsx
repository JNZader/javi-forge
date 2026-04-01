import React, { useEffect, useState, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { runSkillsDoctor } from '../commands/skills.js'
import type { SkillDoctorResult } from '../types/index.js'
import Header from './Header.js'
import { theme } from './theme.js'
import { useCIMode } from './CIContext.js'

import type { SkillsDoctorMode } from '../commands/skills.js'

interface SkillsProps {
  mode: SkillsDoctorMode
  budget?: number
  deep?: boolean
  skillsDir?: string
}

export default function Skills({ mode, budget, deep, skillsDir }: SkillsProps) {
  const { exit } = useApp()
  const isCI = useCIMode()
  const [result, setResult] = useState<SkillDoctorResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const runCheck = useCallback(() => {
    setLoading(true)
    setResult(null)
    setError(null)
    runSkillsDoctor({ mode, budget, deep, skillsDir })
      .then(r => { setResult(r); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [mode, budget, deep, skillsDir])

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

  const subtitle = mode === 'budget' ? 'skills budget' : 'skills doctor'

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={subtitle} />

      {loading && (
        <Text color={theme.warning}>
          <Spinner type="dots" />
          {' Running skills analysis...'}
        </Text>
      )}

      {error && (
        <Text color={theme.error}>{'\u2717'} Error: {error}</Text>
      )}

      {result && (
        <Box flexDirection="column">
          {/* Budget Section */}
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={result.budget.overBudget ? theme.warning : theme.success}>
              {'  '}Context Budget
            </Text>
            <Box marginLeft={2}>
              <Text color={result.budget.overBudget ? theme.warning : theme.success}>
                {result.budget.overBudget ? '\u2717' : '\u2713'}{' '}
                {result.budget.totalTokens} / {result.budget.budget} tokens
                {result.budget.overBudget ? ' (OVER BUDGET)' : ''}
              </Text>
            </Box>
            {result.budget.entries.map(entry => (
              <Box key={entry.skillName} marginLeft={4}>
                <Text color={theme.muted}>
                  {entry.skillName}
                </Text>
                <Text color={theme.muted} dimColor>
                  {'  '}~{entry.tokens} tokens
                </Text>
              </Box>
            ))}
            {result.budget.suggestions.map((s, i) => (
              <Box key={`suggestion-${i}`} marginLeft={4}>
                <Text color={theme.warning}>{'! '}{s}</Text>
              </Box>
            ))}
          </Box>

          {/* Conflicts Section (deep mode) */}
          {result.conflicts.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={theme.error}>
                {'  '}Conflicts ({result.conflicts.length})
              </Text>
              {result.conflicts.map((c, i) => (
                <Box key={`conflict-${i}`} flexDirection="column" marginLeft={4}>
                  <Text color={theme.error}>
                    {'\u2717'} {c.ruleA.skillName} vs {c.ruleB.skillName}
                  </Text>
                  <Text color={theme.muted} dimColor>
                    {'  '}{c.reason}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {deep && result.conflicts.length === 0 && (
            <Box marginLeft={2} marginBottom={1}>
              <Text color={theme.success}>{'\u2713'} No rule conflicts detected</Text>
            </Box>
          )}

          {/* Duplicates Section (deep mode) */}
          {result.duplicates.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={theme.warning}>
                {'  '}Potential Duplicates ({result.duplicates.length})
              </Text>
              {result.duplicates.map((d, i) => (
                <Box key={`dup-${i}`} flexDirection="column" marginLeft={4}>
                  <Text color={theme.warning}>
                    {'~'} {d.skillA} + {d.skillB} ({d.similarity}% overlap)
                  </Text>
                  <Text color={theme.muted} dimColor>
                    {'  '}shared: {d.sharedTriggers.slice(0, 3).join(', ')}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {deep && result.duplicates.length === 0 && (
            <Box marginLeft={2} marginBottom={1}>
              <Text color={theme.success}>{'\u2713'} No duplicate skills detected</Text>
            </Box>
          )}
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
