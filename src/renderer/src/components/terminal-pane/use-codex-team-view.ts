import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { CodexTeamView } from '../../../../shared/codex-team'

export function useCodexTeamView(worktreeId: string, tabId: string): CodexTeamView | null {
  const enabled = useAppStore(
    (state) =>
      state.tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)?.launchAgent ===
      'codex-team'
  )
  const environmentId = useAppStore((state) =>
    getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  )
  const [view, setView] = useState<CodexTeamView | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const target = environmentId
      ? { kind: 'environment' as const, environmentId }
      : { kind: 'local' as const }
    let foundTeam = false
    let refreshing = false
    const refresh = async () => {
      if (controller.signal.aborted || refreshing) {
        return
      }
      refreshing = true
      try {
        const next = await callRuntimeRpc<CodexTeamView | null>(
          target,
          'codexTeam.show',
          { tabId },
          { signal: controller.signal, suppressFeatureInteraction: true }
        )
        if (!controller.signal.aborted) {
          foundTeam = next !== null
          setView(next)
        }
      } catch {
        // Keep the last identity during reconnect; never replay a launch or Dispatch here.
      } finally {
        refreshing = false
      }
    }
    void refresh()
    // launchAgent is cleared when process detection settles. The persisted Run owns team identity.
    const timer = setInterval(() => {
      if (enabled || foundTeam) {
        void refresh()
      }
    }, 2000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [enabled, environmentId, tabId])
  return view
}
