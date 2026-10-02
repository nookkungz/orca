import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady, ensureTerminalVisible } from './helpers/store'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeCreateAgentSessionResult } from '../../src/shared/agent-session-host-authority'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import type { CodexTeamView } from '../../src/shared/codex-team'

test('Codex Team settings and existing sessions survive an Orca restart without redispatch', async (// oxlint-disable-next-line no-empty-pattern -- The restart helper owns both app launches.
{}, testInfo) => {
  test.setTimeout(180_000)
  const fixtureDir = path.join(process.cwd(), 'tests/e2e/fixtures/codex-team')
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const pathEnv = `${fixtureDir}${path.delimiter}${process.env[pathKey] ?? ''}`
  const session = createRestartSession(testInfo, { [pathKey]: pathEnv })
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    const worktreeId = await attachRepoAndOpenTerminal(
      first.page,
      readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    )
    await waitForSessionReady(first.page)
    await first.page.addStyleTag({
      content: '* { animation: none !important; transition: none !important; }'
    })
    await first.page.evaluate(
      async ({ fixtureDir, pathKey, pathEnv }) => {
        const state = window.__store!.getState()
        await state.updateSettings({
          agentStatusHooksEnabled: false,
          agentCmdOverrides: {
            'codex-team': `node "${fixtureDir}/team.cjs"`,
            codex: `node "${fixtureDir}/codex.cjs"`
          },
          agentDefaultArgs: { codex: '' },
          agentDefaultEnv: { codex: { [pathKey]: pathEnv } }
        })
        state.openSettingsPage()
      },
      { fixtureDir, pathKey, pathEnv }
    )
    await first.page.getByPlaceholder('Search settings').fill('codex')
    await first.page.getByRole('button', { name: 'Agents', exact: true }).click({ force: true })
    const availability = first.page.getByRole('radiogroup', { name: 'Codex Team availability' })
    await expect(availability.getByRole('radio', { name: 'Disabled' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await availability.getByRole('radio', { name: 'Enabled' }).click({ force: true })
    await first.page.getByRole('button', { name: 'Codex Team', exact: true }).click({ force: true })
    await first.page.getByLabel('Maximum Codex Team workers').fill('2')
    await first.page
      .getByRole('switch', { name: 'Allow all available worker models' })
      .click({ force: true })
    await first.page.getByLabel('Allowed Codex Team worker models').fill('team-quality\nteam-fast')
    await first.page.getByLabel('Allowed Codex Team worker models').blur()
    await expect
      .poll(() => first.page.evaluate(() => window.__store!.getState().settings?.codexTeam))
      .toEqual({ maxWorkers: 2, allowedModels: ['team-quality', 'team-fast'] })
    await first.page.evaluate(() => window.__store!.getState().closeSettingsPage())
    const client = new RuntimeClient(session.userDataDir, 60_000, null, null)
    const {
      result: { terminal: leader }
    } = await client.call<RuntimeCreateAgentSessionResult>('terminal.createAgentSession', {
      clientOperationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
      worktree: `id:${worktreeId}`,
      agent: 'codex-team',
      presentation: 'focused',
      viewMode: 'terminal'
    })
    await expect
      .poll(
        async () =>
          (await client.call<CodexTeamView | null>('codexTeam.show', { tabId: leader.tabId }))
            .result?.panes.length
      )
      .toBe(1)
    await client.call('terminal.wait', {
      terminal: leader.handle,
      for: 'tui-idle',
      timeoutMs: 30_000
    })
    const { result: worker } = await client.call<{ state: string; dispatchId: string }>(
      'orchestration.workerStart',
      {
        from: leader.handle,
        spec: 'Read README only. Own no files.',
        agent: 'codex',
        model: 'team-quality',
        effort: 'high',
        selectionReason: 'Verify with the Leader model.',
        timeoutMs: 30_000
      }
    )
    expect(worker.state).toBe('ready')
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worker: { state: string } }>('orchestration.workerShow', {
              dispatch: worker.dispatchId
            })
          ).result.worker.state
      )
      .toBe('succeeded')
    const before = (
      await client.call<RuntimeTerminalListResult>('terminal.list')
    ).result.terminals.filter((terminal) => terminal.tabId === leader.tabId)
    const run = (await client.call<CodexTeamView>('codexTeam.show', { tabId: leader.tabId })).result
    await session.close(app)
    app = null
    const second = await session.launch()
    app = second.app
    await waitForSessionReady(second.page)
    await ensureTerminalVisible(second.page)
    const settings = await second.page.evaluate(() => window.__store!.getState().settings)
    expect(settings?.defaultTuiAgent).toBe('codex-team')
    expect(settings?.disabledTuiAgents).not.toContain('codex-team')
    expect(settings?.codexTeam).toEqual({
      maxWorkers: 2,
      allowedModels: ['team-quality', 'team-fast']
    })
    await expect(second.page.locator('.pane-title-bar')).toHaveCount(2)
    const restored = (await client.call<CodexTeamView>('codexTeam.show', { tabId: leader.tabId }))
      .result
    expect(restored.runId).toBe(run.runId)
    expect(restored.panes.map((pane) => pane.dispatches)).toEqual(
      run.panes.map((pane) => pane.dispatches)
    )
    const after = (
      await client.call<RuntimeTerminalListResult>('terminal.list')
    ).result.terminals.filter((terminal) => terminal.tabId === leader.tabId)
    expect(
      after
        .map(({ handle, ptyId, incarnationId }) => ({ handle, ptyId, incarnationId }))
        .sort((a, b) => a.handle.localeCompare(b.handle))
    ).toEqual(
      before
        .map(({ handle, ptyId, incarnationId }) => ({ handle, ptyId, incarnationId }))
        .sort((a, b) => a.handle.localeCompare(b.handle))
    )
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
