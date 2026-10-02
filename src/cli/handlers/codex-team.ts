import { homedir } from 'node:os'
import { stdioForWindowsInteractiveChild } from '../../shared/windows-console-input'
import { join } from 'node:path'
import { spawnProcess } from '../../shared/child-process/run-process'
import { resolveCodexCommand, withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { parseCodexTeamLaunchArgs } from '../../shared/codex-team-launch-args'
import { stripElectronRunAsNode } from '../runtime/launch'
import type { CommandHandler } from '../dispatch'
import { CODEX_TEAM_RUNTIME_CAPABILITY } from '../../shared/codex-team'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { buildWslExecArgs } from '../../shared/wsl-login-shell-command'

export const runCodexTeam: CommandHandler = async ({ client, rawArgs, cwd }) => {
  const paneKey = process.env.ORCA_PANE_KEY
  if (!paneKey) {
    throw new Error('Codex Team must run inside an Orca terminal.')
  }
  const bridgedWsl =
    process.platform === 'win32' ? process.env.ORCA_CODEX_TEAM_GUEST_DISTRO : undefined
  const wslDistro =
    bridgedWsl ?? (process.platform === 'linux' ? process.env.WSL_DISTRO_NAME : undefined)
  const codexCommand = bridgedWsl
    ? process.env.ORCA_CODEX_TEAM_GUEST_COMMAND
    : resolveCodexCommand()
  const codexHome = bridgedWsl
    ? process.env.ORCA_CODEX_TEAM_GUEST_HOME
    : (process.env.CODEX_HOME ?? join(homedir(), '.codex'))
  const launchCwd = bridgedWsl ? process.env.ORCA_CODEX_TEAM_GUEST_CWD : cwd
  if (
    !codexCommand ||
    !codexHome ||
    !launchCwd ||
    (wslDistro && ![codexCommand, codexHome, launchCwd].every((value) => value.startsWith('/')))
  ) {
    throw new Error(
      'The WSL Codex Team launch context is incomplete. Repair the Orca CLI registration.'
    )
  }
  const { args } = parseCodexTeamLaunchArgs(rawArgs ?? [])
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(CODEX_TEAM_RUNTIME_CAPABILITY)) {
    throw new Error('This execution host does not support Codex Team. Update the host first.')
  }
  const { result } = await client.call<{
    runId: string
    model: string
    effort: string
    prompt: string
  }>('codexTeam.prepareLaunch', {
    paneKey,
    codexCommand,
    codexHome,
    wslDistro: wslDistro ?? null,
    cwd: launchCwd,
    args: rawArgs ?? []
  })
  process.stdout.write(
    `Codex Team · Leader · requested ${result.model} / ${result.effort}\nRun ${result.runId}\n`
  )
  const codexArgs = [
    ...args,
    '-c',
    `model=${JSON.stringify(result.model)}`,
    '-c',
    `model_reasoning_effort=${result.effort}`,
    '-c',
    'agents.enabled=false',
    result.prompt
  ]
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const consoleStdio = stdioForWindowsInteractiveChild(false)
    let child: ReturnType<typeof spawnProcess>
    try {
      child = spawnProcess({
        program: bridgedWsl ? 'wsl.exe' : codexCommand,
        args: bridgedWsl
          ? buildWslExecArgs(bridgedWsl, [
              'sh',
              '-c',
              'cd "$1" || exit 1; shift; exec "$@"',
              'orca-codex-team',
              launchCwd,
              'env',
              `CODEX_HOME=${codexHome}`,
              codexCommand,
              ...codexArgs
            ])
          : codexArgs,
        // The Windows interop cwd can be a UNC guest directory; wsl.exe needs a stable host cwd.
        cwd: bridgedWsl ? (process.env.ORCA_USER_DATA_PATH ?? process.cwd()) : launchCwd,
        env: bridgedWsl
          ? stripElectronRunAsNode(process.env)
          : withCliRuntimeOnPath(codexCommand, stripElectronRunAsNode(process.env)),
        stdio: consoleStdio.stdio
      })
    } finally {
      consoleStdio.dispose()
    }
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}
