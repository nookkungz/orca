import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { quoteStartupArg } from '../../src/shared/tui-agent-startup-shell'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('sidebar counts fresh idle agent tabs before any prompt and removes closed tabs', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const script = testInfo.outputPath('idle-agent.mjs')
  mkdirSync(dirname(script), { recursive: true })
  writeFileSync(
    script,
    "console.log('\\x1b]0;workspace\\x07IDLE_AGENT_READY'); setInterval(() => {}, 1000);\n"
  )
  const command = `node ${quoteStartupArg(script, process.platform === 'win32' ? 'powershell' : 'posix')}`
  await orcaPage.evaluate(async (command) => {
    await window.__store!.getState().updateSettings({
      experimentalStructuredNativeChat: false,
      agentCmdOverrides: { codex: command },
      agentDefaultArgs: { codex: '' }
    })
    window.__store!.setState({ agentActivityDisplayMode: 'compact' })
  }, command)
  const handles: string[] = []
  for (let i = 0; i < 2; i++) {
    const result = await orcaPage.evaluate(async () => {
      const response = await window.api.runtime.call({
        method: 'agent.launch',
        params: {
          agent: 'codex',
          target: {
            kind: 'existing',
            worktree: `id:${window.__store!.getState().activeWorktreeId}`
          }
        }
      })
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      return response.result
    })
    handles.push(
      z
        .object({ outcome: z.object({ kind: z.literal('terminal'), handle: z.string() }) })
        .parse(result).outcome.handle
    )
  }
  await expect(orcaPage.getByRole('button', { name: /All 2 agents idle/ })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('idle-agents.png') })
  for (const terminal of handles) {
    await orcaPage.evaluate(async (terminal) => {
      const response = await window.api.runtime.call({
        method: 'terminal.closeTab',
        params: { terminal }
      })
      if (!response.ok) {
        throw new Error(response.error.message)
      }
    }, terminal)
  }
  await expect(orcaPage.getByRole('button', { name: /All 2 agents idle/ })).toHaveCount(0)
})
