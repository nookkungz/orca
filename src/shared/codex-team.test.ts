import { describe, expect, it } from 'vitest'
import {
  CodexTeamSettingsSchema,
  DEFAULT_CODEX_TEAM_SETTINGS,
  getCodexTeamAllowedEfforts
} from './codex-team'
import { parseCodexTeamLaunchArgs } from './codex-team-launch-args'
import { DEFAULT_DISABLED_TUI_AGENTS } from './tui-agent-selection'
import { buildAgentStartupPlan } from './tui-agent-startup'

describe('Codex Team launch and policy', () => {
  it('preserves legacy settings and applies inclusive per-model effort bounds from the catalog', () => {
    const model = {
      id: 'new-model',
      label: 'New',
      isDefault: false,
      efforts: ['low', 'medium', 'high', 'future-effort'].map((value) => ({ value, label: value }))
    }
    const legacy = CodexTeamSettingsSchema.parse({ maxWorkers: 3, allowedModels: null })
    expect(getCodexTeamAllowedEfforts(legacy, model)).toEqual(model.efforts)
    const team = CodexTeamSettingsSchema.parse({
      ...legacy,
      modelEffortRanges: { 'new-model': { min: 'medium', max: 'high' } }
    })
    expect(getCodexTeamAllowedEfforts(team, model).map((effort) => effort.value)).toEqual([
      'medium',
      'high'
    ])
    expect(CodexTeamSettingsSchema.parse(JSON.parse(JSON.stringify(team)))).toEqual(team)
    expect(getCodexTeamAllowedEfforts({ ...team, allowedModels: [] }, model)).toEqual([])
    for (const range of [
      { min: 'high', max: 'high' },
      { min: 'future-effort', max: 'future-effort' }
    ]) {
      expect(
        getCodexTeamAllowedEfforts({ ...team, modelEffortRanges: { 'new-model': range } }, model)
      ).toHaveLength(1)
    }
    for (const range of [
      { min: 'removed', max: 'high' },
      { min: 'high', max: 'low' }
    ]) {
      expect(
        getCodexTeamAllowedEfforts({ ...team, modelEffortRanges: { 'new-model': range } }, model)
      ).toEqual([])
    }
    expect(
      CodexTeamSettingsSchema.safeParse({
        ...team,
        modelEffortRanges: { 'new-model': { min: '', max: 'high' } }
      }).success
    ).toBe(false)
  })
  it('starts disabled, counts workers separately, and validates the bounds', () => {
    expect(DEFAULT_DISABLED_TUI_AGENTS).toContain('codex-team')
    expect(DEFAULT_CODEX_TEAM_SETTINGS).toEqual({ maxWorkers: 3, allowedModels: null })
    for (const maxWorkers of [0, 9, 1.5, Number.NaN]) {
      expect(CodexTeamSettingsSchema.safeParse({ maxWorkers, allowedModels: null }).success).toBe(
        false
      )
    }
    expect(
      CodexTeamSettingsSchema.parse({ maxWorkers: 8, allowedModels: [] }).allowedModels
    ).toEqual([])
  })
  it('keeps the first task separate from Codex flags, including Thai and option-like text', () => {
    const task = '--help งานแรก\nไฟล์ที่มีช่องว่าง'
    const parsed = parseCodexTeamLaunchArgs([
      '--model',
      'future-model',
      '-c',
      'model_reasoning_effort=high',
      '--orca-team-prompt',
      task
    ])
    expect(parsed.prompt).toBe(task)
    expect(parsed.args).not.toContain(task)
    expect(parsed.config).toEqual([
      '-c',
      'model="future-model"',
      '-c',
      'model_reasoning_effort=high'
    ])
    expect(
      buildAgentStartupPlan({
        agent: 'codex-team',
        prompt: task,
        cmdOverrides: {},
        platform: 'darwin'
      })?.launchCommand
    ).toContain('--orca-team-prompt')
  })
  it('refuses launches that escape the team execution context', () => {
    for (const flag of [
      '--remote=ws://host',
      '--oss',
      '-C',
      '-C/tmp',
      '-pother',
      '--profile',
      '--',
      '--help'
    ]) {
      expect(() => parseCodexTeamLaunchArgs([flag])).toThrow()
    }
    expect(() =>
      parseCodexTeamLaunchArgs(['--orca-team-prompt', '', '--orca-team-prompt', 'second'])
    ).toThrow()
    expect(parseCodexTeamLaunchArgs(['-mfuture', '-cmodel_reasoning_effort=high']).config).toEqual([
      '-c',
      'model="future"',
      '-c',
      'model_reasoning_effort=high'
    ])
  })
})
