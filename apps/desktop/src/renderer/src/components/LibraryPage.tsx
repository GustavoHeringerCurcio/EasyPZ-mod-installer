import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PackHealth } from '@easypz/engine'
import type { Bootstrap, PackView } from '../../../shared/ipc'
import { Badge, Button, Panel, Switch } from './ui'
import { formatDate } from '../lib/format'

export function LibraryPage({
  bootstrap,
  busyPackId,
  onBrowse,
  onRepair,
  onToggle,
  onDelete,
  onVerify,
  onHost,
}: {
  bootstrap: Bootstrap
  busyPackId: string | null
  onBrowse: () => void
  onRepair: (packId: string) => void
  onToggle: (packId: string, enabled: boolean) => void
  onDelete: (packId: string) => void
  onVerify: (packId: string) => Promise<PackHealth | null>
  onHost: (packId: string) => void
}) {
  const { t } = useTranslation()
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null)
  const [health, setHealth] = useState<Record<string, PackHealth>>({})

  const availablePacks: PackView[] = bootstrap.availablePackIds
    .map((id) => bootstrap.catalog.packs.find((pack) => pack.id === id))
    .filter((pack): pack is PackView => Boolean(pack))
    .sort((left, right) => {
      const leftActive = bootstrap.state.activePackId === left.id ? 1 : 0
      const rightActive = bootstrap.state.activePackId === right.id ? 1 : 0
      return rightActive - leftActive
    })

  async function verify(packId: string): Promise<void> {
    setVerifyBusy(packId)
    try {
      const result = await onVerify(packId)
      if (result) setHealth((current) => ({ ...current, [packId]: result }))
    } finally {
      setVerifyBusy(null)
    }
  }

  const activePackId = bootstrap.state.activePackId
  const hostOutOfSync =
    Boolean(activePackId) && bootstrap.host.exists && bootstrap.host.matchesActivePack === false

  if (availablePacks.length === 0) {
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
        <Panel className="mt-5 flex gap-3 border-brand/20 bg-brand/[0.04] p-4">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
          <div>
            <div className="text-xs font-semibold text-bone">{t('settings.legacy')}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted">
              {t('settings.legacyHint')}
            </div>
          </div>
        </Panel>
      ) : null}

      {hostOutOfSync && activePackId ? (
        <Panel className="mt-5 flex flex-col gap-3 border-warn/25 bg-warn/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <Server className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <div className="text-xs font-semibold text-bone">{t('library.hostOutOfSync')}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted">
                {t('library.hostOutOfSyncHint', { pack: packName(bootstrap, activePackId) })}
              </div>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onHost(activePackId)}>
            <Server className="size-3.5" />
            {t('library.syncHost')}
          </Button>
        </Panel>
      ) : null}

      <div className="mt-6 space-y-4">
        {availablePacks.map((pack) => {
          const active = activePackId === pack.id
          const healthForPack = health[pack.id]
          const busy = busyPackId === pack.id
          const installRecord = bootstrap.state.installs[pack.id]

          return (
            <Panel
              key={pack.id}
              className={active ? 'overflow-hidden border-brand/35' : 'overflow-hidden'}
            >
              <div className="flex flex-col gap-5 p-5 sm:flex-row">
                <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl border border-line bg-panel-2 sm:w-48">
                  {pack.coverDataUrl ? (
                    <img src={pack.coverDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                  <div className="absolute left-2 top-2">
                    {active ? <Badge tone="brand">{t('library.active')}</Badge> : null}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl font-bold text-bone">{pack.name}</h2>
                    {!active ? <Badge tone="muted">{t('library.stored')}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{pack.tagline}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>
                      {t('library.installedMods')}:{' '}
                      <b className="text-bone">{pack.stats.clientMods}</b>
                    </span>
                    {installRecord ? (
                      <span>
                        {t('library.lastInstalled', {
                          date: formatDate(installRecord.installedAt),
                        })}
                      </span>
                    ) : null}
                    <span className="font-mono">{pack.archive.sha256.slice(0, 10)}...</span>
                  </div>

                  {healthForPack ? (
                    <div className="mt-3 rounded-xl border border-line bg-panel-2/50 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-bone">
                        {healthForPack.missing.length === 0 ? (
                          <ShieldCheck className="size-3.5 text-brand" />
                        ) : (
                          <AlertTriangle className="size-3.5 text-warn" />
                        )}
                        {t('library.health')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
                        <span>
                          {t('library.modsCount', {
                            installed: healthForPack.installedCount,
                            total: healthForPack.totalCount,
                          })}
                        </span>
                        <span>
                          {t('library.activeCount', { count: healthForPack.activeCount })}
                        </span>
                        <span>
                          {t('library.defaultTxt')}: {healthForPack.defaultTxtCount}
                        </span>
                        <span>
                          {t('library.zombieBuddy')}:{' '}
                          {healthForPack.zombieBuddyInstalled ? t('common.yes') : t('common.no')}
                        </span>
                      </div>
                      {healthForPack.missing.length > 0 ? (
                        <div className="mt-1 text-[10px] text-warn">
                          {t('library.healthMissing', { count: healthForPack.missing.length })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Switch
                      checked={active}
                      disabled={busy || bootstrap.game.gameRunning}
                      label={active ? t('catalog.on') : t('catalog.off')}
                      onChange={(enabled) => onToggle(pack.id, enabled)}
                    />
                    {active ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onRepair(pack.id)}
                        disabled={busy}
                      >
                        <Wrench className="size-3.5" />
                        {t('library.repair')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void verify(pack.id)}
                      loading={verifyBusy === pack.id}
                    >
                      <RefreshCw className="size-3.5" />
                      {t('library.verify')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => onDelete(pack.id)}
                      disabled={busy}
                    >
                      <Trash2 className="size-3.5" />
                      {t('library.deleteMods')}
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          )
        })}
      </div>

      <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
        {t('settings.saveWarning')}
      </p>
    </div>
  )
}

function packName(bootstrap: Bootstrap, packId: string): string {
  return bootstrap.catalog.packs.find((pack) => pack.id === packId)?.name ?? packId
}
