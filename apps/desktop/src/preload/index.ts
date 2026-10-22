import { contextBridge, ipcRenderer } from 'electron'
import type { EngineEvent } from '@easypz/engine'
import type { EasyPzApi, Language, PendingAction } from '../shared/ipc'
import { IPC } from '../shared/ipc'

const api: EasyPzApi = {
  getBootstrap: () => ipcRenderer.invoke(IPC.getBootstrap),
  startInstall: (packId: string) => ipcRenderer.invoke(IPC.startInstall, packId),
  cancelInstall: () => ipcRenderer.invoke(IPC.cancelInstall),
  setPackEnabled: (packId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setPackEnabled, packId, enabled),
  repairPack: (packId: string) => ipcRenderer.invoke(IPC.repairPack, packId),
  deletePack: (packId: string) => ipcRenderer.invoke(IPC.deletePack, packId),
  verify: (packId: string) => ipcRenderer.invoke(IPC.verify, packId),
  applyHost: (packId: string) => ipcRenderer.invoke(IPC.applyHost, packId),
  setGamePath: (gamePath: string | null) => ipcRenderer.invoke(IPC.setGamePath, gamePath),
  pickGamePath: () => ipcRenderer.invoke(IPC.pickGamePath),
  setLanguage: (language: Language) => ipcRenderer.invoke(IPC.setLanguage, language),
  setHeapMB: (heapMB: number) => ipcRenderer.invoke(IPC.setHeapMB, heapMB),
  applyFpsBoost: (preset, heapMB) => ipcRenderer.invoke(IPC.applyFpsBoost, preset, heapMB),
  openPath: (target: string) => ipcRenderer.invoke(IPC.openPath, target),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  restartAsAdmin: (pending: PendingAction | null) =>
    ipcRenderer.invoke(IPC.restartAsAdmin, pending),
  consumePendingAction: () => ipcRenderer.invoke(IPC.consumePendingAction),
  onInstallEvent: (callback: (event: EngineEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: EngineEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IPC.installEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.installEvent, listener)
    }
  },
}

contextBridge.exposeInMainWorld('easypz', api)
