import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const env = { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
const read = (command, args) =>
  execFileSync(command, args, { cwd: root, env, encoding: 'utf8' }).trim()
const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })

if (process.platform !== 'darwin') {
  throw new Error('Personal packaging currently targets macOS.')
}
if (process.versions.node.split('.')[0] !== '24') {
  throw new Error('Use Node 24.')
}
if (read('git', ['status', '--porcelain'])) {
  throw new Error('Commit or stash pending work before updating.')
}
if (read('git', ['branch', '--show-current']) !== 'personal/automation-models') {
  throw new Error('Switch to personal/automation-models before updating.')
}
const tag = read('gh', ['api', 'repos/stablyai/orca/releases/latest', '--jq', '.tag_name'])
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Unexpected stable release tag: ${tag}`)
}
run('git', ['fetch', 'upstream', `refs/tags/${tag}:refs/tags/${tag}`])
// A failed merge leaves Git's conflict state for review; nothing is installed automatically.
run('git', ['merge', '--no-edit', tag])
run('pnpm', ['install', '--frozen-lockfile'])
run('pnpm', ['tc'])
run('pnpm', ['run', 'check:code-quality:changed', tag])
run('pnpm', [
  'test',
  'src/shared/automation-launch-preferences.test.ts',
  'src/cli/handlers/automation-launch-preferences-flags.test.ts',
  'src/main/persistence-automations.test.ts',
  'src/shared/tui-agent-startup-session-options.test.ts',
  'src/main/automations/headless-workspace-create.test.ts',
  'src/main/runtime/rpc/methods/automations.test.ts'
])
run('pnpm', [
  'exec',
  'playwright',
  'test',
  'tests/e2e/automation-model-preferences.spec.ts',
  'tests/e2e/automation-model-launch.spec.ts',
  '--config',
  'tests/playwright.config.ts',
  '--project',
  'electron-headless',
  '--workers=1'
])
run('pnpm', ['personal:build'])
console.log(`Built ${tag} with personal patches in dist/. Review and install the package manually.`)
