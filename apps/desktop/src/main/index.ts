import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import {
  EasyPzError,
  activateInstalledPack,
  applyHostForPack,
  deactivatePack,
  getAppPaths,
  getGameInfo,
  getPackHealth,
  installPack,
  isEasyPzError,
  loadState,
  saveState,
  setGamePathOverride,
  type EngineEvent,
} from '@easypz/engine'
import { getPack, type Catalog } from '@easypz/catalog'
import type {
  Bootstrap,
  DeactivateResult,
  OperationResult,
  PendingAction,
  Settings,
} from '../shared/ipc'
import { IPC } from '../shared/ipc'
import { loadCatalog, toCatalogView } from './catalog'
import { ensureLogsDir, log, logsDir } from './logger'
import { isLanguage, readSettings, updateSettings } from './settings'

app.setName('EasyPZ Mod Installer')
app.setPath('userData', path.join(app.getPath('appData'), 'EasyPZ'))

const execFileAsync = promisify(execFile)

let mainWindow: BrowserWindow | null = null
let activeInstall: AbortController | null = null

function pendingActionPath(): string {
  return path.join(app.getPath('userData'), 'pending-action.json')
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readPendingAction(): Promise<PendingAction | null> {
  try {
    const raw = await fs.readFile(pendingActionPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PendingAction>
    if (parsed.type === 'install' && typeof parsed.packId === 'string') {
      return { type: 'install', packId: parsed.packId }
    }
  } catch {
    // No pending action.
  }
  return null
}

async function writePendingAction(pending: PendingAction | null): Promise<void> {
  const file = pendingActionPath()
  if (!pending) {
    await fs.rm(file, { force: true })
    return
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
}

function fail(error: unknown): OperationResult<never> {
  const code = isEasyPzError(error) ? error.code : 'IO'
  const message = isEasyPzError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error)
  return {
    ok: false,
    code,
    message,
    needsElevation: code === 'ELEVATION_REQUIRED',
  }
}

function sendInstallEvent(event: EngineEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.installEvent, event)

  if (event.type === 'stage') {
    log.info(`[install] ${event.stage}:${event.status}${event.detail ? ` (${event.detail})` : ''}`)
  } else if (event.type === 'warning') {
    log.warn(`[install] ${event.message}`)
  } else if (event.type === 'error') {
    log.error(`[install] ${event.code}: ${event.message}`)
  } else if (event.type === 'done') {
    log.info(`[install] done: ${JSON.stringify(event.summary)}`)
  } else if (event.type === 'log') {
    log.info(`[install] ${event.message}`)
  }
}

async function buildBootstrap(): Promise<Bootstrap> {
  const paths = getAppPaths()
  const settings = await readSettings()
  const catalog = await loadCatalog()
  const catalogView = await toCatalogView(catalog)
  const game = await getGameInfo(paths, { gamePathOverride: settings.gamePathOverride })
  const state = await loadState(paths, { catalog, migrate: true })
  const legacyDetected =
    (await fileExists(paths.legacyProfileFile)) ||
    (await fileExists(paths.legacyMarkerFile)) ||
    (await fileExists(paths.legacyInstallerDir))

  log.info(
    `Bootstrap: catalog=${catalog.mode}/${catalog.packs.length} packs, game=${game.found ? 'found' : 'missing'}, active=${state.activePackId ?? 'none'}, legacy=${legacyDetected}, elevated=${game.elevated}`,
  )

  return {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    catalog: catalogView,
    game,
    state,
    settings,
    legacyDetected,
    isElevated: game.elevated,
    logsPath: logsDir,
    paths: {
      cache: paths.cacheDir,
      mods: path.join(paths.zomboidDir, 'mods'),
      backups: paths.backupDir,
      zomboid: paths.zomboidDir,
      game: game.pzPath,
      logs: logsDir,
    },
    pendingAction: await readPendingAction(),
    platform: process.platform,
  }
}

async function loadCatalogForOperation(): Promise<Catalog> {
  return loadCatalog()
}

function registerIpc(): void {
  ipcMain.handle(IPC.getBootstrap, async (): Promise<Bootstrap> => {
    try {
      return await buildBootstrap()
    } catch (error) {
      log.error('Bootstrap failed', error)
      throw error
    }
  })

  ipcMain.handle(IPC.startInstall, async (_event, packId: unknown) => {
    if (typeof packId !== 'string') return fail(new Error('Invalid pack selection.'))
    if (activeInstall) {
      return {
        ok: false,
        code: 'BUSY',
        message: 'Another installation is already running.',
      } satisfies OperationResult<never>
    }

    try {
      const paths = getAppPaths()
      const settings = await readSettings()
      const catalog = await loadCatalogForOperation()
      const pack = getPack(catalog, packId)
      const game = await getGameInfo(paths, { gamePathOverride: settings.gamePathOverride })

      if (!game.found || !game.pzPath) {
        throw new EasyPzError(
          'GAME_NOT_FOUND',
          game.detectionError ??
            'Project Zomboid was not found. Install it through Steam or choose the game folder in Settings.',
        )
      }
      if (game.gameRunning) {
        throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before installing.')
      }
      if (!game.elevated && !game.canWriteGame) {
        return {
          ok: false,
          code: 'ELEVATION_REQUIRED',
          message: 'Administrator access is required to write to the Project Zomboid folder.',
          needsElevation: true,
        } satisfies OperationResult<never>
      }

      activeInstall = new AbortController()
      const controller = activeInstall
      const summary = await installPack({
        catalog,
        packId: pack.id,
        paths,
        gamePathOverride: settings.gamePathOverride,
        signal: controller.signal,
        onEvent: sendInstallEvent,
      })
      return { ok: true, data: summary } satisfies OperationResult<typeof summary>
    } catch (error) {
      return fail(error)
    } finally {
      activeInstall = null
    }
  })

  ipcMain.handle(IPC.cancelInstall, async () => {
    activeInstall?.abort()
  })

  ipcMain.handle(IPC.activate, async (_event, packId: unknown) => {
    if (typeof packId !== 'string') return fail(new Error('Invalid pack selection.'))
    if (activeInstall) {
      return {
        ok: false,
        code: 'BUSY',
        message: 'Wait for the installation to finish.',
      } satisfies OperationResult<never>
    }
    try {
      const result = await activateInstalledPack({
        catalog: await loadCatalogForOperation(),
        packId,
        paths: getAppPaths(),
        onEvent: sendInstallEvent,
      })
      return { ok: true, data: { modCount: result.modCount } } satisfies OperationResult<{
        modCount: number
      }>
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.deactivate, async (_event, packId: unknown, purge: unknown) => {
    if (typeof packId !== 'string') return fail(new Error('Invalid pack selection.'))
    try {
      const result = await deactivatePack({
        catalog: await loadCatalogForOperation(),
        packId,
        paths: getAppPaths(),
        purge: Boolean(purge),
        onEvent: sendInstallEvent,
      })
      return { ok: true, data: result } satisfies OperationResult<DeactivateResult>
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.verify, async (_event, packId: unknown) => {
    if (typeof packId !== 'string') return fail(new Error('Invalid pack selection.'))
    try {
      const settings = await readSettings()
      const health = await getPackHealth({
        catalog: await loadCatalogForOperation(),
        packId,
        paths: getAppPaths(),
        gamePathOverride: settings.gamePathOverride,
      })
      return { ok: true, data: health } satisfies OperationResult<typeof health>
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.applyHost, async (_event, packId: unknown) => {
    if (typeof packId !== 'string') return fail(new Error('Invalid pack selection.'))
    try {
      const result = await applyHostForPack({
        catalog: await loadCatalogForOperation(),
        packId,
        paths: getAppPaths(),
        onEvent: sendInstallEvent,
      })
      return { ok: true, data: result } satisfies OperationResult<typeof result>
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.setGamePath, async (_event, gamePath: unknown) => {
    if (gamePath !== null && typeof gamePath !== 'string') {
      return fail(new Error('Invalid game path.'))
    }

    try {
      const nextPath = typeof gamePath === 'string' ? path.resolve(gamePath) : null
      if (nextPath) {
        const exe = path.join(nextPath, 'ProjectZomboid64.exe')
        if (!(await fileExists(exe))) {
          throw new EasyPzError(
            'GAME_NOT_FOUND',
            'That folder does not contain ProjectZomboid64.exe.',
          )
        }
      }

      const settings = await readSettings()
      await updateSettings({ ...settings, gamePathOverride: nextPath })
      const paths = getAppPaths()
      const catalog = await loadCatalogForOperation()
      const state = await loadState(paths, { catalog, migrate: true })
      await saveState(paths, setGamePathOverride(state, nextPath))
      return { ok: true, data: await buildBootstrap() } satisfies OperationResult<Bootstrap>
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.pickGamePath, async () => {
    const settings = await readSettings()
    const result = await dialog.showOpenDialog({
      title: 'Select the Project Zomboid folder',
      properties: ['openDirectory'],
      defaultPath: settings.gamePathOverride ?? undefined,
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.setLanguage, async (_event, language: unknown) => {
    if (!isLanguage(language)) return fail(new Error('Unsupported language.'))
    try {
      const settings: Settings = await updateSettings({ language })
      log.info(`Language set to ${settings.language}`)
      return { ok: true, data: await buildBootstrap() } satisfies OperationResult<Bootstrap>
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.openPath, async (_event, target: unknown) => {
    if (typeof target !== 'string' || target.length === 0) return
    const result = await shell.openPath(target)
    if (result) log.warn(`openPath failed for ${target}: ${result}`)
  })

  ipcMain.handle(IPC.openLogs, async () => {
    await ensureLogsDir()
    log.info('Opening logs folder')
    await shell.openPath(logsDir)
  })

  ipcMain.handle(IPC.restartAsAdmin, async (_event, pending: unknown) => {
    const action =
      pending && typeof pending === 'object' && (pending as PendingAction).type === 'install'
        ? (pending as PendingAction)
        : null

    await writePendingAction(action)

    if (!app.isPackaged) {
      await writePendingAction(null)
      return {
        ok: false,
        code: 'DEV_ELEVATION',
        message:
          'Elevation relaunch only works in a packaged build. Run the development terminal as Administrator to test installs.',
      } satisfies OperationResult<never>
    }

    try {
      const exe = process.execPath.replace(/'/g, "''")
      const command = `Start-Process -FilePath '${exe}' -Verb RunAs -ArgumentList '--elevated'`
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
        windowsHide: true,
      })
      log.info('Elevated relaunch requested')
      setTimeout(() => app.quit(), 800)
      return { ok: true, data: undefined as never } satisfies OperationResult<never>
    } catch (error) {
      await writePendingAction(null)
      return fail(error)
    }
  })

  ipcMain.handle(IPC.consumePendingAction, async () => {
    const pending = await readPendingAction()
    if (pending) await writePendingAction(null)
    return pending
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    show: false,
    backgroundColor: '#0a0d0c',
    autoHideMenuBar: true,
    title: 'EasyPZ Mod Installer',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    log.info('Window ready')
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Renderer loaded')
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error(`Renderer failed to load (${code}): ${description} ${url}`)
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error(`Preload failed (${preloadPath})`, error)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', details)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function installContentSecurityPolicy(): void {
  const production =
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self';"
  const development =
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: ws://localhost:* http://localhost:*; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws://localhost:* http://localhost:*;"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [app.isPackaged ? production : development],
      },
    })
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.easypz.installer')
  Menu.setApplicationMenu(null)
  await ensureLogsDir()
  installContentSecurityPolicy()
  registerIpc()
  createWindow()

  log.info(`EasyPZ ${app.getVersion()} started (packaged=${app.isPackaged})`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', error)
})

process.on('unhandledRejection', (error) => {
  log.error('Unhandled rejection', error)
})
