import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  FolderOpen,
  Gamepad2,
  Gauge,
  Globe2,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PerformanceConfigResult } from '@easypz/engine'
import type { Bootstrap, Language, PerformancePreset } from '../../../shared/ipc'
import { Badge, Button, Panel, SectionTitle } from './ui'
import { cn, formatBytes, formatDate } from '../lib/format'

export function SettingsPage({
  bootstrap,
  onPickGamePath,
  onResetGamePath,
  onLanguage,
  onOpen,
  onOpenLogs,
  onRefreshCatalog,
  onClearCache,
  onSaveHeap,
  onApplyFpsBoost,
}: {
  bootstrap: Bootstrap
  onPickGamePath: () => Promise<void>
  onResetGamePath: () => Promise<void>
  onLanguage: (language: Language) => void
  onOpen: (target: string | null) => void
  onOpenLogs: () => void
  onRefreshCatalog: () => Promise<void>
  onClearCache: () => void
  onSaveHeap: (heapMB: number) => Promise<void>
  onApplyFpsBoost: (
    preset: PerformancePreset,
    heapMB: number,
  ) => Promise<PerformanceConfigResult | null>
}) {
  const { t } = useTranslation()
  const game = bootstrap.game
  const paths = bootstrap.paths
  const minHeapMB = 3072
  const maxHeapMB = Math.max(
    minHeapMB,
    Math.min(16384, Math.floor(game.totalRamMB / 2 / 512) * 512),
  )
  const currentHeapMB = bootstrap.settings.heapMB ?? game.currentHeapMB ?? game.recommendedHeapMB
  const [heapDraft, setHeapDraft] = useState(() =>
    Math.min(maxHeapMB, Math.max(minHeapMB, currentHeapMB)),
  )
  const [heapBusy, setHeapBusy] = useState(false)
  const [preset, setPreset] = useState<'recommended' | 'light'>('recommended')
  const [busyPreset, setBusyPreset] = useState<PerformancePreset | null>(null)
  const [lastResult, setLastResult] = useState<PerformanceConfigResult | null>(null)
  const [lastPreset, setLastPreset] = useState<PerformancePreset | null>(null)

  useEffect(() => {
    setHeapDraft(Math.min(maxHeapMB, Math.max(minHeapMB, currentHeapMB)))
  }, [currentHeapMB, maxHeapMB])

  const heapDirty = Math.round(heapDraft / 512) * 512 !== currentHeapMB
  const canApply = game.found && !game.gameRunning && !heapBusy && busyPreset === null

  const saveHeap = async (): Promise<void> => {
    setHeapBusy(true)
    try {
      await onSaveHeap(heapDraft)
    } finally {
      setHeapBusy(false)
    }
  }

  const applyPreset = async (selected: PerformancePreset): Promise<void> => {
    setBusyPreset(selected)
    try {
      const result = await onApplyFpsBoost(selected, game.recommendedHeapMB)
      if (result) {
        setLastResult(result)
        setLastPreset(selected)
      }
    } finally {
      setBusyPreset(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight text-bone">
          {t('settings.title')}
        </h1>
        <p className="mt-2 text-sm text-muted">{t('settings.subtitle')}</p>
      </header>

      <div className="mt-6 space-y-6">
        <section>
          <SectionTitle
            aside={
              game.found ? (
                <Badge tone="success">{t('settings.detected')}</Badge>
              ) : (
                <Badge tone="warn">{t('settings.notFound')}</Badge>
              )
            }
          >
            {t('settings.game')}
          </SectionTitle>
          <Panel className="mt-3 overflow-hidden">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Gamepad2 className="size-3.5" />
                  {t('settings.gamePath')}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-bone">
                  {game.pzPath ?? t('settings.auto')}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => void onPickGamePath()}>
                  <FolderOpen className="size-3.5" />
                  {t('settings.change')}
                </Button>
                {bootstrap.settings.gamePathOverride ? (
                  <Button size="sm" variant="ghost" onClick={() => void onResetGamePath()}>
                    {t('settings.reset')}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
              <InfoCell
                icon={Archive}
                label={t('settings.steamLibs')}
                value={String(game.steamLibraries.length)}
              />
              <InfoCell
                icon={Cpu}
                label={t('settings.ram')}
                value={`${(game.totalRamMB / 1024).toFixed(0)} GB`}
              />
              <InfoCell
                icon={HardDrive}
                label={t('settings.heap')}
                value={`${game.currentHeapMB ?? game.recommendedHeapMB} MB`}
              />
              <InfoCell icon={Gamepad2} label={t('pack.build')} value={game.gameVersion ?? '—'} />
            </div>

            {!game.found && game.detectionError ? (
              <div className="flex gap-2 border-t border-line bg-warn/[0.05] px-5 py-3 text-[11px] text-warn">
                <AlertTriangle className="size-3.5 shrink-0" />
                {game.detectionError}
              </div>
            ) : null}
          </Panel>
        </section>

        <section>
          <SectionTitle aside={<Badge tone="brand">FPS BOOST</Badge>}>
            {t('settings.fpsBoost')}
          </SectionTitle>
          <Panel className="mt-3 overflow-hidden">
            <div className="h-0.5 w-full bg-brand" />
            <div className="space-y-5 p-5">
              <p className="text-[11px] leading-relaxed text-muted">{t('settings.fpsBoostHint')}</p>

              <div className="space-y-3 rounded-xl border border-line bg-panel-2/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-bone">
                    <Gauge className="size-4 text-brand" />
                    {t('settings.heapSlider')}
                  </div>
                  {heapDirty ? <Badge tone="warn">{t('settings.unsaved')}</Badge> : null}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="font-display text-2xl font-bold text-bone">
                      {(heapDraft / 1024).toFixed(1)} GB
                    </div>
                    <div className="text-[10px] text-muted">
                      {t('settings.heapCurrent', {
                        gb: (currentHeapMB / 1024).toFixed(1),
                      })}{' '}
                      ·{' '}
                      {t('settings.heapRecommended', {
                        gb: (game.recommendedHeapMB / 1024).toFixed(0),
                      })}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setHeapDraft(game.recommendedHeapMB)}
                    disabled={!canApply}
                  >
                    {t('settings.useRecommended')}
                  </Button>
                </div>

                <input
                  type="range"
                  min={minHeapMB}
                  max={maxHeapMB}
                  step={512}
                  value={heapDraft}
                  disabled={!canApply}
                  onChange={(event) => setHeapDraft(Number(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-brand disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label={t('settings.heapSlider')}
                />
                <div className="flex justify-between text-[10px] text-muted">
                  <span>3 GB</span>
                  <span>{Math.round(maxHeapMB / 1024)} GB</span>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    size="md"
                    onClick={() => void saveHeap()}
                    loading={heapBusy}
                    disabled={!canApply || !heapDirty}
                  >
                    <HardDrive className="size-4" />
                    {t('settings.saveHeap')}
                  </Button>
                  <p className="text-[10px] leading-relaxed text-muted">
                    {t('settings.sliderHint')}
                  </p>
                </div>
              </div>

              <div className="space-y-3 border-t border-line pt-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-sm font-semibold text-bone">
                      {t('settings.performanceProfile')}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">
                      {t('settings.performanceProfileHint')}
                    </p>
                  </div>
                  <Badge tone="muted">
                    {preset === 'recommended'
                      ? t('settings.presetRecommended')
                      : t('settings.presetLight')}
                  </Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      [
                        'recommended',
                        t('settings.presetRecommended'),
                        t('settings.presetRecommendedHint'),
                      ],
                      ['light', t('settings.presetLight'), t('settings.presetLightHint')],
                    ] as Array<['recommended' | 'light', string, string]>
                  ).map(([id, label, hint]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setPreset(id)
                        setLastResult(null)
                        setLastPreset(null)
                      }}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-left transition-colors',
                        preset === id
                          ? 'border-brand/50 bg-brand/10'
                          : 'border-line bg-panel-2/40 hover:border-white/25',
                      )}
                    >
                      <div className="text-xs font-semibold text-bone">{label}</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-muted">{hint}</div>
                    </button>
                  ))}
                </div>

                <details className="rounded-xl border border-line bg-panel-2/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-bone">
                    {t('settings.seeChanges')}
                  </summary>
                  <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted">
                    <li>{t('settings.changeViewpoint')}</li>
                    <li>{t('settings.changeWeather')}</li>
                    <li>{t('settings.changeShadows')}</li>
                    {preset === 'recommended' ? (
                      <>
                        <li>{t('settings.changeCombat')}</li>
                        <li>{t('settings.changeVehicles')}</li>
                      </>
                    ) : null}
                  </ul>
                  <p className="mt-2 text-[10px] leading-relaxed text-muted">
                    {t('settings.changesFiles')}
                  </p>
                </details>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    size="md"
                    variant="light"
                    onClick={() => void applyPreset(preset)}
                    loading={busyPreset === preset}
                    disabled={!canApply}
                  >
                    <Zap className="size-4" />
                    {preset === 'recommended'
                      ? t('settings.applyRecommended')
                      : t('settings.applyLight')}
                  </Button>
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={() => void applyPreset('defaults')}
                    loading={busyPreset === 'defaults'}
                    disabled={!canApply}
                  >
                    <RotateCcw className="size-4" />
                    {t('settings.restoreDefaults')}
                  </Button>
                </div>

                <p className="text-[10px] leading-relaxed text-muted">
                  {t('settings.lazyHint', {
                    gb: (game.recommendedHeapMB / 1024).toFixed(0),
                  })}
                </p>
              </div>

              {lastResult ? <PerformanceResult result={lastResult} preset={lastPreset} /> : null}

              {game.gameRunning ? (
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-warn">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {t('settings.gameMustBeClosed')}
                </p>
              ) : null}
            </div>
          </Panel>
        </section>

        <section>
          <SectionTitle>{t('settings.detection')}</SectionTitle>
          <Panel className="mt-3 divide-y divide-line">
            <FactRow
              icon={game.gameRunning ? AlertTriangle : ShieldCheck}
              label={t('settings.gameProcess')}
              value={game.gameRunning ? t('settings.running') : t('settings.closed')}
              tone={game.gameRunning ? 'warn' : 'success'}
            />
            <FactRow
              icon={game.canWriteGame ? ShieldCheck : Shield}
              label={t('settings.writeAccess')}
              value={game.canWriteGame ? t('settings.writable') : t('settings.needsAdmin')}
              tone={game.canWriteGame ? 'success' : 'muted'}
            />
            <FactRow
              icon={Globe2}
              label={t('settings.freeSpace')}
              value={game.freeDiskGB === null ? '—' : formatBytes(game.freeDiskGB * 1024 ** 3)}
            />
            <FactRow
              icon={ShieldCheck}
              label={t('settings.admin')}
              value={bootstrap.isElevated ? t('settings.adminYes') : t('settings.adminNo')}
              tone={bootstrap.isElevated ? 'success' : 'muted'}
            />
          </Panel>
        </section>

        <section>
          <SectionTitle>{t('settings.language')}</SectionTitle>
          <Panel className="mt-3 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-bone">
                <Globe2 className="size-4 text-muted" />
                {t('settings.language')}
              </div>
              <p className="mt-1 text-[11px] text-muted">{t('settings.languageHint')}</p>
            </div>
            <div className="flex rounded-xl border border-line bg-panel-2 p-1">
              {(
                [
                  ['en', 'English'],
                  ['pt-BR', 'Português (BR)'],
                ] as Array<[Language, string]>
              ).map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => onLanguage(code)}
                  className={
                    bootstrap.settings.language === code
                      ? 'rounded-lg bg-bone px-3 py-1.5 text-xs font-semibold text-ink'
                      : 'rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-bone'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </Panel>
        </section>

        <section>
          <SectionTitle>{t('settings.maintenance')}</SectionTitle>
          <Panel className="mt-3 grid gap-2 p-3 sm:grid-cols-2">
            <MaintenanceButton
              icon={FileText}
              label={t('settings.openLogs')}
              onClick={onOpenLogs}
            />
            <MaintenanceButton
              icon={RefreshCw}
              label={t('settings.refreshCatalog')}
              onClick={() => void onRefreshCatalog()}
            />
            <MaintenanceButton
              icon={Archive}
              label={t('settings.openCache')}
              onClick={() => onOpen(paths.cache)}
            />
            <MaintenanceButton
              icon={Trash2}
              label={t('settings.clearCache')}
              onClick={onClearCache}
            />
            <MaintenanceButton
              icon={HardDrive}
              label={t('settings.openStore')}
              onClick={() => onOpen(paths.store)}
            />
            <MaintenanceButton
              icon={FolderOpen}
              label={t('settings.openMods')}
              onClick={() => onOpen(paths.mods)}
            />
            <MaintenanceButton
              icon={Wrench}
              label={t('settings.openBackups')}
              onClick={() => onOpen(paths.backups)}
            />
            <MaintenanceButton
              icon={Gamepad2}
              label={t('settings.openGame')}
              onClick={() => onOpen(paths.game)}
              disabled={!paths.game}
            />
            <MaintenanceButton
              icon={RefreshCw}
              label={t('common.refresh')}
              onClick={() => window.location.reload()}
            />
          </Panel>
        </section>

        <section>
          <SectionTitle>{t('settings.about')}</SectionTitle>
          <Panel className="mt-3 divide-y divide-line">
            <FactRow icon={Shield} label={t('settings.version')} value={bootstrap.appVersion} />
            <FactRow
              icon={RefreshCw}
              label={t('settings.channel')}
              value={t('settings.channelOff')}
            />
            <FactRow
              icon={Archive}
              label={t('settings.catalogLabel')}
              value={`${bootstrap.catalog.mode} · ${bootstrap.catalog.packs.length} packs`}
            />
            <FactRow
              icon={Globe2}
              label={t('settings.catalogSource')}
              value={
                bootstrap.catalogSource === 'remote'
                  ? t('settings.catalogRemote')
                  : t('settings.catalogBundled')
              }
            />
            <FactRow
              icon={RefreshCw}
              label={t('settings.catalogUpdated')}
              value={formatDate(bootstrap.catalog.generatedAt)}
            />
          </Panel>
        </section>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          {t('settings.saveWarning')}
        </p>
      </div>
    </div>
  )
}

