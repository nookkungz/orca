import { isAutomationRunTabVisible } from '@/lib/automation-run-tab-visibility'
import type { WorkspaceVisibleTabType } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

export function shouldRepairActiveTerminalTab(args: {
  activeTabType: WorkspaceVisibleTabType
  activeTabId: string | null
  tabs: TerminalTab[]
}): boolean {
  const visibleTabs = args.tabs.filter((tab) => isAutomationRunTabVisible(tab))
  return (
    args.activeTabType === 'terminal' &&
    visibleTabs.length > 0 &&
    (!args.activeTabId || !visibleTabs.some((tab) => tab.id === args.activeTabId))
  )
}

export function resolveRepairedActiveTerminalTabId(args: {
  activeTabType: WorkspaceVisibleTabType
  activeTabId: string | null
  rememberedTabId: string | null | undefined
  tabs: TerminalTab[]
}): string | null {
  if (!shouldRepairActiveTerminalTab(args)) {
    return null
  }
  const visibleTabs = args.tabs.filter((tab) => isAutomationRunTabVisible(tab))
  if (args.rememberedTabId && visibleTabs.some((tab) => tab.id === args.rememberedTabId)) {
    return args.rememberedTabId
  }
  return visibleTabs[0]?.id ?? null
}
