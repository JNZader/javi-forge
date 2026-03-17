import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Root of the javi-forge package (one level up from dist/) */
export const FORGE_ROOT = path.resolve(__dirname, '..')

/** Templates directory */
export const TEMPLATES_DIR = path.join(FORGE_ROOT, 'templates')

/** Modules directory */
export const MODULES_DIR = path.join(FORGE_ROOT, 'modules')

/** Workflows directory */
export const WORKFLOWS_DIR = path.join(FORGE_ROOT, 'workflows')

/** AI config directory */
export const AI_CONFIG_DIR = path.join(FORGE_ROOT, 'ai-config')

/** Schemas directory */
export const SCHEMAS_DIR = path.join(FORGE_ROOT, 'schemas')

/** CI-local directory */
export const CI_LOCAL_DIR = path.join(FORGE_ROOT, 'ci-local')

/** Dependabot fragment directory */
export const DEPENDABOT_FRAGMENTS_DIR = path.join(TEMPLATES_DIR, 'common', 'dependabot')

/** Plugins directory (installed plugins) */
export const PLUGINS_DIR = path.join(FORGE_ROOT, 'plugins')

/** Plugin registry URL */
export const PLUGIN_REGISTRY_URL = 'https://raw.githubusercontent.com/JNZader/javi-forge-registry/main/registry.json'

/** Plugin manifest filename */
export const PLUGIN_MANIFEST_FILE = 'plugin.json'

/** Valid plugin asset directories */
export const PLUGIN_ASSET_DIRS = ['skills', 'commands', 'hooks', 'agents'] as const

/** Stack-to-dependabot fragment mapping */
export const STACK_DEPENDABOT_MAP: Record<string, string[]> = {
  'node':        ['npm'],
  'python':      ['pip'],
  'go':          ['gomod'],
  'rust':        ['cargo'],
  'java-gradle': ['gradle'],
  'java-maven':  ['maven'],
  'elixir':      [],
}

/** Stack-to-CI template filename mapping */
export const STACK_CI_MAP: Record<string, Record<string, string>> = {
  github: {
    'node':        'ci-node.yml',
    'python':      'ci-python.yml',
    'go':          'ci-go.yml',
    'rust':        'ci-rust.yml',
    'java-gradle': 'ci-java.yml',
    'java-maven':  'ci-java.yml',
  },
  gitlab: {
    'node':        'gitlab-ci-node.yml',
    'python':      'gitlab-ci-python.yml',
    'go':          'gitlab-ci-go.yml',
    'rust':        'gitlab-ci-rust.yml',
    'java-gradle': 'gitlab-ci-java.yml',
    'java-maven':  'gitlab-ci-java.yml',
  },
  woodpecker: {
    'node':        'woodpecker-node.yml',
    'python':      'woodpecker-python.yml',
    'go':          'woodpecker-go.yml',
    'rust':        'woodpecker-rust.yml',
    'java-gradle': 'woodpecker-java.yml',
    'java-maven':  'woodpecker-java.yml',
  },
}