function PerformanceResult({
  result,
  preset,
}: {
  result: PerformanceConfigResult
  preset: PerformancePreset | null
}) {
  const { t } = useTranslation()
  const files = [
    result.jsonPatched ? 'ProjectZomboid64.json' : null,
    result.batPatched ? 'ProjectZomboid64.bat' : null,
    result.propertiesPatched ? 'viewpoint-live.properties' : null,
    result.optionsPatched ? 'options.ini' : null,
    result.modOptionsPatched ? 'Lua\\ModOptions.ini' : null,
  ].filter(Boolean) as string[]

  return (
    <div className="rounded-xl border border-success/25 bg-success/[0.06] p-4">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
        <div>
          <div className="text-sm font-semibold text-bone">
            {preset === 'defaults'
              ? t('settings.defaultsRestored')
              : t('settings.performanceApplied')}
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-muted">
            {t('settings.performanceAppliedHint')}
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted">
        <div>{t('settings.heapApplied', { gb: (result.heapMB / 1024).toFixed(1) })}</div>
        <div>
          {t('settings.filesUpdated')}: {files.length > 0 ? files.join(', ') : '—'}
        </div>
        {result.skipped.length > 0 ? (
          <div className="text-warn">
            {t('settings.filesSkipped')}: {result.skipped.join(', ')}
          </div>
        ) : null}
        <div className="font-medium text-bone">{t('settings.restartGame')}</div>
      </div>
    </div>
  )
}

function InfoCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu
  label: string
  value: string
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-bone">{value}</div>
    </div>
  )
}

function FactRow({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Cpu
  label: string
  value: string
  tone?: 'default' | 'success' | 'warn' | 'muted'
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Icon
        className={
          tone === 'success'
            ? 'size-3.5 text-success'
            : tone === 'warn'
              ? 'size-3.5 text-warn'
              : 'size-3.5 text-muted'
        }
      />
      <span className="flex-1 text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-bone">{value}</span>
    </div>
  )
}

function MaintenanceButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Cpu
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-bone transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="size-3.5 text-muted" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-3.5 text-muted" />
    </button>
  )
}
