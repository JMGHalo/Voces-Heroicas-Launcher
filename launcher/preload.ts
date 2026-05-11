import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('launcher', {
  start: (id: string) => ipcRenderer.send('component:start', id),
  stop: (id: string) => ipcRenderer.send('component:stop', id),
  restart: (id: string) => ipcRenderer.send('component:restart', id),
  startAll: () => ipcRenderer.send('all:start'),
  stopAll: () => ipcRenderer.send('all:stop'),
  onStatus: (cb: (data: unknown) => void) =>
    ipcRenderer.on('status-update', (_e, data) => cb(data)),
  onError: (cb: (data: unknown) => void) =>
    ipcRenderer.on('error', (_e, data) => cb(data)),
  onUpdateAvailable: (cb: (info: unknown) => void) =>
    ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb: (info: unknown) => void) =>
    ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.invoke('update:install-now'),
  refreshPaths: () => ipcRenderer.invoke('config:refresh-paths'),
  mods: {
    check: () => ipcRenderer.invoke('mods:check'),
    openCollection: () => ipcRenderer.invoke('mods:open-collection'),
    writeModlist: () => ipcRenderer.invoke('mods:write-modlist'),
  },
})
