import { afterEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { getDefaultPersistedState } from '../../shared/constants'
import { OrcaRuntimeService } from './orca-runtime'
import { readCodexTeamCatalog } from '../codex/codex-team-catalog'

vi.mock('../codex/codex-team-catalog', () => ({ readCodexTeamCatalog: vi.fn() }))
const platform = process.platform
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  vi.clearAllMocks()
})

describe('Codex Team settings catalog', () => {
  it('uses the native selected account and configured command, without starting a team', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const settings = {
      ...getDefaultPersistedState(homedir()).settings,
      agentCmdOverrides: { codex: 'node "/path with spaces/codex.cjs"' }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: catalog discovery only reads getSettings from the store; session APIs are not exercised.
    const runtime = new OrcaRuntimeService({ getSettings: () => settings } as never)
    const prepare = vi.fn().mockResolvedValue('/managed/account')
    runtime.setCommitMessageAgentEnvironmentResolvers({ prepareForCodexLaunch: prepare })
    const createRun = vi.spyOn(runtime, 'getOrchestrationDb')
    vi.mocked(readCodexTeamCatalog).mockResolvedValue({
      models: [],
      model: 'unavailable-config-model',
      effort: 'high'
    })
    expect(await runtime.getCodexTeamModelCatalog()).toEqual({ models: [], wslDistro: null })
    expect(prepare).toHaveBeenCalledWith({ runtime: 'host', wslDistro: null })
    expect(readCodexTeamCatalog).toHaveBeenCalledWith({
      cwd: homedir(),
      codexHome: '/managed/account',
      wslDistro: null,
      codexCommand: 'node',
      commandArgs: ['/path with spaces/codex.cjs']
    })
    expect(createRun).not.toHaveBeenCalled()
  })
  it('uses the selected WSL distro account and refuses a home from another distro', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const settings = {
      ...getDefaultPersistedState(homedir()).settings,
      localWindowsRuntimeDefault: { kind: 'wsl' as const, distro: 'Ubuntu' },
      agentCmdOverrides: { codex: "'/tmp/งาน test/codex'" }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: catalog discovery only reads getSettings from the store; session APIs are not exercised.
    const runtime = new OrcaRuntimeService({ getSettings: () => settings } as never)
    const prepare = vi.fn().mockResolvedValue('\\\\wsl.localhost\\Ubuntu\\home\\user\\.codex')
    runtime.setCommitMessageAgentEnvironmentResolvers({ prepareForCodexLaunch: prepare })
    vi.mocked(readCodexTeamCatalog).mockResolvedValue({
      models: [],
      model: 'model',
      effort: 'high'
    })
    expect(await runtime.getCodexTeamModelCatalog()).toEqual({ models: [], wslDistro: 'Ubuntu' })
    expect(prepare).toHaveBeenCalledWith({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    expect(readCodexTeamCatalog).toHaveBeenCalledWith({
      cwd: '/home/user/.codex',
      codexHome: '/home/user/.codex',
      wslDistro: 'Ubuntu',
      codexCommand: '/tmp/งาน test/codex',
      commandArgs: []
    })
    prepare.mockResolvedValue('\\\\wsl.localhost\\Debian\\home\\user\\.codex')
    await expect(runtime.getCodexTeamModelCatalog()).rejects.toThrow('Cannot verify')
    expect(readCodexTeamCatalog).toHaveBeenCalledTimes(1)
  })
})
