import type { AutomationCreateInput } from './automations-types'
import { findCatalogModel, getAgentSessionOptionCatalog } from './agent-session-option-catalog'

import { AUTOMATION_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from './protocol-version'

export function assertAutomationLaunchPreferences(
  input: Pick<AutomationCreateInput, 'agentId' | 'launchPreferences' | 'reuseSession'>
): void {
  const preferences = input.launchPreferences
  if (preferences == null) {
    return
  }
  const { model, effort } = preferences
  if (
    typeof model !== 'string' ||
    !model.trim() ||
    model.length > 256 ||
    Array.from(model).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new Error('Automation launch preferences require a valid model.')
  }
  if (input.agentId !== 'codex' && input.agentId !== 'antigravity') {
    throw new Error('Automation model selection supports Codex and Antigravity.')
  }
  if (input.reuseSession) {
    throw new Error('Automation model overrides require a fresh session; disable reuseSession.')
  }
  if (effort !== undefined) {
    const catalog = getAgentSessionOptionCatalog(input.agentId)!
    const modelEntry = findCatalogModel(catalog, model)
    const option = (modelEntry?.options ?? catalog.unknownModelOptions)?.find(
      (entry) => entry.id === 'effort'
    )
    if (
      option?.kind.type !== 'select' ||
      !option.kind.choices.some((choice) => choice.value === effort)
    ) {
      throw new Error(`Model ${model} does not support effort ${effort}.`)
    }
  }
}

export function assertAutomationLaunchPreferencesSupported(
  preferences: AutomationCreateInput['launchPreferences'],
  capabilities: readonly string[] | undefined
): void {
  if (
    preferences !== undefined &&
    !capabilities?.includes(AUTOMATION_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY)
  ) {
    throw new Error('This host does not support automation model overrides. Update the host first.')
  }
}

export function automationRequestHasLaunchPreferences(method: string, params: unknown): boolean {
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
    'launchPreferences' in input &&
    input.launchPreferences !== undefined
  )
}
