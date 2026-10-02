import { describe, expect, it, vi } from 'vitest'
import './orca-runtime-test-lifecycle.spec'
import { OrcaRuntimeService, electronMocks } from './orca-runtime-test-mocks.spec'
import {
  HEADLESS_LEAF_ID,
  TEST_WORKTREE_ID,
  makeRuntimeStoreWithWorkspaceSession,
  makeWorkspaceSessionWithHeadlessTerminal
} from './orca-runtime-test-fixtures.spec'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

const EPOCH = 'renderer:hydrate-regression'

class HydrateRuntime extends OrcaRuntimeService {
  seed(snapshot: RuntimeMobileSessionTabsSnapshot) {
    this.storeMobileSessionSnapshot(TEST_WORKTREE_ID, snapshot)
  }

  hydrate() {
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(TEST_WORKTREE_ID, {
      allowAttachedWindow: true
    })
    return this.snapshot()
  }

  snapshot() {
    const snapshot = this.mobileSessionTabsByWorktree.get(TEST_WORKTREE_ID)
    if (!snapshot) {
      throw new Error('Expected hydrated snapshot')
    }
    return snapshot
  }
}

function prepare(availableWindow: boolean) {
  const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession(
    makeWorkspaceSessionWithHeadlessTerminal()
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every store read used here.
  const runtime = new HydrateRuntime(runtimeStore as never)
  electronMocks.BrowserWindow.fromId.mockReturnValue(
    availableWindow ? { isDestroyed: () => false, webContents: { send: vi.fn() } } : null
  )
  const empty: RuntimeMobileSessionTabsSnapshot = {
    worktree: TEST_WORKTREE_ID,
    publicationEpoch: EPOCH,
    snapshotVersion: 4,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: []
  }
  runtime.syncWindowGraph(1, { tabs: [], leaves: [], mobileSessionTabs: [empty] })
  return { runtime, empty }
}

describe('full headless hydration publication identity', () => {
  it.each([true, false])('preserves the renderer epoch with available window %s', (available) => {
    const { runtime, empty } = prepare(available)
    const hydrated = runtime.hydrate()
    expect(hydrated.publicationEpoch).toBe(EPOCH)
    expect(hydrated.snapshotVersion).toBeGreaterThan(empty.snapshotVersion)
    expect(hydrated.tabs).toHaveLength(1)
    runtime.syncWindowGraph(1, {
      tabs: [],
      leaves: [],
      mobileSessionTabs: [{ ...empty, snapshotVersion: 5 }]
    })
    expect(runtime.snapshot().tabs).toHaveLength(0)
    expect(runtime.snapshot().publicationEpoch).toBe(EPOCH)
    const next = runtime.hydrate()
    expect(next.publicationEpoch).toBe(EPOCH)
    expect(next.snapshotVersion).toBeGreaterThan(hydrated.snapshotVersion)
  })

  it('still mints a headless epoch when no publisher exists', () => {
    const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession(
      makeWorkspaceSessionWithHeadlessTerminal()
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every store read used here.
    const runtime = new HydrateRuntime(runtimeStore as never)
    const hydrated = runtime.hydrate()
    expect(hydrated.publicationEpoch).toMatch(/^headless-hydrated:/)
    expect(hydrated.snapshotVersion).toBe(1)
  })

  it.each(['host', 'all'] as const)(
    'materializes pending panes for %s with no window',
    async (navigation) => {
      const { runtime } = prepare(false)
      runtime.hydrate()
      const focusTerminal = vi.fn()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this path uses only the notifier focus callback.
      runtime.setNotifier({ focusTerminal } as never)
      const spawn = vi.fn().mockResolvedValue({ id: 'persisted-pty', isReattach: true })
      runtime.setPtyController({
        spawn,
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => null,
        listProcesses: async () => []
      })
      const result = await runtime.activateMobileSessionTab(
        `id:${TEST_WORKTREE_ID}`,
        'host-tab',
        undefined,
        { navigation }
      )
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'persisted-pty' }))
      expect(result.tabs.some((tab) => tab.type === 'terminal' && tab.status === 'ready')).toBe(
        true
      )
      expect(result.publicationEpoch).toBe(EPOCH)
      expect(focusTerminal).not.toHaveBeenCalled()
    }
  )

  it.each(['host', 'all'] as const)(
    'relays pending panes for %s with a renderer',
    async (navigation) => {
      const { runtime } = prepare(true)
      runtime.hydrate()
      const focusTerminal = vi.fn()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this path uses only the notifier focus callback.
      runtime.setNotifier({ focusTerminal } as never)
      const spawn = vi.fn()
      runtime.setPtyController({
        spawn,
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => null
      })
      await runtime.activateMobileSessionTab(`id:${TEST_WORKTREE_ID}`, 'host-tab', undefined, {
        navigation
      })
      expect(spawn).not.toHaveBeenCalled()
      expect(focusTerminal).toHaveBeenCalledWith('host-tab', TEST_WORKTREE_ID, HEADLESS_LEAF_ID)
    }
  )

  it('keeps the renderer epoch when activating an inactive ready pane without a window', async () => {
    const { runtime } = prepare(false)
    const hydrated = runtime.hydrate()
    runtime.seed({
      ...hydrated,
      publicationEpoch: EPOCH,
      activeTabId: null,
      activeTabType: null,
      tabs: hydrated.tabs.map((tab) => ({ ...tab, isActive: false }))
    })
    runtime.markGraphUnavailable(1)
    runtime.registerPty('persisted-pty', TEST_WORKTREE_ID, null, {
      tabId: 'host-tab',
      leafId: HEADLESS_LEAF_ID
    })
    const result = await runtime.activateMobileSessionTab(
      `id:${TEST_WORKTREE_ID}`,
      'host-tab',
      undefined,
      { navigation: 'host' }
    )
    expect(result.activeTabId).toBe(`host-tab::${HEADLESS_LEAF_ID}`)
    expect(result.publicationEpoch).toBe(EPOCH)
    expect(result.snapshotVersion).toBeGreaterThan(hydrated.snapshotVersion)
  })
})
