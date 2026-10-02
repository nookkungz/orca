// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexTeamSettings } from './CodexTeamSettings'
import {
  DEFAULT_CODEX_TEAM_SETTINGS,
  type CodexTeamSettings as TeamSettings
} from '../../../../shared/codex-team'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: vi.fn(),
  getActiveRuntimeTarget: ({
    activeRuntimeEnvironmentId
  }: {
    activeRuntimeEnvironmentId?: string | null
  }) =>
    activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))
const models = ['future-model', 'fast-model'].map((id) => ({
  id,
  label: id,
  isDefault: false,
  efforts: (id === 'future-model' ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'high']).map(
    (value) => ({ value, label: value })
  )
}))
const saved = vi.fn()
function Pane({ initial = DEFAULT_CODEX_TEAM_SETTINGS }: { initial?: TeamSettings }) {
  const [codexTeam, setTeam] = useState(initial)
  return (
    <CodexTeamSettings
      settings={{
        codexTeam,
        activeRuntimeEnvironmentId: 'windows',
        localWindowsRuntimeDefault: { kind: 'windows-host' },
        activeCodexManagedAccountId: null
      }}
      updateSettings={(patch) => {
        saved(patch)
        if (patch.codexTeam) {
          setTeam(patch.codexTeam)
        }
      }}
    />
  )
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function choose(label: string, value: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: value }))
}

describe('Codex Team model settings', () => {
  it('selects live models and independent inclusive effort ranges, then restores saved controls', async () => {
    vi.mocked(callRuntimeRpc).mockResolvedValue({ models, wslDistro: 'Ubuntu' })
    const mounted = render(<Pane />)
    const model = await screen.findByRole('checkbox', { name: 'Allow worker model fast-model' })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'windows' },
      'codexTeam.models',
      {},
      expect.any(Object)
    )
    fireEvent.click(model)
    expect(saved).toHaveBeenLastCalledWith({
      codexTeam: { ...DEFAULT_CODEX_TEAM_SETTINGS, allowedModels: ['future-model'] }
    })
    await choose('Minimum effort for future-model', 'medium')
    await choose('Maximum effort for future-model', 'high')
    expect(saved).toHaveBeenLastCalledWith({
      codexTeam: {
        maxWorkers: 3,
        allowedModels: ['future-model'],
        modelEffortRanges: { 'future-model': { min: 'medium', max: 'high' } }
      }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow worker model fast-model' }))
    await choose('Minimum effort for fast-model', 'high')
    const last = saved.mock.lastCall![0].codexTeam
    expect(last.modelEffortRanges).toEqual({
      'future-model': { min: 'medium', max: 'high' },
      'fast-model': { min: 'high', max: 'high' }
    })
    mounted.unmount()
    render(<Pane initial={last} />)
    await screen.findByRole('checkbox', { name: 'Allow worker model fast-model' })
    expect(
      screen.getByRole('combobox', { name: 'Minimum effort for future-model' }).textContent
    ).toBe('medium')
    fireEvent.click(screen.getByRole('button', { name: 'Reset effort range for fast-model' }))
    expect(saved.mock.lastCall![0].codexTeam.modelEffortRanges).toEqual({
      'future-model': { min: 'medium', max: 'high' }
    })
  })
  it('retains unavailable selections, exposes catalog errors and permits retry without changing settings', async () => {
    vi.mocked(callRuntimeRpc)
      .mockRejectedValueOnce(new Error('Host disconnected'))
      .mockResolvedValue({ models, wslDistro: null })
    render(
      <Pane
        initial={{
          maxWorkers: 3,
          allowedModels: ['removed-model'],
          modelEffortRanges: { 'future-model': { min: 'removed', max: 'high' } }
        }}
      />
    )
    expect((await screen.findByRole('alert')).textContent).toBe('Host disconnected')
    expect(saved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
    const missing = await screen.findByRole('checkbox', {
      name: 'Allow worker model removed-model'
    })
    expect(missing.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow worker model future-model' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('No supported effort')
    )
    fireEvent.click(missing)
    expect(saved.mock.lastCall![0].codexTeam.allowedModels).toEqual(['future-model'])
  })
})
