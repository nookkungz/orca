import { z } from 'zod'

export const CodexTeamModelsParams = z.object({})

export const CodexTeamShowParams = z.object({ tabId: z.string().min(1) })

export const CodexTeamPrepareLaunchParams = z.object({
  paneKey: z.string().min(1),
  codexCommand: z.string().min(1),
  codexHome: z.string().nullable(),
  wslDistro: z.string().nullable().default(null),
  cwd: z.string().min(1),
  args: z.array(z.string())
})
