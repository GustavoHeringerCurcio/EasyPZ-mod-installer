import {
  AlertTriangle,
  Archive,
  ChevronRight,
  Cpu,
  FileText,
  FolderOpen,
  Gamepad2,
  Globe2,
  HardDrive,
  RefreshCw,
  Shield,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Bootstrap, Language } from '../../../shared/ipc'
import { Badge, Button, Panel, SectionTitle } from './ui'
import { formatBytes } from '../lib/format'

export function SettingsPage({
  bootstrap,
  onPickGamePath,
  onResetGamePath,
  onLanguage,
  onOpen,
  onOpenLogs,
}: {
  bootstrap: Bootstrap
  onPickGamePath: () => Promise<void>
  onResetGamePath: () => Promise<void>
  onLanguage: (language: Language) => void
  onOpen: (target: string | null) => void
  onOpenLogs: () => void
}) {
  const { t } = useTranslation()
  const game = bootstrap.game
  const paths = bootstrap.paths

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
                <Badge tone="brand">{t('settings.detected')}</Badge>
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
                value={`${game.recommendedHeapMB} MB`}
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
          <SectionTitle>{t('settings.detection')}</SectionTitle>
          <Panel className="mt-3 divide-y divide-line">
            <FactRow
              icon={game.gameRunning ? AlertTriangle : ShieldCheck}
              label={t('settings.gameProcess')}
              value={game.gameRunning ? t('settings.running') : t('settings.closed')}
              tone={game.gameRunning ? 'warn' : 'brand'}
            />
            <FactRow
              icon={game.canWriteGame ? ShieldCheck : Shield}
              label={t('settings.writeAccess')}
              value={game.canWriteGame ? t('settings.writable') : t('settings.needsAdmin')}
              tone={game.canWriteGame ? 'brand' : 'muted'}
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
              tone={bootstrap.isElevated ? 'brand' : 'muted'}
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
                      ? 'rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-ink'
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
              icon={Archive}
              label={t('settings.openCache')}
              onClick={() => onOpen(paths.cache)}
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
  tone?: 'default' | 'brand' | 'warn' | 'muted'
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Icon
        className={
          tone === 'brand'
            ? 'size-3.5 text-brand'
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
