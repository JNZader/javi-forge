import React, { useEffect } from 'react'
import { Box, Text } from 'ink'
import Header from './Header.js'
import { theme } from './theme.js'

interface Props {
  onDone: () => void
}

export default function Welcome({ onDone }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1500)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text>Bootstrap your project with:</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color={theme.primary}>{'\u25c6'} CI/CD      </Text>
            <Text color={theme.muted}> GitHub, GitLab, Woodpecker pipelines</Text>
          </Text>
          <Text>
            <Text color={theme.accent}>{'\u25c6'} AI Config  </Text>
            <Text color={theme.muted}> Agents, skills, and CLI configs</Text>
          </Text>
          <Text>
            <Text color={theme.success}>{'\u25c6'} Memory     </Text>
            <Text color={theme.muted}> Engram, Obsidian Brain, or simple</Text>
          </Text>
          <Text>
            <Text color={theme.warning}>{'\u25c6'} SDD        </Text>
            <Text color={theme.muted}> Spec-Driven Development workflow</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>Detecting your project...</Text>
        </Box>
      </Box>
    </Box>
  )
}
