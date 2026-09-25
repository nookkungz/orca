import { AUTOMATION_TAB_VISIBILITY_RUNTIME_CAPABILITY } from './protocol-version'

export function assertAutomationTabVisibility(value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error('Show runs in workspace tabs must be a boolean.')
  }
}

export function automationRequestHasTabVisibility(method: string, params: unknown): boolean {
  if (!params || typeof params !== 'object') {
    return false
  }
  const input =
    method === 'automation.create'
      ? params
      : method === 'automation.update' && 'updates' in params
        ? params.updates
        : null
  return Boolean(
    input &&
    typeof input === 'object' &&
    'showRunsInTabs' in input &&
    input.showRunsInTabs !== undefined
  )
}

export function assertAutomationTabVisibilitySupported(capabilities?: readonly string[]): void {
  if (!capabilities?.includes(AUTOMATION_TAB_VISIBILITY_RUNTIME_CAPABILITY)) {
    throw new Error('This host does not support automation tab visibility. Update the host first.')
  }
}
