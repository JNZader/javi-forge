import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import type { HookProfile } from '../types/index.js'
import { HOOK_PROFILES } from '../constants.js'
import { theme } from './theme.js'
import { useCIMode } from './CIContext.js'

type ProfileEntry = {
  id: HookProfile
  label: string
  description: string
}

const PROFILES: ProfileEntry[] = (
  Object.entries(HOOK_PROFILES) as [HookProfile, typeof HOOK_PROFILES[HookProfile]][]
).map(([id, meta]) => ({
  id,
  label: meta.label,
  description: meta.description,
}))

// Default selection index (standard = index 1)
const DEFAULT_INDEX = 1

interface Props {
  onConfirm: (profile: HookProfile) => void
  presetProfile?: HookProfile
}

export default function HookProfileSelector({ onConfirm, presetProfile }: Props) {
  const isCI = useCIMode()
  const [cursor, setCursor] = useState(() => {
    if (presetProfile) {
      const idx = PROFILES.findIndex(p => p.id === presetProfile)
      return idx >= 0 ? idx : DEFAULT_INDEX
    }
    return DEFAULT_INDEX
  })

  // Auto-confirm in CI mode with default
  useEffect(() => {
    if (isCI) {
      onConfirm(PROFILES[cursor].id)
    }
  }, [isCI]) // eslint-disable-line react-hooks/exhaustive-deps

  useInput((_, key) => {
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(PROFILES.length - 1, c + 1))
    if (key.return) {
      onConfirm(PROFILES[cursor].id)
    }
  }, { isActive: !isCI })

  return (
    <Box flexDirection="column">
      <Text bold>Select hook reliability profile:</Text>

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
        {PROFILES.map((p, i) => (
          <Box key={p.id}>
            <Text color={i === cursor ? theme.primary : 'white'}>
              {i === cursor ? '\u25b6 ' : '  '}
              {i === cursor ? '\u25c9' : '\u25cb'} {p.label}
            </Text>
            <Text color={theme.muted} dimColor>  {p.description}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} gap={2}>
        <Text color={theme.primary}>
          {PROFILES[cursor].label}
        </Text>
        <Text color={theme.muted} dimColor>
          {'\u2191\u2193'} navigate  Enter confirm
        </Text>
      </Box>
    </Box>
  )
}
