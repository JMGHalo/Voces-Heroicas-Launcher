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
  onUpdateChecking: (cb: () => void) =>
    ipcRenderer.on('update:checking', () => cb()),
  onUpdateAvailable: (cb: (info: unknown) => void) =>
    ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateNotAvailable: (cb: (info: { current: string; latest: string }) => void) =>
    ipcRenderer.on('update:not-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb: (info: unknown) => void) =>
    ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  onUpdateError: (cb: (message: string) => void) =>
    ipcRenderer.on('update:error', (_e, message) => cb(message)),
  installUpdate: () => ipcRenderer.invoke('update:install-now'),
  refreshPaths: () => ipcRenderer.invoke('config:refresh-paths'),
  tools: {
    installTs3: () => ipcRenderer.invoke('tools:install-ts3'),
    installSaltychat: () => ipcRenderer.invoke('tools:install-saltychat'),
  },
  mods: {
    check: () => ipcRenderer.invoke('mods:check'),
    subscribeAll: () => ipcRenderer.invoke('mods:subscribe-all'),
    writeModlist: () => ipcRenderer.invoke('mods:write-modlist'),
  },
  engine: {
    applyCrispyLights: () => ipcRenderer.invoke('engine:apply-crispy-lights'),
    removeCrispyLights: () => ipcRenderer.invoke('engine:remove-crispy-lights'),
  },
})
