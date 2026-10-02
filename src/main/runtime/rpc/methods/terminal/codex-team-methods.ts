import { defineMethod } from '../../core'
import {
  CodexTeamPolicySchema,
  DEFAULT_CODEX_TEAM_SETTINGS,
  getCodexTeamAllowedEfforts,
  readCodexTeamPolicy,
  type CodexTeamView
} from '../../../../../shared/codex-team'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import {
  readCodexTeamCatalog,
  readCodexTeamReportedSelection
} from '../../../../codex/codex-team-catalog'
import { parseCodexTeamLaunchArgs } from '../../../../../shared/codex-team-launch-args'
import {
  CodexTeamPrepareLaunchParams,
  CodexTeamModelsParams,
  CodexTeamShowParams
} from '../../../../../shared/rpc-contract/codex-team-params'

export const CODEX_TEAM_METHODS = [
  defineMethod({
    name: 'codexTeam.models',
    params: CodexTeamModelsParams,
    handler: async (_params, { runtime }) => runtime.getCodexTeamModelCatalog()
  }),
  defineMethod({
    name: 'codexTeam.show',
    params: CodexTeamShowParams,
    handler: async (params, { runtime }): Promise<CodexTeamView | null> => {
      const db = runtime.getOrchestrationDb()
      const row = db.db
        .prepare(
          "SELECT id FROM runs WHERE json_valid(team_policy) AND json_extract(team_policy, '$.tabId') = ? ORDER BY rowid DESC LIMIT 1"
        )
        .get(params.tabId)
      const run =
        row && typeof row === 'object' && 'id' in row && typeof row.id === 'string'
          ? db.getRun(row.id)
          : undefined
      const team = readCodexTeamPolicy(run?.team_policy)
      if (!team || !run?.coordinator_pane_key) {
        return null
      }
      const panes: CodexTeamView['panes'] = [
        {
          paneKey: run.coordinator_pane_key,
          role: 'Leader',
          model: team.leaderModel,
          effort: team.leaderEffort,
          dispatches: team.archivedDispatches.toReversed(),
          recovery: team.members.some((member) => !member.paneKey && member.state === 'recovery')
        },
        ...team.members.flatMap((member) =>
          member.paneKey
            ? [
                {
                  paneKey: member.paneKey,
                  role: `Worker ${member.slot}`,
                  model: member.model,
                  effort: member.effort,
                  recovery: member.state === 'recovery',
                  dispatches: [member.dispatchId, ...member.previousDispatches.toReversed()]
                }
              ]
            : []
        )
      ]
      await Promise.all(
        panes.map(async (pane) => {
          const handle = runtime.getTerminalHandleForPaneKey(pane.paneKey)
          pane.recovery ||= !handle || runtime.getTerminalLivenessVerdict(handle)?.status !== 'live'
          if (handle && !pane.recovery) {
            pane.recovery ||= !(await runtime.isTerminalRunningAgent(handle))
            pane.reported = await readCodexTeamReportedSelection(
              runtime.getExactWorkerProviderSession(handle, 0)
            ).catch(() => null)
          }
        })
      )
      return { runId: run.id, panes }
    }
  }),
  defineMethod({
    name: 'codexTeam.prepareLaunch',
    params: CodexTeamPrepareLaunchParams,
    handler: async (params, { runtime }) => {
      const handle = runtime.getTerminalHandleForPaneKey(params.paneKey)
      const pane = parsePaneKey(params.paneKey)
      if (!handle || !pane) {
        throw new Error('Codex Team must start inside a live Orca pane.')
      }
      const { workspace, settings, wslDistro } = await runtime.getCodexTeamContext(handle)
      if (wslDistro !== params.wslDistro) {
        throw new Error(
          'Codex Team launcher must run on the pane execution host and WSL distro. Repair the Orca CLI registration first.'
        )
      }
      if (!settings.codexTeam || settings.disabledTuiAgents?.includes('codex-team')) {
        throw new Error('Enable Codex Team in Settings → Agents before starting a team.')
      }
      const launch = parseCodexTeamLaunchArgs(params.args)
      const db = runtime.getOrchestrationDb()
      if (db.getCurrentRunForPane(params.paneKey)?.team_policy) {
        throw new Error(
          'This pane already owns a Codex Team. Recover its existing session; the initial task was not resent.'
        )
      }
      const catalog = await readCodexTeamCatalog({
        cwd: params.cwd,
        codexHome: params.codexHome,
        codexCommand: params.codexCommand,
        wslDistro,
        config: launch.config
      })
      const selected = catalog.models.find((entry) => entry.id === catalog.model)
      if (!selected) {
        throw new Error(`Codex model ${catalog.model} is unavailable on this account.`)
      }
      if (!selected.efforts.some((entry) => entry.value === catalog.effort)) {
        throw new Error(`Codex model ${catalog.model} does not support effort ${catalog.effort}.`)
      }
      if (
        runtime.getTerminalHandleForPaneKey(params.paneKey) !== handle ||
        db.getCurrentRunForPane(params.paneKey)?.team_policy
      ) {
        throw new Error('The team leader changed while preparing the launch. No prompt was sent.')
      }
      const policy = CodexTeamPolicySchema.parse({
        ...(settings.codexTeam ?? DEFAULT_CODEX_TEAM_SETTINGS),
        tabId: pane.tabId,
        worktreeId: workspace.id,
        cwd: params.cwd,
        wslDistro,
        codexHome: params.codexHome,
        codexCommand: params.codexCommand,
        leaderModel: catalog.model,
        launchArgs: launch.args,
        leaderEffort: catalog.effort,
        initialPromptState: 'claimed',
        members: []
      })
      const run = db.createRun({
        objective: launch.prompt || 'Codex Team',
        coordinatorHandle: handle,
        coordinatorPaneKey: params.paneKey,
        teamPolicy: JSON.stringify(policy)
      })
      const available = catalog.models
        .flatMap((entry) => {
          const efforts = getCodexTeamAllowedEfforts(policy, entry)
          return efforts.length
            ? [`${entry.id}: ${efforts.map((effort) => effort.value).join(', ')}`]
            : []
        })
        .join('\n')
      const cli = runtime.getTerminalOrchestrationCliCommand(handle)
      const prompt = [
        `You lead Orca Codex Team, Run ${run.id}. Your terminal is ${handle}. This Run is already bound; do not create another Run.`,
        `All members share ${policy.cwd} on this execution host and WSL distro. Maximum ${policy.maxWorkers} workers, excluding you.`,
        `Use Orca Orchestration only. Native Codex subagents are disabled. Read \`${cli} skills get orchestration\` before delegating.`,
        'You decide whether work needs delegation, define tasks, choose workers and model/effort, review their evidence, and synthesize the final answer.',
        `Quality first: use your model ${catalog.model} with suitable effort for complex, important coding, verification, or uncertain tasks. A faster allowed model may handle bounded search, reading, or summaries.`,
        `Allowed worker models and effort ranges for this team (mandatory, including reuse):\n${available || 'None. Work as Leader only until the user opens a team with an allowed selection.'}`,
        `Use \`${cli} orchestration worker-start --spec <brief> --agent codex --model <model> --effort <effort> --selection-reason <reason> --json\`.`,
        'Each brief must define file ownership, acceptance checks, dependencies, and what to report. Tasks editing the same file must have one owner and ordered dependencies.',
        'Inspect worker-list/worker-show and reuse an idle matching worker with worker-start --task <task-id> --terminal <handle>; this creates a new Dispatch in the existing session. Keep finished workers for later tasks.',
        'When full and another model is needed, pass --replace-worker <completed-dispatch-id>; Orca archives and proves the old PTY stopped before replacement. Never replace working, waiting, or user-controlled members.',
        'Use Tasks, Dispatches, mailbox, ask/reply, dependencies and completion receipts. Input accepted does not mean read or completed. Wait for and verify completion before summarizing.',
        'A startup timeout or reconnect is ambiguous: inspect existing Run, Dispatch and PTY evidence; never resend or create duplicates automatically.',
        launch.prompt
          ? `First user task:\n${launch.prompt}`
          : 'There is no user task yet. Wait for the user. Do not create workers.'
      ].join('\n\n')
      return { runId: run.id, model: catalog.model, effort: catalog.effort, prompt }
    }
  })
]
