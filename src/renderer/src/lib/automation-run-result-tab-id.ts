import type { AutomationRun } from '../../../shared/automations-types'
import type { ExecutionHostId } from '../../../shared/execution-host'

const PREFIX = 'automation-run:'

export function automationRunResultTabId(
  hostId: ExecutionHostId,
  run: Pick<AutomationRun, 'automationId' | 'id'>
): string {
  return `${PREFIX}${[hostId, run.automationId, run.id].map(encodeURIComponent).join(':')}`
}

export function isAutomationRunResultTabId(id: string): boolean {
  return id.startsWith(PREFIX)
}
