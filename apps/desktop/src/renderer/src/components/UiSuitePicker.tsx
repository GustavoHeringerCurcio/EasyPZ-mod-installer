import { Check, Layers3, Server, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UiSuiteView } from '../../../shared/ipc'
import { Badge, Button } from './ui'
import { cn, formatBytes } from '../lib/format'

export function UiSuiteGrid({
  suites,
  value,
  onChange,
}: {
  suites: UiSuiteView[]
  value: string
  onChange: (suiteId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {suites.map((suite) => {
        const selected = suite.id === value
        const size = suite.items.reduce((total, item) => total + (item.sizeBytes ?? 0), 0)
        return (
          <button
            key={suite.id}
            type="button"
            onClick={() => onChange(suite.id)}
            className={cn(
              'group relative overflow-hidden rounded-2xl border bg-panel text-left transition-all',
              selected
                ? 'border-bone/60 shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_18px_50px_rgba(0,0,0,0.35)]'
                : 'border-line hover:-translate-y-0.5 hover:border-white/25',
            )}
          >
            <div className="relative aspect-[16/9] overflow-hidden bg-panel-2">
              {suite.coverDataUrl ? (
                <img
                  src={suite.coverDataUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Layers3 className="size-10 text-muted/30" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                <Badge tone="muted" className="bg-ink/70 backdrop-blur">
                  <Server className="size-3" />
                  {t('uiSuite.serverWide')}
                </Badge>
                {selected ? (
                  <Badge tone="success" className="bg-ink/70 backdrop-blur">
                    <Check className="size-3" />
                    {t('uiSuite.selected')}
                  </Badge>
                ) : null}
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="font-display text-xl font-bold tracking-tight text-bone drop-shadow">
                  {suite.name}
                </div>
                <div className="mt-0.5 text-[11px] text-bone/75">{suite.tagline}</div>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <p className="line-clamp-3 text-[12px] leading-relaxed text-muted">
                {suite.description}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <Layers3 className="size-3" />
                  {suite.add.length === 0
                    ? t('uiSuite.packDefault')
                    : t('uiSuite.suiteMods', { count: suite.add.length })}
                </span>
                {size > 0 ? <span>{formatBytes(size)}</span> : null}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function UiSuiteDialog({
  open,
  packName,
  suites,
  value,
  mode,
  loading,
  onSelect,
  onConfirm,
  onClose,
}: {
  open: boolean
  packName: string
  suites: UiSuiteView[]
  value: string
  mode: 'install' | 'change'
  loading: boolean
  onSelect: (suiteId: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-ink/85 p-5 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="h-0.5 w-full bg-brand" />
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              {mode === 'install' ? t('uiSuite.installTitle') : t('uiSuite.changeTitle')}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-bone">{packName}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              {t('uiSuite.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-white/5 hover:text-bone"
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <UiSuiteGrid suites={suites} value={value} onChange={onSelect} />
          <div className="mt-4 flex gap-3 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3">
            <Server className="mt-0.5 size-4 shrink-0 text-warn" />
            <p className="text-[11px] leading-relaxed text-bone/85">{t('uiSuite.syncWarning')}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <div className="text-[10px] leading-relaxed text-muted">{t('uiSuite.footer')}</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button variant="light" onClick={onConfirm} loading={loading}>
              {mode === 'install' ? t('uiSuite.installAction') : t('uiSuite.applyAction')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
