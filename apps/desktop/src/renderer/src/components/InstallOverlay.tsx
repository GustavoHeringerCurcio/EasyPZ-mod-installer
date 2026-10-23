import {
  CheckCircle2,
  Circle,
  Download,
  FolderOpen,
  ListChecks,
  RotateCcw,
  SkipForward,
  Terminal,
  X,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CSSProperties } from 'react'
import type { UiSuiteView } from '../../../shared/ipc'
import type { InstallUiState, StageName } from '../lib/install'
import { STAGE_ORDER } from '../lib/install'
import { Badge, Button, Progress, Spinner } from './ui'
import { cn, formatBytes, formatDate, formatEta, formatSpeed } from '../lib/format'

export function InstallOverlay({
  state,
  packName,
  accent,
  canceling,
  onClose,
  onCancel,
  onRetry,
  onOpenGame,
  onOpenLogs,
  uiSuite,
}: {
  state: InstallUiState
  packName: string
  accent?: string
  canceling: boolean
  onClose: () => void
  onCancel: () => void
  onRetry: () => void
  onOpenGame: () => void
  onOpenLogs: () => void
  uiSuite: UiSuiteView | null
}) {
  const { t } = useTranslation()
  if (!state.visible) return null

  const completed = STAGE_ORDER.filter((stage) => {
    const status = state.stages[stage]?.status
    return status === 'done' || status === 'skip'
  }).length
  const download = state.progress.download
  const workshop = state.progress.workshop
  const workshopItem = state.workshopItem
  const extract = state.progress.extract
  const activeStage = STAGE_ORDER.find((stage) => state.stages[stage]?.status === 'start')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-6 backdrop-blur-sm">
      <div
        style={accent ? ({ '--pack-accent': accent } as CSSProperties) : undefined}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-[0_30px_100px_rgba(0,0,0,0.6)]"
      >
        <div className="h-0.5 w-full pack-accent-fill" />
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-bone">
                {state.summary
                  ? t('install.doneTitle')
                  : state.error
                    ? t('install.errorTitle')
                    : t('install.running')}
              </span>
              {state.running ? <Spinner /> : null}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-bone">
              {state.summary
                ? packName
                : state.error
                  ? t('install.errorTitle')
                  : t('install.title', { pack: packName })}
            </h2>
            {!state.summary && !state.error ? (
              <p className="mt-1 text-xs text-muted">{t('install.subtitle')}</p>
            ) : null}
          </div>
          {!state.running ? (
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-white/5 hover:text-bone"
              aria-label={t('common.close')}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {uiSuite && !state.summary && !state.error ? (
            <div className="mb-5 overflow-hidden rounded-2xl border border-line bg-panel-2/60">
              <div className="relative h-32">
                {uiSuite.coverDataUrl ? (
                  <img src={uiSuite.coverDataUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-panel-2 via-panel-2/30 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-bone/65">
                      {t('uiSuite.selectedHud')}
                    </div>
                    <div className="font-display text-lg font-bold text-bone">{uiSuite.name}</div>
                    <div className="text-[11px] text-bone/70">{uiSuite.tagline}</div>
                  </div>
                  <Badge tone="muted" className="shrink-0 bg-ink/60">
                    {t('uiSuite.serverWide')}
                  </Badge>
                </div>
              </div>
            </div>
          ) : null}

          {state.error ? (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-2xl border border-danger/25 bg-danger/[0.07] p-4">
                <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
                <div>
                  <div className="text-sm font-semibold text-bone">{state.error.message}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted">
                    {t('install.errorBody')}
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-danger/80">
                    {state.error.code}
                  </div>
                </div>
              </div>
              <LogList state={state} />
            </div>
          ) : state.summary ? (
            <div className="space-y-5">
              <div className="flex gap-3 rounded-2xl border border-success/25 bg-success/[0.06] p-4">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                <div>
                  <div className="text-sm font-semibold text-bone">{t('install.doneTitle')}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted">
                    {t('install.doneBody', { pack: packName })}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <SummaryStat
                  label={t('install.summary.clientMods')}
                  value={state.summary.clientMods}
                />
                <SummaryStat
                  label={t('install.summary.serverMods')}
                  value={state.summary.serverMods}
                />
                <SummaryStat
                  label={t('install.summary.workshop')}
                  value={state.summary.workshopItems}
                />
                <SummaryStat
                  label={t('install.summary.zombieBuddy')}
                  value={state.summary.zombieBuddy.replaceAll('-', ' ')}
                />
                <SummaryStat
                  label={t('install.summary.installedAt')}
                  value={formatDate(state.summary.installedAt)}
                />
                <SummaryStat
                  label={t('install.summary.download')}
                  value={formatBytes(state.summary.downloadedBytes)}
                />
              </div>

              <LogList state={state} />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {completed}/{STAGE_ORDER.length} {t('install.running').toLowerCase()}
                </span>
                {download ? (
                  <span className="font-mono">
                    {formatBytes(download.transferred)} / {formatBytes(download.total)}
                  </span>
                ) : null}
              </div>
              <Progress value={(completed / STAGE_ORDER.length) * 100} />

              <div className="space-y-1">
                {STAGE_ORDER.map((stage) => (
                  <StageRow
                    key={stage}
                    stage={stage}
                    state={state}
                    active={activeStage === stage}
                  />
                ))}
              </div>

              {download && state.stages.download?.status === 'start' ? (
                <div className="space-y-2 rounded-xl border border-line bg-panel-2/60 p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-bone">{t('install.stages.download')}</span>
                    <span className="font-mono text-muted">{download.percent.toFixed(0)}%</span>
                  </div>
                  <Progress value={download.percent} />
                  <div className="text-[11px] text-muted">
                    {t('install.downloadSpeed', {
                      speed: formatSpeed(download.bytesPerSecond),
                      eta: formatEta(download.etaSeconds),
                    })}
                  </div>
                </div>
              ) : null}

              {state.stages.workshop?.status === 'start' ? (
                <div className="space-y-3 rounded-xl border border-line bg-panel-2/60 p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-bone">{t('install.workshopSource')}</span>
                    <span className="font-mono text-muted">
                      {workshop ? `${workshop.percent.toFixed(0)}%` : '...'}
                    </span>
                  </div>
                  <Progress value={workshop?.percent ?? 0} indeterminate={!workshop} />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                    <span>
                      {workshop
                        ? t('install.workshopItems', {
                            done: workshop.transferred ?? 0,
                            total: workshop.total ?? 0,
                          })
                        : t('install.workshopPreparing')}
                    </span>
                    {workshop ? (
                      <span>
                        {t('install.workshopCounts', {
                          downloaded: workshop.downloaded ?? 0,
                          cached: workshop.cached ?? 0,
                          failed: workshop.failed ?? 0,
                        })}
                      </span>
                    ) : null}
                  </div>

                  {workshopItem ? (
                    <div className="space-y-2 rounded-lg border border-line bg-panel/70 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-bone">
                          {t('install.workshopCurrent', {
                            index: workshopItem.index,
                            total: workshopItem.total,
                          })}
                        </span>
                        <span
                          className={cn(
                            'font-mono',
                            workshopItem.status === 'failed' ? 'text-danger' : 'text-muted',
                          )}
                        >
                          {workshopItem.status === 'failed'
                            ? t('install.workshopFailed')
                            : workshopItem.percent === null
                              ? t('install.workshopWaiting')
                              : `${workshopItem.percent.toFixed(0)}%`}
                        </span>
                      </div>
                      <div className="truncate text-[13px] font-medium text-bone">
                        {workshopItem.name}
                      </div>
                      <Progress
                        value={workshopItem.percent ?? 0}
                        indeterminate={workshopItem.percent === null}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
                        <span>
                          {formatBytes(workshopItem.transferredBytes)} /{' '}
                          {formatBytes(workshopItem.totalBytes)}
                        </span>
                        <span>
                          {formatSpeed(workshopItem.bytesPerSecond)} -{' '}
                          {formatEta(workshopItem.etaSeconds)}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="text-[10px] leading-relaxed text-muted">
                    {t('install.workshopSourceHint')}
                  </div>
                </div>
              ) : null}

              {extract && state.stages.extract?.status === 'start' ? (
                <div className="space-y-2 rounded-xl border border-line bg-panel-2/60 p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-bone">{t('install.extracting')}</span>
                    <span className="font-mono text-muted">
                      {t('install.files', { count: extract.transferred ?? 0 })}
                    </span>
                  </div>
                  <Progress value={0} indeterminate />
                </div>
              ) : null}

              {state.currentMod && state.stages.apply?.status === 'start' ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                  <Spinner />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-bone">
                      {t('install.currentMod', { name: state.currentMod.name })}
                    </div>
                    <div className="text-[10px] text-muted">
                      {state.currentMod.index}/{state.currentMod.total}
                    </div>
                  </div>
                </div>
              ) : null}

              <LogList state={state} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <div>
            {state.running ? (
              <Badge tone="neutral" className="gap-1.5">
                <Download className="size-3" />
                {canceling ? t('install.canceling') : t('install.running')}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {state.running ? (
              <Button variant="secondary" onClick={onCancel} disabled={canceling}>
                {canceling ? t('install.canceling') : t('install.cancel')}
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={onOpenLogs}>
                  <Terminal className="size-4" />
                  {t('install.openLogs')}
                </Button>
                {state.error ? (
                  <Button variant="primary" onClick={onRetry}>
                    <RotateCcw className="size-4" />
                    {t('install.retry')}
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={onOpenGame}>
                      <FolderOpen className="size-4" />
                      {t('install.openGame')}
                    </Button>
                    <Button variant="light" onClick={onClose}>
                      {t('common.done')}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StageRow({
  stage,
  state,
  active,
}: {
  stage: StageName
  state: InstallUiState
  active: boolean
}) {
  const { t } = useTranslation()
  const entry = state.stages[stage]
  const status = entry?.status

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors',
        active && 'bg-white/[0.03]',
      )}
    >
      <div className="flex size-5 items-center justify-center">
        {status === 'done' ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : status === 'skip' ? (
          <SkipForward className="size-3.5 text-muted" />
        ) : status === 'start' ? (
          <Spinner className="size-3.5" />
        ) : (
          <Circle className="size-3.5 text-line" />
        )}
      </div>
      <span
        className={cn(
          'flex-1',
          status ? 'text-bone' : 'text-muted',
          status === 'skip' && 'text-muted/80',
        )}
      >
        {t(`install.stages.${stage}`)}
      </span>
      {entry?.detail ? (
        <span className="max-w-[220px] truncate text-[10px] text-muted">{entry.detail}</span>
      ) : null}
      {status ? (
        <span className="w-14 text-right text-[10px] uppercase tracking-wide text-muted">
          {t(`install.status.${status}`)}
        </span>
      ) : null}
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-3 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold capitalize text-bone">{value}</div>
    </div>
  )
}

function LogList({ state }: { state: InstallUiState }) {
  const { t } = useTranslation()
  if (state.logs.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink/60">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        <ListChecks className="size-3" />
        {t('install.log')}
      </div>
      <div className="max-h-36 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[10px] leading-relaxed">
        {state.logs.slice(-12).map((line, index) => (
          <div
            key={`${line.at}-${index}`}
            className={cn(
              'break-words',
              line.level === 'error'
                ? 'text-danger/90'
                : line.level === 'warn'
                  ? 'text-warn/90'
                  : 'text-muted',
            )}
          >
            <span className="mr-2 text-muted/50">
              {new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {line.message}
          </div>
        ))}
      </div>
    </div>
  )
}
