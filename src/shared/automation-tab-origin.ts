import type { AutomationRun } from './automations-types'
import { parsePaneKey } from './stable-pane-id'
import type { WorkspaceSessionState } from './workspace-session-state-types'

/** Identity evidence only; labels and workspace names are never evidence of a run. */
export function automationRunTabIds(run: AutomationRun): string[] {
  return [run.terminalSessionId, parsePaneKey(run.terminalPaneKey ?? '')?.tabId].filter(
    (id): id is string => Boolean(id)
  )
}

export function stampAutomationTabOrigins(
  session: WorkspaceSessionState,
  runs: readonly AutomationRun[],
  executionHostId?: string
): WorkspaceSessionState {
  const origins = new Map<string, string>()
  for (const run of [...runs].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!run.workspaceId) {
      continue
    }
    for (const id of automationRunTabIds(run)) {
      origins.set(JSON.stringify([run.workspaceId, id]), run.automationId)
    }
  }
  const ptyOrigins = new Map<string, string>()
  for (const run of [...runs].sort((a, b) => a.createdAt - b.createdAt)) {
    if (run.workspaceId && run.terminalPtyId) {
      ptyOrigins.set(JSON.stringify([run.workspaceId, run.terminalPtyId]), run.automationId)
    }
  }
  let changed = false
  const tabsByWorktree = Object.fromEntries(
    Object.entries(session.tabsByWorktree).map(([w, tabs]) => [
      w,
      tabs.map((tab) => {
        if (executionHostId && tab.executionHostId && tab.executionHostId !== executionHostId) {
          return tab
        }
        const automationId =
          origins.get(JSON.stringify([w, tab.id])) ??
          (tab.ptyId ? ptyOrigins.get(JSON.stringify([w, tab.ptyId])) : undefined) ??
          tab.automationId
        if (automationId === tab.automationId) {
          return tab
        }
        changed = true
        return { ...tab, automationId }
      })
    ])
  )
  const unifiedTabs =
    session.unifiedTabs &&
    Object.fromEntries(
      Object.entries(session.unifiedTabs).map(([w, tabs]) => [
        w,
        tabs.map((tab) => {
          if (executionHostId && tab.executionHostId && tab.executionHostId !== executionHostId) {
            return tab
          }
          if (tab.contentType !== 'terminal') {
            return tab
          }
          const automationId =
            origins.get(JSON.stringify([w, tab.entityId])) ??
            tabsByWorktree[w]?.find((t) => t.id === tab.entityId)?.automationId ??
            tab.automationId
          if (automationId === tab.automationId) {
            return tab
          }
          changed = true
          return { ...tab, automationId }
        })
      ])
    )
  return changed ? { ...session, tabsByWorktree, unifiedTabs } : session
}
