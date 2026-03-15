import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import path from 'path'
import { theme } from './theme.js'

interface Props {
  defaultName: string
  onConfirm: (name: string, dir: string) => void
}

export default function NameInput({ defaultName, onConfirm }: Props) {
  const [value, setValue] = useState(defaultName)

  useInput((input, key) => {
    if (key.return && value.trim().length > 0) {
      const name = value.trim()
      const dir = path.resolve(process.cwd(), name)
      onConfirm(name, dir)
    } else if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1))
    } else if (input && !key.ctrl && !key.meta) {
      setValue(v => v + input)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold>Project name:</Text>
      <Box marginTop={1}>
        <Text color={theme.primary}>{'\u25b6'} </Text>
        <Text>{value}</Text>
        <Text color={theme.muted}>{'\u2588'}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          Directory: {path.resolve(process.cwd(), value || '.')}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>Enter to confirm</Text>
      </Box>
    </Box>
  )
}
