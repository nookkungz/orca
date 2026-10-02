import {
  getCodexTeamAllowedEfforts,
  readCodexTeamPolicy,
  type CodexTeamMember
} from '../../../../../../shared/codex-team'
import { readCodexTeamCatalog } from '../../../../../codex/codex-team-catalog'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import {
  saveCodexTeam,
  type CodexTeamWorkerSelection
} from '../../../../orchestration/codex-team-members'
import type { WorkerStartInput } from './worker-start-schema'
import { completeWorkerTerminalRelease } from './worker-release-completion'
import { parseCodexTeamLaunchArgs } from '../../../../../../shared/codex-team-launch-args'
import { runtimeWorktreeIdsEqual } from '../../../../runtime-worktree-path-identity'

const starts = new WeakMap<OrcaRuntimeService, Map<string, Promise<unknown>>>()

export async function withCodexTeamStart<T>(
  runtime: OrcaRuntimeService,
  runId: string,
  start: () => Promise<T>
): Promise<T> {
  // ponytail: starts serialize per team; parallel startup can use per-slot leases if startup latency matters.
  let pending = starts.get(runtime)
  if (!pending) {
    pending = new Map()
    starts.set(runtime, pending)
  }
  const prior = pending.get(runId)
  const next = (prior ?? Promise.resolve()).catch(() => undefined).then(start)
  pending.set(runId, next)
  try {
    return await next
  } finally {
    if (pending.get(runId) === next) {
      pending.delete(runId)
    }
  }
}

