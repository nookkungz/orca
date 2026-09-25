import { beforeEach, describe, expect, it } from 'vitest'
import { makeAutomation, makeRun } from '@/components/automations/automations-page-fixtures'
import {
  createTestStore,
  makeTab,
  makeTabGroup,
  makeUnifiedTab
} from '@/store/slices/store-test-helpers'
import { getGroupVisibleTabOrder } from '@/components/tab-bar/group-tab-order'
import { resolveRepairedActiveTerminalTabId } from '@/components/terminal/active-terminal-repair'
import { resolveTabNumberShortcutTarget } from './tab-number-shortcuts'
import { reconcileAutomationRunTabs } from './reconcile-automation-run-tabs'
import { getDefaultWorkspaceSession } from '../../../shared/constants'
import { stampAutomationTabOrigins } from '../../../shared/automation-tab-origin'
import { workspaceSessionStateSchema } from '../../../shared/workspace-session-schema'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import {
  clearAutomationTabReveals,
  isAutomationRunTabVisible,
  revealAutomationRunTab,
  setAutomationTabCatalog,
  useAutomationRunTabVisibility
} from './automation-run-tab-visibility'

beforeEach(() =>
  useAutomationRunTabVisibility.setState({ catalogs: new Map(), revealed: new Map() })
)
const run = makeRun({
  workspaceId: 'wt',
  terminalSessionId: 'run-tab',
  terminalPtyId: 'pty',
  status: 'dispatched'
})
const tab = makeUnifiedTab({
  id: 'run-tab',
  worktreeId: 'wt',
  groupId: 'g',
  executionHostId: 'local'
})

