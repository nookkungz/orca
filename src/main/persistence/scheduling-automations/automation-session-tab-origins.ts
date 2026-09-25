import { toSshExecutionHostId } from '../../../shared/execution-host'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { stampAutomationTabOrigins } from '../../../shared/automation-tab-origin'

export function automationSessionTabOrigins(
  state: PersistedState,
  session: WorkspaceSessionState,
  hostId: string
): WorkspaceSessionState {
  // Runtime partitions belong to another authority; its run IDs may collide with ours.
  if (hostId.startsWith('runtime:')) {
    return session
  }
  const automations = new Map((state.automations ?? []).map((a) => [a.id, a]))
  const runs = (state.automationRuns ?? []).filter((run) => {
    const automation = automations.get(run.automationId)
    const owner =
      automation?.executionTargetType === 'ssh'
        ? toSshExecutionHostId(automation.executionTargetId ?? '')
        : 'local'
    return owner === hostId
  })
  return stampAutomationTabOrigins(session, runs, hostId)
}
