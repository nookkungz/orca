import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrchestrationWorkerReleaseHarness } from './worker-release.test-support'
import { prepareCodexTeamWorker, withCodexTeamStart } from './codex-team-worker'
import { CodexTeamPolicySchema, readCodexTeamPolicy } from '../../../../../../shared/codex-team'
import { saveCodexTeam } from '../../../../orchestration/codex-team-members'
import { readCodexTeamCatalog } from '../../../../../codex/codex-team-catalog'

vi.mock('../../../../../codex/codex-team-catalog', () => ({ readCodexTeamCatalog: vi.fn() }))

describe('Codex Team worker lifecycle', () => {
  const h = createOrchestrationWorkerReleaseHarness()
  let dispatchId: string
  beforeEach(async () => {
    h.setup()
    const first = await h.startSettledWorker()
    dispatchId = first.dispatchId
    saveCodexTeam(
      h.db,
      h.activeRunId,
      CodexTeamPolicySchema.parse({
        maxWorkers: 1,
        allowedModels: ['future-model'],
        tabId: 'team',
        worktreeId: 'repo::worktree',
        cwd: '/งาน test',
        wslDistro: null,
        codexHome: '/account',
        leaderModel: 'future-model',
        leaderEffort: 'high',
        initialPromptState: 'claimed',
        members: [
          {
            slot: 1,
            dispatchId,
            paneKey: h.workerPaneKey,
            handle: 'term_worker',
            incarnation: 'runtime_test:term_worker:1',
            model: 'future-model',
            effort: 'high',
            state: 'live'
          }
        ]
      })
    )
    vi.spyOn(h.runtime, 'getTerminalLivenessVerdict').mockReturnValue({
      status: 'live',
      ptyIds: ['pty']
    })
    vi.spyOn(h.runtime, 'listTerminals').mockResolvedValue({
      terminals: [],
      truncated: false,
      totalCount: 0
    })
    vi.spyOn(h.runtime, 'getTerminalHandleForPaneKey').mockReturnValue('term_worker')
    vi.spyOn(h.runtime, 'getTerminalInteractiveWait').mockResolvedValue(null)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this preparation reads only workspace.id and wslDistro; placement is outside these tests.
    vi.spyOn(h.runtime, 'getCodexTeamContext').mockResolvedValue({
      workspace: { id: 'repo::worktree' },
      wslDistro: null
    } as never)
    vi.mocked(readCodexTeamCatalog).mockResolvedValue({
      models: [
        {
          id: 'future-model',
          label: 'Future',
          isDefault: true,
          defaultEffort: 'high',
          efforts: [{ value: 'high', label: 'High' }]
        }
      ],
      model: 'future-model',
      effort: 'high'
    })
  })
  afterEach(() => h.cleanup())
  const reuse = () =>
    prepareCodexTeamWorker(h.runtime, h.db, h.activeRunId, {
      from: 'term_coord',
      terminal: 'term_worker',
      spec: 'next task'
    })
  const replace = () =>
    prepareCodexTeamWorker(h.runtime, h.db, h.activeRunId, {
      from: 'term_coord',
      replaceWorker: dispatchId,
      spec: 'new model task',
      agent: 'codex',
      model: 'future-model',
      effort: 'high',
      selectionReason: 'Requires a new session.'
    })

  it('reuses a completed owned member and refuses a user takeover or interactive wait', async () => {
    expect(await reuse()).toMatchObject({
      terminal: 'term_worker',
      model: 'future-model',
      effort: 'high'
    })
    vi.mocked(h.runtime.getTerminalInteractiveWait).mockResolvedValue({ source: 'hook' })
    await expect(reuse()).rejects.toThrow('waiting for an answer')
    vi.mocked(h.runtime.getTerminalInteractiveWait).mockResolvedValue(null)
    h.db.markWorkerTerminalUserOwned(h.workerPaneKey)
    await expect(replace()).rejects.toThrow('ownership')
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
  })
  it('requires fresh host liveness before dispatching to the team', async () => {
    vi.mocked(h.runtime.listTerminals).mockRejectedValue(new Error('terminal_liveness_unavailable'))
    await expect(reuse()).rejects.toThrow('terminal_liveness_unavailable')
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
  })
  it('enforces effort bounds before reuse, new work, or releasing a replacement', async () => {
    const team = readCodexTeamPolicy(h.db.getRun(h.activeRunId)!.team_policy)!
    team.modelEffortRanges = { 'future-model': { min: 'low', max: 'medium' } }
    saveCodexTeam(h.db, h.activeRunId, team)
    vi.mocked(readCodexTeamCatalog).mockResolvedValue({
      model: 'future-model',
      effort: 'high',
      models: [
        {
          id: 'future-model',
          label: 'Future',
          isDefault: true,
          efforts: ['low', 'medium', 'high'].map((value) => ({ value, label: value }))
        }
      ]
    })
    await expect(reuse()).rejects.toThrow('outside the allowed range low–medium')
    await expect(replace()).rejects.toThrow('outside the allowed range low–medium')
    await expect(
      prepareCodexTeamWorker(h.runtime, h.db, h.activeRunId, {
        from: 'term_coord',
        spec: 'next',
        model: 'future-model',
        effort: 'high',
        selectionReason: 'test'
      })
    ).rejects.toThrow('outside the allowed range')
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
    expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)!.team_policy)?.members).toHaveLength(1)
    team.modelEffortRanges['future-model']!.max = 'high'
    saveCodexTeam(h.db, h.activeRunId, team)
    expect(await reuse()).toMatchObject({ terminal: 'term_worker', effort: 'high' })
  })
  it('accepts equivalent Windows path spelling while still fencing the WSL distro', async () => {
    const team = readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)!
    saveCodexTeam(h.db, h.activeRunId, {
      ...team,
      worktreeId: 'repo::C:\\งาน team\\repo',
      wslDistro: 'Ubuntu'
    })
    const context = await h.runtime.getCodexTeamContext('term_coord')
    vi.mocked(h.runtime.getCodexTeamContext).mockResolvedValue({
      ...context,
      workspace: { ...context.workspace, id: 'repo::C:/งาน team/repo' },
      wslDistro: 'Ubuntu'
    })
    await expect(reuse()).resolves.toMatchObject({ terminal: 'term_worker' })
    vi.mocked(h.runtime.getCodexTeamContext).mockResolvedValue({
      ...context,
      workspace: { ...context.workspace, id: 'repo::C:/งาน team/repo' },
      wslDistro: 'Debian'
    })
    await expect(reuse()).rejects.toThrow('execution host or WSL distro changed')
  })
  it('preserves the slot when output cannot be archived', async () => {
    vi.mocked(h.runtime.readTerminal).mockRejectedValue(new Error('archive unavailable'))
    await expect(replace()).rejects.toThrow('could not be preserved')
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
    expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)?.members).toHaveLength(1)
  })
  it.each(['screen', 'clipped'] as const)(
    'keeps the member when only %s history is available',
    async (source) => {
      vi.mocked(h.runtime.readTerminal).mockResolvedValue({
        handle: 'term_worker',
        status: 'running',
        tail: ['Partial history'],
        source: source === 'screen' ? 'screen' : 'stream',
        truncated: source === 'clipped',
        nextCursor: '1'
      })
      await expect(replace()).rejects.toThrow('complete team history could not be preserved')
      expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
      expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)?.members).toHaveLength(1)
    }
  )
  it('preserves the slot and archive when the old PTY stop is unproven', async () => {
    vi.mocked(h.runtime.closeTerminal).mockResolvedValue({
      handle: 'term_worker',
      tabId: 'team',
      ptyKilled: false,
      ptyStopVerdict: 'unverifiable',
      ptyStopReason: 'connection lost'
    })
    await expect(replace()).rejects.toThrow('retained for recovery')
    expect(h.db.getWorkerTerminalArchive(dispatchId)).toBeTruthy()
    expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)?.members).toHaveLength(1)
  })
  it('selects a matching idle member before opening a new session', async () => {
    expect(
      await prepareCodexTeamWorker(h.runtime, h.db, h.activeRunId, {
        from: 'term_coord',
        spec: 'next',
        model: 'future-model',
        effort: 'high',
        selectionReason: 'Same quality required.'
      })
    ).toMatchObject({ terminal: 'term_worker', reason: 'Same quality required.' })
  })
  it('keeps catalog configuration pinned and frees a closed slot only after proven process exit', async () => {
    const team = readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)!
    team.launchArgs = ['-c', 'model_provider="custom"', '--ask-for-approval', 'on-request']
    saveCodexTeam(h.db, h.activeRunId, team)
    vi.mocked(h.runtime.getTerminalHandleForPaneKey).mockReturnValue(null)
    const liveness = vi
      .spyOn(h.runtime, 'inspectTerminalProcessIncarnationLiveness')
      .mockResolvedValue('unverifiable')
    const start = () =>
      prepareCodexTeamWorker(h.runtime, h.db, h.activeRunId, {
        from: 'term_coord',
        spec: 'next',
        model: 'future-model',
        effort: 'high',
        selectionReason: 'verify'
      })
    await start()
    expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)?.members).toHaveLength(1)
    expect(readCodexTeamCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: ['-c', 'model_provider="custom"']
      })
    )
    liveness.mockResolvedValue('exited')
    await start()
    expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)).toMatchObject({
      members: [],
      archivedDispatches: [dispatchId]
    })
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
  })
  it('keeps history and slot identity only after the old process is proven stopped', async () => {
    const result = await replace()
    expect(result).toMatchObject({ slot: 1, previousDispatches: [dispatchId] })
    expect(h.runtime.closeTerminal).toHaveBeenCalledWith('term_worker', {
      waitForPhysicalExit: true
    })
    expect(h.db.getWorkerTerminalArchive(dispatchId)).toBeTruthy()
    expect(readCodexTeamPolicy(h.db.getRun(h.activeRunId)?.team_policy)?.members).toHaveLength(0)
  })
  it('refuses disconnected leaders and unavailable model choices without opening a session', async () => {
    vi.mocked(h.runtime.getTerminalLivenessVerdict).mockReturnValue({
      status: 'unverifiable',
      reason: 'reconnecting'
    })
    await expect(reuse()).rejects.toThrow('Leader is disconnected')
    vi.mocked(h.runtime.getTerminalLivenessVerdict).mockReturnValue({
      status: 'live',
      ptyIds: ['pty']
    })
    vi.mocked(readCodexTeamCatalog).mockRejectedValue(new Error('model unavailable'))
    await expect(replace()).rejects.toThrow('model unavailable')
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
  })
  it('serializes concurrent starts and continues after a failed start', async () => {
    const gate = h.deferred<void>()
    const second = vi.fn(async () => 'second')
    const first = withCodexTeamStart(h.runtime, h.activeRunId, async () => {
      await gate.promise
      throw new Error('failed')
    })
    const firstResult = expect(first).rejects.toThrow('failed')
    const next = withCodexTeamStart(h.runtime, h.activeRunId, second)
    await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
    gate.resolve()
    await firstResult
    expect(await next).toBe('second')
  })
})
