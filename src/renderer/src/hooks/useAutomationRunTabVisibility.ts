import { useEffect } from 'react'
import { useAppStore } from '@/store'
import {
  setAutomationTabCatalog,
  useAutomationRunTabVisibility as visibilityStore
} from '@/lib/automation-run-tab-visibility'
import { reconcileAutomationRunTabs } from '@/lib/reconcile-automation-run-tabs'
import {
  listAutomationsForTarget,
  listAutomationRunsPageForTarget,
  type AutomationHostTarget
} from '@/components/automations/automation-host-client'
import { subscribeAutomationHostInvalidation } from '@/components/automations/automation-host-invalidation-window-events'
import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import type { AutomationRun } from '../../../shared/automations-types'

/** One window subscription, shared by the strip and every keyboard navigation path. */
export function useAutomationRunTabVisibility(): void {
  const ready = useAppStore((s) => s.workspaceSessionReady)
  const connectionKey = useAppStore((s) =>
    JSON.stringify(
      s.runtimeEnvironments.map((env) => [
        env.id,
        env.pairingRevision ?? env.createdAt,
        Boolean(s.runtimeStatusByEnvironmentId.get(env.id)?.status),
        s.runtimeStatusByEnvironmentId.get(env.id)?.connectionGeneration,
        s.runtimeStatusByEnvironmentId.get(env.id)?.hostContactEpoch
      ])
    )
  )
  useEffect(() => {
    if (!ready) {
      return
    }
    let disposed = false
    let queued = false
    const reconcile = (): void => {
      if (queued || disposed) {
        return
      }
      queued = true
      queueMicrotask(() => {
        queued = false
        if (disposed) {
          return
        }
        const patch = reconcileAutomationRunTabs(useAppStore.getState())
        if (patch) {
          useAppStore.setState(patch)
        }
      })
    }
    const stopStore = useAppStore.subscribe((state, previous) => {
      if (
        state.unifiedTabsByWorktree !== previous.unifiedTabsByWorktree ||
        state.tabsByWorktree !== previous.tabsByWorktree ||
        state.groupsByWorktree !== previous.groupsByWorktree ||
        state.worktreesByRepo !== previous.worktreesByRepo ||
        state.folderWorkspaces !== previous.folderWorkspaces
      ) {
        reconcile()
      }
    })
    const stopVisibility = visibilityStore.subscribe(reconcile)
    const generations = new Map<string, number>()
    const runCache = new Map<string, Map<string, AutomationRun>>()
    const load = async (target: AutomationHostTarget): Promise<void> => {
      const hostId =
        target.kind === 'local' ? 'local' : toRuntimeExecutionHostId(target.environmentId)
      const generation = (generations.get(hostId) ?? 0) + 1
      generations.set(hostId, generation)
      const current = (): boolean => !disposed && generations.get(hostId) === generation
      try {
        const automations = await listAutomationsForTarget(target)
        if (!current()) {
          return
        }
        const cached = runCache.get(hostId)
        // Definitions apply immediately; history only supplies evidence for legacy tabs.
        setAutomationTabCatalog(hostId, automations, [...(cached?.values() ?? [])])
        const runs = new Map(cached)
        for (const automation of automations) {
          let cursor: string | undefined
          do {
            const page = await listAutomationRunsPageForTarget(target, automation.id, {
              limit: 200,
              cursor
            })
            if (!current()) {
              return
            }
            for (const run of page.runs) {
              runs.set(run.id, run)
            }
            cursor = cached ? undefined : (page.nextCursor ?? undefined)
          } while (cursor)
        }
        runCache.set(hostId, runs)
        setAutomationTabCatalog(hostId, automations, [...runs.values()])
      } catch (error) {
        if (current()) {
          console.warn('[automation-tabs] Unable to refresh host visibility', hostId, error)
        }
      }
    }
    const stopEvents = subscribeAutomationHostInvalidation((event) => {
      if (event.reason === 'usage') {
        return
      }
      void load(
        event.authority.kind === 'desktop'
          ? { kind: 'local' }
          : { kind: 'environment', environmentId: event.authority.environmentId }
      )
    })
    void load({ kind: 'local' })
    const state = useAppStore.getState()
    for (const environment of state.runtimeEnvironments) {
      if (state.runtimeStatusByEnvironmentId.get(environment.id)?.status) {
        void load({ kind: 'environment', environmentId: environment.id })
      }
    }
    reconcile()
    return () => {
      disposed = true
      stopStore()
      stopVisibility()
      stopEvents()
    }
  }, [ready, connectionKey])
}
