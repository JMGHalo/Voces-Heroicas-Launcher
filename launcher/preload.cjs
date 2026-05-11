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
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, message) => cb(message)),
  installUpdate: () => ipcRenderer.invoke('update:install-now'),
  refreshPaths: () => ipcRenderer.invoke('config:refresh-paths'),
  mods: {
    check: () => ipcRenderer.invoke('mods:check'),
    openCollection: () => ipcRenderer.invoke('mods:open-collection'),
    writeModlist: () => ipcRenderer.invoke('mods:write-modlist'),
  },
})
