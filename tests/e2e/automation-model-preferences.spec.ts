import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('edits and clears saved automation model preferences in a hidden renderer', async ({
  orcaPage
}) => {
  // Hidden Windows renderers do not advance the frames used by click stability checks.
  const clickOptions = { force: process.platform === 'win32' }
  await waitForSessionReady(orcaPage)
  await orcaPage.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }'
  })
  await orcaPage.evaluate(async () => {
    const store = window.__store!
    const repo = store.getState().repos[0]!
    const result = await window.api.runtime.call({
      method: 'automation.create',
      params: {
        name: 'Personal model check',
        prompt: 'Reply OK',
        agentId: 'codex',
        repo: `id:${repo.id}`,
        workspaceMode: 'new_per_run',
        enabled: false,
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstart: Date.now(),
        launchPreferences: { model: 'gpt-5.6-terra', effort: 'low' }
      }
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    store.getState().openAutomationsPage()
  })
  await orcaPage.getByText('Personal model check', { exact: true }).first().click(clickOptions)
  await expect(orcaPage.getByText('gpt-5.6-terra · low', { exact: true })).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Edit automation', exact: true }).click(clickOptions)
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog.getByLabel('Automation model')).toContainText('gpt-5.6-terra')
  await expect(dialog.getByLabel('Automation effort')).toContainText('Low')
  await expect(dialog.getByText('Fresh session every run')).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'Reuse', exact: true })).toBeDisabled()
  await dialog.getByLabel('Automation effort').click(clickOptions)
  await orcaPage.getByRole('option', { name: 'High', exact: true }).click(clickOptions)
  await expect(dialog.getByRole('button', { name: /save/i })).toBeVisible()
  await dialog.getByRole('button', { name: /save/i }).click(clickOptions)
  await expect(orcaPage.getByText('gpt-5.6-terra · high', { exact: true })).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Edit automation', exact: true }).click(clickOptions)
  await dialog.getByLabel('Automation model').click(clickOptions)
  await orcaPage.getByRole('option', { name: 'Use agent default', exact: true }).click(clickOptions)
  await expect(dialog.getByLabel('Automation effort')).toHaveCount(0)
  await dialog.getByRole('button', { name: /save/i }).click(clickOptions)
  await orcaPage.getByRole('button', { name: 'Edit automation', exact: true }).click(clickOptions)
  await expect(dialog.getByLabel('Automation model')).toContainText('Use agent default')
  await orcaPage.screenshot({ path: 'test-results/personal-automation-model.png' })
})
