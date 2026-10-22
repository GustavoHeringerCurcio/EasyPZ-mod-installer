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
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog'
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
import { packAccent } from './lib/packTheme'
import logo from './assets/logo.png'

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
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [busyPackId, setBusyPackId] = useState<string | null>(null)
  const startedPending = useRef(false)

  const showToast = useCallback((kind: ToastKind, text: string) => {
    setToast({ kind, text })
  }, [])

  const packNameFor = useCallback(
    (packId: string | null) =>
      packId ? (bootstrap?.catalog.packs.find((pack) => pack.id === packId)?.name ?? packId) : '',
    [bootstrap],
  )

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

  const saveHeapMB = useCallback(
    async (heapMB: number) => {
      const result = await window.easypz.setHeapMB(heapMB)
      if (result.ok) {
        setBootstrap(result.data)
        showToast('success', t('toast.heapSaved', { gb: (heapMB / 1024).toFixed(1) }))
      } else {
        showToast('error', result.message)
      }
    },
    [showToast, t],
  )

  const applyFpsBoost = useCallback(
    async (heapMB: number) => {
      const result = await window.easypz.applyFpsBoost(heapMB)
      if (result.ok) {
        setBootstrap(result.data)
        showToast('success', t('toast.fpsBoostApplied'))
      } else {
        showToast('error', result.message)
      }
    },
    [showToast, t],
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

  const performToggle = useCallback(
    async (packId: string, enabled: boolean) => {
      const previousPackId = bootstrap?.state.activePackId ?? null
      setBusyPackId(packId)
      try {
        const result = await window.easypz.setPackEnabled(packId, enabled)
        if (!result.ok) {
          showToast('error', result.message)
          return
        }
        await refreshBootstrap()
        if (enabled) {
          if (previousPackId && previousPackId !== packId) {
            showToast(
              'success',
              t('toast.switched', {
                pack: packNameFor(packId),
                previous: packNameFor(previousPackId),
              }),
            )
          } else {
            showToast('success', t('toast.activated', { pack: packNameFor(packId) }))
          }
        } else {
          showToast('success', t('toast.disabled', { pack: packNameFor(packId) }))
        }
      } finally {
        setBusyPackId(null)
      }
    },
    [bootstrap, packNameFor, refreshBootstrap, showToast, t],
  )

  const requestToggle = useCallback(
    (packId: string, enabled: boolean) => {
      if (bootstrap?.game.gameRunning) {
        showToast('info', t('catalog.gameRunningHint'))
        return
      }

      const activePackId = bootstrap?.state.activePackId ?? null
      if (!enabled) {
        setConfirmRequest({
          title: t('confirm.disableTitle', { pack: packNameFor(packId) }),
          body: t('confirm.disableBody'),
          confirmLabel: t('catalog.disable'),
          onConfirm: async () => {
            await performToggle(packId, false)
          },
        })
        return
      }

      if (activePackId && activePackId !== packId) {
        setConfirmRequest({
          title: t('confirm.switchTitle', { pack: packNameFor(packId) }),
          body: t('confirm.switchBody', {
            pack: packNameFor(packId),
            previous: packNameFor(activePackId),
          }),
          confirmLabel: t('confirm.switchAction', { pack: packNameFor(packId) }),
          onConfirm: async () => {
            await performToggle(packId, true)
          },
        })
        return
      }

      void performToggle(packId, true)
    },
    [bootstrap, packNameFor, performToggle, showToast, t],
  )

  const requestInstall = useCallback(
    (packId: string) => {
      if (bootstrap?.game.gameRunning) {
        showToast('info', t('catalog.gameRunningHint'))
        return
      }

      const activePackId = bootstrap?.state.activePackId ?? null
      if (activePackId && activePackId !== packId) {
        setConfirmRequest({
          title: t('confirm.installTitle', { pack: packNameFor(packId) }),
          body: t('confirm.installBody', {
            pack: packNameFor(packId),
            previous: packNameFor(activePackId),
          }),
          confirmLabel: t('confirm.installAction'),
          onConfirm: async () => {
            await startInstall(packId)
          },
        })
        return
      }

      void startInstall(packId)
    },
    [bootstrap, packNameFor, showToast, startInstall, t],
  )

  const repairPack = useCallback(
    async (packId: string) => {
      setBusyPackId(packId)
      try {
        const result = await window.easypz.repairPack(packId)
        if (!result.ok) {
          showToast('error', result.message)
          return
        }
        await refreshBootstrap()
        showToast('success', t('toast.repaired', { pack: packNameFor(packId) }))
      } finally {
        setBusyPackId(null)
      }
    },
    [packNameFor, refreshBootstrap, showToast, t],
  )

  const requestDelete = useCallback(
    (packId: string) => {
      setConfirmRequest({
        title: t('confirm.deleteTitle', { pack: packNameFor(packId) }),
        body: t('confirm.deleteBody', { pack: packNameFor(packId) }),
        confirmLabel: t('confirm.deleteAction'),
        destructive: true,
        onConfirm: async () => {
          setBusyPackId(packId)
          try {
            const result = await window.easypz.deletePack(packId)
            if (!result.ok) {
              showToast('error', result.message)
              return
            }
            await refreshBootstrap()
            showToast('success', t('toast.deleted', { pack: packNameFor(packId) }))
          } finally {
            setBusyPackId(null)
          }
        },
      })
    },
    [packNameFor, refreshBootstrap, showToast, t],
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
      await refreshBootstrap()
    },
    [refreshBootstrap, showToast, t],
  )

  const requestClearCache = useCallback(() => {
    setConfirmRequest({
      title: t('confirm.clearCacheTitle'),
      body: t('confirm.clearCacheBody'),
      confirmLabel: t('confirm.clearCacheAction'),
      destructive: true,
      onConfirm: async () => {
        const result = await window.easypz.clearCache()
        if (!result.ok) {
          showToast('error', result.message)
          return
        }
        setBootstrap(result.data)
        showToast('success', t('toast.cacheCleared'))
      },
    })
  }, [showToast, t])

  const requestHostSync = useCallback(
    (packId: string) => {
      setConfirmRequest({
        title: t('confirm.hostTitle'),
        body: t('confirm.hostBody'),
        confirmLabel: t('confirm.hostAction'),
        onConfirm: async () => {
          await applyHost(packId)
        },
      })
    },
    [applyHost, t],
  )

  const confirmAction = useCallback(async () => {
    if (!confirmRequest) return
    setConfirmLoading(true)
    try {
      await confirmRequest.onConfirm()
      setConfirmRequest(null)
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : String(error))
      setConfirmRequest(null)
    } finally {
      setConfirmLoading(false)
    }
  }, [confirmRequest, showToast])

  const selectedPack = useMemo(
    () => bootstrap?.catalog.packs.find((pack) => pack.id === selectedPackId) ?? null,
    [bootstrap, selectedPackId],
  )

  const installPackName =
    bootstrap?.catalog.packs.find((pack) => pack.id === install.packId)?.name ??
    install.packId ??
    ''
  const installAccent = packAccent(
    bootstrap?.catalog.packs.find((pack) => pack.id === install.packId),
  )

  if (!bootstrap && !bootError) {
    return <LoadingScreen />
  }

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center bg-ink p-8">
        <div className="w-full max-w-lg rounded-3xl border border-line bg-panel p-8 text-center">
          <AlertTriangle className="mx-auto size-8 text-warn" />
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
        installedCount={bootstrap.availablePackIds.length}
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
              onInstall={requestInstall}
              onToggle={requestToggle}
              onRepair={repairPack}
              busy={busyPackId === selectedPack.id || install.running}
            />
          ) : (
            <CatalogPage
              bootstrap={bootstrap}
              search={search}
              onSearch={setSearch}
              onSelectPack={(packId) => setSelectedPackId(packId)}
              onInstall={requestInstall}
              onToggle={requestToggle}
              busyPackId={busyPackId ?? (install.running ? install.packId : null)}
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
            onRepair={repairPack}
            onToggle={requestToggle}
            onDelete={requestDelete}
            onVerify={verifyPack}
            onHost={requestHostSync}
            busyPackId={busyPackId}
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
            onClearCache={requestClearCache}
            onSaveHeap={saveHeapMB}
            onApplyFpsBoost={applyFpsBoost}
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
        accent={installAccent}
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
              <div className="flex size-11 items-center justify-center rounded-xl border border-success/25 bg-success/10">
                <ShieldCheck className="size-5 text-success" />
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

      {confirmRequest ? (
        <ConfirmDialog
          request={confirmRequest}
          loading={confirmLoading}
          onConfirm={() => void confirmAction()}
          onCancel={() => {
            if (!confirmLoading) setConfirmRequest(null)
          }}
        />
      ) : null}

      {toast ? (
        <div
          className={cn(
            'fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-xs shadow-2xl',
            toast.kind === 'success'
              ? 'border-success/30 bg-[#0b1a10] text-bone'
              : toast.kind === 'error'
                ? 'border-danger/35 bg-[#210b0b] text-bone'
                : 'border-line bg-panel text-bone',
          )}
        >
          {toast.kind === 'error' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : toast.kind === 'success' ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
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
      <img src={logo} alt="" className="size-16 object-contain" />
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin text-brand" />
        {t('common.loading')}
      </div>
    </div>
  )
}
