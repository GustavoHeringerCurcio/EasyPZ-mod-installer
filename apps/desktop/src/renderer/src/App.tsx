import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PackHealth } from '@easypz/engine'
import type { Bootstrap, Language } from '../../shared/ipc'
import { Sidebar, type View } from './components/Sidebar'
import { CatalogPage } from './components/CatalogPage'
import { PackDetailPage } from './components/PackDetailPage'
import { InstallOverlay } from './components/InstallOverlay'
import { LibraryPage } from './components/LibraryPage'
import { SettingsPage } from './components/SettingsPage'
import { LogsPage } from './components/LogsPage'
import { Button } from './components/ui'
import {
  createInstallState,
  emptyInstallState,
  failInstallState,
  reduceInstallEvent,
  type InstallLogLine,
  type InstallUiState,
} from './lib/install'
import { cn } from './lib/format'

type ToastKind = 'success' | 'error' | 'info'
type Toast = { kind: ToastKind; text: string }

export default function App() {
  const { t, i18n } = useTranslation()
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [view, setView] = useState<View>('catalog')
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [install, setInstall] = useState<InstallUiState>(emptyInstallState)
  const [canceling, setCanceling] = useState(false)
  const [elevation, setElevation] = useState<{ packId: string } | null>(null)
  const [elevating, setElevating] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [sessionLogs, setSessionLogs] = useState<InstallLogLine[]>([])
  const startedPending = useRef(false)

  const showToast = useCallback((kind: ToastKind, text: string) => {
    setToast({ kind, text })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const refreshBootstrap = useCallback(async () => {
    const next = await window.easypz.getBootstrap()
    setBootstrap(next)
    return next
  }, [])

  useEffect(() => {
    refreshBootstrap().catch((error: unknown) => {
      setBootError(error instanceof Error ? error.message : String(error))
    })
  }, [refreshBootstrap])

  useEffect(() => {
    if (!bootstrap) return
    void i18n.changeLanguage(bootstrap.settings.language)
    document.documentElement.lang = bootstrap.settings.language === 'pt-BR' ? 'pt-BR' : 'en'
  }, [bootstrap, i18n])

  useEffect(() => {
    return window.easypz.onInstallEvent((event) => {
      setInstall((current) => reduceInstallEvent(current, event))

      if (event.type === 'warning') {
        appendLog('warn', event.message)
      } else if (event.type === 'error') {
        appendLog('error', event.message)
      } else if (event.type === 'log') {
        appendLog(event.level === 'warn' ? 'warn' : event.level, event.message)
      } else if (event.type === 'done') {
        appendLog('info', `Install complete: ${event.summary.packId}`)
        void refreshBootstrap()
      }
    })

    function appendLog(level: InstallLogLine['level'], message: string): void {
      setSessionLogs((current) =>
        [...current, { level, message, at: new Date().toISOString() }].slice(-300),
      )
    }
  }, [refreshBootstrap])

  const startInstall = useCallback(
    async (packId: string) => {
      setCanceling(false)
      setInstall(createInstallState(packId))
      const result = await window.easypz.startInstall(packId)

      if (!result.ok) {
        if (result.needsElevation) {
          setInstall(emptyInstallState())
          setElevation({ packId })
          return
        }
        setInstall((current) => failInstallState(current, result.code, result.message))
        if (result.code !== 'CANCELLED') showToast('error', result.message)
        return
      }

      await refreshBootstrap()
      const packName = bootstrap?.catalog.packs.find((pack) => pack.id === packId)?.name ?? packId
      showToast('success', t('toast.installDone', { pack: packName }))
    },
    [bootstrap, refreshBootstrap, showToast, t],
  )

  useEffect(() => {
    if (!bootstrap || startedPending.current) return
    const pending = bootstrap.pendingAction
    if (pending?.type !== 'install') return

    startedPending.current = true
    void (async () => {
      await window.easypz.consumePendingAction()
      await startInstall(pending.packId)
    })()
  }, [bootstrap, startInstall])

  const cancelInstall = useCallback(async () => {
    setCanceling(true)
    try {
      await window.easypz.cancelInstall()
    } finally {
      setCanceling(false)
    }
  }, [])

  const restartAsAdmin = useCallback(async () => {
    if (!elevation) return
    setElevating(true)
    const result = await window.easypz.restartAsAdmin({
      type: 'install',
      packId: elevation.packId,
    })
    setElevating(false)
    if (!result.ok) showToast('error', result.message)
  }, [elevation, showToast])

  const dismissElevation = useCallback(async () => {
    await window.easypz.consumePendingAction()
    setElevation(null)
  }, [])

  const changeLanguage = useCallback(
    async (language: Language) => {
      const result = await window.easypz.setLanguage(language)
      if (result.ok) {
        setBootstrap(result.data)
        await i18n.changeLanguage(language)
      } else {
        showToast('error', result.message)
      }
    },
    [i18n, showToast],
  )

  const pickGamePath = useCallback(async () => {
    const picked = await window.easypz.pickGamePath()
    if (!picked) return
    const result = await window.easypz.setGamePath(picked)
    if (result.ok) {
      setBootstrap(result.data)
      showToast('success', t('toast.gameUpdated'))
    } else {
      showToast('error', result.message)
    }
  }, [showToast, t])

  const resetGamePath = useCallback(async () => {
    const result = await window.easypz.setGamePath(null)
    if (result.ok) {
      setBootstrap(result.data)
      showToast('success', t('toast.gameUpdated'))
    } else {
      showToast('error', result.message)
    }
  }, [showToast, t])

  const openLogs = useCallback(async () => {
    await window.easypz.openLogs()
  }, [])

  const openPath = useCallback(async (target: string | null) => {
    if (target) await window.easypz.openPath(target)
  }, [])

  const activatePack = useCallback(
    async (packId: string) => {
      const result = await window.easypz.activate(packId)
      if (!result.ok) {
        showToast('error', result.message)
        return
      }
      await refreshBootstrap()
      const packName = bootstrap?.catalog.packs.find((pack) => pack.id === packId)?.name ?? packId
      showToast('success', t('toast.activated', { pack: packName }))
    },
    [bootstrap, refreshBootstrap, showToast, t],
  )

  const deactivatePack = useCallback(
    async (packId: string, purge: boolean) => {
      const result = await window.easypz.deactivate(packId, purge)
      if (!result.ok) {
        showToast('error', result.message)
        return
      }
      await refreshBootstrap()
      showToast('success', purge ? t('toast.purged') : t('toast.deactivated'))
    },
    [refreshBootstrap, showToast, t],
  )

  const verifyPack = useCallback(
    async (packId: string): Promise<PackHealth | null> => {
      const result = await window.easypz.verify(packId)
      if (!result.ok) {
        showToast('error', result.message)
        return null
      }
      if (result.data.missing.length === 0) {
        showToast('success', t('toast.verifiedOk'))
      } else {
        showToast('info', t('toast.verifiedMissing', { count: result.data.missing.length }))
      }
      return result.data
    },
    [showToast, t],
  )

  const applyHost = useCallback(
    async (packId: string) => {
      const result = await window.easypz.applyHost(packId)
      if (!result.ok) {
        showToast('error', result.message)
        return
      }
      if (result.data.updated) {
        showToast('success', t('toast.hostUpdated'))
      } else {
        showToast('info', t('toast.hostMissing'))
      }
    },
    [showToast, t],
  )

  const selectedPack = useMemo(
    () => bootstrap?.catalog.packs.find((pack) => pack.id === selectedPackId) ?? null,
    [bootstrap, selectedPackId],
  )

  const installPackName =
    bootstrap?.catalog.packs.find((pack) => pack.id === install.packId)?.name ??
    install.packId ??
    ''

  if (!bootstrap && !bootError) {
    return <LoadingScreen />
  }

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center bg-ink p-8">
        <div className="w-full max-w-lg rounded-3xl border border-line bg-panel p-8 text-center">
          <AlertTriangle className="mx-auto size-8 text-rust" />
          <h1 className="mt-4 font-display text-2xl font-bold text-bone">{t('errors.generic')}</h1>
          <p className="mt-2 break-words text-sm text-muted">{bootError}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>{t('common.refresh')}</Button>
            <Button variant="ghost" onClick={() => void openLogs()}>
              {t('logs.open')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!bootstrap) return <LoadingScreen />

  return (
    <div className="flex h-full bg-ink text-bone">
      <Sidebar
        view={view}
        onChange={(next) => {
          setView(next)
          if (next !== 'catalog') setSelectedPackId(null)
        }}
        installedCount={Object.keys(bootstrap.state.installs).length}
        appVersion={bootstrap.appVersion}
        isElevated={bootstrap.isElevated}
        language={bootstrap.settings.language}
        onLanguage={(language) => void changeLanguage(language)}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        {view === 'catalog' ? (
          selectedPack ? (
            <PackDetailPage
              bootstrap={bootstrap}
              pack={selectedPack}
              onBack={() => setSelectedPackId(null)}
              onInstall={(packId) => void startInstall(packId)}
              installing={install.running && install.packId === selectedPack.id}
            />
          ) : (
            <CatalogPage
              bootstrap={bootstrap}
              search={search}
              onSearch={setSearch}
              onSelectPack={(packId) => setSelectedPackId(packId)}
            />
          )
        ) : null}

        {view === 'library' ? (
          <LibraryPage
            bootstrap={bootstrap}
            onBrowse={() => {
              setView('catalog')
              setSelectedPackId(null)
            }}
            onRepair={(packId) => void startInstall(packId)}
            onActivate={activatePack}
            onDeactivate={deactivatePack}
            onVerify={verifyPack}
            onHost={applyHost}
          />
        ) : null}

        {view === 'settings' ? (
          <SettingsPage
            bootstrap={bootstrap}
            onPickGamePath={pickGamePath}
            onResetGamePath={resetGamePath}
            onLanguage={(language) => void changeLanguage(language)}
            onOpen={(target) => void openPath(target)}
            onOpenLogs={() => void openLogs()}
          />
        ) : null}

        {view === 'logs' ? (
          <LogsPage
            logs={sessionLogs}
            onOpenLogs={() => void openLogs()}
            onClear={() => setSessionLogs([])}
          />
        ) : null}
      </main>

      <InstallOverlay
        state={install}
        packName={installPackName}
        canceling={canceling}
        onClose={() => setInstall(emptyInstallState())}
        onCancel={() => void cancelInstall()}
        onRetry={() => {
          if (install.packId) void startInstall(install.packId)
        }}
        onOpenGame={() => void openPath(bootstrap.paths.game)}
        onOpenLogs={() => void openLogs()}
      />

      {elevation ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink/85 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-[0_30px_100px_rgba(0,0,0,0.6)]">
            <div className="flex items-start justify-between">
              <div className="flex size-11 items-center justify-center rounded-xl border border-acid/25 bg-acid/10">
                <ShieldCheck className="size-5 text-acid" />
              </div>
              <button
                onClick={() => void dismissElevation()}
                className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-bone"
                aria-label={t('common.close')}
              >
                <X className="size-4" />
              </button>
            </div>
            <h2 className="mt-4 font-display text-xl font-bold text-bone">
              {t('elevation.title')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t('elevation.body')}</p>
            <p className="mt-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
              {t('elevation.note')}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void dismissElevation()}>
                {t('elevation.cancel')}
              </Button>
              <Button variant="primary" onClick={() => void restartAsAdmin()} loading={elevating}>
                {t('elevation.restart')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={cn(
            'fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-xs shadow-2xl',
            toast.kind === 'success'
              ? 'border-acid/30 bg-[#15200f] text-bone'
              : toast.kind === 'error'
                ? 'border-danger/35 bg-[#221011] text-bone'
                : 'border-line bg-panel text-bone',
          )}
        >
          {toast.kind === 'error' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : toast.kind === 'success' ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-acid" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rust" />
          )}
          <span className="leading-relaxed">{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-1 rounded p-0.5 text-muted hover:text-bone"
            aria-label={t('common.close')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-ink">
      <div className="relative flex size-14 items-center justify-center rounded-2xl border border-line bg-panel-2">
        <span className="font-display text-lg font-bold text-bone">EZ</span>
        <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-acid shadow-[0_0_12px_rgba(183,240,74,0.9)]" />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin text-acid" />
        {t('common.loading')}
      </div>
    </div>
  )
}
