import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { CIProvider } from '../types/index.js'
import { theme } from './theme.js'

const CI_PROVIDERS: { id: CIProvider; label: string; description: string }[] = [
  { id: 'github',     label: 'GitHub Actions', description: 'GitHub CI/CD with reusable workflows' },
  { id: 'gitlab',     label: 'GitLab CI',      description: 'GitLab CI/CD pipelines' },
  { id: 'woodpecker', label: 'Woodpecker CI',  description: 'Container-native CI for Gitea/Forgejo' },
]

interface Props {
  onConfirm: (provider: CIProvider) => void
}

export default function CISelector({ onConfirm }: Props) {
  const [cursor, setCursor] = useState(0)

  useInput((_, key) => {
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(CI_PROVIDERS.length - 1, c + 1))
    if (key.return) {
      onConfirm(CI_PROVIDERS[cursor].id)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold>Select CI provider:</Text>

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
        {CI_PROVIDERS.map((p, i) => (
          <Box key={p.id}>
            <Text color={i === cursor ? theme.primary : 'white'}>
              {i === cursor ? '\u25b6 ' : '  '}
              {i === cursor ? '\u25c9' : '\u25cb'} {p.label}
            </Text>
            <Text color={theme.muted} dimColor>  {p.description}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          {'\u2191\u2193'} navigate  Enter confirm
        </Text>
      </Box>
    </Box>
  )
}
