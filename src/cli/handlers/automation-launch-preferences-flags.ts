import type { Automation } from '../../shared/automations-types'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

export function getAutomationLaunchPreferencesFlags(
  flags: Map<string, string | boolean>,
  current?: Automation['launchPreferences']
): Automation['launchPreferences'] {
  if (!['model', 'effort', 'clear-model', 'clear-effort'].some((flag) => flags.has(flag))) {
    return undefined
  }
  const model = getOptionalStringFlag(flags, 'model')
  const effort = getOptionalStringFlag(flags, 'effort')
  if ((flags.has('clear-model') && (model || effort)) || (flags.has('clear-effort') && effort)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Model and effort selections conflict with clear flags.'
    )
  }
  if (flags.has('clear-model')) {
    return null
  }
  const selectedModel = model ?? current?.model
  const selectedEffort = flags.has('clear-effort') ? undefined : (effort ?? current?.effort)
  if (!selectedModel && selectedEffort) {
    throw new RuntimeClientError('invalid_argument', '--effort requires --model or a saved model.')
  }
  if (!selectedModel) {
    return null
  }
  return { model: selectedModel, ...(selectedEffort ? { effort: selectedEffort } : {}) }
}
