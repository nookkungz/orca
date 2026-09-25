import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { quoteStartupArg } from '../../src/shared/tui-agent-startup-shell'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

for (const mode of ['git', 'folder']) {
  test(`hides and reveals automation tabs with saved preference in ${mode} workspace`, async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(150_000)
    await waitForSessionReady(orcaPage)
    const click = { force: process.platform === 'win32' }
    await orcaPage.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }'
    })
    const script = testInfo.outputPath('agent.mjs')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(
      script,
      "console.log('AUTOMATION_HIDDEN_RUNNING'); setTimeout(() => process.exit(0), 120000);\n"
    )
    const command = `node ${quoteStartupArg(script, process.platform === 'win32' ? 'powershell' : 'posix')}`
    const folderPath = testInfo.outputPath('folder-workspace')
    mkdirSync(folderPath, { recursive: true })
    const automationId = await orcaPage.evaluate(
      async ({ command, folderPath, mode }) => {
        const store = window.__store!
        let automationWorkspaceId = store.getState().activeWorktreeId
        if (mode === 'folder') {
          const result = await window.api.repos.add({
            path: folderPath,
            kind: 'folder',
            displayName: 'Automation folder'
          })
          if ('error' in result) {
            throw new Error(result.error)
          }
          await store.getState().fetchRepos()
          await store.getState().fetchWorktrees(result.repo.id)
          const workspace = store.getState().worktreesByRepo[result.repo.id]?.[0]
          if (!workspace) {
            throw new Error('Folder workspace missing')
          }
          automationWorkspaceId = workspace.id
          store.getState().setActiveRepo(result.repo.id)
          store.getState().setActiveWorktree(workspace.id, 'local')
        }
        const state = store.getState()
        await state.updateSettings({ agentCmdOverrides: { codex: command } })
        const response = await window.api.runtime.call({
          method: 'automation.create',
          params: {
            name: 'Run tab visibility',
            prompt: 'Check visibility',
            agentId: 'codex',
            workspace: `id:${automationWorkspaceId}`,
            workspaceMode: 'existing',
            enabled: false,
            timezone: 'UTC',
            rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
            dtstart: Date.now()
          }
        })
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        const data = response.result
        if (
          !data ||
          typeof data !== 'object' ||
          !('automation' in data) ||
          !data.automation ||
          typeof data.automation !== 'object' ||
          !('id' in data.automation) ||
          typeof data.automation.id !== 'string'
        ) {
          throw new Error('Missing automation')
        }
        for (let n = 0; n < 2; n++) {
          const result = await window.api.runtime.call({
            method: 'automation.runNow',
            params: { id: data.automation.id }
          })
          if (!result.ok) {
            throw new Error(result.error.message)
          }
        }
        return data.automation.id
      },
      { command, folderPath, mode }
    )
    const getRunTabs = () =>
      orcaPage.evaluate(
        (automationId) =>
          Object.values(window.__store!.getState().unifiedTabsByWorktree)
            .flat()
            .filter((t) => t.automationId === automationId)
            .map((t) => t.id),
        automationId
      )
    await expect.poll(async () => (await getRunTabs()).length, { timeout: 40_000 }).toBe(2)
    const tabIds = await getRunTabs()
    for (const id of tabIds) {
      await expect(orcaPage.locator(`[data-tab-id="${id}"]`)).toHaveCount(0)
    }
    const liveBindings = () =>
      orcaPage.evaluate(
        (ids) => ids.map((id) => window.__store!.getState().ptyIdsByTabId[id]?.[0]),
        tabIds
      )
    await expect.poll(async () => (await liveBindings()).filter(Boolean).length).toBe(2)
    const originalPtys = await liveBindings()
    await expect
      .poll(
        () =>
          orcaPage.evaluate(async (ids) => {
            const snapshots = await Promise.all(
              ids
                .filter((id): id is string => Boolean(id))
                .map((id) => window.api.pty.getMainBufferSnapshot(id, { scrollbackRows: 100 }))
            )
            return snapshots.every((snapshot) =>
              snapshot?.data.includes('AUTOMATION_HIDDEN_RUNNING')
            )
          }, originalPtys),
        { timeout: 20_000 }
      )
      .toBe(true)
    await orcaPage.evaluate(() => window.__store!.getState().openAutomationsPage())
    await orcaPage.getByText('Run tab visibility', { exact: true }).first().click(click)
    await orcaPage.getByRole('button', { name: 'Edit automation', exact: true }).click(click)
    const dialog = orcaPage.getByRole('dialog')
    const checkbox = dialog.getByRole('checkbox', { name: 'Show runs in workspace tabs' })
    await expect(checkbox).not.toBeChecked()
    await expect(dialog.getByText('Hidden runs remain available in Run history.')).toBeVisible()
    await checkbox.check(click)
    await dialog.getByRole('button', { name: /save/i }).click(click)
    await orcaPage.evaluate(() => window.__store!.getState().setActiveView('terminal'))
    for (const id of tabIds) {
      await expect(orcaPage.locator(`[data-tab-id="${id}"]`)).toHaveCount(1)
    }
    await orcaPage.evaluate(() => window.__store!.getState().openAutomationsPage())
    await orcaPage.getByText('Run tab visibility', { exact: true }).first().click(click)
    await orcaPage.getByRole('button', { name: 'Edit automation', exact: true }).click(click)
    await expect(checkbox).toBeChecked()
    await checkbox.uncheck(click)
    await dialog.getByRole('button', { name: /save/i }).click(click)
    await orcaPage.getByRole('tab', { name: /^Runs/ }).click(click)
    await orcaPage.locator('[data-automation-run-id]').first().click(click)
    await expect(
      orcaPage.getByRole('button', { name: 'Open workspace', exact: true })
    ).toBeVisible()
    expect(await getRunTabs()).toEqual(tabIds)
    await orcaPage.getByRole('button', { name: 'Open workspace', exact: true }).click(click)
    await expect
      .poll(async () => {
        let count = 0
        for (const id of tabIds) {
          count += await orcaPage.locator(`[data-tab-id="${id}"]`).count()
        }
        return count
      })
      .toBe(1)
    expect(await liveBindings()).toEqual(originalPtys)
    expect(await getRunTabs()).toEqual(tabIds)
    // CDP captures the hidden window without focusing or revealing it.
    const cdp = await orcaPage.context().newCDPSession(orcaPage)
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(
      testInfo.outputPath('automation-run-tab-visibility.png'),
      Buffer.from(screenshot.data, 'base64')
    )
    await cdp.detach()
    await windowPersisted()
    await orcaPage.reload()
    await waitForSessionReady(orcaPage)
    for (const id of tabIds) {
      await expect(orcaPage.locator(`[data-tab-id="${id}"]`)).toHaveCount(0)
    }
    await expect.poll(async () => (await getRunTabs()).length).toBe(2)
    async function windowPersisted(): Promise<void> {
      await expect
        .poll(() =>
          orcaPage.evaluate(async (ids) => {
            await window.api.session.flush()
            const session = await window.api.session.get()
            return Object.values(session.tabsByWorktree)
              .flat()
              .filter((tab) => ids.includes(tab.id)).length
          }, tabIds)
        )
        .toBe(2)
    }
  })
}
