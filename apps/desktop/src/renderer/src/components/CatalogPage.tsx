import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import { Boxes, Download, Loader2, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getEffectiveMods } from '@easypz/catalog'
import type { Bootstrap, PackView } from '../../../shared/ipc'
import { Badge, Button, Panel, Switch } from './ui'
import { cn, formatBytes } from '../lib/format'
import { isRecommendedPack, packAccent } from '../lib/packTheme'
import otherModpackImage from '../assets/other-modpack.jpg'

function PackCard({
  pack,
  available,
  active,
  busy,
  gameRunning,
  onOpen,
  onInstall,
  onToggle,
  className,
}: {
  pack: PackView
  available: boolean
  active: boolean
  busy: boolean
  gameRunning: boolean
  onOpen: () => void
  onInstall: () => void
  onToggle: (enabled: boolean) => void
  className?: string
}) {
  const { t } = useTranslation()
  const accent = packAccent(pack)

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
      style={{ '--pack-accent': accent } as CSSProperties}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-panel/80 text-left transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
        active
          ? 'border-success/30 shadow-[0_0_40px_rgba(34,197,94,0.08)]'
          : 'border-line hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_16px_40px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-panel-2">
        {pack.coverDataUrl ? (
          <img
            src={pack.coverDataUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-ink">
            <Boxes className="size-12 text-muted/40" />
          </div>
        )}
        <span className="pack-accent-soft pack-accent-border pack-accent-text absolute left-3 top-3 inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] backdrop-blur-sm">
          {pack.tags[0] ?? pack.name}
        </span>
        {active ? (
          <div className="absolute right-3 top-3 rounded-full bg-ink/70 p-0.5 backdrop-blur-sm">
            <Badge tone="success">{t('catalog.active')}</Badge>
          </div>
        ) : null}
        <span className="absolute inset-x-0 top-0 h-0.5 pack-accent-fill" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight text-bone">{pack.name}</h3>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted">
            {pack.tagline}
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex flex-nowrap items-center gap-3 text-sm font-semibold text-bone">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Sparkles className="size-4 text-bone" />
              {t('catalog.modsShort', { count: pack.stats.clientMods })}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-bone/80">
              <Download className="size-4" />
              {formatBytes(pack.archive?.sizeBytes ?? pack.workshop?.downloadBytes ?? 0)}
            </span>
          </div>

          <div onClick={stop} onKeyDown={stop} className="shrink-0">
            {busy ? (
              <div className="flex h-9 items-center px-2">
                <Loader2 className="size-4 animate-spin text-bone" />
              </div>
            ) : available ? (
              <Switch
                checked={active}
                disabled={gameRunning}
                label={active ? t('catalog.on') : t('catalog.off')}
                showLabel={false}
                onChange={onToggle}
              />
            ) : (
              <Button
                size="sm"
                variant="light"
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
          <div className="text-[10px] text-warn">{t('catalog.gameRunningHint')}</div>
        ) : null}
      </div>
    </article>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  const { t } = useTranslation()

  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="font-display text-lg font-semibold tracking-tight text-bone">{title}</h2>
      <span className="shrink-0 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {t('catalog.packCount', { count })}
      </span>
    </div>
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
    if (pack.workshop?.items.some((item) => item.name.toLowerCase().includes(normalized))) {
      return true
    }
    return getEffectiveMods(bootstrap.catalog, pack.id).some(
      (mod) =>
        mod.name.toLowerCase().includes(normalized) ||
        mod.folder.toLowerCase().includes(normalized),
    )
  })

  const recommended = packs.filter(isRecommendedPack)
  const morePacks = packs.filter((pack) => !isRecommendedPack(pack))
  const searching = normalized.length > 0

  const renderCard = (pack: PackView, className: string) => {
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
        className={className}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-bone">
            {t('catalog.title')}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            {t('catalog.subtitle')}
          </p>
        </div>
        <span className="rounded-full border border-line bg-panel-2 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          {t('catalog.packCount', { count: packs.length })}
        </span>
      </header>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t('catalog.search')}
          className="h-11 w-full rounded-xl border border-line bg-panel/70 pl-11 pr-4 text-sm text-bone outline-none transition-colors placeholder:text-muted/60 focus:border-white/30 focus:ring-2 focus:ring-white/10"
        />
      </div>

      {recommended.length > 0 ? (
        <section className="mt-8">
          <SectionHeader title={t('catalog.recommended')} count={recommended.length} />
          <div className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3">
            {recommended.map((pack) => renderCard(pack, 'min-w-[250px] flex-1 basis-0 snap-start'))}
          </div>
        </section>
      ) : null}

      {morePacks.length > 0 || !searching ? (
        <section className="mt-8">
          <SectionHeader title={t('catalog.morePacks')} count={morePacks.length} />
          {morePacks.length > 0 ? (
            <div className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3">
              {morePacks.map((pack) => renderCard(pack, 'w-[300px] shrink-0 snap-start'))}
            </div>
          ) : (
            <div className="relative mt-4 overflow-hidden rounded-2xl border border-line bg-panel">
              <img
                src={otherModpackImage}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-30"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
              <div className="relative flex min-h-[120px] flex-col justify-center px-6 py-6">
                <div className="text-sm font-semibold text-bone">{t('catalog.morePacksEmpty')}</div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {packs.length === 0 ? (
        <Panel className="mt-6 p-8 text-center text-sm text-muted">{t('catalog.empty')}</Panel>
      ) : null}
    </div>
  )
}
