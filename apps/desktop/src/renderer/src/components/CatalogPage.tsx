import type { KeyboardEvent, MouseEvent } from 'react'
import { Boxes, Download, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getEffectiveMods } from '@easypz/catalog'
import type { Bootstrap, PackView } from '../../../shared/ipc'
import { Button, Panel, Spinner, Switch } from './ui'
import { cn, formatBytes } from '../lib/format'

function PackCard({
  pack,
  available,
  active,
  busy,
  gameRunning,
  onOpen,
  onInstall,
  onToggle,
}: {
  pack: PackView
  available: boolean
  active: boolean
  busy: boolean
  gameRunning: boolean
  onOpen: () => void
  onInstall: () => void
  onToggle: (enabled: boolean) => void
}) {
  const { t } = useTranslation()

  const stop = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation()
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-panel/80 text-left transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
        active
          ? 'border-acid/45 shadow-[0_0_40px_rgba(183,240,74,0.08)]'
          : 'border-line hover:-translate-y-0.5 hover:border-muted/50 hover:shadow-[0_16px_40px_rgba(0,0,0,0.35)]',
      )}
    >
      <div className="relative aspect-[16/7] overflow-hidden bg-panel-2">
        {pack.coverDataUrl ? (
          <img
            src={pack.coverDataUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-ink">
            <Boxes className="size-12 text-muted/40" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight text-bone">{pack.name}</h3>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted">{pack.tagline}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-acid/80" />
              {t('catalog.mods', { count: pack.stats.clientMods })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Download className="size-3.5" />
              {formatBytes(pack.archive.sizeBytes)}
            </span>
          </div>

          <div onClick={stop} onKeyDown={stop} className="shrink-0">
            {busy ? (
              <div className="flex h-9 items-center px-2">
                <Spinner />
              </div>
            ) : available ? (
              <Switch
                checked={active}
                disabled={gameRunning}
                label={active ? t('catalog.on') : t('catalog.off')}
                onChange={onToggle}
              />
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={gameRunning}
                onClick={(event) => {
                  event.stopPropagation()
                  onInstall()
                }}
              >
                <Download className="size-3.5" />
                {t('catalog.install')}
              </Button>
            )}
          </div>
        </div>
        {gameRunning ? (
          <div className="text-[10px] text-rust">{t('catalog.gameRunningHint')}</div>
        ) : null}
      </div>
    </article>
  )
}

export function CatalogPage({
  bootstrap,
  search,
  onSearch,
  onSelectPack,
  onInstall,
  onToggle,
  busyPackId,
}: {
  bootstrap: Bootstrap
  search: string
  onSearch: (value: string) => void
  onSelectPack: (packId: string) => void
  onInstall: (packId: string) => void
  onToggle: (packId: string, enabled: boolean) => void
  busyPackId: string | null
}) {
  const { t } = useTranslation()
  const normalized = search.trim().toLowerCase()

  const packs = bootstrap.catalog.packs.filter((pack) => {
    if (!normalized) return true
    if (
      pack.name.toLowerCase().includes(normalized) ||
      pack.tagline.toLowerCase().includes(normalized) ||
      pack.description.toLowerCase().includes(normalized) ||
      pack.tags.some((tag) => tag.toLowerCase().includes(normalized))
    ) {
      return true
    }
    return getEffectiveMods(bootstrap.catalog, pack.id).some(
      (mod) =>
        mod.name.toLowerCase().includes(normalized) ||
        mod.folder.toLowerCase().includes(normalized),
    )
  })

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t('catalog.search')}
          className="h-11 w-full rounded-xl border border-line bg-panel/70 pl-11 pr-4 text-sm text-bone outline-none transition-colors placeholder:text-muted/60 focus:border-acid/50 focus:ring-2 focus:ring-acid/15"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {packs.map((pack) => {
          const available = bootstrap.availablePackIds.includes(pack.id)
          const active = bootstrap.state.activePackId === pack.id && available
          return (
            <PackCard
              key={pack.id}
              pack={pack}
              available={available}
              active={active}
              busy={busyPackId === pack.id}
              gameRunning={bootstrap.game.gameRunning}
              onOpen={() => onSelectPack(pack.id)}
              onInstall={() => onInstall(pack.id)}
              onToggle={(enabled) => onToggle(pack.id, enabled)}
            />
          )
        })}
      </div>

      {packs.length === 0 ? (
        <Panel className="mt-4 p-8 text-center text-sm text-muted">{t('catalog.empty')}</Panel>
      ) : null}
    </div>
  )
}
