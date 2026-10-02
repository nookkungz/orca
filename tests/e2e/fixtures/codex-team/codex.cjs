const { execFile } = require('node:child_process')
const path = require('node:path')
const { createInterface } = require('node:readline')
const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  process.stdout.write('codex-cli 0.159.0\n')
  process.exit(0)
}
const model = argv.includes('-m') ? argv[argv.indexOf('-m') + 1] : 'team-quality'
const modelConfig = argv.find((v) => v.startsWith('model='))
const effortConfig = argv.find((v) => v.startsWith('model_reasoning_effort='))
const selectedModel = modelConfig ? JSON.parse(modelConfig.slice(6)) : model
const effort = effortConfig ? effortConfig.split('=')[1].replaceAll('"', '') : 'high'
if (argv.includes('app-server')) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line)
    if (request.id === undefined) {
      return
    }
    const result =
      request.method === 'model/list'
        ? {
            data: ['team-quality', 'team-fast'].map((model, index) => ({
              id: model,
              model,
              displayName: model,
              hidden: false,
              isDefault: index === 0,
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: ['medium', 'high', 'xhigh'].map((reasoningEffort) => ({
                reasoningEffort,
                description: reasoningEffort
              }))
            })),
            nextCursor: null
          }
        : request.method === 'config/read'
          ? {
              config: { model: selectedModel, model_reasoning_effort: effort }
            }
          : { userAgent: 'codex-team-fixture' }
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`)
  })
} else {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  const ready = () => process.stdout.write('\x1b]0;Codex done\x07')
  process.stdout.write(`CODEX_TEAM_FIXTURE_READY ${selectedModel} / ${effort}\n`)
  const initial = argv.at(-1)
  if (initial?.includes('You lead Orca Codex Team')) {
    process.stdout.write('LEADER_INITIAL_PROMPT_ONCE\n')
  }
  ready()
  let input = ''
  process.stdin.on('data', (chunk) => {
    input += chunk.toString()
    if (input.includes('\x03')) {
      process.exit(0)
    }
    if (input.includes('\r')) {
      process.stdout.write('\x1b]0;Codex working\x07TEAM_DISPATCH_INPUT\n')
      const taskId = /--task-id (\S+)/.exec(input)?.[1]
      const dispatchId = /--dispatch-id (\S+)/.exec(input)?.[1]
      const capability = /--dispatch-capability (\S+)/.exec(input)?.[1]
      const from = /--from (\S+)/.exec(input)?.[1]
      input = ''
      if (taskId && dispatchId && capability && from) {
        setTimeout(() => {
          const guest = process.platform === 'linux' && process.env.WSL_DISTRO_NAME
          execFile(
            guest ? path.join(__dirname, 'orca-dev') : process.execPath,
            [
              ...(guest ? [] : [path.resolve(__dirname, '../../../../out/cli/index.js')]),
              'orchestration',
              'send',
              '--from',
              from,
              '--dispatch-capability',
              capability,
              '--type',
              'worker_done',
              '--subject',
              'Fixture complete',
              '--body',
              'Read the assigned input. Verified the result. Ready for another task.',
              '--task-id',
              taskId,
              '--dispatch-id',
              dispatchId,
              '--outcome',
              'succeeded',
              '--json'
            ],
            (error) => {
              process.stdout.write(
                error ? `TEAM_REPORT_ERROR ${error.message}\n` : 'TEAM_WORKER_DONE\n'
              )
              ready()
            }
          )
        }, 1500)
      } else {
        setTimeout(ready, 1200)
      }
    }
  })
  setInterval(ready, 5000)
}
