import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { CODEX_TEAM_RUNTIME_CAPABILITY } from '../../shared/codex-team'
import { runCodexTeam } from './codex-team'

const { spawn, consoleStdio, dispose } = vi.hoisted(() => ({
  spawn: vi.fn(),
  consoleStdio: vi.fn(),
  dispose: vi.fn()
}))
vi.mock('../../shared/child-process/run-process', () => ({ spawnProcess: spawn }))
vi.mock('../../shared/windows-console-input', () => ({
  stdioForWindowsInteractiveChild: consoleStdio
}))
vi.mock('../../shared/node-cli-command-resolution', () => ({
  resolveCodexCommand: () => 'codex.exe',
  withCliRuntimeOnPath: (_command: string, env: NodeJS.ProcessEnv) => env
}))

const originalExitCode = process.exitCode

beforeEach(() => {
  vi.stubEnv('ORCA_PANE_KEY', 'team-pane')
  vi.stubEnv('ORCA_CODEX_TEAM_GUEST_DISTRO', undefined)
  vi.stubEnv('WSL_DISTRO_NAME', undefined)
  vi.clearAllMocks()
  consoleStdio.mockReturnValue({ stdio: [11, 'inherit', 'inherit'], dispose })
  spawn.mockImplementation(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function context() {
  const client = new RuntimeClient(process.cwd(), 1_000, null, null)
  const call = vi.spyOn(client, 'call')
  const envelope = { id: 'test', ok: true as const, _meta: { runtimeId: 'host' } }
  call
    .mockResolvedValueOnce({
      ...envelope,
      result: { capabilities: [CODEX_TEAM_RUNTIME_CAPABILITY] }
    })
    .mockResolvedValueOnce({
      ...envelope,
      result: { runId: 'run-1', model: 'test-model', effort: 'high', prompt: 'Wait for work.' }
    })
  return { client, cwd: process.cwd(), flags: new Map<string, string | boolean>(), json: false }
}

describe('Codex Team interactive launch', () => {
  it('attaches the Windows console input after binding the Run', async () => {
    const ctx = context()
    await runCodexTeam(ctx)
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        stdio: [11, 'inherit', 'inherit'],
        args: expect.arrayContaining(['agents.enabled=false', 'Wait for work.'])
      })
    )
    expect(ctx.client.call).toHaveBeenCalledTimes(2)
    expect(consoleStdio).toHaveBeenCalledWith(false)
    expect(dispose).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(0)
  })

  it('closes its console descriptor when spawning fails', async () => {
    spawn.mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })
    await expect(runCodexTeam(context())).rejects.toThrow('spawn failed')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
