import { hasFlag } from './agent-cli-flag-detection'
import { removeAgentArgOption } from './agent-session-option-agent-args'
import type { AgentSessionOptionCatalog } from './agent-session-option-catalog-types'
import { parseAntigravityModels } from './commit-message-model-parsers'

export const ANTIGRAVITY_SESSION_OPTION_CATALOG: AgentSessionOptionCatalog = {
  models: [],
  discoveredModelsAreAuthoritative: true,
  modelApply: {
    launchArgs: (value) => ['--model', String(value)],
    agentArgsOverride: (tokens) => hasFlag(tokens, ['-m', '--model']),
    removeAgentArgs: (tokens) => removeAgentArgOption(tokens, ['-m', '--model'])
  },
  listModels: {
    command: 'agy models',
    parse: (stdout) => parseAntigravityModels(stdout).map((model) => ({ ...model, options: [] }))
  }
}
