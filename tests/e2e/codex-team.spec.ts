import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import { waitForTerminalOutput } from './helpers/terminal'
import { stageWslGoldenStubAgent, removeWslGoldenStubAgent } from './helpers/wsl-golden-stub-agent'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const fixtureDir = path.join(process.cwd(), 'tests/e2e/fixtures/codex-team')
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
const wslDistro = process.env.ORCA_TEAM_TEST_WSL ?? ''
const guestFixtureDir = process.env.ORCA_TEAM_TEST_WSL_DIR ?? '/tmp/orca codex ทดสอบ'
test.use({
  minimumSeededWorktreeCount: 1,
  // Select WSL before registering the repo so reload observes the same workspace identity.
  seededRepoPath: async (
    { electronApp, testRepoPath, registerPostElectronShutdownCleanup },
    provideFixture
  ) => {
    if (wslDistro) {
      const stage = stageWslGoldenStubAgent(wslDistro)
      if (!stage) {
        throw new Error('Could not stage the WSL test agent for host detection.')
      }
      registerPostElectronShutdownCleanup(async () => removeWslGoldenStubAgent(wslDistro, stage))
      const page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForFunction(() => Boolean(window.__store?.getState().settings), null, {
        polling: 100
      })
      await page.evaluate(async (distro) => {
        await window.__store!.getState().updateSettings({
          localWindowsRuntimeDefault: { kind: 'wsl', distro },
          terminalWindowsShell: 'wsl',
          terminalWindowsWslDistro: distro
        })
      }, wslDistro)
    }
    await provideFixture(testRepoPath)
  },
  orcaAppExtraArgs: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  launchEnv: { [pathKey]: `${fixtureDir}${path.delimiter}${process.env[pathKey] ?? ''}` }
})

