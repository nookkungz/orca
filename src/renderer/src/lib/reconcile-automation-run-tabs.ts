import type { AppState } from '@/store/types'
import { getKnownExecutionHostIdForWorktree } from './worktree-runtime-owner'
import { automationTabOrigin, isAutomationRunTabVisible } from './automation-run-tab-visibility'
import { buildActiveSurfacePatch } from '@/store/slices/tabs/tabs-surface'

/** Keep every terminal and group order; only repair a selection that became hidden. */
export function reconcileAutomationRunTabs(state: AppState): Partial<AppState> | null {
  let changed = false
  const unifiedTabsByWorktree = { ...state.unifiedTabsByWorktree }
  const tabsByWorktree = { ...state.tabsByWorktree }
  const groupsByWorktree = { ...state.groupsByWorktree }
  for (const [worktreeId, tabs] of Object.entries(unifiedTabsByWorktree)) {
    const hostId = getKnownExecutionHostIdForWorktree(state, worktreeId)
    const legacyById = new Map((tabsByWorktree[worktreeId] ?? []).map((tab) => [tab.id, tab]))
    unifiedTabsByWorktree[worktreeId] = tabs.map((tab) => {
      if (tab.contentType !== 'terminal') {
        return tab
      }
      const executionHostId = tab.executionHostId ?? hostId ?? undefined
      // An unresolved host is not evidence that a legacy tab belongs to this desktop.
      if (!executionHostId) {
        return tab
      }
      const legacy = legacyById.get(tab.entityId)
      const automationId = automationTabOrigin({ ...tab, executionHostId, ptyId: legacy?.ptyId })
      if (tab.automationId === automationId && tab.executionHostId === executionHostId) {
        return tab
      }
      changed = true
      return { ...tab, automationId, executionHostId }
    })
    const terminalOrigins = new Map(
      unifiedTabsByWorktree[worktreeId]
        .filter((t) => t.contentType === 'terminal')
        .map((t) => [t.entityId, t])
    )
    tabsByWorktree[worktreeId] = (tabsByWorktree[worktreeId] ?? []).map((tab) => {
      const origin = terminalOrigins.get(tab.id)
      if (
        !origin ||
        (tab.automationId === origin.automationId && tab.executionHostId === origin.executionHostId)
      ) {
        return tab
      }
      changed = true
      return { ...tab, automationId: origin.automationId, executionHostId: origin.executionHostId }
    })
    groupsByWorktree[worktreeId] = (groupsByWorktree[worktreeId] ?? []).map((group) => {
      const groupTabs = unifiedTabsByWorktree[worktreeId].filter((t) => t.groupId === group.id)
      const active = groupTabs.find((t) => t.id === group.activeTabId)
      if (!active || isAutomationRunTabVisible(active)) {
        return group
      }
      const visible = groupTabs.filter((tab) => isAutomationRunTabVisible(tab))
      const ids = new Set(visible.map((t) => t.id))
      const activeTabId =
        (group.recentTabIds ?? []).toReversed().find((id) => ids.has(id)) ??
        [...visible].sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0))[0]?.id ??
        null
      changed = true
      return { ...group, activeTabId }
    })
  }
  if (!changed) {
    return null
  }
  const patch = { unifiedTabsByWorktree, tabsByWorktree, groupsByWorktree }
  return {
    ...patch,
    ...(state.activeWorktreeId
      ? buildActiveSurfacePatch({ ...state, ...patch }, state.activeWorktreeId)
      : {})
  }
}
