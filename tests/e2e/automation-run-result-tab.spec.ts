import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { quoteStartupArg } from '../../src/shared/tui-agent-startup-shell'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

const Run = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  workspaceId: z.string().nullable(),
  terminalPaneKey: z.string().nullable(),
  outputSnapshot: z.object({ content: z.string() }).nullable()
})

for (const mode of ['git', 'folder']) {
  test(`opens one saved run tab after its terminal closes in a ${mode} workspace`, async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(150_000)
    await waitForSessionReady(orcaPage)
    const marker = `SAVED_RUN_RESULT_${mode}`
    const script = testInfo.outputPath('agent.mjs')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, `console.log('${marker}'); setTimeout(() => process.exit(0), 5000);\n`)
    const command = `node ${quoteStartupArg(script, process.platform === 'win32' ? 'powershell' : 'posix')}`
    const folderPath = testInfo.outputPath('folder-workspace')
    mkdirSync(folderPath, { recursive: true })
    const name = `Saved result ${mode}`
    const automationId = await orcaPage.evaluate(
      async ({ command, folderPath, mode, name }) => {
        const store = window.__store!
        let workspaceId = store.getState().activeWorktreeId!
        if (mode === 'folder') {
          const added = await window.api.repos.add({
            path: folderPath,
            kind: 'folder',
            displayName: name
          })
          if ('error' in added) {
            throw new Error(added.error)
          }
          await store.getState().fetchRepos()
          await store.getState().fetchWorktrees(added.repo.id)
          workspaceId = store.getState().worktreesByRepo[added.repo.id]?.[0]?.id ?? ''
          if (!workspaceId) {
            throw new Error('Folder workspace missing')
          }
        }
        await store.getState().updateSettings({ agentCmdOverrides: { codex: command } })
        const created = await window.api.runtime.call({
          method: 'automation.create',
          params: {
            name,
            prompt: 'Check saved output',
            agentId: 'codex',
            workspace: `id:${workspaceId}`,
            workspaceMode: 'existing',
            enabled: false,
            timezone: 'UTC',
            rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
            dtstart: Date.now()
          }
        })
        if (!created.ok) {
          throw new Error(created.error.message)
        }
        const data = created.result
        if (
          !data ||
          typeof data !== 'object' ||
          !('automation' in data) ||
          !data.automation ||
          typeof data.automation !== 'object' ||
          !('id' in data.automation) ||
          typeof data.automation.id !== 'string'
        ) {
          throw new Error('Automation create returned no ID')
        }
        const started = await window.api.runtime.call({
          method: 'automation.runNow',
          params: { id: data.automation.id }
        })
        if (!started.ok) {
          throw new Error(started.error.message)
        }
        return data.automation.id
      },
      { command, folderPath, mode, name }
    )
    const readRun = async () => {
      const raw = await orcaPage.evaluate(async (id) => {
        const response = await window.api.runtime.call({
          method: 'automation.runs',
          params: { automationId: id }
        })
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        const result = response.result
        if (!result || typeof result !== 'object' || !('runs' in result)) {
          return null
        }
        return Array.isArray(result.runs) ? (result.runs[0] ?? null) : null
      }, automationId)
      const parsed = Run.safeParse(raw)
      return parsed.success ? parsed.data : null
    }
    await expect
      .poll(async () => (await readRun())?.terminalPaneKey, { timeout: 30_000 })
      .toBeTruthy()
    const run = await readRun()
    if (!run?.terminalPaneKey) {
      throw new Error('Run terminal identity did not load')
    }
    const terminalTabId = run.terminalPaneKey.split(':')[0]
    await orcaPage.evaluate((id) => window.__store!.getState().closeUnifiedTab(id), terminalTabId)
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (id) =>
            Object.values(window.__store!.getState().unifiedTabsByWorktree)
              .flat()
              .some((tab) => tab.id === id),
          terminalTabId
        )
      )
      .toBe(false)

    const counts = () =>
      orcaPage.evaluate(async (id) => {
        const state = window.__store!.getState()
        const ptys = await window.api.pty.listSessions()
        const response = await window.api.runtime.call({
          method: 'automation.runs',
          params: { automationId: id }
        })
        const result = response.ok ? response.result : null
        return {
          ptys: ptys.length,
          agents: Object.values(state.unifiedTabsByWorktree)
            .flat()
            .filter((tab) => tab.contentType === 'agent-session').length,
          runs:
            result && typeof result === 'object' && 'runs' in result && Array.isArray(result.runs)
              ? result.runs.length
              : -1
        }
      }, automationId)
    const before = await counts()
    const openFromHistory = async () => {
      await orcaPage.evaluate(() => window.__store!.getState().openAutomationsPage())
      await orcaPage.getByRole('main').getByText(name, { exact: true }).first().click()
      await orcaPage.getByRole('tab', { name: /^Runs/ }).click()
      await orcaPage.locator('[data-automation-run-id]').first().click()
      await orcaPage.getByRole('button', { name: 'Open workspace', exact: true }).click()
    }
    await openFromHistory()
    await expect(orcaPage.getByText('No saved output is available for this run.')).toBeVisible()
    const resultTabId = await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      const file = state.openFiles.find((entry) => entry.mode === 'automation-run')
      if (!file) {
        throw new Error('Saved result tab did not open')
      }
      return file.id
    })
    expect(await counts()).toEqual(before)
    await openFromHistory()
    await expect(orcaPage.getByText('No saved output is available for this run.')).toBeVisible()
    await orcaPage.evaluate(
      ({ id, marker }) => {
        window.__store!.setState((state) => ({
          openFiles: state.openFiles.map((file) =>
            file.id === id && file.automationRun
              ? {
                  ...file,
                  automationRun: {
                    ...file.automationRun,
                    status: 'completed',
                    outputSnapshot: {
                      format: 'plain_text',
                      content: marker,
                      capturedAt: Date.now(),
                      truncated: true
                    }
                  }
                }
              : file
          )
        }))
      },
      { id: resultTabId, marker }
    )
    await expect(orcaPage.getByText(marker)).toBeVisible()
    await expect(
      orcaPage.getByText('Saved output was truncated. This is not the full conversation.')
    ).toBeVisible()
    expect(await counts()).toEqual(before)
    expect(
      await orcaPage.evaluate((id) => {
        const state = window.__store!.getState()
        return {
          files: state.openFiles.filter((file) => file.id === id).length,
          tabs: Object.values(state.unifiedTabsByWorktree)
            .flat()
            .filter((tab) => tab.entityId === id).length
        }
      }, resultTabId)
    ).toEqual({ files: 1, tabs: 1 })
    if (mode === 'git') {
      const resultTab = orcaPage.locator('[data-tab-id]').filter({ hasText: run.title })
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
      await orcaPage.keyboard.press(`${mod}+Alt+BracketLeft`)
      await expect(resultTab).toHaveAttribute('data-active', 'false')
      await orcaPage.keyboard.press(`${mod}+Alt+BracketRight`)
      await expect(resultTab).toHaveAttribute('data-active', 'true')
    }
    const persistedResult = await orcaPage.evaluate(async (id) => {
      await window.api.session.flush()
      const session = await window.api.session.get()
      return (
        Object.values(session.unifiedTabs ?? {})
          .flat()
          .some((tab) => tab.entityId === id) ||
        Object.values(session.openFilesByWorktree ?? {})
          .flat()
          .some((file) => file.filePath === id)
      )
    }, resultTabId)
    expect(persistedResult).toBe(false)
    const cdp = await orcaPage.context().newCDPSession(orcaPage)
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(
      testInfo.outputPath(`saved-run-${mode}.png`),
      Buffer.from(screenshot.data, 'base64')
    )
    await cdp.detach()
    const tab = orcaPage.locator(`[data-tab-id][data-active="true"]`).filter({ hasText: run.title })
    await tab.locator('[data-tab-close-button]').click()
    await expect(
      orcaPage.locator(`[data-tab-id][data-active="true"]`).filter({ hasText: run.title })
    ).toHaveCount(0)
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (id) => window.__store!.getState().openFiles.some((file) => file.id === id),
          resultTabId
        )
      )
      .toBe(false)
    expect(await counts()).toEqual(before)
  })
}
