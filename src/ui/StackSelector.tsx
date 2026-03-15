import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { detectStack, STACK_LABELS } from '../lib/common.js'
import type { Stack } from '../types/index.js'
import { theme } from './theme.js'

const ALL_STACKS: Stack[] = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven', 'elixir']

interface Props {
  projectDir: string
  onConfirm: (stack: Stack) => void
}

export default function StackSelector({ projectDir, onConfirm }: Props) {
  const [cursor, setCursor] = useState(0)
  const [detectedStack, setDetectedStack] = useState<Stack | null>(null)
  const [detecting, setDetecting] = useState(true)

  useEffect(() => {
    detectStack(projectDir).then(result => {
      if (result) {
        setDetectedStack(result.stackType)
        const idx = ALL_STACKS.indexOf(result.stackType)
        if (idx >= 0) setCursor(idx)
      }
      setDetecting(false)
    })
  }, [projectDir])

  useInput((input, key) => {
    if (detecting) return
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(ALL_STACKS.length - 1, c + 1))
    if (key.return) {
      onConfirm(ALL_STACKS[cursor])
    }
  })

  if (detecting) {
    return (
      <Box>
        <Text color={theme.muted}>Detecting project stack...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>Select project stack:</Text>
      {detectedStack && (
        <Text color={theme.success}>
          {'  '}Auto-detected: {STACK_LABELS[detectedStack]}
        </Text>
      )}

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
        {ALL_STACKS.map((stack, i) => (
          <Box key={stack}>
            <Text color={i === cursor ? theme.primary : 'white'}>
              {i === cursor ? '\u25b6 ' : '  '}
              {stack === detectedStack ? '\u25c9' : '\u25cb'} {STACK_LABELS[stack]}
              {stack === detectedStack && (
                <Text color={theme.success} dimColor>  (detected)</Text>
              )}
            </Text>
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
