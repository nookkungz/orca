import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_CODEX_TEAM_SETTINGS,
  getCodexTeamAllowedEfforts,
  type CodexTeamModelCatalog
} from '../../../../shared/codex-team'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsSubsectionHeader, SettingsSwitchRow } from './SettingsFormControls'

export function CodexTeamSettings({
  settings,
  updateSettings
}: {
  settings: Pick<
    GlobalSettings,
    | 'codexTeam'
    | 'activeRuntimeEnvironmentId'
    | 'localWindowsRuntimeDefault'
    | 'activeCodexManagedAccountId'
    | 'activeCodexManagedAccountIdsByRuntime'
  >
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const team = settings.codexTeam ?? DEFAULT_CODEX_TEAM_SETTINGS
  const [catalog, setCatalog] = useState<CodexTeamModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const environmentId = settings.activeRuntimeEnvironmentId
  const accountKey = JSON.stringify([
    settings.localWindowsRuntimeDefault,
    settings.activeCodexManagedAccountId,
    settings.activeCodexManagedAccountIdsByRuntime
  ])
  useEffect(() => {
    const controller = new AbortController()
    setCatalog(null)
    setError(null)
    void callRuntimeRpc<CodexTeamModelCatalog>(
      getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId }),
      'codexTeam.models',
      {},
      { signal: controller.signal, timeoutMs: 40_000 }
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setCatalog(result)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load Codex models.')
        }
      })
    return () => controller.abort()
  }, [environmentId, accountKey, revision])
  const models = catalog?.models ?? []
  const unavailable = catalog
    ? (team.allowedModels ?? []).filter((id) => !models.some((model) => model.id === id))
    : []
  return (
    <section className="space-y-3" aria-label="Codex Team settings">
      <SettingsSubsectionHeader
        title="Codex Team"
        description="The Leader opens first. Workers share its folder. These settings apply to new teams; the Leader’s own model and effort are unchanged."
      />
      <label className="flex items-center justify-between gap-3">
        <span>Maximum workers (excluding Leader)</span>
        <Input
          type="number"
          min={1}
          max={8}
          value={team.maxWorkers}
          className="w-20"
          aria-label="Maximum Codex Team workers"
          onChange={(event) => {
            const maxWorkers = event.target.valueAsNumber
            if (Number.isInteger(maxWorkers) && maxWorkers >= 1 && maxWorkers <= 8) {
              void updateSettings({ codexTeam: { ...team, maxWorkers } })
            }
          }}
        />
      </label>
      <SettingsSwitchRow
        label="Allow all available worker models"
        description="Includes new models as they become available. Effort limits below still apply."
        ariaLabel="Allow all available worker models"
        checked={team.allowedModels === null}
        disabled={!catalog}
        onChange={() =>
          void updateSettings({
            codexTeam: {
              ...team,
              allowedModels: team.allowedModels === null ? models.map((model) => model.id) : null
            }
          })
        }
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {catalog
            ? `Models from the selected host’s Codex account${catalog.wslDistro ? ` · WSL: ${catalog.wslDistro}` : ''}.`
            : error
              ? 'Model catalog unavailable.'
              : 'Loading available models…'}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!catalog && !error}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh models
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {catalog && models.length === 0 && (
        <p role="status">No models are available on this account.</p>
      )}
      {models.map((model) => {
        const allowed = team.allowedModels === null || team.allowedModels.includes(model.id)
        const range = team.modelEffortRanges?.[model.id]
        const min = range?.min ?? model.efforts[0]?.value
        const max = range?.max ?? model.efforts.at(-1)?.value
        const minIndex = model.efforts.findIndex((effort) => effort.value === min)
        const maxIndex = model.efforts.findIndex((effort) => effort.value === max)
        return (
          <div key={model.id} className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={`Allow worker model ${model.id}`}
                checked={allowed}
                onCheckedChange={(checked) => {
                  const selected = team.allowedModels ?? models.map((entry) => entry.id)
                  void updateSettings({
                    codexTeam: {
                      ...team,
                      allowedModels: checked
                        ? [...new Set([...selected, model.id])]
                        : selected.filter((id) => id !== model.id)
                    }
                  })
                }}
              />
              <span>
                {model.label}
                {model.label !== model.id && (
                  <span className="ml-2 text-xs text-muted-foreground">{model.id}</span>
                )}
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              {(['min', 'max'] as const).map((bound) => (
                <label key={bound} className="space-y-1 text-xs text-muted-foreground">
                  <span>{bound === 'min' ? 'Minimum effort' : 'Maximum effort'}</span>
                  <Select
                    value={bound === 'min' ? min : max}
                    disabled={!allowed || model.efforts.length === 0}
                    onValueChange={(value) =>
                      void updateSettings({
                        codexTeam: {
                          ...team,
                          modelEffortRanges: {
                            ...team.modelEffortRanges,
                            [model.id]: { min: min!, max: max!, [bound]: value }
                          }
                        }
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={`${bound === 'min' ? 'Minimum' : 'Maximum'} effort for ${model.id}`}
                    >
                      <SelectValue placeholder="Unavailable" />
                    </SelectTrigger>
                    <SelectContent>
                      {range && !model.efforts.some((effort) => effort.value === range[bound]) && (
                        <SelectItem value={range[bound]} disabled>
                          {range[bound]} (unavailable)
                        </SelectItem>
                      )}
                      {model.efforts.map((effort, index) => (
                        <SelectItem
                          key={effort.value}
                          value={effort.value}
                          disabled={
                            bound === 'min'
                              ? maxIndex !== -1 && index > maxIndex
                              : minIndex !== -1 && index < minIndex
                          }
                        >
                          {effort.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ))}
              {range && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Reset effort range for ${model.id}`}
                  onClick={() => {
                    const modelEffortRanges = { ...team.modelEffortRanges }
                    delete modelEffortRanges[model.id]
                    void updateSettings({ codexTeam: { ...team, modelEffortRanges } })
                  }}
                >
                  Use all efforts
                </Button>
              )}
            </div>
            {allowed && getCodexTeamAllowedEfforts(team, model).length === 0 && (
              <p role="alert" className="text-xs text-destructive">
                No supported effort is allowed. Choose a valid range before using this model.
              </p>
            )}
          </div>
        )
      })}
      {unavailable.map((id) => (
        <label key={id} className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label={`Allow worker model ${id}`}
            checked
            onCheckedChange={() =>
              void updateSettings({
                codexTeam: {
                  ...team,
                  allowedModels: team.allowedModels!.filter((model) => model !== id)
                }
              })
            }
          />
          {id} — unavailable on this account; saved selection retained
        </label>
      ))}
      {team.allowedModels?.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          No worker models selected. New teams will use the Leader only.
        </p>
      )}
    </section>
  )
}
