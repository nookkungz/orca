import { toHostSessionTabId } from '../../../shared/terminal-surface-id'
import { create } from 'zustand'
import type { Automation, AutomationRun } from '../../../shared/automations-types'
import { automationRunTabIds } from '../../../shared/automation-tab-origin'
import { disabledAutomationTabVisibilityId } from '../../../shared/automation-request-capabilities'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { toRuntimeExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'

type RunTab = {
  id: string
  entityId?: string
  worktreeId: string
  executionHostId?: string
  automationId?: string
  contentType?: string
  ptyId?: string | null
}
type Catalog = { definitions: Map<string, boolean>; origins: Map<string, string> }
const identity = (...parts: string[]): string => JSON.stringify(parts)
const owner = (tab: RunTab): string => tab.executionHostId ?? 'local'
const tabKey = (tab: RunTab): string =>
  identity(owner(tab), tab.worktreeId, toHostSessionTabId(tab.entityId ?? tab.id))

/** Presentation only: reveal exceptions intentionally never enter persisted sessions. */
export const useAutomationRunTabVisibility = create(() => ({
  catalogs: new Map<string, Catalog>(),
  revealed: new Map<string, { hostId: string; automationId: string }>()
}))

export function setAutomationTabCatalog(
  authorityHostId: string,
  automations: readonly Automation[],
  runs: readonly AutomationRun[]
): void {
  const state = useAutomationRunTabVisibility.getState()
  const catalogs = new Map(state.catalogs)
  const definitions = new Map(automations.map((a) => [a.id, a.showRunsInTabs === true]))
  const origins = new Map<string, string>()
  const byId = new Map(automations.map((a) => [a.id, a]))
  for (const run of [...runs].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!run.workspaceId) {
      continue
    }
    const automation = byId.get(run.automationId)
    const hostId =
      authorityHostId === 'local' &&
      automation?.executionTargetType === 'ssh' &&
      automation.executionTargetId
        ? toSshExecutionHostId(automation.executionTargetId)
        : authorityHostId
    for (const id of automationRunTabIds(run)) {
      origins.set(identity(hostId, run.workspaceId, id), run.automationId)
    }
    if (run.terminalPtyId) {
      origins.set(identity(hostId, run.workspaceId, 'pty', run.terminalPtyId), run.automationId)
    }
  }
  const previous = catalogs.get(authorityHostId)
  catalogs.set(authorityHostId, { definitions, origins })
  const revealed = new Map(state.revealed)
  for (const [key, value] of revealed) {
    const authority = value.hostId.startsWith('ssh:') ? 'local' : value.hostId
    if (
      authority === authorityHostId &&
      previous?.definitions.get(value.automationId) === true &&
      definitions.get(value.automationId) !== true
    ) {
      revealed.delete(key)
    }
  }
  useAutomationRunTabVisibility.setState({ catalogs, revealed })
}

export function automationTabOrigin(tab: RunTab): string | undefined {
  if (tab.contentType && tab.contentType !== 'terminal') {
    return undefined
  }
  const hostId = owner(tab)
  const catalog = useAutomationRunTabVisibility
    .getState()
    .catalogs.get(hostId.startsWith('ssh:') ? 'local' : hostId)
  return (
    catalog?.origins.get(tabKey(tab)) ??
    (tab.ptyId
      ? catalog?.origins.get(identity(hostId, tab.worktreeId, 'pty', tab.ptyId))
      : undefined) ??
    tab.automationId
  )
}

export function isAutomationRunTabVisible(
  tab: RunTab,
  state = useAutomationRunTabVisibility.getState()
): boolean {
  const automationId = automationTabOrigin(tab)
  if (!automationId) {
    return true
  }
  const hostId = owner(tab)
  return (
    state.revealed.has(tabKey(tab)) ||
    state.catalogs
      .get(hostId.startsWith('ssh:') ? 'local' : hostId)
      ?.definitions.get(automationId) === true
  )
}

export function revealAutomationRunTab(tab: RunTab): void {
  const automationId = automationTabOrigin(tab)
  if (!automationId) {
    return
  }
  const revealed = new Map(useAutomationRunTabVisibility.getState().revealed)
  revealed.set(tabKey(tab), { hostId: owner(tab), automationId })
  useAutomationRunTabVisibility.setState({ revealed })
}

export function clearAutomationTabReveals(hostId: string, automationId: string): void {
  const revealed = new Map(useAutomationRunTabVisibility.getState().revealed)
  for (const [key, entry] of revealed) {
    if (
      (entry.hostId.startsWith('ssh:') ? 'local' : entry.hostId) === hostId &&
      entry.automationId === automationId
    ) {
      revealed.delete(key)
    }
  }
  useAutomationRunTabVisibility.setState({ revealed })
}

export function applySavedAutomationTabVisibility(
  target: RuntimeClientTarget,
  method: string,
  params: unknown
): void {
  const id = disabledAutomationTabVisibilityId(method, params)
  if (id) {
    clearAutomationTabReveals(
      target.kind === 'environment' ? toRuntimeExecutionHostId(target.environmentId) : 'local',
      id
    )
  }
}
