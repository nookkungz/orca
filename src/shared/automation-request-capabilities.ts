import {
  automationRequestHasTabVisibility,
  assertAutomationTabVisibilitySupported
} from './automation-tab-visibility'
import {
  automationRequestHasLaunchPreferences,
  assertAutomationLaunchPreferencesSupported
} from './automation-launch-preferences'

/** Old hosts silently discard optional fields; require explicit support before saving. */
export async function assertAutomationRequestCapabilities(
  method: string,
  params: unknown,
  getCapabilities: () => Promise<readonly string[] | undefined>
): Promise<void> {
  const tabs = automationRequestHasTabVisibility(method, params)
  const launch = automationRequestHasLaunchPreferences(method, params)
  if (!tabs && !launch) {
    return
  }
  const capabilities = await getCapabilities()
  if (tabs) {
    assertAutomationTabVisibilitySupported(capabilities)
  }
  if (launch) {
    assertAutomationLaunchPreferencesSupported(null, capabilities)
  }
}

export function disabledAutomationTabVisibilityId(method: string, params: unknown): string | null {
  if (
    method !== 'automation.update' ||
    !params ||
    typeof params !== 'object' ||
    !('id' in params) ||
    typeof params.id !== 'string' ||
    !('updates' in params) ||
    !params.updates ||
    typeof params.updates !== 'object'
  ) {
    return null
  }
  return 'showRunsInTabs' in params.updates && params.updates.showRunsInTabs === false
    ? params.id
    : null
}