test('Codex Team opens one Leader and dispatches a worker in the same tab', async ({
  orcaPage,
  electronApp
}) => {
  // Four sequential dispatches can each spend 30s rendering through Windows ConPTY.
  test.setTimeout(process.platform === 'win32' ? 240_000 : 120_000)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  await waitForSessionReady(orcaPage)
  // Hidden Windows windows can park CSS exit animations and leave closed menus over the panes.
  await orcaPage.addStyleTag({
    content: '* { animation: none !important; transition: none !important; }'
  })
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 90_000, null, null)
  await orcaPage.evaluate(
    async ({ fixtureDir, pathKey, pathEnv, wslDistro, guestFixtureDir }) => {
      const state = window.__store!.getState()
      await state.updateSettings({
        // The fixture reports OSC status; provider hook installation belongs to the real-CLI smoke.
        agentStatusHooksEnabled: false,
        disabledTuiAgents: (state.settings?.disabledTuiAgents ?? []).filter(
          (agent) => agent !== 'codex-team'
        ),
        codexTeam: { maxWorkers: 2, allowedModels: null },
        agentCmdOverrides: {
          'codex-team': wslDistro
            ? `env PATH='${guestFixtureDir}:/usr/bin:/bin' '${guestFixtureDir}/orca-dev' codex-team`
            : `node "${fixtureDir}/team.cjs"`,
          codex: wslDistro ? `'${guestFixtureDir}/codex'` : `node "${fixtureDir}/codex.cjs"`
        },
        agentDefaultArgs: { codex: '' },
        agentDefaultEnv: {
          codex: wslDistro ? { CODEX_HOME: `${guestFixtureDir}/home` } : { [pathKey]: pathEnv }
        },
        openAgentTabsInChatByDefault: true
      })
    },
    {
      fixtureDir,
      pathKey,
      pathEnv: `${fixtureDir}${path.delimiter}${process.env[pathKey] ?? ''}`,
      wslDistro,
      guestFixtureDir
    }
  )
  if (!wslDistro) {
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'agents', repoId: null })
      state.openSettingsPage()
    })
    const settings = orcaPage.getByRole('region', { name: 'Codex Team settings' })
    await expect(
      settings.getByRole('checkbox', { name: 'Allow worker model team-fast' })
    ).toBeVisible({ timeout: 40_000 })
    await settings
      .getByRole('switch', { name: 'Allow all available worker models' })
      .click({ force: true })
    await settings
      .getByRole('combobox', { name: 'Minimum effort for team-quality' })
      .click({ force: true })
    await orcaPage.getByRole('option', { name: 'High', exact: true }).click({ force: true })
    await settings
      .getByRole('combobox', { name: 'Maximum effort for team-fast' })
      .click({ force: true })
    await orcaPage.getByRole('option', { name: 'High', exact: true }).click({ force: true })
    await expect
      .poll(() =>
        orcaPage.evaluate(() => window.__store!.getState().settings?.codexTeam?.modelEffortRanges)
      )
      .toEqual({
        'team-quality': { min: 'high', max: 'xhigh' },
        'team-fast': { min: 'medium', max: 'high' }
      })
    await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
  } else {
    const { result: catalog } = await client.call<{
      wslDistro: string | null
      models: { id: string; efforts: { value: string }[] }[]
    }>('codexTeam.models')
    expect(catalog.wslDistro).toBe(wslDistro)
    expect(catalog.models.length).toBeGreaterThan(0)
    expect(catalog.models.some((model) => model.efforts.length > 0)).toBe(true)
    await orcaPage.evaluate(async () => {
      const state = window.__store!.getState()
      await state.updateSettings({
        codexTeam: {
          maxWorkers: 2,
          allowedModels: ['team-quality', 'team-fast'],
          modelEffortRanges: {
            'team-quality': { min: 'high', max: 'xhigh' },
            'team-fast': { min: 'medium', max: 'high' }
          }
        }
      })
    })
  }
  if (process.env.ORCA_TEAM_TEST_FOLDER === '1') {
    const folderPath = path.join(userDataDir, 'งาน team')
    mkdirSync(folderPath)
    writeFileSync(path.join(folderPath, 'README.md'), '# Folder team test\n')
    writeFileSync(path.join(folderPath, 'package.json'), '{"name":"folder-team-test"}\n')
    const {
      result: { group }
    } = await client.call<{ group: { id: string } }>('projectGroup.create', {
      name: 'Team folder',
      parentPath: folderPath
    })
    const {
      result: { folderWorkspace }
    } = await client.call<{ folderWorkspace: { id: string } }>('folderWorkspace.create', {
      projectGroupId: group.id,
      name: 'งาน team',
      folderPath
    })
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (id) => window.__store!.getState().folderWorkspaces.some((entry) => entry.id === id),
          folderWorkspace.id
        )
      )
      .toBe(true)
    await orcaPage.evaluate(
      (id) => window.__store!.getState().setActiveWorktree(`folder:${id}`),
      folderWorkspace.id
    )
  }
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  const option = orcaPage.getByRole('menuitem', { name: /^Codex Team(?:\s|$)/i }).first()
  await expect(option).toBeVisible()
  await option.click({ force: true })
  await orcaPage.keyboard.press('Escape')
  await expect(option).toBeHidden()
  await waitForTerminalOutput(orcaPage, 'CODEX_TEAM_FIXTURE_READY', 30_000)
  const { result: before } = await client.call<RuntimeTerminalListResult>('terminal.list')
  const leader = before.terminals.find((terminal) => terminal.title?.includes('Codex'))
  expect(leader).toBeTruthy()
  await expect(
    client.call('orchestration.workerStart', {
      from: leader!.handle,
      spec: 'Must not launch outside the configured effort range.',
      agent: 'codex',
      model: 'team-fast',
      effort: 'xhigh',
      selectionReason: 'Effort policy check.'
    })
  ).rejects.toThrow(/outside the allowed range/)
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(1)
  // Process detection clears launch hints; the persisted Run must still identify every team pane.
  await orcaPage.evaluate(
    (tabId) => window.__store!.getState().clearTabLaunchAgent(tabId),
    leader!.tabId
  )
  const { result: worker } = await client.call<{
    state: string
    dispatchId: string
    effects: { kind: string; id?: string; tabId?: string }[]
  }>('orchestration.workerStart', {
    from: leader!.handle,
    spec: 'Read only README.md. Own no files. Report one sentence to the Leader.',
    agent: 'codex',
    model: 'team-quality',
    effort: 'high',
    selectionReason: 'Verify with the Leader model.',
    timeoutMs: 30_000
  })
  expect(worker.dispatchId).toBeTruthy()
  expect(worker.state, JSON.stringify(worker)).toBe('ready')
  const created = worker.effects.find((effect) => effect.kind === 'terminal' && effect.id)
  expect(created?.tabId).toBe(leader!.tabId)
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(2)
  await expect(orcaPage.getByText(/Worker 1 · requested team-quality/)).toBeVisible()
  const { result: second } = await client.call<typeof worker>('orchestration.workerStart', {
    from: leader!.handle,
    spec: 'Read package.json. Own no files. Report the package name.',
    agent: 'codex',
    model: 'team-fast',
    effort: 'medium',
    selectionReason: 'Bounded read of one file.',
    timeoutMs: 30_000
  })
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(3)
  const left = await orcaPage
    .locator('.pane-title-bar')
    .getByText(/Leader · requested/)
    .boundingBox()
  const right = await orcaPage.getByText(/Worker 1 · requested/).boundingBox()
  expect(right!.x).toBeGreaterThan(left!.x)
  await expect(
    client.call('orchestration.workerStart', {
      from: leader!.handle,
      spec: 'Must not open a third worker.',
      agent: 'codex',
      model: 'team-quality',
      effort: 'xhigh',
      selectionReason: 'Capacity check.'
    })
  ).rejects.toThrow(/worker limit/)
  const settled = async (dispatch: string) =>
    (await client.call<{ worker: { state: string } }>('orchestration.workerShow', { dispatch }))
      .result.worker.state
  await expect.poll(() => settled(worker.dispatchId), { timeout: 20_000 }).toBe('succeeded')
  await expect.poll(() => settled(second.dispatchId), { timeout: 20_000 }).toBe('succeeded')
  const { result: reused } = await client.call<typeof worker>('orchestration.workerStart', {
    from: leader!.handle,
    terminal: created!.id,
    spec: 'Read README.md again. Own no files. Report one sentence.',
    timeoutMs: 30_000
  })
  expect(reused.dispatchId).not.toBe(worker.dispatchId)
  expect(reused.effects.find((effect) => effect.kind === 'terminal')?.id).toBe(created!.id)
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(3)
  await expect.poll(() => settled(reused.dispatchId), { timeout: 20_000 }).toBe('succeeded')
  const { result: replacement } = await client.call<typeof worker>('orchestration.workerStart', {
    from: leader!.handle,
    replaceWorker: reused.dispatchId,
    spec: 'Read README.md with a fresh session. Own no files.',
    agent: 'codex',
    model: 'team-fast',
    effort: 'high',
    selectionReason: 'Replace the idle slot with a faster allowed model.',
    timeoutMs: 30_000
  })
  expect(replacement.state).toBe('ready')
  expect(replacement.effects.find((effect) => effect.kind === 'terminal')?.id).not.toBe(created!.id)
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(3)
  await expect(orcaPage.getByText(/Worker 1 · requested team-fast/)).toBeVisible()
  const workerOne = await orcaPage.getByText(/Worker 1 · requested team-fast/).boundingBox()
  const workerTwo = await orcaPage.getByText(/Worker 2 · requested team-fast/).boundingBox()
  expect(workerOne!.y).toBeLessThan(workerTwo!.y)
  const archive = (
    await client.call<{ terminalResource: { releaseState: string } }>('orchestration.workerShow', {
      dispatch: reused.dispatchId
    })
  ).result
  expect(archive.terminalResource.releaseState).toBe('released')
  await orcaPage.keyboard.press('Escape')
  await orcaPage.getByRole('button', { name: 'Worker 1 history' }).click({ force: true })
  const history = orcaPage.getByRole('dialog', { name: 'Worker 1 history' })
  await expect(history).toBeVisible()
  await history.getByRole('combobox').selectOption(reused.dispatchId)
  await expect(history.getByText(/TEAM_WORKER_DONE/)).toBeVisible()
  await history.getByRole('combobox').selectOption(worker.dispatchId)
  await expect(history.getByText(/TEAM_WORKER_DONE/)).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  const prior = (await client.call<RuntimeTerminalListResult>('terminal.list')).result.terminals
    .filter((entry) => entry.tabId === leader!.tabId)
    .map((entry) => entry.handle)
    .sort()
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  expect(
    await orcaPage.evaluate(() => window.__store!.getState().settings?.codexTeam?.modelEffortRanges)
  ).toEqual({
    'team-quality': { min: 'high', max: 'xhigh' },
    'team-fast': { min: 'medium', max: 'high' }
  })
  await ensureTerminalVisible(orcaPage)
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(3)
  const restored = (await client.call<RuntimeTerminalListResult>('terminal.list')).result.terminals
    .filter((entry) => entry.tabId === leader!.tabId)
    .map((entry) => entry.handle)
    .sort()
  expect(restored).toEqual(prior)
  expect(
    (await client.call<{ panes: unknown[] }>('codexTeam.show', { tabId: leader!.tabId })).result
      .panes
  ).toHaveLength(3)
})
