// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useAutomationDispatchEvents } from './useAutomationDispatchEvents'

const { startupState, rendererReady, unsubscribe, onDispatchRequested } = vi.hoisted(() => ({
  startupState: { hydrationSucceeded: false, startupWorktreeRefreshCompleted: false },
  rendererReady: vi.fn(() => Promise.resolve()),
  unsubscribe: vi.fn(),
  onDispatchRequested: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: typeof startupState) => unknown) => selector(startupState)
}))
vi.mock('./automation-dispatch-handler', () => ({
  handleAutomationDispatchRequest: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  startupState.hydrationSucceeded = false
  startupState.startupWorktreeRefreshCompleted = false
  onDispatchRequested.mockReturnValue(unsubscribe)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { automations: { rendererReady, onDispatchRequested } }
  })
})
afterEach(cleanup)

it('subscribes immediately but releases scheduled runs only after session and catalog hydration', () => {
  const { rerender, unmount } = renderHook(() => useAutomationDispatchEvents())
  expect(onDispatchRequested).toHaveBeenCalledOnce()
  expect(rendererReady).not.toHaveBeenCalled()
  startupState.hydrationSucceeded = true
  rerender()
  expect(rendererReady).not.toHaveBeenCalled()
  startupState.startupWorktreeRefreshCompleted = true
  rerender()
  expect(rendererReady).toHaveBeenCalledOnce()
  rerender()
  expect(rendererReady).toHaveBeenCalledOnce()
  expect(onDispatchRequested).toHaveBeenCalledOnce()
  unmount()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('does not dispatch against a partial catalog after degraded startup', () => {
  startupState.startupWorktreeRefreshCompleted = true
  renderHook(() => useAutomationDispatchEvents())
  expect(rendererReady).not.toHaveBeenCalled()
})
