import { describe, expect, it } from 'vitest'
import type { AutomationRun } from '../../../../shared/automations-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { Tab } from '../../../../shared/tab-types'
import { automationRunResultTabId } from '@/lib/automation-run-result-tab-id'
import { buildPersistedUnifiedTabSessionData } from '@/lib/workspace-session-unified-tabs'
import { isMobilePublishableOpenFile } from '@/runtime/sync-runtime-graph/mobile-session-surfaces'
import type { OpenFile } from '@/store/slices/editor'
import {
  resolveAutomationRunWorkspace,
  resolveAutomationRunWorkspaceDecision
} from './automation-run-workspace-decision'

const leafId = '11111111-1111-4111-8111-111111111111'
const run: AutomationRun = {
  id: 'run-3',
  automationId: 'automation-1',
  title: 'Run 3',
  scheduledFor: 1,
  status: 'completed',
  trigger: 'scheduled',
  workspaceId: 'wt-1',
  sessionKind: 'terminal',
  chatSessionId: null,
  terminalSessionId: 'tab-1',
  terminalPaneKey: `tab-1:${leafId}`,
  terminalPtyId: 'pty-1',
  outputSnapshot: {
    format: 'plain_text',
    content: 'Saved result',
    capturedAt: 2,
    truncated: false
  },
  precheckResult: null,
  usage: null,
  error: null,
  startedAt: 1,
  dispatchedAt: 1,
  createdAt: 1
}
const terminal: Tab = {
  id: 'tab-1',
  entityId: 'tab-1',
  worktreeId: 'wt-1',
  groupId: 'group-1',
  executionHostId: 'local',
  contentType: 'terminal',
  label: 'Run terminal',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}
const layout = {
  root: { type: 'leaf' as const, leafId },
  activeLeafId: leafId,
  expandedLeafId: null,
  ptyIdsByLeafId: { [leafId]: 'pty-1' }
}
const state = {
  unifiedTabsByWorktree: { 'wt-1': [terminal] },
  terminalLayoutsByTabId: { 'tab-1': layout },
  ptyIdsByTabId: { 'tab-1': ['pty-1'] },
  runtimeStatusByEnvironmentId: new Map(),
  sshConnectionStates: new Map()
}

describe('automation run workspace decision', () => {
  it('opens an exact live terminal and falls back to the saved tab after its identity is cleared', () => {
    expect(
      resolveAutomationRunWorkspaceDecision({
        run,
        workspaceExists: true,
        hostId: 'local',
        state
      }).viewState.availability
    ).toBe('terminal')
    expect(
      resolveAutomationRunWorkspaceDecision({
        run: { ...run, terminalPaneKey: null, terminalPtyId: null },
        workspaceExists: true,
        hostId: 'local',
        state
      }).viewState.availability
    ).toBe('snapshot')
  })

  it('never opens another host’s terminal even when tab and run IDs collide', () => {
    const decision = resolveAutomationRunWorkspaceDecision({
      run,
      workspaceExists: true,
      hostId: 'ssh:other',
      state: {
        ...state,
        sshConnectionStates: new Map([
          [
            'other',
            { targetId: 'other', status: 'connected' as const, error: null, reconnectAttempt: 0 }
          ]
        ])
      }
    })
    expect(decision.terminalTarget).toBeNull()
    expect(decision.viewState.availability).toBe('snapshot')
    expect(automationRunResultTabId('local', run)).not.toBe(
      automationRunResultTabId('ssh:other', run)
    )
  })

  it('selects the folder workspace owned by the run host when IDs collide', () => {
    const folderRun: AutomationRun = {
      ...run,
      workspaceId: 'folder:shared',
      runContext: {
        kind: 'workspace-run',
        projectId: 'project-1',
        hostId: 'ssh:other',
        projectHostSetupId: 'setup-1',
        repoId: 'repo-1',
        path: '/work'
      }
    }
    const folder = (
      hostId: FolderWorkspace['executionHostId'],
      group: string
    ): FolderWorkspace => ({
      id: 'shared',
      projectGroupId: group,
      name: 'Shared folder',
      folderPath: '/work',
      executionHostId: hostId,
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1
    })
    const folderWorkspaces = [folder('local', 'local-group'), folder('ssh:other', 'remote-group')]
    const resolved = resolveAutomationRunWorkspace({
      run: folderRun,
      row: null,
      repo: undefined,
      worktreeForRow: () => undefined,
      state: { folderWorkspaces }
    })
    expect(resolved.worktree?.repoId).toBe('folder-workspace:remote-group')
    expect(resolved.hostId).toBe('ssh:other')
  })

  it('uses the saved result when a paired host cannot be reached', () => {
    const decision = resolveAutomationRunWorkspaceDecision({
      run,
      workspaceExists: true,
      hostId: 'runtime:env-1',
      environmentId: 'env-1',
      state: {
        ...state,
        unifiedTabsByWorktree: {
          'wt-1': [{ ...terminal, executionHostId: 'runtime:env-1' }]
        },
        runtimeStatusByEnvironmentId: new Map([['env-1', { status: null, checkedAt: 1 }]])
      }
    })
    expect(decision.viewState).toMatchObject({ availability: 'snapshot', canOpen: true })
  })

  it('keeps result tabs local to the window session and out of mobile publication', () => {
    const id = automationRunResultTabId('local', run)
    const file: OpenFile = {
      id,
      filePath: id,
      relativePath: run.title,
      worktreeId: 'wt-1',
      language: 'markdown',
      isDirty: false,
      mode: 'automation-run',
      automationRun: run,
      automationRunHostId: 'local'
    }
    expect(isMobilePublishableOpenFile(file)).toBe(false)
    const persisted = buildPersistedUnifiedTabSessionData({
      unifiedTabsByWorktree: {
        'wt-1': [
          terminal,
          { ...terminal, id: 'result-tab', entityId: id, contentType: 'editor', sortOrder: 1 }
        ]
      },
      groupsByWorktree: {
        'wt-1': [
          {
            id: 'group-1',
            worktreeId: 'wt-1',
            activeTabId: 'result-tab',
            tabOrder: ['tab-1', 'result-tab']
          }
        ]
      },
      activeGroupIdByWorktree: { 'wt-1': 'group-1' },
      layoutByWorktree: { 'wt-1': { type: 'leaf', groupId: 'group-1' } }
    })
    expect(persisted.unifiedTabs?.['wt-1']).toEqual([terminal])
    expect(persisted.tabGroups?.['wt-1']?.[0]?.tabOrder).toEqual(['tab-1'])
  })
})
