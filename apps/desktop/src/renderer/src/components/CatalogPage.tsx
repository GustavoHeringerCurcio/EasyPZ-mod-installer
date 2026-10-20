import { ArrowRight, Boxes, Download, HardDrive, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getEffectiveMods } from '@easypz/catalog'
import type { Bootstrap, PackView } from '../../../shared/ipc'
import { Badge, Panel } from './ui'
import { cn, formatBytes, formatDate } from '../lib/format'

function PackCard({
  pack,
  installed,
  active,
  onSelect,
}: {
  pack: PackView
  installed: boolean
  active: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()

  return (
    <button
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-panel/80 text-left transition-all duration-200',
        active
          ? 'border-acid/45 shadow-[0_0_40px_rgba(183,240,74,0.08)]'
          : 'border-line hover:-translate-y-0.5 hover:border-muted/50 hover:shadow-[0_16px_40px_rgba(0,0,0,0.35)]',
      )}
    >
      <div className="relative aspect-[16/8.2] overflow-hidden bg-panel-2">
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
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/10 to-transparent" />
        <div className="absolute left-4 top-4 flex gap-2">
          {active ? <Badge tone="acid">{t('catalog.active')}</Badge> : null}
          {!active && installed ? <Badge tone="neutral">{t('catalog.installed')}</Badge> : null}
          {pack.placeholderArt ? (
            <Badge tone="muted" className="backdrop-blur">
              {t('pack.placeholder')}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-2xl font-bold tracking-tight text-bone">
              {pack.name}
            </h3>
            {pack.tags[0] ? <Badge tone="muted">{pack.tags[0]}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">{pack.tagline}</p>
        </div>

        <p className="line-clamp-2 text-[13px] leading-relaxed text-muted/85">{pack.description}</p>

        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-acid" />
            <span className="text-xs text-bone">
              {t('catalog.mods', { count: pack.stats.clientMods })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Download className="size-3.5 text-muted" />
            <span className="text-xs text-muted">{formatBytes(pack.archive.sizeBytes)}</span>
          </div>
          <div className="flex items-center gap-2">
            <HardDrive className="size-3.5 text-muted" />
            <span className="text-xs text-muted">{pack.archive.requiredDiskGB} GB</span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{t('catalog.updated', { date: formatDate(pack.updatedAt) })}</span>
          <span className="inline-flex items-center gap-1 font-medium text-bone opacity-70 transition-opacity group-hover:opacity-100">
            {t('catalog.viewPack')}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </button>
  )
}

export function CatalogPage({
  bootstrap,
  search,
  onSearch,
  onSelectPack,
}: {
  bootstrap: Bootstrap
  search: string
  onSearch: (value: string) => void
  onSelectPack: (packId: string) => void
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
      <header className="noise relative overflow-hidden rounded-3xl border border-line bg-panel/60 px-8 py-8">
        <div className="absolute -right-16 -top-20 size-56 rounded-full bg-acid/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-acid">
            <span className="size-1.5 rounded-full bg-acid" />
            {t('catalog.buildLine', {
              build: bootstrap.catalog.packs[0]?.gameBuild ?? '42.21',
            })}
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-bone">
            {t('catalog.title')}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            {t('catalog.subtitle')}
          </p>

          <div className="relative mt-6 max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={t('catalog.search')}
              className="h-11 w-full rounded-xl border border-line bg-ink/60 pl-11 pr-4 text-sm text-bone outline-none transition-colors placeholder:text-muted/60 focus:border-acid/50 focus:ring-2 focus:ring-acid/15"
            />
          </div>
        </div>
      </header>

      <div className="mt-7 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {t('catalog.packCount', { count: packs.length })}
        </div>
        <div className="text-[11px] text-muted">{t('catalog.alphaNote')}</div>
      </div>

      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        {packs.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            installed={Boolean(bootstrap.state.installs[pack.id])}
            active={
              bootstrap.state.activePackId === pack.id && Boolean(bootstrap.state.installs[pack.id])
            }
            onSelect={() => onSelectPack(pack.id)}
          />
        ))}
      </div>

      {packs.length === 0 ? (
        <Panel className="mt-4 p-8 text-center text-sm text-muted">{t('catalog.empty')}</Panel>
      ) : null}
    </div>
  )
}
