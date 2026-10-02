import { z } from 'zod'
import { resolveCodexCommand } from '../codex-cli/command'
import { buildWslCodexAppServerArgs } from '../codex-accounts/wsl-codex-command'
import { runCodexAppServerSession } from './codex-app-server-session'
import { readCodexStructuredSessionOptionCatalog } from './codex-structured-model-catalog'
import type { ExactWorkerProviderSession } from '../../shared/orchestration-worker-output'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import { readTranscriptSlice, wslGatedStat } from '../native-chat/wsl-transcript-fs-access'

const reportedTurn = z.object({
  type: z.literal('turn_context'),
  payload: z.object({ model: z.string().min(1), effort: z.string().min(1) })
})

export async function readCodexTeamReportedSelection(session: ExactWorkerProviderSession | null) {
  if (!session || session.agent !== 'codex') {
    return null
  }
  const file = await resolveSessionFilePath('codex', session.providerSession.id, {
    transcriptPath: session.providerSession.transcriptPath,
    wslDistro: session.wslDistro
  })
  if (!file) {
    return null
  }
  const size = (await wslGatedStat(file, 'exact')).size
  // ponytail: bound each UI probe to 1 MiB; older turn metadata remains unconfirmed until another turn reports it.
  const start = Math.max(0, size - 1024 * 1024)
  const lines = (await readTranscriptSlice(file, start, size - start, 'exact'))
    .toString('utf8')
    .split('\n')
  for (const line of lines.slice(start ? 1 : 0).toReversed()) {
    if (!line.includes('turn_context')) {
      continue
    }
    try {
      const parsed = reportedTurn.safeParse(JSON.parse(line))
      if (parsed.success) {
        return parsed.data.payload
      }
    } catch {
      // A partially written final record is not confirmation.
    }
  }
  return null
}

export async function readCodexTeamCatalog(input: {
  cwd: string
  codexHome: string | null
  codexCommand?: string | null
  commandArgs?: string[]
  wslDistro: string | null
  config?: string[]
}) {
  const cliPath = input.wslDistro ? null : (input.codexCommand ?? resolveCodexCommand())
  if (input.wslDistro && !input.codexHome) {
    throw new Error('Cannot establish the team Codex home in WSL.')
  }
  const args = [...(input.commandArgs ?? []), ...(input.config ?? []), 'app-server']
  return runCodexAppServerSession(
    {
      command: input.wslDistro ? 'wsl.exe' : cliPath!,
      cliPath,
      args: input.wslDistro
        ? buildWslCodexAppServerArgs(
            input.wslDistro,
            input.codexHome!,
            args,
            input.codexCommand ?? undefined
          )
        : args,
      ...(input.codexHome && !input.wslDistro ? { env: { CODEX_HOME: input.codexHome } } : {}),
      ...(!input.codexHome && !input.wslDistro ? { envToDelete: ['CODEX_HOME'] } : {}),
      timeoutMs: 30_000
    },
    async (connection) => {
      const config = z
        .object({
          config: z
            .object({
              model: z.string().nullish(),
              model_reasoning_effort: z.string().nullish()
            })
            .passthrough()
        })
        .parse(await connection.request('config/read', { cwd: input.cwd, includeLayers: false }))
      // Membership must come from model/list, not the reader's synthetic current-model row.
      const { result } = await readCodexStructuredSessionOptionCatalog({ connection, current: {} })
      const model = config.config.model ?? result.current.model
      const selected = result.models.find((entry) => entry.id === model)
      return {
        models: result.models,
        model,
        effort: config.config.model_reasoning_effort ?? selected?.defaultEffort ?? 'medium'
      }
    }
  )
}
