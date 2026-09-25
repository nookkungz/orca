import {
  getWorktreeExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { revealAutomationRunTab } from '@/lib/automation-run-tab-visibility'
import type { AutomationRun } from '../../../../shared/automations-types'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import {
  automationRunForEnvironment,
  buildAutomationRunOpenLayout,
  getAutomationRunOpenTabId,
  resolveAutomationRunOpenTarget
} from './automation-run-open-target'
import { getAutomationRunViewState } from './automation-run-view-state'
import type { AutomationsPageActionContext } from './automations-page-action-context'

/** Opens the original run terminal when its host-qualified workspace is alive. */
export function createAutomationRunWorkspaceAction({ store, list }: AutomationsPageActionContext) {
  const { repoForRow, worktreeForRow } = store
  const { selectedRow } = list
  return function openRunWorkspace(run: AutomationRun): void {
    const runWorktree =
      run.workspaceId && selectedRow
        ? (worktreeForRow(selectedRow, repoForRow(selectedRow), run.workspaceId) ?? null)
        : null
    const appStore = useAppStore.getState()
    const authority = selectedRow?.catalogRef?.authority
    const environmentId = authority?.kind === 'runtime' ? authority.environmentId : undefined
    const openTabId = getAutomationRunOpenTabId(run, environmentId)
    const terminalTabExists = openTabId ? Boolean(appStore.getTab(openTabId)) : false
    const currentLayout = openTabId ? appStore.terminalLayoutsByTabId[openTabId] : null
    const livePtyIds = openTabId ? (appStore.ptyIdsByTabId[openTabId] ?? []) : []
    const terminalTarget = resolveAutomationRunOpenTarget({
      run: automationRunForEnvironment(run, environmentId, currentLayout),
      terminalTabExists,
      currentLayout,
      livePtyIds
    })
    const runViewState = getAutomationRunViewState({
      run,
      workspaceExists: Boolean(runWorktree),
      terminalTargetExists: terminalTarget !== null
    })
    if (!run.workspaceId || !runWorktree || !runViewState.canOpen) {
      toast.error(runViewState.statusLabel)
      return
    }
    if (!terminalTarget || !currentLayout) {
      toast.error(runViewState.statusLabel)
      return
    }
    const executionHostId = environmentId
      ? toRuntimeExecutionHostId(environmentId)
      : getWorktreeExecutionHostId(runWorktree, selectedRow ? repoForRow(selectedRow) : undefined)
    const tab = appStore.unifiedTabsByWorktree[run.workspaceId]?.find(
      (entry) =>
        entry.entityId === terminalTarget.tabId &&
        entry.contentType === 'terminal' &&
        (entry.executionHostId ?? 'local') === executionHostId
    )
    if (!tab) {
      toast.error('Run terminal is unavailable.')
      return
    }
    revealAutomationRunTab(tab)
    appStore.setTabLayout(
      terminalTarget.tabId,
      buildAutomationRunOpenLayout({ target: terminalTarget, currentLayout })
    )
    if (
      activateAndRevealWorktree(run.workspaceId, {
        executionHostId,
        providesInitialSurface: true,
        notifyHostRuntime: false
      })
    ) {
      appStore.focusGroup(run.workspaceId, tab.groupId)
      appStore.activateTab(tab.id)
      appStore.setActiveTab(terminalTarget.tabId)
      appStore.setActiveTabType('terminal')
      return
    }
    toast.error(
      translate(
        'auto.components.automations.AutomationsPage.e1bf9b1512',
        'Workspace is not available.'
      )
    )
  }
}

export type AutomationRunWorkspaceAction = ReturnType<typeof createAutomationRunWorkspaceAction>
