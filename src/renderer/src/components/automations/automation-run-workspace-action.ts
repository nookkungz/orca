import type { AutomationRun } from '../../../../shared/automations-types'
import { toast } from 'sonner'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { automationRunResultTabId } from '@/lib/automation-run-result-tab-id'
import { revealAutomationRunTab } from '@/lib/automation-run-tab-visibility'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { buildAutomationRunOpenLayout } from './automation-run-open-target'
import {
  resolveAutomationRunWorkspace,
  resolveAutomationRunWorkspaceDecision
} from './automation-run-workspace-decision'
import type { AutomationsPageActionContext } from './automations-page-action-context'

export function createAutomationRunWorkspaceAction({ store, list }: AutomationsPageActionContext) {
  const { repoForRow, worktreeForRow } = store
  const { selectedRow } = list
  return function openRunWorkspace(run: AutomationRun): void {
    const state = useAppStore.getState()
    const repo = selectedRow ? repoForRow(selectedRow) : undefined
    const { worktree, hostId, environmentId } = resolveAutomationRunWorkspace({
      run,
      row: selectedRow,
      repo,
      worktreeForRow,
      state
    })
    let decision = resolveAutomationRunWorkspaceDecision({
      run,
      workspaceExists: Boolean(worktree),
      hostId,
      environmentId,
      state
    })
    if (!run.workspaceId || !decision.viewState.canOpen) {
      toast.error(decision.viewState.statusLabel)
      return
    }
    const activateWorkspace = () =>
      activateAndRevealWorkspace(run.workspaceId!, {
        executionHostId: hostId,
        providesInitialSurface: true,
        readOnlySurface: true,
        notifyHostRuntime: false
      })
    const terminalWasAvailable = decision.viewState.availability === 'terminal'
    if (terminalWasAvailable) {
      if (!activateWorkspace()) {
        toast.error('Workspace is not available.')
        return
      }
      decision = resolveAutomationRunWorkspaceDecision({
        run,
        workspaceExists: Boolean(worktree),
        hostId,
        environmentId,
        state: useAppStore.getState()
      })
    }

    if (decision.viewState.availability === 'terminal') {
      const { tab, terminalTarget, currentLayout } = decision
      if (!tab || !terminalTarget || !currentLayout) {
        toast.error('Run terminal is unavailable.')
        return
      }
      revealAutomationRunTab(tab)
      useAppStore
        .getState()
        .setTabLayout(
          terminalTarget.tabId,
          buildAutomationRunOpenLayout({ target: terminalTarget, currentLayout })
        )
      const next = useAppStore.getState()
      next.focusGroup(run.workspaceId, tab.groupId)
      next.activateTab(tab.id, { worktreeId: run.workspaceId })
      next.setActiveTab(terminalTarget.tabId)
      next.setActiveTabType('terminal')
      return
    }

    const id = automationRunResultTabId(hostId, run)
    const file: OpenFile = {
      id,
      filePath: id,
      relativePath: run.title,
      worktreeId: run.workspaceId,
      language: 'markdown',
      isDirty: false,
      readOnly: true,
      mode: 'automation-run',
      automationRun: run,
      automationRunHostId: hostId,
      runtimeEnvironmentId: environmentId ?? null
    }
    useAppStore.setState((current) => ({
      openFiles: current.openFiles.some((entry) => entry.id === id)
        ? current.openFiles.map((entry) => (entry.id === id ? file : entry))
        : [...current.openFiles, file]
    }))
    const next = useAppStore.getState()
    const existing = (next.unifiedTabsByWorktree[run.workspaceId] ?? []).find(
      (tab) => tab.contentType === 'editor' && tab.entityId === id && tab.executionHostId === hostId
    )
    const tab =
      existing ??
      next.createUnifiedTab(run.workspaceId, 'editor', {
        entityId: id,
        label: run.title,
        executionHostId: hostId,
        recordInteraction: false
      })
    // Select the read-only surface before activating its workspace so saved terminal tabs stay unmounted.
    next.activateTab(tab.id, { worktreeId: run.workspaceId })
    if (!terminalWasAvailable && !activateWorkspace()) {
      useAppStore.getState().closeUnifiedTab(tab.id)
      useAppStore.setState((current) => ({
        openFiles: current.openFiles.filter((entry) => entry.id !== id)
      }))
      toast.error('Workspace is not available.')
      return
    }
    const latest = useAppStore.getState()
    latest.focusGroup(run.workspaceId, tab.groupId)
    latest.activateTab(tab.id, { worktreeId: run.workspaceId })
    latest.setActiveFile(id)
    latest.setActiveTabType('editor')
  }
}

export type AutomationRunWorkspaceAction = ReturnType<typeof createAutomationRunWorkspaceAction>
