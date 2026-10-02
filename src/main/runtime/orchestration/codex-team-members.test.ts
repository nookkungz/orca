import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { CodexTeamPolicySchema, readCodexTeamPolicy } from '../../../shared/codex-team'
import { bindCodexTeamMember } from './codex-team-members'

describe('Codex Team durable slots', () => {
  const databases: OrchestrationDb[] = []
  afterEach(() => {
    for (const db of databases.splice(0)) {
      db.close()
    }
  })
  function setup(maxWorkers = 3) {
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    const team = CodexTeamPolicySchema.parse({
      maxWorkers,
      allowedModels: null,
      tabId: 'team-tab',
      worktreeId: 'folder:project',
      cwd: '/งาน test',
      wslDistro: null,
      codexHome: null,
      leaderModel: 'future-model',
      leaderEffort: 'high',
      initialPromptState: 'claimed',
      members: []
    })
    const run = db.createRun({
      objective: 'test',
      coordinatorHandle: 'leader',
      coordinatorPaneKey: 'team-tab:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      teamPolicy: JSON.stringify(team)
    })
    const start = (terminal?: string) =>
      db.createStartingWorkerDispatch({
        taskSpec: 'read one file',
        taskRunId: run.id,
        startOptions: {},
        codexTeam: {
          model: 'future-model',
          effort: 'high',
          reason: 'verify',
          ...(terminal ? { terminal } : {})
        },
        creator: {
          kind: 'terminal',
          handle: 'leader',
          paneKey: run.coordinator_pane_key ?? undefined
        },
        maxDepth: 3
      })
    return { db, run, start }
  }
  it('reserves opening members in the same transaction and rolls back an over-capacity Task', () => {
    const { db, run, start } = setup(1)
    const first = start()
    expect(readCodexTeamPolicy(db.getRun(run.id)?.team_policy)?.members[0]).toMatchObject({
      state: 'opening',
      dispatchId: first.dispatch.id
    })
    expect(() => start()).toThrow('worker limit')
    expect(db.db.prepare('SELECT count(*) AS n FROM tasks WHERE run_id = ?').get(run.id)).toEqual({
      n: 1
    })
  })
  it('reuses a member without consuming another slot and retains previous dispatch identity', () => {
    const { db, run, start } = setup(1)
    const first = start()
    bindCodexTeamMember(db, run.id, first.dispatch.id, {
      handle: 'worker',
      paneKey: 'pane',
      incarnation: 'inc-1'
    })
    const second = start('worker')
    const members = readCodexTeamPolicy(db.getRun(run.id)?.team_policy)!.members
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({
      slot: 1,
      dispatchId: second.dispatch.id,
      previousDispatches: [first.dispatch.id]
    })
  })
  it('migrates an existing run without changing its objective or binding', () => {
    const { db, run } = setup()
    db.db.exec('ALTER TABLE runs DROP COLUMN team_policy')
    db.db.pragma('user_version = 41')
    db.migrate()
    expect(db.getRun(run.id)).toMatchObject({
      objective: 'test',
      coordinator_pane_key: run.coordinator_pane_key,
      team_policy: null
    })
    expect(db.db.pragma('user_version', { simple: true })).toBe(42)
  })
  it('rejects an unvalidated start against a team run', () => {
    const { db, run } = setup()
    expect(() =>
      db.createStartingWorkerDispatch({
        taskSpec: 'bypass',
        taskRunId: run.id,
        startOptions: {},
        creator: { kind: 'terminal', handle: 'leader' },
        maxDepth: 3
      })
    ).toThrow('validated model')
  })
})
