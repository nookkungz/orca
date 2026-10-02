import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import type { OrchestrationWorkerReadResult } from '../../../../shared/orchestration-worker-output'

export function CodexTeamHistory({
  worktreeId,
  role,
  dispatches
}: {
  worktreeId: string
  role: string
  dispatches: string[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [read, setRead] = useState<OrchestrationWorkerReadResult | null>(null)
  const [error, setError] = useState('')
  const environmentId = useAppStore((state) =>
    getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  )
  const dispatch = selected || dispatches[0]
  useEffect(() => {
    if (!open || !dispatch) {
      return
    }
    const controller = new AbortController()
    setRead(null)
    setError('')
    void callRuntimeRpc<OrchestrationWorkerReadResult>(
      environmentId ? { kind: 'environment', environmentId } : { kind: 'local' },
      'orchestration.workerRead',
      { dispatch, cursor, limit: 200 },
      { signal: controller.signal, suppressFeatureInteraction: true }
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setRead(result)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => controller.abort()
  }, [open, dispatch, cursor, environmentId])
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`${role} history`}
        onClick={() => setOpen(true)}
      >
        <History />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{role} history</DialogTitle>
            <DialogDescription>
              Saved conversations and task output remain available after replacing a member.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-sm">
            Task session
            <select
              className="w-full rounded-md border border-input bg-background p-2"
              value={dispatch}
              onChange={(event) => {
                setSelected(event.target.value)
                setCursor(undefined)
              }}
            >
              {dispatches.map((id, index) => (
                <option key={id} value={id}>
                  {index === 0 ? 'Current task' : `Previous task ${index}`}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p role="alert">{error}</p>
          ) : !read ? (
            <p role="status">Loading history…</p>
          ) : (
            <>
              {read.source === 'terminal' ? (
                <pre className="scrollbar-sleek min-h-0 overflow-auto whitespace-pre-wrap text-xs">
                  {[...read.terminal.tail, read.terminal.draft ?? ''].join('\n')}
                </pre>
              ) : (
                <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
                  <NativeChatMessageList
                    session={{
                      agent: read.provider,
                      sessionId: null,
                      status: 'ready',
                      messages: read.transcript.messages,
                      hasMore: false,
                      loadingEarlier: false,
                      loadEarlier: () => undefined,
                      readPhase: 'ready'
                    }}
                    isWorking={false}
                    expandSignal={false}
                    fontScale={1}
                    showTurnStatus={false}
                  />
                </div>
              )}
              {read.contentComplete === false && (
                <p className="text-xs text-muted-foreground">
                  This is the saved output available for this task; some earlier content may be
                  omitted.
                </p>
              )}
              {read.cursor && (read.source === 'terminal' || read.transcript.limited) && (
                <Button variant="outline" onClick={() => setCursor(read.cursor ?? undefined)}>
                  Next page
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
