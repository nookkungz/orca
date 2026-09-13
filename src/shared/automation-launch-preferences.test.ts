import { describe, expect, it } from 'vitest'
import {
  assertAutomationLaunchPreferences,
  assertAutomationLaunchPreferencesSupported,
  automationRequestHasLaunchPreferences
} from './automation-launch-preferences'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'
import { parseAntigravityModels } from './commit-message-model-parsers'

describe('automation launch preferences', () => {
  it('validates fresh sessions and supported effort', () => {
    const input = {
      agentId: 'codex' as const,
      launchPreferences: { model: 'gpt-5.6-terra', effort: 'low' }
    }
    expect(() => assertAutomationLaunchPreferences(input)).not.toThrow()
    expect(() => assertAutomationLaunchPreferences({ ...input, reuseSession: true })).toThrow(
      'fresh session'
    )
    expect(() =>
      assertAutomationLaunchPreferences({
        ...input,
        launchPreferences: { model: '', effort: 'low' }
      })
    ).toThrow('valid model')
    expect(() =>
      assertAutomationLaunchPreferences({
        ...input,
        launchPreferences: { model: 'gpt-5.6-terra', effort: 'invalid' }
      })
    ).toThrow('does not support')
    expect(() => assertAutomationLaunchPreferences({ ...input, agentId: 'antigravity' })).toThrow(
      'does not support'
    )
    expect(() =>
      assertAutomationLaunchPreferences({
        agentId: 'antigravity',
        launchPreferences: { model: 'gemini-3.8-flash-high' }
      })
    ).not.toThrow()
    expect(() => assertAutomationLaunchPreferences({ agentId: 'claude' })).not.toThrow()
  })

  it('negotiates both overrides and explicit clears while retaining legacy requests', () => {
    expect(
      automationRequestHasLaunchPreferences('automation.create', {
        launchPreferences: { model: 'x' }
      })
    ).toBe(true)
    expect(
      automationRequestHasLaunchPreferences('automation.update', {
        updates: { launchPreferences: null }
      })
    ).toBe(true)
    expect(
      automationRequestHasLaunchPreferences('automation.update', { updates: { name: 'x' } })
    ).toBe(false)
    expect(() => assertAutomationLaunchPreferencesSupported(null, [])).toThrow('Update the host')
    expect(() => assertAutomationLaunchPreferencesSupported(undefined, [])).not.toThrow()
    expect(() =>
      assertAutomationLaunchPreferencesSupported(null, ['automation.launch-preferences.v1'])
    ).not.toThrow()
  })

  it('uses actual Antigravity ids and overrides conflicting defaults with quoted arguments', () => {
    expect(
      parseAntigravityModels(
        'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'
      )
    ).toEqual([{ id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' }])
    for (const shell of ['posix', 'powershell', 'cmd'] as const) {
      const result = resolveAgentLaunchCommand({
        agent: 'codex',
        cmdOverrides: {},
        platform: shell === 'posix' ? 'darwin' : 'win32',
        shell,
        sessionOptions: { model: 'gpt-5.6-terra', effort: 'low' },
        sessionOptionsOverrideAgentArgs: true,
        agentArgs: '-m old -c model_reasoning_effort=high'
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.command).toContain('gpt-5.6-terra')
        expect(result.command).toContain('model_reasoning_effort=low')
        expect(result.command).not.toContain('old')
        expect(result.command).not.toContain('effort=high')
      }
    }
    const agy = resolveAgentLaunchCommand({
      agent: 'antigravity',
      cmdOverrides: {},
      platform: 'darwin',
      shell: 'posix',
      sessionOptions: { model: 'gemini-3.8-flash-high' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '--model old'
    })
    expect(agy).toMatchObject({
      ok: true,
      appliedSessionOptions: { model: 'gemini-3.8-flash-high' }
    })
  })
})
