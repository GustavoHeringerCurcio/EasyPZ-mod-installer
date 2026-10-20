import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Gamepad2,
  HardDrive,
  Layers,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getEffectiveGroups, getEffectiveMods } from '@easypz/catalog'
import type { Bootstrap, PackView } from '../../../shared/ipc'
import { Badge, Button, Panel, SectionTitle, Stat } from './ui'
import { cn, formatBytes, formatDate } from '../lib/format'

type Tab = 'overview' | 'mods' | 'requirements'

export function PackDetailPage({
  bootstrap,
  pack,
  onBack,
  onInstall,
  installing,
}: {
  bootstrap: Bootstrap
  pack: PackView
  onBack: () => void
  onInstall: (packId: string) => void
  installing: boolean
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('overview')
  const [modSearch, setModSearch] = useState('')

  const installed = Boolean(bootstrap.state.installs[pack.id])
  const active = bootstrap.state.activePackId === pack.id && installed
  const groups = useMemo(
    () => getEffectiveGroups(bootstrap.catalog, pack.id),
    [bootstrap.catalog, pack.id],
  )
  const mods = useMemo(
    () => getEffectiveMods(bootstrap.catalog, pack.id),
    [bootstrap.catalog, pack.id],
  )

  const normalized = modSearch.trim().toLowerCase()
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      mods: group.mods.filter(
        (mod) =>
          !normalized ||
          mod.name.toLowerCase().includes(normalized) ||
          mod.folder.toLowerCase().includes(normalized),
      ),
    }))
    .filter((group) => group.mods.length > 0)

  const actionLabel = active ? t('pack.repair') : installed ? t('pack.switch') : t('pack.install')
  const ActionIcon = active ? Wrench : installed ? Layers : Download

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-7">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-2 text-xs font-medium text-muted transition-colors hover:text-bone"
      >
        <ArrowLeft className="size-3.5" />
        {t('pack.back')}
      </button>

      <div className="overflow-hidden rounded-3xl border border-line bg-panel">
        <div className="aspect-[16/5.2] w-full overflow-hidden bg-panel-2">
          {pack.coverDataUrl ? (
            <img src={pack.coverDataUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Boxes className="size-16 text-muted/30" />
            </div>
          )}
        </div>
        <div className="border-t border-line p-7">
          <div className="flex flex-wrap items-center gap-2">
            {active ? <Badge tone="acid">{t('pack.active')}</Badge> : null}
            {!active && installed ? <Badge>{t('pack.installed')}</Badge> : null}
            <Badge tone="muted">
              {t('pack.build')} {pack.gameBuild}
            </Badge>
            {pack.placeholderArt ? <Badge tone="muted">{t('pack.placeholder')}</Badge> : null}
          </div>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-bone">
            {pack.name}
          </h1>
          <p className="mt-1 text-sm text-muted">{pack.tagline}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="flex gap-1 border-b border-line">
            {(
              [
                ['overview', t('pack.overview')],
                ['mods', `${t('pack.mods')} (${mods.length})`],
                ['requirements', t('pack.requirements')],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  '-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                  tab === id
                    ? 'border-acid text-bone'
                    : 'border-transparent text-muted hover:text-bone',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <div className="space-y-7 py-6">
              <section>
                <SectionTitle>{t('pack.overview')}</SectionTitle>
                <p className="mt-3 text-sm leading-7 text-muted">{pack.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {pack.tags.map((tag) => (
                    <Badge key={tag} tone="muted">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label={t('pack.clientMods')}
                  value={pack.stats.clientMods}
                  hint={`${pack.stats.serverMods} ${t('pack.serverMods').toLowerCase()}`}
                />
                <Stat
                  label={t('pack.workshopItems')}
                  value={pack.stats.workshopCount}
                  hint="Steam Workshop"
                />
                <Stat label={t('pack.download')} value={formatBytes(pack.archive.sizeBytes)} />
                <Stat label={t('pack.disk')} value={`${pack.archive.requiredDiskGB} GB`} />
              </div>

              <section>
                <SectionTitle>{t('pack.warnings')}</SectionTitle>
                <div className="mt-3 space-y-2">
                  {pack.warnings.map((warning) => (
                    <div
                      key={warning}
                      className="flex gap-3 rounded-xl border border-rust/20 bg-rust/[0.06] px-4 py-3"
                    >
                      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rust" />
                      <p className="text-[13px] leading-relaxed text-bone/85">{warning}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <SectionTitle>{t('pack.groups')}</SectionTitle>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {groups.map((group) => (
                    <div
                      key={`${group.packId}-${group.name}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel-2/60 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-bone">{group.name}</div>
                        <div className="text-[11px] text-muted">
                          {t('pack.modCount', { count: group.mods.length })}
                          {group.packId !== pack.id ? ` · ${t('pack.inherited')}` : ''}
                        </div>
                      </div>
                      <Badge tone="muted">{group.mods.length}</Badge>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <SectionTitle>{t('pack.credits')}</SectionTitle>
                <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted">
                  {pack.credits.map((credit) => (
                    <li key={credit}>{credit}</li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {tab === 'mods' ? (
            <div className="space-y-6 py-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  value={modSearch}
                  onChange={(event) => setModSearch(event.target.value)}
                  placeholder={t('pack.searchMods')}
                  className="h-10 w-full rounded-xl border border-line bg-panel-2/60 pl-10 pr-4 text-sm text-bone outline-none transition-colors placeholder:text-muted/60 focus:border-acid/50"
                />
              </div>

              {filteredGroups.map((group) => (
                <section key={`${group.packId}-${group.name}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 className="font-display text-sm font-semibold text-bone">{group.name}</h3>
                    {group.packId !== pack.id ? (
                      <Badge tone="muted">{t('pack.inherited')}</Badge>
                    ) : null}
                    <div className="h-px flex-1 bg-line" />
                  </div>
                  <div className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
                    {group.mods.map((mod) => (
                      <div
                        key={`${mod.workshopId}-${mod.folder}`}
                        className="flex items-center gap-4 bg-panel-2/35 px-4 py-3"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel">
                          {mod.serverOnly ? (
                            <Server className="size-3.5 text-muted" />
                          ) : (
                            <Sparkles className="size-3.5 text-acid/80" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-bone">
                            {mod.name}
                          </div>
                          <div className="truncate font-mono text-[10px] text-muted">
                            {mod.folder} · {mod.workshopId}
                          </div>
                        </div>
                        {mod.serverOnly ? <Badge tone="muted">{t('pack.serverOnly')}</Badge> : null}
                        {mod.workshopUrl ? (
                          <a
                            href={mod.workshopUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={t('pack.openWorkshop')}
                            className="rounded-lg p-2 text-muted transition-colors hover:bg-white/5 hover:text-bone"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {filteredGroups.length === 0 ? (
                <Panel className="p-8 text-center text-sm text-muted">{t('pack.noMods')}</Panel>
              ) : null}
            </div>
          ) : null}

          {tab === 'requirements' ? (
            <div className="space-y-6 py-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <RequirementRow icon={Gamepad2} label={t('pack.build')} value={pack.gameBuild} />
                <RequirementRow
                  icon={Cpu}
                  label={t('pack.ram')}
                  value={`${pack.requirements.ramGB} GB+`}
                />
                <RequirementRow
                  icon={Cpu}
                  label={t('pack.recommendedRam')}
                  value={`${pack.requirements.recommendedRamGB} GB`}
                />
                {pack.requirements.vramGB ? (
                  <RequirementRow
                    icon={Gamepad2}
                    label={t('pack.vram')}
                    value={`${pack.requirements.vramGB} GB`}
                  />
                ) : null}
                <RequirementRow
                  icon={HardDrive}
                  label={t('pack.disk')}
                  value={`${pack.requirements.freeDiskGB} GB ${t('pack.free')}`}
                />
                <RequirementRow
                  icon={Download}
                  label={t('pack.download')}
                  value={formatBytes(pack.archive.sizeBytes)}
                />
              </div>

              <Panel className="p-5">
                <SectionTitle>{t('pack.updated')}</SectionTitle>
                <p className="mt-2 text-sm text-muted">{formatDate(pack.updatedAt)}</p>
              </Panel>
            </div>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Panel className="overflow-hidden">
            <div className="border-b border-line bg-panel-2/60 px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {t('pack.requires')}
                </span>
                {active ? (
                  <CheckCircle2 className="size-4 text-acid" />
                ) : installed ? (
                  <Badge>{t('pack.installedBadge')}</Badge>
                ) : null}
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-bone">
                {pack.stats.clientMods}
                <span className="ml-1.5 text-xs font-medium text-muted">
                  {t('pack.clientMods').toLowerCase()}
                </span>
              </div>
            </div>

            <div className="space-y-3 px-5 py-4 text-xs">
              <Row label={t('pack.download')} value={formatBytes(pack.archive.sizeBytes)} />
              <Row label={t('pack.disk')} value={`${pack.archive.requiredDiskGB} GB`} />
              <Row label={t('pack.build')} value={pack.gameBuild} />
              <Row label={t('pack.workshopItems')} value={String(pack.stats.workshopCount)} />
            </div>

            <div className="border-t border-line p-4">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => onInstall(pack.id)}
                loading={installing}
              >
                <ActionIcon className="size-4" />
                {actionLabel}
              </Button>
              <p className="mt-3 text-center text-[10px] leading-relaxed text-muted">
                {active ? t('pack.activeHint') : t('pack.installHint')}
              </p>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function RequirementRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gamepad2
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/50 px-4 py-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-panel">
        <Icon className="size-3.5 text-acid/80" />
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </div>
        <div className="text-sm font-medium text-bone">{value}</div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-bone">{value}</span>
    </div>
  )
}
