import fs from 'fs-extra'
import path from 'path'
import type { Stack, TddPipelineMode, TddPipelineResult } from '../types/index.js'
import { detectCIStack } from './ci.js'
import { getTddTestCommand } from './tdd.js'

// =============================================================================
// Hook generation
// =============================================================================

/**
 * Generate a TDD pipeline enforcement pre-push hook script.
 *
 * - strict: tests MUST pass or push is blocked (exit 1).
 * - warn:   tests are run and results shown, but push is never blocked.
 *
 * If testCmd is null, generates a skip-only hook regardless of mode.
 */
export function generateTddPipelineHook(
  mode: TddPipelineMode,
  testCmd: string | null,
  stack: Stack
): string {
  if (!testCmd) {
    return `#!/bin/bash
# =============================================================================
# TDD PIPELINE (pre-push): No test command detected for stack "${stack}"
# =============================================================================
# Install a test runner and re-run: javi-forge tdd pipeline --mode ${mode}
# =============================================================================

echo "TDD PIPELINE: No test command configured for stack '${stack}' — skipping."
exit 0
`
  }

  if (mode === 'warn') {
    return `#!/bin/bash
# =============================================================================
# TDD PIPELINE (pre-push): WARN mode
# =============================================================================
# Flow: Spec → Tests → Fail → Implement → Pass
# Stack: ${stack} | Command: ${testCmd}
# Mode: warn — tests run but push is NEVER blocked
# To skip: git push --no-verify
# =============================================================================

echo "TDD PIPELINE [WARN]: Running tests before push..."
echo "  Stack: ${stack}"
echo "  Command: ${testCmd}"
echo "  Mode: warn (push will proceed regardless)"
echo ""

${testCmd} && {
    echo ""
    echo "TDD PIPELINE [WARN]: All tests passed."
} || {
    echo ""
    echo "TDD PIPELINE [WARN]: Tests FAILED — but push will proceed (warn mode)."
    echo "  Consider fixing tests before merging."
}

exit 0
`
  }

  // strict mode (default)
  return `#!/bin/bash
# =============================================================================
# TDD PIPELINE (pre-push): STRICT mode
# =============================================================================
# Flow: Spec → Tests → Fail → Implement → Pass
# Stack: ${stack} | Command: ${testCmd}
# Mode: strict — push is BLOCKED if tests fail
# To skip: git push --no-verify
# =============================================================================

set -e

echo "TDD PIPELINE [STRICT]: Running tests before push..."
echo "  Stack: ${stack}"
echo "  Command: ${testCmd}"
echo "  Mode: strict (push blocked on failure)"
echo ""

${testCmd} || {
    echo ""
    echo "TDD PIPELINE [STRICT]: FAILED — Tests did not pass."
    echo "  Fix failing tests before pushing."
    echo "  To skip: git push --no-verify"
    exit 1
}

echo ""
echo "TDD PIPELINE [STRICT]: All tests passed. Push allowed."
`
}

// =============================================================================
// Hook installation
// =============================================================================

/**
 * Install TDD pipeline pre-push hook into .git/hooks/.
 * Detects the project stack automatically and generates the appropriate hook.
 * Backs up any existing pre-push hook to pre-push.bak.
 */
export async function installTddPipelineHook(
  projectDir: string,
  mode: TddPipelineMode
): Promise<TddPipelineResult> {
  const result: TddPipelineResult = { installed: [], skipped: [], errors: [], mode }

  const gitDir = path.join(projectDir, '.git')
  if (!await fs.pathExists(gitDir)) {
    result.errors.push('Not a git repository. Run git init first.')
    return result
  }

  const hooksDir = path.join(gitDir, 'hooks')
  await fs.ensureDir(hooksDir)

  // Detect stack
  let stackInfo
  try {
    stackInfo = await detectCIStack(projectDir)
  } catch {
    result.errors.push('Failed to detect project stack.')
    return result
  }

  const testCmd = await getTddTestCommand(stackInfo.stackType, stackInfo.buildTool, projectDir)
  const hookContent = generateTddPipelineHook(mode, testCmd, stackInfo.stackType)

  const hookPath = path.join(hooksDir, 'pre-push')

  // Backup existing hook
  if (await fs.pathExists(hookPath)) {
    const backupPath = path.join(hooksDir, 'pre-push.bak')
    try {
      await fs.copy(hookPath, backupPath, { overwrite: true })
      result.skipped.push('pre-push (backed up to pre-push.bak)')
    } catch (e) {
      result.errors.push(`backup: ${e instanceof Error ? e.message : String(e)}`)
      return result
    }
  }

  try {
    await fs.writeFile(hookPath, hookContent, { mode: 0o755 })
    result.installed.push('pre-push')
  } catch (e) {
    result.errors.push(`pre-push: ${e instanceof Error ? e.message : String(e)}`)
  }

  return result
}
