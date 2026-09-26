import { Badge } from '@/components/ui/badge'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { translate } from '@/i18n/i18n'
import { runtimeHostConnectionStateForEntry } from '@/runtime/runtime-host-connection-state'
import { useAppStore } from '@/store'
import type { AutomationRun } from '../../../../shared/automations-types'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import {
  formatAutomationDateTime,
  getAutomationRunStatusLabel,
  getAutomationRunStatusVariant
} from './automation-page-parts'
import { getAutomationRunContent } from './automation-run-content'

export function AutomationRunResultTab({
  run,
  hostId
}: {
  run: AutomationRun
  hostId: ExecutionHostId
}): React.JSX.Element {
  const host = parseExecutionHostId(hostId)
  const runtimeEntry = useAppStore((state) =>
    host?.kind === 'runtime' ? state.runtimeStatusByEnvironmentId.get(host.environmentId) : null
  )
  const sshStatus = useAppStore((state) =>
    host?.kind === 'ssh' ? state.sshConnectionStates.get(host.targetId)?.status : undefined
  )
  const hostUnverified =
    host?.kind === 'runtime'
      ? runtimeHostConnectionStateForEntry(runtimeEntry) !== 'connected'
      : host?.kind === 'ssh'
        ? sshStatus !== 'connected'
        : false
  const savedOutput = run.outputSnapshot?.content.trim()
  const content = savedOutput
    ? (run.outputSnapshot?.content ?? savedOutput)
    : run.precheckResult || run.error || run.usage?.unavailableMessage
      ? getAutomationRunContent(run)
      : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium text-foreground">{run.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {translate('automation.runScheduledFor', 'Scheduled')}{' '}
            {formatAutomationDateTime(run.scheduledFor)}
            {run.startedAt
              ? ` · ${translate('automation.runStartedAt', 'Started')} ${formatAutomationDateTime(run.startedAt)}`
              : ''}
          </p>
        </div>
        <Badge variant={getAutomationRunStatusVariant(run.status)}>
          {getAutomationRunStatusLabel(run.status)}
        </Badge>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-5">
        {hostUnverified ? (
          <p className="mb-4 text-sm text-muted-foreground" role="status">
            {translate(
              'automation.savedRunHostUnavailable',
              'Host connection cannot be confirmed. This saved result does not confirm whether the process is running.'
            )}
          </p>
        ) : null}
        {run.outputSnapshot?.truncated ? (
          <p className="mb-4 text-sm text-muted-foreground" role="note">
            {translate(
              'automation.savedRunTruncated',
              'Saved output was truncated. This is not the full conversation.'
            )}
          </p>
        ) : null}
        {!savedOutput ? (
          <p className="mb-4 text-sm text-muted-foreground" role="note">
            {translate('automation.savedRunNoOutput', 'No saved output is available for this run.')}
          </p>
        ) : null}
        {content ? (
          <CommentMarkdown
            variant="document"
            content={content}
            className="text-sm leading-relaxed text-foreground"
          />
        ) : null}
      </div>
    </div>
  )
}
