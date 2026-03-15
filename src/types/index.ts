export type Stack = 'node' | 'python' | 'go' | 'rust' | 'java-gradle' | 'java-maven' | 'elixir'
export type CIProvider = 'github' | 'gitlab' | 'woodpecker'
export type MemoryOption = 'engram' | 'obsidian-brain' | 'memory-simple' | 'none'
export type AI_CLI = 'claude' | 'opencode' | 'gemini' | 'qwen' | 'codex' | 'copilot'

export interface InitOptions {
  projectName: string
  projectDir: string
  stack: Stack
  ciProvider: CIProvider
  memory: MemoryOption
  aiSync: boolean
  sdd: boolean
  ghagga: boolean
  dryRun: boolean
}

export interface SyncOptions {
  target: AI_CLI | 'all'
  mode: 'overwrite' | 'merge'
  projectDir: string
  dryRun: boolean
}

export interface InitStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  detail?: string
}

export interface StackDetection {
  stackType: Stack
  buildTool: string
  javaVersion?: string
}

export interface ForgeManifest {
  version: string
  projectName: string
  stack: Stack
  ciProvider: CIProvider
  memory: MemoryOption
  createdAt: string
  updatedAt: string
  modules: string[]
}

export interface DoctorCheck {
  label: string
  status: 'ok' | 'fail' | 'skip'
  detail?: string
}

export interface DoctorSection {
  title: string
  checks: DoctorCheck[]
}

export interface DoctorResult {
  sections: DoctorSection[]
}
