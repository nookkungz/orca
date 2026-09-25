import type { AutomationRun } from '../../../../shared/automations-types'
import { toWebTerminalSurfaceTabId } from '../../../../shared/terminal-surface-id'
import { parseRemoteRuntimePtyId } from '../../../../shared/remote-runtime-pty-id'
import { makePaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../../shared/terminal-tab-types'

export type AutomationRunPaneTarget = {
  tabId: string
  paneKey: string
  leafId: string
  ptyId: string
}

export function getAutomationRunOpenTabId(
  run: Pick<AutomationRun, 'terminalPaneKey'>,
  environmentId?: string
): string | null {
  const tabId = parsePaneKey(run.terminalPaneKey ?? '')?.tabId
  return tabId ? (environmentId ? toWebTerminalSurfaceTabId(tabId) : tabId) : null
}

/** Remote rows name host tabs; the client mirrors those identities with an encoded tab ID. */
export function automationRunForEnvironment(
  run: AutomationRun,
  environmentId: string | undefined,
  layout: TerminalLayoutSnapshot | null | undefined
): AutomationRun {
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (!environmentId || !parsed) {
    return run
  }
  const ptyId = layout?.ptyIdsByLeafId?.[parsed.leafId]
  const owner = ptyId ? parseRemoteRuntimePtyId(ptyId) : null
  return {
    ...run,
    terminalPaneKey: makePaneKey(toWebTerminalSurfaceTabId(parsed.tabId), parsed.leafId),
    terminalPtyId: owner?.environmentId === environmentId ? (ptyId ?? null) : null
  }
}

export function automationRunMatchesPaneKey(
  run: Pick<AutomationRun, 'terminalPaneKey'>,
  paneKey: string
): boolean {
  return run.terminalPaneKey ? paneKey === run.terminalPaneKey : false
}

export function resolveAutomationRunOpenTarget({
  run,
  terminalTabExists,
  currentLayout,
  livePtyIds
}: {
  run: AutomationRun
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
  livePtyIds: readonly string[]
}): AutomationRunPaneTarget | null {
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (!terminalTabExists || !parsed || !run.terminalPtyId || !currentLayout?.root) {
    return null
  }
  if (!terminalLayoutContainsLeaf(currentLayout.root, parsed.leafId)) {
    return null
  }
  if (!livePtyIds.includes(run.terminalPtyId)) {
    return null
  }
  const layoutPtyId = currentLayout.ptyIdsByLeafId?.[parsed.leafId]
  if (layoutPtyId !== undefined && layoutPtyId !== run.terminalPtyId) {
    return null
  }
  return {
    tabId: parsed.tabId,
    paneKey: run.terminalPaneKey!,
    leafId: parsed.leafId,
    ptyId: run.terminalPtyId
  }
}

export function canOpenAutomationRunOpenTarget(args: {
  run: AutomationRun
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
  livePtyIds: readonly string[]
}): boolean {
  return resolveAutomationRunOpenTarget(args) !== null
}

export function buildAutomationRunOpenLayout({
  target,
  currentLayout
}: {
  target: AutomationRunPaneTarget
  currentLayout: TerminalLayoutSnapshot
}): TerminalLayoutSnapshot {
  return {
    ...currentLayout,
    activeLeafId: target.leafId,
    expandedLeafId: currentLayout.expandedLeafId === target.leafId ? target.leafId : null,
    ptyIdsByLeafId: {
      ...currentLayout.ptyIdsByLeafId,
      [target.leafId]: target.ptyId
    }
  }
}

function terminalLayoutContainsLeaf(node: TerminalPaneLayoutNode, leafId: string): boolean {
  if (node.type === 'leaf') {
    return node.leafId === leafId
  }
  return (
    terminalLayoutContainsLeaf(node.first, leafId) ||
    terminalLayoutContainsLeaf(node.second, leafId)
  )
}
