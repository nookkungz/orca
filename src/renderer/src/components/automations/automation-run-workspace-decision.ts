import type { AutomationRun } from '../../../../shared/automations-types'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { runtimeHostConnectionStateForEntry } from '@/runtime/runtime-host-connection-state'
import type { AppState } from '@/store/types'
import { folderWorkspaceMatchesHost } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import {
  automationRunForEnvironment,
  getAutomationRunOpenTabId,
  resolveAutomationRunOpenTarget
} from './automation-run-open-target'
import type { AutomationListRow } from './automation-list-row-identity'
import { getAutomationRunViewState } from './automation-run-view-state'

export function resolveAutomationRunWorkspace({
  run,
  row,
  repo,
  worktreeForRow,
  state
}: {
  run: AutomationRun
  row: AutomationListRow | null
  repo: Repo | undefined
  worktreeForRow: (
    row: AutomationListRow,
    repo: Repo | undefined,
    id: string
  ) => Worktree | undefined
  state: Pick<AppState, 'folderWorkspaces'>
}): { worktree: Worktree | null; hostId: ExecutionHostId; environmentId?: string } {
  const authority = row?.catalogRef?.authority
  const environmentId = authority?.kind === 'runtime' ? authority.environmentId : undefined
  const hostId = environmentId
    ? toRuntimeExecutionHostId(environmentId)
    : (normalizeExecutionHostId(run.runContext?.hostId) ??
      (repo ? getRepoExecutionHostId(repo) : 'local'))
  const scope = parseWorkspaceKey(run.workspaceId ?? '')
  const candidate =
    scope?.type === 'folder'
      ? state.folderWorkspaces.find(
          (folder) =>
            folder.id === scope.folderWorkspaceId && folderWorkspaceMatchesHost(folder, hostId)
        )
      : null
  const worktree = candidate
    ? folderWorkspaceToWorktree(candidate)
    : run.workspaceId && row
      ? (worktreeForRow(row, repo, run.workspaceId) ?? null)
      : null
  return {
    worktree: worktree && getWorktreeExecutionHostId(worktree, repo) === hostId ? worktree : null,
    hostId,
    ...(environmentId ? { environmentId } : {})
  }
}

export function resolveAutomationRunWorkspaceDecision({
  run,
  workspaceExists,
  hostId,
  environmentId,
  state
}: {
  run: AutomationRun
  workspaceExists: boolean
  hostId: ExecutionHostId
  environmentId?: string
  state: Pick<
    AppState,
    | 'unifiedTabsByWorktree'
    | 'terminalLayoutsByTabId'
    | 'ptyIdsByTabId'
    | 'runtimeStatusByEnvironmentId'
    | 'sshConnectionStates'
  >
}) {
  const openTabId = getAutomationRunOpenTabId(run, environmentId)
  const tab = run.workspaceId
    ? (state.unifiedTabsByWorktree[run.workspaceId] ?? []).find(
        (entry) =>
          entry.contentType === 'terminal' &&
          entry.entityId === openTabId &&
          (entry.executionHostId ?? 'local') === hostId
      )
    : undefined
  const currentLayout = openTabId ? state.terminalLayoutsByTabId[openTabId] : null
  const parsedHost = parseExecutionHostId(hostId)
  const hostAvailable =
    parsedHost?.kind === 'runtime'
      ? runtimeHostConnectionStateForEntry(
          state.runtimeStatusByEnvironmentId.get(parsedHost.environmentId)
        ) === 'connected'
      : parsedHost?.kind === 'ssh'
        ? state.sshConnectionStates.get(parsedHost.targetId)?.status === 'connected'
        : true
  const terminalTarget = hostAvailable
    ? resolveAutomationRunOpenTarget({
        run: automationRunForEnvironment(run, environmentId, currentLayout),
        terminalTabExists: Boolean(tab),
        currentLayout,
        livePtyIds: openTabId ? (state.ptyIdsByTabId[openTabId] ?? []) : []
      })
    : null
  return {
    tab,
    currentLayout,
    terminalTarget,
    viewState: getAutomationRunViewState({
      run,
      workspaceExists,
      terminalTargetExists: Boolean(terminalTarget)
    })
  }
}
