import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { Repo } from '../../../../shared/repo-types'
import { Field } from './automation-page-parts'
import type { AutomationDraft } from './AutomationEditorDialog'
import type { AutomationCreateDestinationControl } from './use-automation-create-destination'

type Model = { id: string; label: string }

export function AutomationModelField({
  draft,
  repo,
  destination,
  onDraftChange
}: {
  draft: AutomationDraft
  repo?: Repo
  destination?: AutomationCreateDestinationControl
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}): React.JSX.Element | null {
  const [models, setModels] = useState<Model[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false)
  const supported = draft.agentId === 'codex' || draft.agentId === 'antigravity'
  const resolution = destination?.resolution
  const environmentId =
    resolution?.status === 'ready' && resolution.authority.kind === 'runtime'
      ? resolution.authority.environmentId
      : undefined
  const ready = resolution?.status === 'ready'
  const connectionId = repo?.connectionId ?? undefined
  const path = repo?.path
  useEffect(() => {
    let cancelled = false
    setModels([])
    setError(null)
    if (!supported || !ready || !path) {
      return
    }
    setLoading(true)
    const discover = environmentId
      ? callRuntimeRpc<Awaited<ReturnType<typeof window.api.git.discoverCommitMessageModels>>>(
          { kind: 'environment', environmentId },
          'git.discoverCommitMessageModels',
          { worktree: `path:${path}`, agentId: draft.agentId },
          { timeoutMs: 75_000 }
        )
      : window.api.git.discoverCommitMessageModels({
          agentId: draft.agentId,
          worktreePath: path,
          connectionId
        })
    void discover
      .then((result) => {
        if (cancelled) {
          return
        }
        if (!result.success) {
          throw new Error(result.error)
        }
        if (result.models.length === 0) {
          throw new Error('No models reported by this host.')
        }
        setModels(result.models)
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [supported, ready, path, connectionId, environmentId, draft.agentId, retry])
  if (!supported) {
    return null
  }
  const model = draft.launchPreferences?.model
  const catalog = getAgentSessionOptionCatalog(draft.agentId)
  const effort = (
    catalog?.models.find((entry) => entry.id === model)?.options ?? catalog?.unknownModelOptions
  )?.find((entry) => entry.id === 'effort')
  const available =
    model && !models.some((entry) => entry.id === model)
      ? [{ id: model, label: model }, ...models]
      : models
  return (
    <div className="flex flex-col gap-3">
      <Field label="Model">
        <Select
          value={model ?? 'agent-default'}
          onValueChange={(value) =>
            onDraftChange((current) => ({
              ...current,
              launchPreferences: value === 'agent-default' ? null : { model: value },
              reuseSession: value === 'agent-default' ? current.reuseSession : false
            }))
          }
        >
          <SelectTrigger className="w-full" aria-label="Automation model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent-default">Use agent default</SelectItem>
            {available.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {model && draft.agentId === 'codex' && effort?.kind.type === 'select' ? (
        <Field label="Effort">
          <Select
            value={draft.launchPreferences?.effort ?? 'agent-default'}
            onValueChange={(value) =>
              onDraftChange((current) => ({
                ...current,
                launchPreferences: {
                  model,
                  ...(value === 'agent-default' ? {} : { effort: value })
                }
              }))
            }
          >
            <SelectTrigger className="w-full" aria-label="Automation effort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent-default">Use agent default</SelectItem>
              {effort.kind.choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {model ? <p className="text-xs text-muted-foreground">Fresh session every run</p> : null}
      {!ready ? (
        <p className="text-xs text-muted-foreground">Choose a host and project to load models.</p>
      ) : null}
      {loading ? <p className="text-xs text-muted-foreground">Loading models from host…</p> : null}
      {error ? (
        <div role="alert" className="text-xs text-destructive">
          {error}
          <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  )
}
