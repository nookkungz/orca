import { z } from 'zod'
import type { AgentSessionModelOption } from './agent-session-wire'

export const CODEX_TEAM_RUNTIME_CAPABILITY = 'orchestration.codex-team.v1'

export const CodexTeamSettingsSchema = z.object({
  maxWorkers: z.number().int().min(1).max(8),
  allowedModels: z.array(z.string().trim().min(1)).nullable(),
  modelEffortRanges: z
    .record(
      z.string().min(1),
      z.object({
        min: z.string().trim().min(1),
        max: z.string().trim().min(1)
      })
    )
    .optional()
})
export type CodexTeamSettings = z.infer<typeof CodexTeamSettingsSchema>
export const DEFAULT_CODEX_TEAM_SETTINGS: CodexTeamSettings = {
  maxWorkers: 3,
  allowedModels: null
}

export type CodexTeamModelCatalog = { models: AgentSessionModelOption[]; wslDistro: string | null }

export function getCodexTeamAllowedEfforts(
  team: CodexTeamSettings,
  model: AgentSessionModelOption
) {
  if (team.allowedModels && !team.allowedModels.includes(model.id)) {
    return []
  }
  const range = team.modelEffortRanges?.[model.id]
  if (!range) {
    return model.efforts
  }
  // Codex supplies the ordered effort choices, including new levels unknown to Orca.
  const min = model.efforts.findIndex((effort) => effort.value === range.min)
  const max = model.efforts.findIndex((effort) => effort.value === range.max)
  // A removed boundary must not silently broaden the saved policy.
  return min === -1 || max < min ? [] : model.efforts.slice(min, max + 1)
}

export const CodexTeamMemberSchema = z.object({
  slot: z.number().int().min(1).max(8),
  dispatchId: z.string(),
  paneKey: z.string().nullable(),
  handle: z.string().nullable(),
  incarnation: z.string().nullable(),
  model: z.string(),
  effort: z.string(),
  state: z.enum(['opening', 'live', 'recovery']),
  previousDispatches: z.array(z.string()).default([])
})
export const CodexTeamPolicySchema = CodexTeamSettingsSchema.extend({
  tabId: z.string(),
  worktreeId: z.string(),
  cwd: z.string(),
  wslDistro: z.string().nullable(),
  codexCommand: z.string().nullable().default(null),
  launchArgs: z.array(z.string()).default([]),
  codexHome: z.string().nullable(),
  leaderModel: z.string(),
  leaderEffort: z.string(),
  initialPromptState: z.enum(['claimed', 'recovery']),
  archivedDispatches: z.array(z.string()).default([]),
  members: z.array(CodexTeamMemberSchema)
})
export type CodexTeamPolicy = z.infer<typeof CodexTeamPolicySchema>
export type CodexTeamMember = z.infer<typeof CodexTeamMemberSchema>

export type CodexTeamView = {
  runId: string
  panes: {
    paneKey: string
    role: string
    model: string
    effort: string
    recovery: boolean
    reported?: { model: string; effort: string } | null
    dispatches?: string[]
  }[]
}

export function readCodexTeamPolicy(value: string | null | undefined): CodexTeamPolicy | null {
  if (!value) {
    return null
  }
  return CodexTeamPolicySchema.parse(JSON.parse(value))
}
