import { useEffect } from 'react'
import { useAppStore } from '../store'
import { handleAutomationDispatchRequest } from './automation-dispatch-handler'

export function useAutomationDispatchEvents(): void {
  const ready = useAppStore(
    (state) => state.hydrationSucceeded && state.startupWorktreeRefreshCompleted
  )

  useEffect(() => {
    return window.api.automations.onDispatchRequested(handleAutomationDispatchRequest)
  }, [])

  useEffect(() => {
    // Catch-up runs must not resolve projects against an unhydrated catalog.
    if (ready) {
      void window.api.automations.rendererReady()
    }
  }, [ready])
}
