export function parseCodexTeamLaunchArgs(argv: readonly string[]): {
  args: string[]
  config: string[]
  prompt: string
} {
  const args: string[] = []
  const config: string[] = []
  let prompt = ''
  let hasPrompt = false
  for (let index = 0; index < argv.length; index++) {
    let arg = argv[index]!
    const attached = /^(-[cmCap])=?(.+)$/.exec(arg)
    if (attached) {
      // Normalize Clap's short attached values before checking the execution boundary.
      arg = attached[1]!
    }
    if (arg === '--orca-team-prompt') {
      if (hasPrompt || argv[index + 1] === undefined) {
        throw new Error('Invalid team prompt')
      }
      prompt = argv[++index]!
      hasPrompt = true
      continue
    }
    if (
      [
        '--remote',
        '--remote-auth-token-env',
        '--oss',
        '--local-provider',
        '--cd',
        '-C',
        '--worktree',
        '--profile',
        '-p'
      ].some((flag) => arg === flag || arg.startsWith(`${flag}=`))
    ) {
      throw new Error(`Codex Team cannot use ${arg}; choose the workspace and account in Orca.`)
    }
    if (!arg.startsWith('-') || ['--', '--help', '-h', '--version', '-V'].includes(arg)) {
      throw new Error(
        'Pass the first team task with --orca-team-prompt; Codex subcommands and resumed sessions cannot start a team.'
      )
    }
    args.push(arg)
    if (arg === '-c' || arg === '--config' || arg === '-m' || arg === '--model') {
      const value = attached?.[2] ?? argv[++index]
      if (!value) {
        throw new Error(`Missing value for ${arg}`)
      }
      args.push(value)
      config.push(
        '-c',
        arg === '-m' || arg === '--model' ? `model=${JSON.stringify(value)}` : value
      )
    } else if (
      [
        '-s',
        '--sandbox',
        '-a',
        '--ask-for-approval',
        '-i',
        '--image',
        '--add-dir',
        '--enable',
        '--disable'
      ].includes(arg)
    ) {
      const value = attached?.[2] ?? argv[++index]
      if (!value) {
        throw new Error(`Missing value for ${arg}`)
      }
      args.push(value)
    } else if (arg.startsWith('--model=')) {
      config.push('-c', `model=${JSON.stringify(arg.slice(8))}`)
    } else if (arg.startsWith('--config=')) {
      config.push('-c', arg.slice(9))
    } else if (attached) {
      throw new Error(`Unsupported Codex Team option: ${argv[index]}`)
    }
  }
  return { args, config, prompt }
}
