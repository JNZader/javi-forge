import fs from 'fs-extra'
import os from 'os'
import path from 'path'

export async function createTempDir(prefix = 'javi-forge-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await fs.remove(dir)
}

export async function readGenerated(projectDir: string, ...segments: string[]): Promise<string> {
  return fs.readFile(path.join(projectDir, ...segments), 'utf-8')
}

export async function fileExists(projectDir: string, ...segments: string[]): Promise<boolean> {
  return fs.pathExists(path.join(projectDir, ...segments))
}

export async function getFileMode(projectDir: string, ...segments: string[]): Promise<number> {
  const stat = await fs.stat(path.join(projectDir, ...segments))
  return stat.mode & 0o777
}

export function collectSteps() {
  const steps: Array<{ id: string; label: string; status: string; detail?: string }> = []
  const onStep = (step: { id: string; label: string; status: string; detail?: string }) => {
    const idx = steps.findIndex(s => s.id === step.id)
    if (idx >= 0) steps[idx] = step
    else steps.push(step)
  }
  return { steps, onStep }
}
