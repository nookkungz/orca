import { chmodSync, copyFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeCreateAgentSessionResult } from '../../src/shared/agent-session-host-authority'
import type { CodexTeamView } from '../../src/shared/codex-team'
import { quotePosixShell } from '../../src/shared/wsl-login-shell-command'
import { getWslSelectionKey } from '../../src/shared/codex-selection-lane'

// Opt in with an authorized account. Credentials stay inside the disposable E2E home.
const sourceHome = process.env.ORCA_TEAM_LIVE_CODEX_HOME
const model = process.env.ORCA_TEAM_LIVE_MODEL ?? 'gpt-6-astra'
const wslDistro = process.env.ORCA_TEAM_LIVE_WSL
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
test.use({
  ...(process.env.ORCA_TEAM_LIVE_CODEX_BIN
    ? {
        launchEnv: {
          [pathKey]: `${process.env.ORCA_TEAM_LIVE_CODEX_BIN}${path.delimiter}${process.env[pathKey] ?? ''}`
        }
      }
    : {}),
  orcaAppExtraArgs: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling']
})

test('live Codex Leader delegates, answers a worker, verifies results and reuses a member', async ({
  orcaPage,
  electronApp,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(!sourceHome, 'Requires an explicitly selected live Codex account')
  test.setTimeout(600_000)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const client = new RuntimeClient(userData, 90_000, null, null)
  let codexHome = path.join(home, '.codex')
  let hostCodexHome = codexHome
  if (wslDistro) {
    await client.call('accounts.addCodexFromHome', {
      sourceHome: sourceHome!,
      runtime: 'wsl',
      wslDistro
    })
    const account = await orcaPage.evaluate(async (selectionKey) => {
      const settings = await window.api.settings.get()
      const id = settings.activeCodexManagedAccountIdsByRuntime?.wsl[selectionKey]
      const selected = settings.codexManagedAccounts.find((entry) => entry.id === id)!
      return { id: selected.id, path: selected.managedHomePath, guest: selected.wslLinuxHomePath! }
    }, getWslSelectionKey(wslDistro))
    codexHome = account.guest
    hostCodexHome = account.path
    registerPostElectronShutdownCleanup(async () => {
      expect(readFileSync(path.join(account.path, '.orca-managed-home'), 'utf8').trim()).toBe(
        account.id
      )
      execFileSync('wsl.exe', [
        '-d',
        wslDistro,
        '--exec',
        'rm',
        '-rf',
        '--',
        path.posix.dirname(account.guest)
      ])
    })
  }
  const workspacePath = wslDistro
    ? execFileSync('wsl.exe', ['-d', wslDistro, '--exec', 'wslpath', '-u', seededRepoPath], {
        encoding: 'utf8'
      }).trim()
    : seededRepoPath
  mkdirSync(hostCodexHome, { recursive: true, mode: 0o700 })
  copyFileSync(path.join(sourceHome!, 'auth.json'), path.join(hostCodexHome, 'auth.json'))
  chmodSync(path.join(hostCodexHome, 'auth.json'), 0o600)
  if (wslDistro) {
    execFileSync('wsl.exe', ['-d', wslDistro, '--exec', 'chmod', '600', `${codexHome}/auth.json`])
  }
  writeFileSync(
    path.join(hostCodexHome, 'config.toml'),
    `model = ${JSON.stringify(model)}\nmodel_reasoning_effort = "xhigh"\n[projects.${JSON.stringify(workspacePath)}]\ntrust_level = "trusted"\n`,
    { mode: 0o600 }
  )
  await orcaPage.evaluate(
    async ({ command, model, codexHome, wslDistro, guestPath }) => {
      const state = window.__store!.getState()
      await state.updateSettings({
        ...(wslDistro
          ? {
              localWindowsRuntimeDefault: { kind: 'wsl' as const, distro: wslDistro },
              terminalWindowsShell: 'wsl',
              terminalWindowsWslDistro: wslDistro
            }
          : {}),
        disabledTuiAgents: (state.settings?.disabledTuiAgents ?? []).filter(
          (id) => id !== 'codex-team'
        ),
        codexTeam: { maxWorkers: 2, allowedModels: [model] },
        agentCmdOverrides: { 'codex-team': command },
        agentDefaultEnv: {
          codex: {
            ...(!wslDistro ? { CODEX_HOME: codexHome } : {}),
            ...(guestPath ? { PATH: guestPath } : {})
          }
        },
        openAgentTabsInChatByDefault: true
      })
    },
    {
      command: wslDistro
        ? `${process.env.ORCA_TEAM_LIVE_WSL_PATH ? `env PATH=${quotePosixShell(process.env.ORCA_TEAM_LIVE_WSL_PATH)} ` : ''}${quotePosixShell(process.env.ORCA_TEAM_LIVE_WSL_ORCA ?? 'orca')} codex-team`
        : `node "${path.join(process.cwd(), 'out/cli/index.js')}" codex-team`,
      model,
      codexHome,
      wslDistro,
      guestPath: process.env.ORCA_TEAM_LIVE_WSL_PATH
    }
  )
  const task = `Run a bounded read-only Codex Team acceptance check in this disposable repository. Do not edit any files. Use the already-bound Run, never create another Run. Start two independent workers before waiting: A reads README.md and first asks you via orchestration ask whether it should report the first heading; reply yes. B reads package.json and reports the package name, or reports that it does not exist. Both own no files, must send worker_done with evidence, and end their turns. Use your model ${model}, high effort for A and medium effort for B so they occupy two distinct members. After both complete, inspect their receipts and reuse A's idle terminal via worker-start --terminal for a third read-only task counting README lines. Wait for its new Dispatch to succeed. Keep both members open. End with TEAM_LIVE_VERIFIED and the three observed results only after you have accepted all three results.`
  const worktree = await orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId!)
  const {
    result: { terminal: leader }
  } = await client.call<RuntimeCreateAgentSessionResult>('terminal.createAgentSession', {
    clientOperationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
    worktree: `id:${worktree}`,
    agent: 'codex-team',
    launchPreferences: { model, effort: 'xhigh' },
    prompt: task,
    presentation: 'focused',
    viewMode: 'terminal'
  })
  await expect
    .poll(
      async () =>
        (await client.call<CodexTeamView | null>('codexTeam.show', { tabId: leader.tabId })).result
          ?.runId,
      { timeout: 60_000 }
    )
    .toBeTruthy()
  await expect
    .poll(() => globSync('sessions/**/*.jsonl', { cwd: hostCodexHome }).length, {
      timeout: 60_000
    })
    .toBeGreaterThan(0)
  // Assert the assistant's final transcript, not a marker echoed from the input prompt.
  await expect
    .poll(
      () =>
        globSync('sessions/**/*.jsonl', { cwd: hostCodexHome }).some((file) =>
          readFileSync(path.join(hostCodexHome, file), 'utf8')
            .split('\n')
            .some((line) => {
              try {
                const record = JSON.parse(line)
                return (
                  record.type === 'response_item' &&
                  record.payload?.type === 'message' &&
                  record.payload.role === 'assistant' &&
                  record.payload.content?.some((part: { text?: string }) =>
                    part.text?.includes('TEAM_LIVE_VERIFIED')
                  )
                )
              } catch {
                return false
              }
            })
        ),
      { timeout: 480_000, intervals: [3000] }
    )
    .toBe(true)
  const view = (await client.call<CodexTeamView>('codexTeam.show', { tabId: leader.tabId })).result
  expect(view.panes).toHaveLength(3)
  const dispatches = view.panes
    .filter((pane) => pane.role !== 'Leader')
    .flatMap((pane) => pane.dispatches ?? [])
  expect(dispatches).toHaveLength(3)
  for (const dispatch of dispatches) {
    const result = (
      await client.call<{ worker: { state: string } }>('orchestration.workerShow', { dispatch })
    ).result
    expect(result.worker.state).toBe('succeeded')
  }
  expect(view.panes.every((pane) => pane.reported?.model === model)).toBe(true)
  expect(view.panes.find((pane) => pane.role === 'Leader')?.reported?.effort).toBe('xhigh')
  expect(
    view.panes
      .filter((pane) => pane.role !== 'Leader')
      .map((pane) => pane.reported?.effort)
      .sort()
  ).toEqual(['high', 'medium'])
  await expect(orcaPage.locator('.pane-title-bar')).toHaveCount(3)
})
