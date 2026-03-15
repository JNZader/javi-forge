import React from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { InitStep } from '../types/index.js'
import { theme } from './theme.js'

interface Props {
  steps: InitStep[]
  dryRun: boolean
  projectName: string
  elapsedMs?: number
}

export default function Summary({ steps, dryRun, projectName, elapsedMs }: Props) {
  const { exit } = useApp()

  const done   = steps.filter(s => s.status === 'done').length
  const skipped = steps.filter(s => s.status === 'skipped').length
  const errors = steps.filter(s => s.status === 'error')
  const elapsed = elapsedMs != null
    ? `${(elapsedMs / 1000).toFixed(1)}s`
    : null

  useInput((_, key) => {
    if (key.return || key.escape) exit()
  })

  return (
    <Box flexDirection="column">
      {/* Title */}
      <Text bold color={errors.length > 0 ? theme.warning : theme.success}>
        {dryRun ? '\u25cb Dry run complete' : '\u2713 Project scaffolded'}
        {elapsed && <Text color={theme.muted}>  Completed in {elapsed}</Text>}
      </Text>

      {/* Project info */}
      <Box marginTop={1}>
        <Text color={theme.muted}>  Project: </Text>
        <Text color={theme.primary} bold>{projectName}</Text>
      </Box>

      {/* Dry run note */}
      {dryRun && (
        <Box marginTop={1}>
          <Text color={theme.warning} bold>  No changes were made (dry run)</Text>
        </Box>
      )}

      {/* Totals */}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.success}>  {'\u2713'} {done} steps completed</Text>
        {skipped > 0 && (
          <Text color={theme.muted}>  {'\u2013'} {skipped} steps skipped</Text>
        )}
        {errors.length > 0 && (
          <Box flexDirection="column">
            <Text color={theme.error}>  {'\u2717'} {errors.length} errors:</Text>
            {errors.map(e => (
              <Text key={e.id} color={theme.error}>    {'\u2022'} {e.label}: {e.detail}</Text>
            ))}
          </Box>
        )}
      </Box>

      {/* Next steps */}
      {!dryRun && errors.length === 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted} bold>  Next steps:</Text>
          <Text color={theme.muted}>    cd {projectName}</Text>
          <Text color={theme.muted}>    javi-forge doctor</Text>
          <Text color={theme.muted}>    javi-forge sync</Text>
        </Box>
      )}

      {/* Exit hint */}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>Press Enter to exit</Text>
      </Box>
    </Box>
  )
}
