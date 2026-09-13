import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { quoteStartupArg } from '../../src/shared/tui-agent-startup-shell'

test('Run Now and scheduled model overrides launch fresh processes in both workspace modes', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const log = testInfo.outputPath('launches.jsonl')
  const script = testInfo.outputPath('agent.mjs')
  mkdirSync(dirname(script), { recursive: true })
  writeFileSync(log, '')
  writeFileSync(
    script,
    `import { appendFileSync } from 'node:fs';
const launch = { pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2) };
appendFileSync(${JSON.stringify(log)}, JSON.stringify(launch) + '\\n');
console.log('AUTOMATION_MODEL_LAUNCH', JSON.stringify(launch));
setTimeout(() => process.exit(0), 500);
`
  )
  const command = `node ${quoteStartupArg(script, process.platform === 'win32' ? 'powershell' : 'posix')}`
  const ids = await orcaPage.evaluate(async (command) => {
    const store = window.__store!
    await store.getState().updateSettings({
      agentCmdOverrides: { codex: command, antigravity: command },
      agentDefaultArgs: {
        codex: '-m obsolete -c model_reasoning_effort=high',
        antigravity: '--model obsolete'
      }
    })
    const repo = store.getState().repos[0]!
    const workspace = store.getState().activeWorktreeId!
    const ids: string[] = []
    for (const agentId of ['codex', 'antigravity']) {
      for (const workspaceMode of ['existing', 'new_per_run']) {
        const response = await window.api.runtime.call({
          method: 'automation.create',
          params: {
            name: `Launch ${agentId} ${workspaceMode}`,
            prompt: 'Reply OK',
            agentId,
            ...(workspaceMode === 'existing'
              ? { workspace: `id:${workspace}` }
              : { repo: `id:${repo.id}` }),
            workspaceMode,
            enabled: false,
            timezone: 'UTC',
            rrule: '* * * * *',
            dtstart: Date.now(),
            launchPreferences:
              agentId === 'codex'
                ? { model: 'gpt-5.6-terra', effort: 'low' }
                : { model: 'gemini-3.8-flash-high' }
          }
        })
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        ids.push((response.result as { automation: { id: string } }).automation.id)
      }
    }
    return ids
  }, command)
  const launches = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { pid: number; cwd: string; argv: string[] })
  for (let index = 0; index < ids.length; index++) {
    for (let round = 0; round < 2; round++) {
      await orcaPage.evaluate(async (id) => {
        const response = await window.api.runtime.call({
          method: 'automation.runNow',
          params: { id }
        })
        if (!response.ok) {
          throw new Error(response.error.message)
        }
      }, ids[index])
      await expect.poll(() => launches().length, { timeout: 30_000 }).toBe(index * 2 + round + 1)
    }
  }
  const manual = launches()
  expect(new Set(manual.map((launch) => launch.pid)).size).toBe(8)
  for (const launch of manual) {
    expect(launch.argv).not.toContain('obsolete')
    if (launch.argv.includes('gpt-5.6-terra')) {
      expect(launch.argv).toContain('model_reasoning_effort=low')
      expect(launch.argv).not.toContain('model_reasoning_effort=high')
    } else {
      expect(launch.argv).toContain('gemini-3.8-flash-high')
    }
  }
  expect(manual[0].cwd).toBe(manual[1].cwd)
  expect(manual[2].cwd).not.toBe(manual[3].cwd)
  await orcaPage.evaluate(async (id) => {
    const response = await window.api.runtime.call({
      method: 'automation.update',
      params: { id, updates: { enabled: true } }
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
  }, ids[0])
  await expect.poll(() => launches().length, { timeout: 80_000 }).toBeGreaterThan(8)
  await orcaPage.evaluate(async (id) => {
    await window.api.runtime.call({
      method: 'automation.update',
      params: { id, updates: { enabled: false } }
    })
    window.__store!.getState().openAutomationsPage()
  }, ids[0])
  expect(launches()[8].argv).toContain('gpt-5.6-terra')
  expect(launches()[8].argv).toContain('model_reasoning_effort=low')
  expect(new Set(launches().map((launch) => launch.pid)).size).toBe(launches().length)
  await expect(orcaPage.getByText('Launch codex existing', { exact: true })).toBeVisible()
})
