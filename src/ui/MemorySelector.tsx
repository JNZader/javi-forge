import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { MemoryOption } from '../types/index.js'
import { theme } from './theme.js'

const MEMORY_OPTIONS: { id: MemoryOption; label: string; description: string }[] = [
  { id: 'engram',         label: 'Engram',         description: 'SQLite-backed persistent memory with MCP' },
  { id: 'obsidian-brain', label: 'Obsidian Brain',  description: 'Obsidian vault with Kanban + Dataview' },
  { id: 'memory-simple',  label: 'Simple Memory',   description: 'File-based .project/ memory' },
  { id: 'none',           label: 'None',             description: 'Skip memory module' },
]

interface Props {
  onConfirm: (memory: MemoryOption) => void
}

export default function MemorySelector({ onConfirm }: Props) {
  const [cursor, setCursor] = useState(0)

  useInput((_, key) => {
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(MEMORY_OPTIONS.length - 1, c + 1))
    if (key.return) {
      onConfirm(MEMORY_OPTIONS[cursor].id)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold>Select memory module:</Text>

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
        {MEMORY_OPTIONS.map((m, i) => (
          <Box key={m.id}>
            <Text color={i === cursor ? theme.primary : 'white'}>
              {i === cursor ? '\u25b6 ' : '  '}
              {i === cursor ? '\u25c9' : '\u25cb'} {m.label}
            </Text>
            <Text color={theme.muted} dimColor>  {m.description}</Text>
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
