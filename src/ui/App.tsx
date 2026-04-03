import React, { useState } from 'react'
import { Box } from 'ink'
import path from 'path'
import Welcome from './Welcome.js'
import Header from './Header.js'
import NameInput from './NameInput.js'
import StackSelector from './StackSelector.js'
import CISelector from './CISelector.js'
import MemorySelector from './MemorySelector.js'
import OptionSelector from './OptionSelector.js'
import Progress from './Progress.js'
import Summary from './Summary.js'
import { initProject } from '../commands/init.js'
import type { Stack, CIProvider, MemoryOption, InitStep } from '../types/index.js'

type Stage =
  | 'welcome'
  | 'name'
  | 'stack'
  | 'ci'
  | 'memory'
  | 'options'
  | 'running'
  | 'done'

interface AppProps {
  dryRun?: boolean
  presetStack?: Stack
  presetCI?: CIProvider
  presetMemory?: MemoryOption
  presetName?: string
  presetGhagga?: boolean
  presetMock?: boolean
}

export default function App({
  dryRun = false,
  presetStack,
  presetCI,
  presetMemory,
  presetName,
  presetGhagga = false,
  presetMock = false,
}: AppProps) {
  const [stage, setStage] = useState<Stage>('welcome')
  const [projectName, setProjectName] = useState(presetName ?? '')
  const [projectDir, setProjectDir] = useState(
    presetName ? path.resolve(process.cwd(), presetName) : ''
  )
  const [stack, setStack] = useState<Stack>(presetStack ?? 'node')
  const [ciProvider, setCIProvider] = useState<CIProvider>(presetCI ?? 'github')
  const [memory, setMemory] = useState<MemoryOption>(presetMemory ?? 'engram')
  const [aiSync, setAiSync] = useState(true)
  const [sdd, setSdd] = useState(true)
  const [contextDir, setContextDir] = useState(true)
  const [claudeMd, setClaudeMd] = useState(true)
  const [ghagga, setGhagga] = useState(presetGhagga)
  const [securityHooks, setSecurityHooks] = useState(true)
  const [steps, setSteps] = useState<InitStep[]>([])
  const [startTime] = useState(Date.now())

  const handleNameConfirm = (name: string, dir: string) => {
    setProjectName(name)
    setProjectDir(dir)
    setStage(presetStack ? 'ci' : 'stack')
  }

  const handleStackConfirm = (s: Stack) => {
    setStack(s)
    setStage(presetCI ? 'memory' : 'ci')
  }

  const handleCIConfirm = (p: CIProvider) => {
    setCIProvider(p)
    setStage(presetMemory ? 'options' : 'memory')
  }

  const handleMemoryConfirm = (m: MemoryOption) => {
    setMemory(m)
    setStage('options')
  }

  const handleOptionsConfirm = async (opts: { aiSync: boolean; sdd: boolean; contextDir: boolean; claudeMd: boolean; ghagga: boolean; securityHooks: boolean }) => {
    setAiSync(opts.aiSync)
    setSdd(opts.sdd)
    setContextDir(opts.contextDir)
    setClaudeMd(opts.claudeMd)
    setGhagga(opts.ghagga)
    setSecurityHooks(opts.securityHooks)
    setStage('running')

    await initProject(
      {
        projectName,
        projectDir,
        stack,
        ciProvider,
        memory,
        aiSync: opts.aiSync,
        sdd: opts.sdd,
        ghagga: opts.ghagga,
        contextDir: opts.contextDir,
        claudeMd: opts.claudeMd,
        securityHooks: opts.securityHooks,
        mock: presetMock,
        dryRun,
      },
      (step) => setSteps(prev => {
        const idx = prev.findIndex(s => s.id === step.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = step
          return next
        }
        return [...prev, step]
      })
    )

    setStage('done')
  }

  const subtitle =
    stage === 'running' ? 'scaffolding...' :
    stage === 'done'    ? 'complete'       :
    undefined

  return (
    <Box flexDirection="column" padding={1}>
      {stage !== 'welcome' && <Header subtitle={subtitle} dryRun={dryRun} />}

      {stage === 'welcome' && (
        <Welcome onDone={() => {
          // Skip stages for which presets are already provided
          if (presetName && presetStack && presetCI && presetMemory) {
            setStage('options')
          } else if (presetName && presetStack && presetCI) {
            setStage('memory')
          } else if (presetName && presetStack) {
            setStage('ci')
          } else if (presetName) {
            setStage('stack')
          } else {
            setStage('name')
          }
        }} />
      )}
      {stage === 'name' && (
        <NameInput
          defaultName={projectName || 'my-project'}
          onConfirm={handleNameConfirm}
        />
      )}
      {stage === 'stack' && (
        <StackSelector
          projectDir={projectDir || process.cwd()}
          onConfirm={handleStackConfirm}
        />
      )}
      {stage === 'ci' && (
        <CISelector onConfirm={handleCIConfirm} />
      )}
      {stage === 'memory' && (
        <MemorySelector onConfirm={handleMemoryConfirm} />
      )}
      {stage === 'options' && (
        <OptionSelector onConfirm={handleOptionsConfirm} presetGhagga={presetGhagga} />
      )}
      {stage === 'running' && (
        <Progress
          steps={steps}
          projectName={projectName}
          contextLine={`${projectName} (${stack} + ${ciProvider})`}
          onDone={() => setStage('done')}
        />
      )}
      {stage === 'done' && (
        <Summary
          steps={steps}
          dryRun={dryRun}
          projectName={projectName}
          stack={stack}
          elapsedMs={Date.now() - startTime}
        />
      )}
    </Box>
  )
}
