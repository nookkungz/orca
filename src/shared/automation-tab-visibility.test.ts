import { expect, it } from 'vitest'
import {
  assertAutomationTabVisibility,
  assertAutomationTabVisibilitySupported,
  automationRequestHasTabVisibility
} from './automation-tab-visibility'
import { AUTOMATION_TAB_VISIBILITY_RUNTIME_CAPABILITY } from './protocol-version'

it('validates optional booleans and refuses unsupported hosts for both true and false writes', () => {
  for (const value of [true, false, undefined]) {
    expect(() => assertAutomationTabVisibility(value)).not.toThrow()
  }
  for (const value of ['false', 0, null]) {
    expect(() => assertAutomationTabVisibility(value)).toThrow('boolean')
  }
  for (const value of [true, false]) {
    expect(automationRequestHasTabVisibility('automation.create', { showRunsInTabs: value })).toBe(
      true
    )
    expect(
      automationRequestHasTabVisibility('automation.update', { updates: { showRunsInTabs: value } })
    ).toBe(true)
  }
  expect(
    automationRequestHasTabVisibility('automation.update', { updates: { name: 'unchanged' } })
  ).toBe(false)
  expect(() => assertAutomationTabVisibilitySupported([])).toThrow('Update the host')
  expect(() =>
    assertAutomationTabVisibilitySupported([AUTOMATION_TAB_VISIBILITY_RUNTIME_CAPABILITY])
  ).not.toThrow()
})