describe('automation run workspace tabs', () => {
  it('hides old, new, and reused scheduled/manual runs without matching titles', () => {
    setAutomationTabCatalog(
      'local',
      [makeAutomation()],
      [run, { ...run, id: 'manual', trigger: 'manual' }]
    )
    expect(isAutomationRunTabVisible(tab)).toBe(false)
    expect(
      isAutomationRunTabVisible({
        ...tab,
        id: 'unrelated',
        entityId: 'unrelated'
      })
    ).toBe(true)
    expect(
      isAutomationRunTabVisible({ ...tab, id: 'new', entityId: 'new', automationId: 'a-1' })
    ).toBe(false)
    setAutomationTabCatalog('local', [makeAutomation({ showRunsInTabs: true })], [run])
    expect(isAutomationRunTabVisible(tab)).toBe(true)
  })

  it('qualifies legacy identity and settings by host, including encoded remote tabs', () => {
    setAutomationTabCatalog('local', [makeAutomation({ showRunsInTabs: true })], [run])
    setAutomationTabCatalog('runtime:windows', [makeAutomation()], [run])
    expect(isAutomationRunTabVisible(tab)).toBe(true)
    const remote = {
      ...tab,
      executionHostId: 'runtime:windows',
      id: toWebTerminalSurfaceTabId('run-tab'),
      entityId: toWebTerminalSurfaceTabId('run-tab')
    }
    expect(isAutomationRunTabVisible(remote)).toBe(false)
    expect(isAutomationRunTabVisible({ ...remote, executionHostId: 'runtime:other' })).toBe(true)
    expect(isAutomationRunTabVisible({ ...tab, worktreeId: 'different' })).toBe(true)
  })

  it('reveals only the chosen terminal in this window and clears it on disabling/restart', () => {
    setAutomationTabCatalog('local', [makeAutomation()], [run])
    revealAutomationRunTab(tab)
    expect(isAutomationRunTabVisible(tab)).toBe(true)
    expect(
      isAutomationRunTabVisible({ ...tab, id: 'other', entityId: 'other', automationId: 'a-1' })
    ).toBe(false)
    clearAutomationTabReveals('local', 'a-1')
    expect(isAutomationRunTabVisible(tab)).toBe(false)
    revealAutomationRunTab(tab)
    setAutomationTabCatalog('local', [makeAutomation({ showRunsInTabs: true })], [run])
    setAutomationTabCatalog('local', [makeAutomation({ showRunsInTabs: false })], [run])
    expect(isAutomationRunTabVisible(tab)).toBe(false)
    revealAutomationRunTab(tab)
    useAutomationRunTabVisibility.setState({ revealed: new Map() })
    expect(isAutomationRunTabVisible(tab)).toBe(false)
  })

  it.each(['wt', 'folder:workspace'])(
    'selects MRU visible tab or empty workspace while retaining terminals: %s',
    (worktreeId) => {
      const store = createTestStore()
      const hidden = { ...tab, worktreeId, automationId: 'a-1' }
      const older = { ...tab, worktreeId, id: 'older', entityId: 'older' }
      const recent = { ...tab, worktreeId, id: 'recent', entityId: 'recent' }
      const group = makeTabGroup({
        id: 'g',
        worktreeId,
        activeTabId: hidden.id,
        tabOrder: ['older', 'recent', hidden.id],
        recentTabIds: ['older', 'recent', hidden.id]
      })
      store.setState({
        activeWorktreeId: worktreeId,
        activeView: 'terminal',
        activeGroupIdByWorktree: { [worktreeId]: 'g' },
        groupsByWorktree: { [worktreeId]: [group] },
        unifiedTabsByWorktree: { [worktreeId]: [hidden, older, recent] },
        tabsByWorktree: { [worktreeId]: [makeTab({ id: hidden.id, worktreeId, ptyId: 'running' })] }
      })
      const patch = reconcileAutomationRunTabs(store.getState())
      expect(patch?.groupsByWorktree?.[worktreeId][0].activeTabId).toBe('recent')
      expect(patch?.tabsByWorktree?.[worktreeId][0].ptyId).toBe('running')
      expect(
        getGroupVisibleTabOrder(
          group,
          [hidden, older, recent],
          new Set(['run-tab', 'older', 'recent']),
          new Set(),
          new Set()
        ).map((t) => t.id)
      ).toEqual(['older', 'recent'])
      expect(resolveTabNumberShortcutTarget(store.getState(), 0)?.id).toBe('older')
      store.setState({ unifiedTabsByWorktree: { [worktreeId]: [hidden] } })
      const empty = reconcileAutomationRunTabs(store.getState())
      expect(empty?.groupsByWorktree?.[worktreeId][0].activeTabId).toBeNull()
      expect(empty?.activeTabId).toBeNull()
      expect(empty?.tabsByWorktree?.[worktreeId]).toHaveLength(1)
    }
  )

  it('stamps and persists proven terminal origins without changing process/layout state', () => {
    const session = {
      ...getDefaultWorkspaceSession(),
      tabsByWorktree: {
        wt: [
          makeTab({ id: 'run-tab', worktreeId: 'wt', ptyId: 'pty' }),
          makeTab({ id: 'ordinary', worktreeId: 'wt' })
        ]
      },
      unifiedTabs: { wt: [tab] }
    }
    const foreign = {
      ...session,
      tabsByWorktree: {
        wt: session.tabsByWorktree.wt.map((tab) => ({
          ...tab,
          executionHostId: 'runtime:other' as const
        }))
      },
      unifiedTabs: { wt: [{ ...tab, executionHostId: 'runtime:other' as const }] }
    }
    expect(stampAutomationTabOrigins(foreign, [run], 'local')).toBe(foreign)
    const stamped = stampAutomationTabOrigins(session, [run])
    expect(stamped.tabsByWorktree.wt[0]).toMatchObject({ automationId: 'a-1', ptyId: 'pty' })
    expect(stamped.tabsByWorktree.wt[1].automationId).toBeUndefined()
    expect(workspaceSessionStateSchema.parse(stamped).unifiedTabs?.wt[0].automationId).toBe('a-1')
    expect(stampAutomationTabOrigins(stamped, [run])).toBe(stamped)
    expect(
      resolveRepairedActiveTerminalTabId({
        activeTabType: 'terminal',
        activeTabId: null,
        rememberedTabId: 'run-tab',
        tabs: [stamped.tabsByWorktree.wt[0]]
      })
    ).toBeNull()
  })
})
