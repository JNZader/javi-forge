import fs from 'fs-extra'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { InitOptions, InitStep, ForgeManifest } from '../types/index.js'
import { backupIfExists, ensureDirExists } from '../lib/common.js'
import { generateDependabotYml, generateCIWorkflow, getCIDestination } from '../lib/template.js'
import { generateContextDir } from '../lib/context.js'
import { generateClaudeMd } from '../lib/claudemd.js'
import {
  FORGE_ROOT,
  TEMPLATES_DIR,
  MODULES_DIR,
  CI_LOCAL_DIR,
} from '../constants.js'

const execFileAsync = promisify(execFile)

type StepCallback = (step: InitStep) => void

function report(onStep: StepCallback, id: string, label: string, status: InitStep['status'], detail?: string) {
  onStep({ id, label, status, detail })
}

/**
 * Main init orchestrator: bootstraps a project with CI, git hooks,
 * memory module, AI config sync, SDD, and ghagga.
 */
export async function initProject(
  options: InitOptions,
  onStep: StepCallback
): Promise<void> {
  const { projectDir, projectName, stack, ciProvider, memory, aiSync, sdd, ghagga, contextDir, claudeMd, dryRun } = options

  // Ensure project directory exists before any steps
  if (!dryRun && projectDir) {
    await ensureDirExists(projectDir)
  }

  // ── Step 1: Initialize git ────────────────────────────────────────────────
  const stepGit = 'git-init'
  report(onStep, stepGit, 'Initialize git repository', 'running')
  try {
    const gitDir = path.join(projectDir, '.git')
    if (!await fs.pathExists(gitDir)) {
      if (!dryRun) {
        await execFileAsync('git', ['init'], { cwd: projectDir })
      }
      report(onStep, stepGit, 'Initialize git repository', 'done', 'initialized')
    } else {
      report(onStep, stepGit, 'Initialize git repository', 'done', 'already exists')
    }
  } catch (e) {
    report(onStep, stepGit, 'Initialize git repository', 'error', String(e))
  }

  // ── Step 2: Configure git hooks path ──────────────────────────────────────
  const stepHooks = 'git-hooks'
  report(onStep, stepHooks, 'Configure git hooks path', 'running')
  try {
    const ciLocalSrc = CI_LOCAL_DIR
    const ciLocalDest = path.join(projectDir, 'ci-local')
    if (await fs.pathExists(ciLocalSrc)) {
      if (!dryRun) {
        await fs.copy(ciLocalSrc, ciLocalDest, { overwrite: false, errorOnExist: false })
        // Set core.hooksPath to ci-local/hooks
        const hooksDir = path.join(ciLocalDest, 'hooks')
        if (await fs.pathExists(hooksDir)) {
          // Ensure hooks are executable
          const hookFiles = await fs.readdir(hooksDir)
          for (const hook of hookFiles) {
            await fs.chmod(path.join(hooksDir, hook), 0o755)
          }
          await execFileAsync('git', ['config', 'core.hooksPath', 'ci-local/hooks'], { cwd: projectDir })
        }
      }
      report(onStep, stepHooks, 'Configure git hooks path', 'done', 'ci-local/hooks')
    } else {
      report(onStep, stepHooks, 'Configure git hooks path', 'skipped', 'no ci-local dir')
    }
  } catch (e) {
    report(onStep, stepHooks, 'Configure git hooks path', 'error', String(e))
  }

  // ── Step 3: Copy CI template ──────────────────────────────────────────────
  const stepCI = 'ci-template'
  report(onStep, stepCI, `Copy ${ciProvider} CI workflow`, 'running')
  try {
    const ciContent = await generateCIWorkflow(stack, ciProvider)
    if (ciContent) {
      const dest = path.join(projectDir, getCIDestination(ciProvider))
      if (!dryRun) {
        await backupIfExists(dest)
        await ensureDirExists(path.dirname(dest))
        await fs.writeFile(dest, ciContent, 'utf-8')
      }
      report(onStep, stepCI, `Copy ${ciProvider} CI workflow`, 'done', getCIDestination(ciProvider))
    } else {
      report(onStep, stepCI, `Copy ${ciProvider} CI workflow`, 'skipped', `no template for ${stack}`)
    }
  } catch (e) {
    report(onStep, stepCI, `Copy ${ciProvider} CI workflow`, 'error', String(e))
  }

  // ── Step 4: Generate .gitignore ───────────────────────────────────────────
  const stepGitignore = 'gitignore'
  report(onStep, stepGitignore, 'Generate .gitignore', 'running')
  try {
    const templatePath = path.join(FORGE_ROOT, '.gitignore.template')
    const dest = path.join(projectDir, '.gitignore')
    if (await fs.pathExists(templatePath) && !await fs.pathExists(dest)) {
      if (!dryRun) {
        await fs.copy(templatePath, dest)
      }
      report(onStep, stepGitignore, 'Generate .gitignore', 'done', 'from template')
    } else if (await fs.pathExists(dest)) {
      report(onStep, stepGitignore, 'Generate .gitignore', 'done', 'already exists')
    } else {
      report(onStep, stepGitignore, 'Generate .gitignore', 'skipped', 'no template')
    }
  } catch (e) {
    report(onStep, stepGitignore, 'Generate .gitignore', 'error', String(e))
  }

  // ── Step 5: Generate dependabot.yml ───────────────────────────────────────
  const stepDeps = 'dependabot'
  report(onStep, stepDeps, 'Generate dependabot.yml', 'running')
  try {
    if (ciProvider === 'github') {
      const content = await generateDependabotYml([stack], true)
      const dest = path.join(projectDir, '.github', 'dependabot.yml')
      if (!dryRun) {
        await backupIfExists(dest)
        await ensureDirExists(path.dirname(dest))
        await fs.writeFile(dest, content, 'utf-8')
      }
      report(onStep, stepDeps, 'Generate dependabot.yml', 'done')
    } else {
      report(onStep, stepDeps, 'Generate dependabot.yml', 'skipped', `not needed for ${ciProvider}`)
    }
  } catch (e) {
    report(onStep, stepDeps, 'Generate dependabot.yml', 'error', String(e))
  }

  // ── Step 6: Install memory module ─────────────────────────────────────────
  const stepMem = 'memory'
  report(onStep, stepMem, `Install memory module: ${memory}`, 'running')
  try {
    if (memory !== 'none') {
      const moduleSrc = path.join(MODULES_DIR, memory)
      if (await fs.pathExists(moduleSrc)) {
        if (!dryRun) {
          // Copy module files to project
          const moduleDest = path.join(projectDir, '.javi-forge', 'modules', memory)
          await ensureDirExists(moduleDest)
          await fs.copy(moduleSrc, moduleDest, { overwrite: false, errorOnExist: false })

          // If engram, copy .mcp-config-snippet.json to project with placeholder replacement
          if (memory === 'engram') {
            const snippetSrc = path.join(moduleSrc, '.mcp-config-snippet.json')
            if (await fs.pathExists(snippetSrc)) {
              const snippetDest = path.join(projectDir, '.mcp-config-snippet.json')
              let content = await fs.readFile(snippetSrc, 'utf-8')
              content = content.replace(/__PROJECT_NAME__/g, projectName)
              await fs.writeFile(snippetDest, content, 'utf-8')
            }
          }
        }
        report(onStep, stepMem, `Install memory module: ${memory}`, 'done')
      } else {
        report(onStep, stepMem, `Install memory module: ${memory}`, 'error', 'module not found')
      }
    } else {
      report(onStep, stepMem, `Install memory module: ${memory}`, 'skipped', 'none selected')
    }
  } catch (e) {
    report(onStep, stepMem, `Install memory module: ${memory}`, 'error', String(e))
  }

  // ── Step 7: AI config sync (delegated to javi-ai) ──────────────────────────
  const stepAI = 'ai-sync'
  report(onStep, stepAI, 'Sync AI config via javi-ai', 'running')
  try {
    if (aiSync) {
      if (!dryRun) {
        try {
          const { stderr } = await execFileAsync('npx', ['javi-ai', 'sync', '--project-dir', projectDir, '--target', 'all'], {
            cwd: projectDir,
            timeout: 120_000,
          })
          // javi-ai may exit 0 but crash (e.g. Ink raw mode error) — detect via stderr
          if (stderr && (stderr.includes('Raw mode is not supported') || stderr.includes('ERROR'))) {
            report(onStep, stepAI, 'Sync AI config via javi-ai', 'error',
              'javi-ai crashed. Run manually: npx javi-ai sync --project-dir . --target all')
          } else {
            report(onStep, stepAI, 'Sync AI config via javi-ai', 'done', 'javi-ai sync --target all')
          }
        } catch (syncErr: unknown) {
          const msg = syncErr instanceof Error ? syncErr.message : String(syncErr)
          if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('ERR_MODULE_NOT_FOUND')) {
            report(onStep, stepAI, 'Sync AI config via javi-ai', 'error',
              'javi-ai not found. Install with: npm install -g javi-ai (or run npx javi-ai sync manually)')
          } else {
            report(onStep, stepAI, 'Sync AI config via javi-ai', 'error', msg)
          }
        }
      } else {
        report(onStep, stepAI, 'Sync AI config via javi-ai', 'done', 'dry-run: would run javi-ai sync --target all')
      }
    } else {
      report(onStep, stepAI, 'Sync AI config via javi-ai', 'skipped', 'not selected')
    }
  } catch (e) {
    report(onStep, stepAI, 'Sync AI config via javi-ai', 'error', String(e))
  }

  // ── Step 8: SDD (Spec-Driven Development) ─────────────────────────────────
  const stepSDD = 'sdd'
  report(onStep, stepSDD, 'Set up SDD (openspec/)', 'running')
  try {
    if (sdd) {
      if (!dryRun) {
        const openspecDir = path.join(projectDir, 'openspec')
        await ensureDirExists(openspecDir)
        // Create a README if none exists
        const readmePath = path.join(openspecDir, 'README.md')
        if (!await fs.pathExists(readmePath)) {
          await fs.writeFile(readmePath, `# openspec/\n\nSpec-Driven Development artifacts for ${projectName}.\n\nSee: /sdd:new <name> to start a new change.\n`, 'utf-8')
        }
      }
      report(onStep, stepSDD, 'Set up SDD (openspec/)', 'done')
    } else {
      report(onStep, stepSDD, 'Set up SDD (openspec/)', 'skipped', 'not selected')
    }
  } catch (e) {
    report(onStep, stepSDD, 'Set up SDD (openspec/)', 'error', String(e))
  }

  // ── Step 9: GHAGGA ────────────────────────────────────────────────────────
  const stepGhagga = 'ghagga'
  report(onStep, stepGhagga, 'Install GHAGGA review system', 'running')
  try {
    if (ghagga) {
      const ghaggaSrc = path.join(MODULES_DIR, 'ghagga')
      if (await fs.pathExists(ghaggaSrc)) {
        if (!dryRun) {
          const ghaggaDest = path.join(projectDir, '.javi-forge', 'modules', 'ghagga')
          await ensureDirExists(ghaggaDest)
          await fs.copy(ghaggaSrc, ghaggaDest, { overwrite: false, errorOnExist: false })

          // Copy ghagga caller workflow to CI provider location
          if (ciProvider === 'github') {
            const workflowSrc = path.join(FORGE_ROOT, 'templates', 'github', 'ghagga-review.yml')
            if (await fs.pathExists(workflowSrc)) {
              const workflowDest = path.join(projectDir, '.github', 'workflows', 'ghagga-review.yml')
              await ensureDirExists(path.dirname(workflowDest))
              await fs.copy(workflowSrc, workflowDest, { overwrite: false })
            }
          }
        }
        report(onStep, stepGhagga, 'Install GHAGGA review system', 'done')
      } else {
        report(onStep, stepGhagga, 'Install GHAGGA review system', 'error', 'module not found')
      }
    } else {
      report(onStep, stepGhagga, 'Install GHAGGA review system', 'skipped', 'not selected')
    }
  } catch (e) {
    report(onStep, stepGhagga, 'Install GHAGGA review system', 'error', String(e))
  }

  // ── Step 10: Mock-first mode ───────────────────────────────────────────────
  const stepMock = 'mock'
  if (options.mock) {
    report(onStep, stepMock, 'Configure mock-first mode', 'running')
    try {
      if (!dryRun) {
        // Create .env.example with mock values
        const envExample = `# Mock environment — no real API keys required
# Copy to .env to use: cp .env.example .env

# Database
DATABASE_URL=postgresql://mock:mock@localhost:5432/mock_db

# Auth
JWT_SECRET=mock-jwt-secret-for-local-development
SESSION_SECRET=mock-session-secret

# External APIs (mock mode — no real calls)
MOCK_MODE=true
API_KEY=mock-api-key-not-real
STRIPE_KEY=sk_test_mock_not_real
SENDGRID_KEY=SG.mock_not_real

# Feature flags
ENABLE_ANALYTICS=false
ENABLE_EMAILS=false
ENABLE_WEBHOOKS=false
`
        const envExamplePath = path.join(projectDir, '.env.example')
        if (!await fs.pathExists(envExamplePath)) {
          await fs.writeFile(envExamplePath, envExample, 'utf-8')
        }

        // Create .env from example
        const envPath = path.join(projectDir, '.env')
        if (!await fs.pathExists(envPath)) {
          await fs.writeFile(envPath, envExample, 'utf-8')
        }
      }
      report(onStep, stepMock, 'Configure mock-first mode', 'done', '.env.example + .env with mock values')
    } catch (e) {
      report(onStep, stepMock, 'Configure mock-first mode', 'error', String(e))
    }
  } else {
    report(onStep, stepMock, 'Configure mock-first mode', 'skipped', 'not selected')
  }

  // ── Step 11: Generate .context/ directory ──────────────────────────────────
  const stepContext = 'context-dir'
  report(onStep, stepContext, 'Generate .context/ directory', 'running')
  try {
    if (contextDir) {
      const contextDirPath = path.join(projectDir, '.context')
      if (await fs.pathExists(contextDirPath)) {
        report(onStep, stepContext, 'Generate .context/ directory', 'done', 'already exists')
      } else {
        if (!dryRun) {
          const { index, summary } = await generateContextDir(options)
          await ensureDirExists(contextDirPath)
          await fs.writeFile(path.join(contextDirPath, 'INDEX.md'), index, 'utf-8')
          await fs.writeFile(path.join(contextDirPath, 'summary.md'), summary, 'utf-8')
        }
        report(onStep, stepContext, 'Generate .context/ directory', 'done',
          dryRun ? 'dry-run: would generate .context/' : '.context/INDEX.md + summary.md')
      }
    } else {
      report(onStep, stepContext, 'Generate .context/ directory', 'skipped', 'not selected')
    }
  } catch (e) {
    report(onStep, stepContext, 'Generate .context/ directory', 'error', String(e))
  }

  // ── Step 12: Generate CLAUDE.md ────────────────────────────────────────────
  const stepClaudeMd = 'claude-md'
  report(onStep, stepClaudeMd, 'Generate CLAUDE.md', 'running')
  try {
    if (claudeMd) {
      const claudeMdPath = path.join(projectDir, 'CLAUDE.md')
      if (await fs.pathExists(claudeMdPath)) {
        report(onStep, stepClaudeMd, 'Generate CLAUDE.md', 'done', 'already exists')
      } else {
        if (!dryRun) {
          const content = generateClaudeMd(options)
          await fs.writeFile(claudeMdPath, content, 'utf-8')
        }
        report(onStep, stepClaudeMd, 'Generate CLAUDE.md', 'done',
          dryRun ? 'dry-run: would generate CLAUDE.md' : 'CLAUDE.md')
      }
    } else {
      report(onStep, stepClaudeMd, 'Generate CLAUDE.md', 'skipped', 'not selected')
    }
  } catch (e) {
    report(onStep, stepClaudeMd, 'Generate CLAUDE.md', 'error', String(e))
  }

  // ── Step 13: Write manifest ───────────────────────────────────────────────
  const stepManifest = 'manifest'
  report(onStep, stepManifest, 'Write forge manifest', 'running')
  try {
    if (!dryRun) {
      const manifestDir = path.join(projectDir, '.javi-forge')
      await ensureDirExists(manifestDir)
      const manifest: ForgeManifest = {
        version: '0.1.0',
        projectName,
        stack,
        ciProvider,
        memory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        modules: [
          ...(memory !== 'none' ? [memory] : []),
          ...(ghagga ? ['ghagga'] : []),
          ...(sdd ? ['sdd'] : []),
          ...(aiSync ? ['ai-config'] : []),
          ...(contextDir ? ['context'] : []),
          ...(claudeMd ? ['claude-md'] : []),
        ],
      }
      await fs.writeJson(path.join(manifestDir, 'manifest.json'), manifest, { spaces: 2 })
    }
    report(onStep, stepManifest, 'Write forge manifest', 'done', '.javi-forge/manifest.json')
  } catch (e) {
    report(onStep, stepManifest, 'Write forge manifest', 'error', String(e))
  }
}
