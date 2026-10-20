import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PackHealth } from '@easypz/engine'
import type { Bootstrap, PackView } from '../../../shared/ipc'
import { Badge, Button, Panel } from './ui'
import { formatDate } from '../lib/format'

export function LibraryPage({
  bootstrap,
  onBrowse,
  onRepair,
  onActivate,
  onDeactivate,
  onVerify,
  onHost,
}: {
  bootstrap: Bootstrap
  onBrowse: () => void
  onRepair: (packId: string) => void
  onActivate: (packId: string) => Promise<void>
  onDeactivate: (packId: string, purge: boolean) => Promise<void>
  onVerify: (packId: string) => Promise<PackHealth | null>
  onHost: (packId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const [health, setHealth] = useState<Record<string, PackHealth>>({})

  const installedPacks: PackView[] = Object.keys(bootstrap.state.installs)
    .map((id) => bootstrap.catalog.packs.find((pack) => pack.id === id))
    .filter((pack): pack is PackView => Boolean(pack))
    .sort((left, right) => {
      const leftActive = bootstrap.state.activePackId === left.id ? 1 : 0
      const rightActive = bootstrap.state.activePackId === right.id ? 1 : 0
      return rightActive - leftActive
    })

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setBusy(key)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  async function verify(packId: string): Promise<void> {
    setBusy(`verify:${packId}`)
    try {
      const result = await onVerify(packId)
      if (result) setHealth((current) => ({ ...current, [packId]: result }))
    } finally {
      setBusy(null)
    }
  }

  if (installedPacks.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center justify-center px-8 py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-line bg-panel-2">
          <HardDrive className="size-7 text-muted/60" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-bone">{t('library.empty')}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">{t('library.emptyHint')}</p>
        <Button variant="primary" className="mt-6" onClick={onBrowse}>
          {t('library.browse')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight text-bone">
          {t('library.title')}
        </h1>
        <p className="mt-2 text-sm text-muted">{t('library.subtitle')}</p>
      </header>

      {bootstrap.legacyDetected ? (
        <Panel className="mt-5 flex gap-3 border-acid/20 bg-acid/[0.04] p-4">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-acid" />
          <div>
            <div className="text-xs font-semibold text-bone">{t('settings.legacy')}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted">
              {t('settings.legacyHint')}
            </div>
          </div>
        </Panel>
      ) : null}

      <div className="mt-6 space-y-4">
        {installedPacks.map((pack) => {
          const active = bootstrap.state.activePackId === pack.id
          const record = bootstrap.state.installs[pack.id]
          const packHealth = health[pack.id]

          return (
            <Panel
              key={pack.id}
              className={active ? 'overflow-hidden border-acid/35' : 'overflow-hidden'}
            >
              <div className="flex flex-col gap-5 p-5 sm:flex-row">
                <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl border border-line bg-panel-2 sm:w-48">
                  {pack.coverDataUrl ? (
                    <img src={pack.coverDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                  <div className="absolute left-2 top-2">
                    {active ? <Badge tone="acid">{t('library.active')}</Badge> : null}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl font-bold text-bone">{pack.name}</h2>
                    {!active ? <Badge tone="muted">{t('library.notActive')}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{pack.tagline}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>
                      {t('library.installedMods')}:{' '}
                      <b className="text-bone">{pack.stats.clientMods}</b>
                    </span>
                    {record ? (
                      <span>
                        {t('library.lastInstalled', { date: formatDate(record.installedAt) })}
                      </span>
                    ) : null}
                    <span className="font-mono">{pack.archive.sha256.slice(0, 10)}…</span>
                  </div>

                  {packHealth ? (
                    <div className="mt-3 rounded-xl border border-line bg-panel-2/50 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-bone">
                        {packHealth.missing.length === 0 ? (
                          <ShieldCheck className="size-3.5 text-acid" />
                        ) : (
                          <AlertTriangle className="size-3.5 text-rust" />
                        )}
                        {t('library.health')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
                        <span>
                          {t('library.modsCount', {
                            installed: packHealth.installedCount,
                            total: packHealth.totalCount,
                          })}
                        </span>
                        <span>
                          {t('library.defaultTxt')}: {packHealth.defaultTxtCount}
                        </span>
                        <span>
                          {t('library.hostMods')}:{' '}
                          {packHealth.hostModCount === null
                            ? t('library.hostNotConfigured')
                            : packHealth.hostModCount}
                        </span>
                        <span>
                          {t('library.zombieBuddy')}:{' '}
                          {packHealth.zombieBuddyInstalled ? t('common.yes') : t('common.no')}
                        </span>
                      </div>
                      {packHealth.missing.length > 0 ? (
                        <div className="mt-1 text-[10px] text-rust">
                          {t('library.healthMissing', { count: packHealth.missing.length })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {!active ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void run(`activate:${pack.id}`, () => onActivate(pack.id))}
                        loading={busy === `activate:${pack.id}`}
                      >
                        <Play className="size-3.5" />
                        {t('library.activate')}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => onRepair(pack.id)}>
                      <Wrench className="size-3.5" />
                      {t('library.repair')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void verify(pack.id)}
                      loading={busy === `verify:${pack.id}`}
                    >
                      <RefreshCw className="size-3.5" />
                      {t('library.verify')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void run(`host:${pack.id}`, () => onHost(pack.id))}
                      loading={busy === `host:${pack.id}`}
                    >
                      <Server className="size-3.5" />
                      {t('library.host')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (!window.confirm(t('library.deactivateConfirm'))) return
                        void run(`deactivate:${pack.id}`, () => onDeactivate(pack.id, false))
                      }}
                      loading={busy === `deactivate:${pack.id}`}
                    >
                      {t('library.deactivate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (!window.confirm(t('library.purgeConfirm'))) return
                        void run(`purge:${pack.id}`, () => onDeactivate(pack.id, true))
                      }}
                      loading={busy === `purge:${pack.id}`}
                    >
                      <Trash2 className="size-3.5" />
                      {t('library.purge')}
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          )
        })}
      </div>

      <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rust" />
        {t('settings.saveWarning')}
      </p>
    </div>
  )
}
