import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import path from 'path'
import { theme } from './theme.js'

interface Props {
  defaultName: string
  onConfirm: (name: string, dir: string) => void
}

const VALID_NAME = /^[a-z0-9][a-z0-9._-]*$/

function validateName(name: string): string | null {
  if (name.length === 0)           return 'Name cannot be empty'
  if (name !== name.toLowerCase()) return 'Use lowercase only'
  if (name.includes(' '))          return 'No spaces allowed (use - or _)'
  if (!VALID_NAME.test(name))      return 'Use lowercase letters, numbers, hyphens, dots'
  if (name.length > 60)            return 'Name too long (max 60 chars)'
  return null
}

export default function NameInput({ defaultName, onConfirm }: Props) {
  const [value, setValue] = useState(defaultName)
  const trimmed = value.trim()
  const error = validateName(trimmed)
  const isValid = error === null && trimmed.length > 0
  const targetDir = path.resolve(process.cwd(), trimmed || '.')

  useInput((input, key) => {
    if (key.return && isValid) {
      onConfirm(trimmed, targetDir)
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
        <Text color={isValid ? theme.primary : theme.error}>{'\u25b6'} </Text>
        <Text>{value}</Text>
        <Text color={theme.muted}>{'\u2588'}</Text>
      </Box>

      {/* Validation feedback */}
      {trimmed.length > 0 && error && (
        <Box marginTop={1}>
          <Text color={theme.error}>  {'\u2717'} {error}</Text>
        </Box>
      )}
      {isValid && (
        <Box marginTop={1}>
          <Text color={theme.success}>  {'\u2713'} Valid name</Text>
        </Box>
      )}

      {/* Target directory */}
      <Box marginTop={1}>
        <Text color={theme.muted}>  Will create: </Text>
        <Text color={isValid ? theme.primary : theme.muted} dimColor={!isValid}>
          {targetDir}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>Enter to confirm</Text>
      </Box>
    </Box>
  )
}
