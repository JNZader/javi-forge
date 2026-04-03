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
  securityHooks: boolean
  codeGraph: boolean
  dockerDeploy: boolean
  /** Service name for docker rollout (default: 'app') */
  dockerServiceName: string
  /** Scaffold local AI dev stack (Ollama + optional services) */
  localAi: boolean
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

// ── TDD Pipeline Enforcement ────────────────────────────────────────────────

export type TddPipelineMode = 'strict' | 'warn'

export interface TddPipelineResult {
  installed: string[]
  skipped: string[]
  errors: string[]
  mode: TddPipelineMode
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

/**
 * Aggregated skills.json that merges multiple plugins into a single
 * Agent Skills spec manifest. Used by `npx skills add` and 40+ AI agents.
 */
export interface AggregatedSkillsManifest {
  name: string
  version: string
  description: string
  skills: AgentSkillEntry[]
  sources: AgentSkillSource[]
}

export interface AgentSkillSource {
  plugin: string
  version: string
  repository?: string
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
  updatedAt?: string
  stack: string
  buildTool: string
  findings: SecurityFinding[]
  findingKeys: string[]
  allowlist?: string[]
}

export interface SecurityCheckOptions {
  minSeverity?: SecuritySeverity
  staleDays?: number
}

export interface SecurityCheckResult {
  baseline: SecurityBaseline
  current: SecurityFinding[]
  regressions: SecurityFinding[]
  resolved: SecurityFinding[]
  filteredRegressions: SecurityFinding[]
  staleWarning?: string
  summary: SecuritySummary
}

export interface SecuritySummary {
  total: number
  bySeverity: Record<SecuritySeverity, number>
  regressionCount: number
  resolvedCount: number
  filteredCount: number
  baselineAge: number
}

// ── Skills Doctor ────────────────────────────────────────────────────────────

export interface SkillCriticalRule {
  skillName: string
  skillPath: string
  rule: string
  /** Normalized rule for comparison (lowercase, trimmed) */
  normalized: string
}

export type ConflictKind = 'regex-pair' | 'directive-clash'

export interface SkillConflict {
  ruleA: SkillCriticalRule
  ruleB: SkillCriticalRule
  reason: string
  /** How the conflict was detected */
  kind: ConflictKind
}

export interface SkillBudgetEntry {
  skillName: string
  skillPath: string
  tokens: number
}

export interface SkillBudgetSuggestion {
  /** Skills to disable in this suggestion set */
  disableSkills: string[]
  /** Total tokens freed by disabling these skills */
  tokensSaved: number
  /** Remaining tokens after disabling */
  remainingTokens: number
  /** Whether this set brings usage under budget */
  meetsbudget: boolean
}

export interface SkillBudgetResult {
  entries: SkillBudgetEntry[]
  totalTokens: number
  budget: number
  overBudget: boolean
  suggestions: string[]
  /** Structured optimization sets: minimal combinations to meet budget */
  optimizations: SkillBudgetSuggestion[]
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

export type SkillGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface SkillScore {
  skillName: string
  completeness: number
  clarity: number
  testability: number
  tokenEfficiency: number
  safety: number
  agentReadiness: number
  overall: number
  grade: SkillGrade
  threshold: number
  passing: boolean
}

export interface SkillRegistryGateResult {
  skillName: string
  score: SkillScore
  accepted: boolean
  reason?: string
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

// ── Workflow Graphs ─────────────────────────────────────────────────────────

const WORKFLOW_FORMAT = {
  DOT: 'dot',
  MERMAID: 'mermaid',
} as const

export type WorkflowFormat = (typeof WORKFLOW_FORMAT)[keyof typeof WORKFLOW_FORMAT]

const WORKFLOW_VALIDATION_STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  SKIP: 'skip',
} as const

export type WorkflowValidationStatus = (typeof WORKFLOW_VALIDATION_STATUS)[keyof typeof WORKFLOW_VALIDATION_STATUS]

export { WORKFLOW_FORMAT, WORKFLOW_VALIDATION_STATUS }

export interface WorkflowNode {
  id: string
  label: string
  check?: string
  metadata?: Record<string, string>
}

export interface WorkflowEdge {
  from: string
  to: string
  label?: string
}

export interface WorkflowGraph {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  format: WorkflowFormat
}

export interface WorkflowValidationResult {
  node: string
  status: WorkflowValidationStatus
  detail?: string
}

export interface WorkflowDiscoveryEntry {
  name: string
  path: string
  format: WorkflowFormat
}