export async function prepareCodexTeamWorker(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  runId: string,
  params: WorkerStartInput
): Promise<CodexTeamWorkerSelection | undefined> {
  const run = db.getRun(runId)
  const team = readCodexTeamPolicy(run?.team_policy)
  if (!team) {
    if (params.replaceWorker) {
      throw new Error('--replace-worker requires a Codex Team.')
    }
    return undefined
  }
  if (
    params.on ||
    (params.worktree && params.worktree !== 'current') ||
    (params.agent && params.agent !== 'codex')
  ) {
    throw new Error('Codex Team workers must use Codex in the leader workspace on the same host.')
  }
  await runtime.listTerminals(`id:${team.worktreeId}`, 1, {
    handles: [params.from],
    requireFreshPtyLiveness: true,
    includeVisualLayouts: false
  })
  const leaderPaneMatches = runtime.getTerminalPaneKey(params.from) === run?.coordinator_pane_key
  const leaderLiveness = runtime.getTerminalLivenessVerdict(params.from)?.status
  const leaderAgentRunning = await runtime.isTerminalRunningAgent(params.from)
  if (!leaderPaneMatches || leaderLiveness !== 'live' || !leaderAgentRunning) {
    throw new Error(
      `Leader is disconnected or unverified (pane ${leaderPaneMatches ? 'bound' : 'changed'}, PTY ${leaderLiveness ?? 'unknown'}, agent ${leaderAgentRunning ? 'running' : 'unverified'}). Recover the existing Leader before dispatching.`
    )
  }
  const context = await runtime.getCodexTeamContext(params.from)
  if (
    !runtimeWorktreeIdsEqual(context.workspace.id, team.worktreeId) ||
    context.wslDistro !== team.wslDistro
  ) {
    throw new Error('The team execution host or WSL distro changed. Recover the team first.')
  }
  for (const member of team.members) {
    if (!member.handle) {
      continue
    }
    let resource = db.getWorkerTerminalResourceByHandle(member.handle)
    const currentHandle = member.paneKey
      ? runtime.getTerminalHandleForPaneKey(member.paneKey)
      : null
    if (
      resource?.process_incarnation &&
      resource.release_state !== 'released' &&
      (!currentHandle || runtime.getTerminalLivenessVerdict(currentHandle)?.status !== 'live') &&
      (await runtime.inspectTerminalProcessIncarnationLiveness(
        resource.process_incarnation,
        resource.host_scope
      )) === 'exited'
    ) {
      resource = db.settleDeadWorkerTerminalRelease({
        requestingDispatchId: member.dispatchId,
        resourceId: resource.id,
        processIncarnation: resource.process_incarnation
      }).resource
    }
    if (resource?.release_state === 'released') {
      team.archivedDispatches.push(...member.previousDispatches, member.dispatchId)
      team.members = team.members.filter((entry) => entry !== member)
    }
  }
  saveCodexTeam(db, runId, team)
  const validateSelection = async (model: string, effort: string) => {
    if (team.allowedModels && !team.allowedModels.includes(model)) {
      throw new Error(`Worker model ${model} is not allowed in this team.`)
    }
    const catalog = await readCodexTeamCatalog({
      ...team,
      config: parseCodexTeamLaunchArgs(team.launchArgs).config
    })
    const selected = catalog.models.find((entry) => entry.id === model)
    if (!selected?.efforts.some((entry) => entry.value === effort)) {
      throw new Error(
        `Worker model/effort ${model} / ${effort} is unavailable. Choose again; no substitution was made.`
      )
    }
    if (!getCodexTeamAllowedEfforts(team, selected).some((entry) => entry.value === effort)) {
      const range = team.modelEffortRanges?.[model]
      throw new Error(
        `Worker effort ${effort} is outside the allowed range ${range?.min}–${range?.max} for ${model}, or its saved bounds are unavailable. Choose again; no substitution was made.`
      )
    }
  }
  if (params.terminal) {
    if (params.replaceWorker) {
      throw new Error('--terminal and --replace-worker cannot combine.')
    }
    const member = team.members.find(
      (entry) => entry.paneKey === runtime.getTerminalPaneKey(params.terminal!)
    )
    if (!member) {
      throw new Error('The selected terminal is not a member of this team.')
    }
    if (
      (params.model && params.model !== member.model) ||
      (params.effort && params.effort !== member.effort)
    ) {
      throw new Error(
        'Reuse cannot change model or effort. Choose another member or use --replace-worker.'
      )
    }
    await assertIdleMember(runtime, db, member)
    await validateSelection(member.model, member.effort)
    member.handle = params.terminal
    saveCodexTeam(db, runId, team)
    return {
      model: member.model,
      effort: member.effort,
      reason: params.selectionReason ?? 'Reuse the idle worker with its existing model and effort.',
      terminal: params.terminal
    }
  }
  if (!params.model || !params.effort || !params.selectionReason) {
    throw new Error('Codex Team worker-start requires --model, --effort and --selection-reason.')
  }
  await validateSelection(params.model, params.effort)
  let replacement: Pick<CodexTeamWorkerSelection, 'slot' | 'previousDispatches' | 'handoff'> = {}
  if (!params.replaceWorker) {
    for (const member of team.members) {
      if (
        member.state !== 'live' ||
        member.model !== params.model ||
        member.effort !== params.effort
      ) {
        continue
      }
      try {
        await assertIdleMember(runtime, db, member)
      } catch {
        continue
      }
      saveCodexTeam(db, runId, team)
      return {
        model: member.model,
        effort: member.effort,
        reason: params.selectionReason,
        terminal: member.handle!
      }
    }
  }
  if (params.replaceWorker) {
    const member = team.members.find((entry) => entry.dispatchId === params.replaceWorker)
    if (!member) {
      throw new Error('Replacement must name the current Dispatch of a team member.')
    }
    await assertIdleMember(runtime, db, member)
    const release = db.requestWorkerTerminalRelease(member.dispatchId)
    if (release.disposition !== 'requested') {
      throw new Error(`Worker cannot be replaced: ${release.disposition}.`)
    }
    const result = await completeWorkerTerminalRelease({
      runtime,
      db,
      dispatchId: member.dispatchId,
      resource: release.resource
    })
    if (result.state !== 'released' || result.archive?.status === 'unavailable') {
      throw new Error(
        `Worker retained for recovery: ${result.state}. ${result.lastError ?? result.recovery ?? 'The old session could not be safely released.'}`
      )
    }
    replacement = {
      slot: member.slot,
      previousDispatches: [...member.previousDispatches, member.dispatchId],
      handoff: `You replace Worker ${member.slot}. Its archived conversation is available with orchestration worker-read --dispatch ${member.dispatchId}. Previous task result:\n${db.getTask(db.getDispatchContextById(member.dispatchId)!.task_id)?.result?.slice(0, 16000) ?? 'No result was recorded.'}`
    }
    team.archivedDispatches.push(...member.previousDispatches, member.dispatchId)
    team.members = team.members.filter((entry) => entry !== member)
    saveCodexTeam(db, runId, team)
  }
  return {
    model: params.model,
    effort: params.effort,
    reason: params.selectionReason,
    ...replacement
  }
}

async function assertIdleMember(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  member: CodexTeamMember
): Promise<void> {
  const handle = member.paneKey ? runtime.getTerminalHandleForPaneKey(member.paneKey) : null
  if (!handle || runtime.getTerminalProcessIncarnation(handle) !== member.incarnation) {
    throw new Error('Worker identity is unverified; keep its slot for recovery.')
  }
  const resource = db.getWorkerTerminalResourceByHandle(handle)
  if (!resource || resource.ownership_state !== 'owned') {
    throw new Error('Worker ownership is not available for reuse or replacement.')
  }
  if (resource.retained_reason === 'user_requested') {
    throw new Error('Worker is under user control.')
  }
  if (db.findActiveDispatchForAssignee(handle, member.paneKey ?? undefined)) {
    throw new Error('Worker still has an active Dispatch.')
  }
  const wait = await runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 1000 })
  if (!wait.satisfied || (await runtime.getTerminalInteractiveWait(handle))) {
    throw new Error('Worker is not confirmed idle or is waiting for an answer.')
  }
  member.handle = handle
}
