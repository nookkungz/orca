import { runtimeWorktreeIdsEqual } from './runtime-worktree-path-identity'
import { installRuntimeLinearCommandSurface } from './runtime-linear-command-surface'
import { OrcaRuntimeWithResolveWaiter } from './orca-runtime-resolve-waiter'
import type { RuntimeCommandSurfaceHost } from './orca-runtime-core'
import { homedir } from 'node:os'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { getDefaultWslDistro } from '../wsl'
import { readCodexTeamCatalog } from '../codex/codex-team-catalog'
import type { CodexTeamModelCatalog } from '../../shared/codex-team'
import { planAgentBinary } from '../../shared/commit-message-plan'

class OrcaRuntimeService extends OrcaRuntimeWithResolveWaiter {
  async getCodexTeamModelCatalog(): Promise<CodexTeamModelCatalog> {
    const settings = this.requireStore().getSettings()
    const preference = settings.localWindowsRuntimeDefault
    const usesWsl = process.platform === 'win32' && preference?.kind === 'wsl'
    const wslDistro = usesWsl ? preference.distro || getDefaultWslDistro() : null
    if (usesWsl && !wslDistro) {
      throw new Error('Choose a WSL distro before loading Codex models.')
    }
    const prepare = this.accounts.getCommitMessageAgentEnvironment()?.prepareForCodexLaunch
    if (!prepare) {
      throw new Error('Codex account preparation is unavailable on this host.')
    }
    const home = await prepare({ runtime: wslDistro ? 'wsl' : 'host', wslDistro })
    const wslHome = home ? parseWslUncPath(home) : null
    if (wslDistro && (!wslHome || wslHome.distro.toLowerCase() !== wslDistro.toLowerCase())) {
      throw new Error('Cannot verify the selected Codex account home in this WSL distro.')
    }
    if (!wslDistro && wslHome) {
      throw new Error('The Codex account home belongs to WSL.')
    }
    const command = planAgentBinary(
      'codex',
      settings.agentCmdOverrides?.codex,
      process.platform === 'win32' && !wslDistro ? 'literal' : 'escape'
    )
    if (!command.ok) {
      throw new Error(command.error)
    }
    const catalog = await readCodexTeamCatalog({
      cwd: wslHome?.linuxPath ?? homedir(),
      codexHome: wslHome?.linuxPath ?? home,
      wslDistro,
      codexCommand: command.binary === 'codex' ? undefined : command.binary,
      commandArgs: command.prefixArgs
    })
    return { models: catalog.models, wslDistro }
  }

  async getCodexTeamContext(handle: string) {
    const pty = this.ptysById.get(this.getTerminalAgentStatusPtyId(handle))
    if (!pty?.connected) {
      throw new Error('Codex Team requires a live Orca terminal.')
    }
    if (pty.connectionId) {
      throw new Error('Codex Team does not support SSH workspaces.')
    }
    const resolvedWorkspace = await this.resolveTerminalWorkspaceLaunchScope(`id:${pty.worktreeId}`)
    if (!runtimeWorktreeIdsEqual(resolvedWorkspace.id, pty.worktreeId)) {
      throw new Error('terminal_workspace_changed')
    }
    // Git on WSL can change path separators; existing panes keep their original workspace key.
    const workspace = { ...resolvedWorkspace, id: pty.worktreeId }
    const wslDistro = this.wslDistroByPtyId.get(pty.ptyId) ?? pty.wslDistro ?? null
    return { workspace, wslDistro, settings: this.requireStore().getSettings() }
  }
}
type OrcaRuntimeServiceExport = RuntimeCommandSurfaceHost<OrcaRuntimeService>
const OrcaRuntimeServiceExport = OrcaRuntimeService as unknown as {
  new (...args: ConstructorParameters<typeof OrcaRuntimeService>): OrcaRuntimeServiceExport
  readonly prototype: OrcaRuntimeServiceExport
}
export { OrcaRuntimeServiceExport as OrcaRuntimeService }
installRuntimeLinearCommandSurface(OrcaRuntimeServiceExport.prototype)

export type { LegacyWorkerTerminalRecoveryResult } from './runtime-legacy-worker-terminal-recovery-types'
export type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from './runtime-automation-controller'
export type { SubscriptionRegistration } from './runtime-subscription-registry'
export type {
  OrchestrationCompatibilityCallerAuthority,
  OrchestrationCompatibilityTerminalAuthority,
  RuntimePtyDataAdmission,
  RuntimeTerminalAgentStatusEvent
} from './runtime-terminal-contracts'
export type { MessageWaitResult } from './runtime-message-waiters'
export type { AccountsSnapshot, CodexRateLimitResetRpcResult } from './runtime-account-controller'
export type {
  MobileNotificationDispatchEvent,
  MobileNotificationDismissEvent,
  MobileNotificationEvent
} from './runtime-mobile-notification-controller'
export type { RuntimeTerminalDataMeta } from './runtime-terminal-stream-consumers'
export type { RemoteFetchResult, RemoteTrackingBase } from './runtime-remote-fetch-controller'
export {
  computeTerminalTailWaitState,
  tailGainedNewerBlockedReason,
  type TerminalTailWaitState
} from './terminal-wait-tail-state'
export { appendNormalizedToTailBuffer } from './terminal-tail-buffer'
export { appendNormalizedToMultilineTailBufferUnwindowed } from './terminal-tail-redraw-buffer'
export { buildPreview } from './terminal-tail-state'
export { buildRestoredTerminalTailSeed } from './terminal-tail-restore-seed'
export { projectTerminalTailLines } from './orca-runtime-terminal-projection'
export { resolveWorktreeScanCacheTtlMs } from './runtime-worktree-scan-cache'
export type {
  RuntimeWorktreeLifecycleEvent,
  DriverState,
  PtyLayoutTarget,
  PtyLayoutState,
  ApplyLayoutResult,
  RuntimeRendererReloadFence
} from './orca-runtime-core'
export {
  AUTHORITATIVE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
  WORKTREE_SCAN_ADMIN_RECONCILE_INTERVAL_MS,
  WORKTREE_SCAN_ADMIN_FINGERPRINT_TIMEOUT_MS
} from './orca-runtime-postlude'
