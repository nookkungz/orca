import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync'
import {
  ENV,
  HOST_SURFACE_ID,
  LEAF_ID,
  NOW,
  SECOND_LEAF_ID,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

vi.mock('../store', () => ({ useAppStore: { setState: vi.fn() } }))

describe('terminal snapshot host ownership', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  it.each(['epoch-wsl', 'none:client-navigation'])(
    'keeps Windows terminals and resources when a sibling host publishes %s',
    (publicationEpoch) => {
      const snapshot = makeSnapshot([
        {
          type: 'terminal',
          id: HOST_SURFACE_ID,
          title: 'Codex',
          parentTabId: 'host-tab-1',
          leafId: LEAF_ID,
          isActive: true,
          status: 'ready',
          terminal: 'terminal-1'
        },
        {
          type: 'terminal',
          id: `host-tab-2::${SECOND_LEAF_ID}`,
          title: 'pending',
          parentTabId: 'host-tab-2',
          leafId: SECOND_LEAF_ID,
          isActive: false,
          status: 'pending-handle',
          terminal: null
        }
      ])
      const initial = makeState()
      const windows = {
        ...initial,
        ...applyWebSessionTabsSnapshot(initial, snapshot, ENV, NOW)
      }
      // Legacy ready mirrors may predate executionHostId; their PTY still names the owner.
      delete windows.tabsByWorktree[WT][0].executionHostId
      const afterSibling = {
        ...windows,
        ...applyWebSessionTabsSnapshot(
          windows,
          makeSnapshot([], {
            publicationEpoch,
            snapshotVersion: publicationEpoch.startsWith('none') ? 0 : 1
          }),
          'wsl-env',
          NOW + 1
        )
      }
      expect(afterSibling.tabsByWorktree[WT]).toEqual(windows.tabsByWorktree[WT])
      expect(afterSibling.ptyIdsByTabId).toEqual(windows.ptyIdsByTabId)
      expect(afterSibling.terminalLayoutsByTabId).toEqual(windows.terminalLayoutsByTabId)
      expect(afterSibling.unifiedTabsByWorktree[WT]).toEqual(windows.unifiedTabsByWorktree[WT])
      expect(afterSibling.groupsByWorktree[WT]).toEqual(windows.groupsByWorktree[WT])

      const afterOwner = {
        ...afterSibling,
        ...applyWebSessionTabsSnapshot(
          afterSibling,
          makeSnapshot([], { snapshotVersion: 2 }),
          ENV,
          NOW + 2
        )
      }
      expect(afterOwner.tabsByWorktree[WT]).toEqual([])
      expect(afterOwner.ptyIdsByTabId).toEqual({})
      expect(afterOwner.terminalLayoutsByTabId).toEqual({})
    }
  )
})
