import { afterEach, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from './runtime-rpc-client'
import { AUTOMATION_TAB_VISIBILITY_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'

afterEach(() => vi.unstubAllGlobals())

it.each([true, false])(
  'refuses an old remote host before sending showRunsInTabs=%s',
  async (showRunsInTabs) => {
    const call = vi.fn().mockResolvedValue({ ok: true, result: { capabilities: [] } })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call } } })
    await expect(
      callRuntimeRpc(
        { kind: 'environment', environmentId: 'old' },
        'automation.update',
        {
          id: 'a',
          updates: { showRunsInTabs }
        },
        { skipCompatibilityCheck: true }
      )
    ).rejects.toThrow('Update the host')
    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0][0].method).toBe('status.get')
  }
)

it('sends the actual setting only after the host advertises support', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      result: { capabilities: [AUTOMATION_TAB_VISIBILITY_RUNTIME_CAPABILITY] }
    })
    .mockResolvedValueOnce({ ok: true, result: { automation: { id: 'a', showRunsInTabs: false } } })
  vi.stubGlobal('window', { api: { runtimeEnvironments: { call } } })
  await expect(
    callRuntimeRpc(
      { kind: 'environment', environmentId: 'new' },
      'automation.update',
      {
        id: 'a',
        updates: { showRunsInTabs: false }
      },
      { skipCompatibilityCheck: true }
    )
  ).resolves.toEqual({ automation: { id: 'a', showRunsInTabs: false } })
  expect(call.mock.calls.map(([request]) => request.method)).toEqual([
    'status.get',
    'automation.update'
  ])
})
