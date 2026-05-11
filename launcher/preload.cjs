'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcher', {
  start: (id) => ipcRenderer.send('component:start', id),
  stop: (id) => ipcRenderer.send('component:stop', id),
  restart: (id) => ipcRenderer.send('component:restart', id),
  startAll: () => ipcRenderer.send('all:start'),
  stopAll: () => ipcRenderer.send('all:stop'),
  onStatus: (cb) => ipcRenderer.on('status-update', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('error', (_e, data) => cb(data)),
  onUpdateChecking: (cb) => ipcRenderer.on('update:checking', () => cb()),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update:not-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, message) => cb(message)),
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
})
