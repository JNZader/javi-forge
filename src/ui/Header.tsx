import React from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'

interface Props {
  subtitle?: string
  dryRun?: boolean
}

const TITLE = '\u2726 javi-forge  Project scaffolding'

// Fixed inner width (characters between the box walls)
const BOX_WIDTH = 41

function pad(content: string): string {
  const len = [...content].length  // unicode-safe length
  const spaces = BOX_WIDTH - len
  return content + ' '.repeat(Math.max(0, spaces))
}

export default function Header({ subtitle, dryRun }: Props) {
  const top    = '\u256d' + '\u2500'.repeat(BOX_WIDTH) + '\u256e'
  const bottom = '\u2570' + '\u2500'.repeat(BOX_WIDTH) + '\u256f'
  const titleLine = pad('  ' + TITLE + '  ')
  const subLine   = subtitle ? pad('  ' + subtitle + '  ') : null

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.muted}>{top}</Text>
      <Box>
        <Text color={theme.muted}>{'\u2502'}</Text>
        <Text bold color={theme.primary}>{titleLine}</Text>
        <Text color={theme.muted}>{'\u2502'}</Text>
      </Box>
      {subLine && (
        <Box>
          <Text color={theme.muted}>{'\u2502'}</Text>
          <Text color={theme.muted}>{subLine}</Text>
          <Text color={theme.muted}>{'\u2502'}</Text>
        </Box>
      )}
      <Text color={theme.muted}>{bottom}</Text>
      {dryRun && (
        <Text color={theme.warning}> [DRY RUN]</Text>
      )}
    </Box>
  )
}
