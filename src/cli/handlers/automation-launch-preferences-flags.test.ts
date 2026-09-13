import { describe, expect, it } from 'vitest'
import { getAutomationLaunchPreferencesFlags } from './automation-launch-preferences-flags'
describe('automation launch flags', () => {
  it('preserves omitted edit fields and clears the selected level', () => {
    const current = { model: 'gpt-5.6-terra', effort: 'low' }
    const flags = (entries: [string, string | boolean][]) => new Map(entries)
    expect(getAutomationLaunchPreferencesFlags(flags([]), current)).toBeUndefined()
    expect(getAutomationLaunchPreferencesFlags(flags([['effort', 'high']]), current)).toEqual({
      ...current,
      effort: 'high'
    })
    expect(getAutomationLaunchPreferencesFlags(flags([['model', 'gpt-5.5']]), current)).toEqual({
      model: 'gpt-5.5',
      effort: 'low'
    })
    expect(getAutomationLaunchPreferencesFlags(flags([['clear-effort', true]]), current)).toEqual({
      model: current.model
    })
    expect(getAutomationLaunchPreferencesFlags(flags([['clear-model', true]]), current)).toBeNull()
    expect(() => getAutomationLaunchPreferencesFlags(flags([['effort', 'low']]))).toThrow(
      'requires'
    )
    expect(() =>
      getAutomationLaunchPreferencesFlags(
        flags([
          ['model', 'x'],
          ['clear-model', true]
        ])
      )
    ).toThrow('conflict')
  })
})
