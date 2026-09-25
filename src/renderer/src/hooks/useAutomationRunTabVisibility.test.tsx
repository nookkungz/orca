// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type * as AutomationHostClient from '@/components/automations/automation-host-client'
import type { Automation } from '../../../shared/automations-types'
import { useAppStore } from '@/store'
import { makeAutomation, makeRun } from '@/components/automations/automations-page-fixtures'
import { createCompatibleRuntimeStatusResponse } from '@/runtime/runtime-compatibility-test-fixture'
import { emitAutomationsChangedWindowEvent } from '@/lib/automations-changed-window-event'
import {
  isAutomationRunTabVisible,
  useAutomationRunTabVisibility as visibility
} from '@/lib/automation-run-tab-visibility'
import { useAutomationRunTabVisibility } from './useAutomationRunTabVisibility'

const mocks = vi.hoisted(() => ({ list: vi.fn(), runs: vi.fn() }))
vi.mock('@/components/automations/automation-host-client', async (original) => ({
  ...(await original<typeof AutomationHostClient>()),
  listAutomationsForTarget: mocks.list,
  listAutomationRunsPageForTarget: mocks.runs
}))
const root = createRoot(document.createElement('div'))
afterEach(async () => {
  await act(async () => root.unmount())
  useAppStore.setState(useAppStore.getInitialState(), true)
})
function Harness(): null {
  useAutomationRunTabVisibility()
  return null
}

it('refreshes only the event authority, fences stale reads, and reloads after reconnect', async () => {
  const response = createCompatibleRuntimeStatusResponse()
  if (!response.ok) {
    throw new Error('fixture status')
  }
  const status = { status: response.result, checkedAt: 1, hostContactEpoch: 1 }
  useAppStore.setState({
    workspaceSessionReady: true,
    runtimeEnvironments: [
      {
        id: 'windows',
        name: 'Windows',
        createdAt: 1,
        updatedAt: 1,
        pairingRevision: 1,
        lastUsedAt: null,
        runtimeId: 'remote-runtime',
        endpoints: [],
        preferredEndpointId: 'lan'
      }
    ],
    runtimeStatusByEnvironmentId: new Map([['windows', status]])
  })
  visibility.setState({ catalogs: new Map(), revealed: new Map() })
  mocks.list.mockResolvedValue([makeAutomation()])
  mocks.runs.mockResolvedValue({
    runs: [makeRun({ workspaceId: 'wt', terminalSessionId: 't' })],
    nextCursor: null
  })
  await act(async () => root.render(<Harness />))
  const tab = { id: 'web-terminal-t', worktreeId: 'wt', executionHostId: 'runtime:windows' }
  expect(isAutomationRunTabVisible(tab)).toBe(false)
  const before = mocks.list.mock.calls.length
  let resolveStale: ((value: Automation[]) => void) | undefined
  mocks.list.mockImplementationOnce(
    () =>
      new Promise<Automation[]>((resolve) => {
        resolveStale = resolve
      })
  )
  await act(async () =>
    emitAutomationsChangedWindowEvent({ environmentId: 'windows', reason: 'definition' })
  )
  mocks.list.mockResolvedValue([makeAutomation({ showRunsInTabs: true })])
  await act(async () =>
    emitAutomationsChangedWindowEvent({ environmentId: 'windows', reason: 'definition' })
  )
  expect(isAutomationRunTabVisible(tab)).toBe(true)
  await act(async () => resolveStale?.([makeAutomation()]))
  expect(isAutomationRunTabVisible(tab)).toBe(true)
  expect(
    mocks.list.mock.calls.slice(before).every(([target]) => target.environmentId === 'windows')
  ).toBe(true)
  mocks.list.mockResolvedValue([makeAutomation()])
  await act(async () =>
    useAppStore.setState({
      runtimeStatusByEnvironmentId: new Map([['windows', { ...status, hostContactEpoch: 2 }]])
    })
  )
  expect(isAutomationRunTabVisible(tab)).toBe(false)
})
