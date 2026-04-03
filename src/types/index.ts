export type Stack = 'node' | 'python' | 'go' | 'rust' | 'java-gradle' | 'java-maven' | 'elixir'
export type CIProvider = 'github' | 'gitlab' | 'woodpecker'
export type MemoryOption = 'engram' | 'obsidian-brain' | 'memory-simple' | 'none'
export interface InitOptions {
  projectName: string
  projectDir: string
  stack: Stack
  ciProvider: CIProvider
  memory: MemoryOption
  aiSync: boolean
  sdd: boolean
  ghagga: boolean
  mock: boolean
  contextDir: boolean
  claudeMd: boolean
  dryRun: boolean
}

export interface StackClaudeMdEntry {
  skills: string[]
  conventions: string
  testFramework: string
}

export interface StackContextEntry {
  tree: string
  conventions: string
  entryPoint: string
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

// ── Plugin Marketplace ──────────────────────────────────────────────────────

export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  repository?: string
  skills?: string[]
  commands?: string[]
  hooks?: string[]
  agents?: string[]
  tags?: string[]
}

export interface PluginRegistryEntry {
  id: string
  repository: string
  description: string
  tags: string[]
  stars?: number
  updatedAt?: string
}

export interface PluginRegistry {
  version: string
  updatedAt: string
  plugins: PluginRegistryEntry[]
}

export interface PluginValidationError {
  path: string
  message: string
}

export interface PluginValidationResult {
  valid: boolean
  errors: PluginValidationError[]
  manifest: PluginManifest | null
}

export interface InstalledPlugin {
  name: string
  version: string
  installedAt: string
  source: string
  manifest: PluginManifest
}

export interface PluginSyncResult {
  added: string[]
  removed: string[]
  unchanged: string[]
  wired: AutoWireEntry[]
  unwired: AutoWireEntry[]
}

// ── Auto-Wiring ──────────────────────────────────────────────────────────────

export type AutoWireTarget = 'claude-md' | 'settings-json'

export interface AutoWireEntry {
  plugin: string
  target: AutoWireTarget
  capability: string
  /** e.g. skill path or hook command */
  value: string
}

export interface AutoWireResult {
  wired: AutoWireEntry[]
  unwired: AutoWireEntry[]
  errors: string[]
}

// ── Agent Skills Spec ──────────────────────────────────────────────────────

export interface AgentSkillEntry {
  name: string
  description: string
  path: string
}

export interface AgentSkillsManifest {
  name: string
  version: string
  description: string
  skills: AgentSkillEntry[]
  metadata?: { forge_source?: string }
}

// ── Codex TOML Export ─────────────────────────────────────────────────────

export interface CodexTomlEntry {
  name: string
  model: string
  instructions: string
}

export interface CodexExportResult {
  success: boolean
  files?: string[]
  error?: string
}

// ── Security Baseline ──────────────────────────────────────────────────────

export type SecuritySeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info'

export interface SecurityFinding {
  id: string
  severity: SecuritySeverity
  package: string
  title: string
  url?: string
}

export interface SecurityBaseline {
  version: string
  createdAt: string
  stack: string
  buildTool: string
  findings: SecurityFinding[]
  findingKeys: string[]
}

export interface SecurityCheckResult {
  baseline: SecurityBaseline
  current: SecurityFinding[]
  regressions: SecurityFinding[]
  resolved: SecurityFinding[]
}

// ── Skills Doctor ────────────────────────────────────────────────────────────

export interface SkillCriticalRule {
  skillName: string
  skillPath: string
  rule: string
  /** Normalized rule for comparison (lowercase, trimmed) */
  normalized: string
}

export interface SkillConflict {
  ruleA: SkillCriticalRule
  ruleB: SkillCriticalRule
  reason: string
}

export interface SkillBudgetEntry {
  skillName: string
  skillPath: string
  tokens: number
}

export interface SkillBudgetResult {
  entries: SkillBudgetEntry[]
  totalTokens: number
  budget: number
  overBudget: boolean
  suggestions: string[]
}

export interface SkillDuplicate {
  skillA: string
  skillB: string
  /** Overlapping trigger keywords */
  sharedTriggers: string[]
  similarity: number
}

export interface SkillDoctorResult {
  conflicts: SkillConflict[]
  budget: SkillBudgetResult
  duplicates: SkillDuplicate[]
}

// ── Quality Scoring ─────────────────────────────────────────────────────────

export interface SkillScore {
  skillName: string
  completeness: number
  clarity: number
  testability: number
  tokenEfficiency: number
  overall: number
  threshold: number
  passing: boolean
}

export interface SkillBenchmarkCheck {
  name: string
  passed: boolean
  detail?: string
}

export interface SkillBenchmarkResult {
  skillName: string
  checks: SkillBenchmarkCheck[]
  passRate: number
}
