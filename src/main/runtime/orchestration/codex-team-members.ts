import { readCodexTeamPolicy, type CodexTeamPolicy } from '../../../shared/codex-team'
import type { OrchestrationDb } from './db'

export type CodexTeamWorkerSelection = {
  model: string
  effort: string
  reason: string
  terminal?: string
  slot?: number
  previousDispatches?: string[]
  handoff?: string
}

export function saveCodexTeam(db: OrchestrationDb, runId: string, policy: CodexTeamPolicy): void {
  db.db
    .prepare("UPDATE runs SET team_policy = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(policy), runId)
}

// Called inside the Dispatch transaction: reservations and Task acceptance commit together.
export function reserveCodexTeamMember(
  db: OrchestrationDb,
  runId: string,
  dispatchId: string,
  selection?: CodexTeamWorkerSelection
): void {
  const team = readCodexTeamPolicy(db.getRun(runId)?.team_policy)
  if (!team) {
    return
  }
  if (!selection) {
    throw new Error('Codex Team workers require a validated model selection.')
  }
  const existing = team.members.find(
    (member) => selection.terminal && member.handle === selection.terminal
  )
  if (existing) {
    if (existing.state !== 'live') {
      throw new Error('Worker needs recovery before another Dispatch.')
    }
    existing.previousDispatches.push(existing.dispatchId)
    existing.dispatchId = dispatchId
    existing.state = 'opening'
  } else {
    if (team.members.length >= team.maxWorkers) {
      throw new Error(`Codex Team has reached its ${team.maxWorkers} worker limit.`)
    }
    const slot =
      selection.slot ??
      Array.from({ length: team.maxWorkers }, (_, index) => index + 1).find(
        (candidate) => !team.members.some((member) => member.slot === candidate)
      )!
    if (
      !Number.isInteger(slot) ||
      slot < 1 ||
      slot > team.maxWorkers ||
      team.members.some((member) => member.slot === slot)
    ) {
      throw new Error('The requested team slot is unavailable.')
    }
    team.members.push({
      slot,
      dispatchId,
      paneKey: null,
      handle: null,
      incarnation: null,
      model: selection.model,
      effort: selection.effort,
      state: 'opening',
      previousDispatches: selection.previousDispatches ?? []
    })
  }
  saveCodexTeam(db, runId, team)
}

export function bindCodexTeamMember(
  db: OrchestrationDb,
  runId: string,
  dispatchId: string,
  identity: { handle: string; paneKey: string; incarnation: string }
): void {
  const team = readCodexTeamPolicy(db.getRun(runId)?.team_policy)
  const member = team?.members.find((entry) => entry.dispatchId === dispatchId)
  if (!team || !member) {
    return
  }
  Object.assign(member, identity, { state: 'live' })
  saveCodexTeam(db, runId, team)
}
