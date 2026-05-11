import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { loadLauncherConfig, refreshPaths, saveLauncherConfig } from './launcher-config.js'
import { ProcessManager } from './process-manager.js'
import type { ComponentId } from './process-manager.js'
import { checkMods, writeModlist, openCollection } from './mod-manager.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null

// Set userData path before app is ready
app.setPath('userData', join(app.getPath('appData'), 'VocesHeroicasLauncher'))

function createWindow(config: ReturnType<typeof loadLauncherConfig>): void {
  processManager = new ProcessManager(config)

  mainWindow = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Voces Heroicas Launcher',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // Start update check only after the renderer is fully loaded so IPC messages are not lost
  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged && config.updates.checkOnLaunch) {
      runUpdateCheck()
    }
  })

  statusInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && processManager) {
      mainWindow.webContents.send('status-update', processManager.getStatus())
    }
  }, 2000)

  mainWindow.on('closed', async () => {
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null }
    if (config.ui.stopAllOnClose && processManager) {
      await processManager.stopAll().catch(() => {})
    }
    mainWindow = null
  })
}

// Clear any GitHub tokens before importing electron-updater — an invalid
// GH_TOKEN in the environment causes a silent 401 on public repos.
delete process.env.GH_TOKEN
delete process.env.GITHUB_TOKEN

function runUpdateCheck(): void {
  // electron-updater is CJS; with ESM dynamic import the exports land on .default
  import('electron-updater').then((mod: any) => {
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? mod.default

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () =>
      mainWindow?.webContents.send('update:checking'))
    autoUpdater.on('update-available', (info: unknown) =>
      mainWindow?.webContents.send('update:available', info))
    autoUpdater.on('update-not-available', () =>
      mainWindow?.webContents.send('update:not-available'))
    autoUpdater.on('update-downloaded', (info: unknown) =>
      mainWindow?.webContents.send('update:downloaded', info))
    autoUpdater.on('error', (err: Error) =>
      mainWindow?.webContents.send('update:error', err.message))

    autoUpdater.checkForUpdates().catch((err: Error) =>
      mainWindow?.webContents.send('update:error', err.message))
  }).catch((err: Error) =>
    mainWindow?.webContents.send('update:error', err.message))
}

app.whenReady().then(() => {
  // Set VOCES_APP_ROOT so the intermediate app finds config.json
  process.env.VOCES_APP_ROOT = app.isPackaged ? process.resourcesPath : app.getAppPath()

  const config = loadLauncherConfig()
  currentConfig = config
  createWindow(config)
  processManager?.initAll().catch(() => {})
})

app.on('window-all-closed', () => { app.quit() })

// ── IPC handlers ──────────────────────────────────────────────────────────────

function send(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

ipcMain.on('component:start', (_e, id: ComponentId) => {
  processManager?.start(id).catch(err =>
    send('error', { id, message: (err as Error).message }))
})

ipcMain.on('component:stop', (_e, id: ComponentId) => {
  processManager?.stop(id).catch(err =>
    send('error', { id, message: (err as Error).message }))
})

ipcMain.on('component:restart', (_e, id: ComponentId) => {
  processManager?.restart(id).catch(err =>
    send('error', { id, message: (err as Error).message }))
})

ipcMain.on('all:start', () => {
  processManager?.startAll().catch(err =>
    send('error', { id: 'all', message: (err as Error).message }))
})

ipcMain.on('all:stop', () => {
  processManager?.stopAll().catch(err =>
    send('error', { id: 'all', message: (err as Error).message }))
})

let currentConfig: ReturnType<typeof loadLauncherConfig> | null = null

ipcMain.handle('config:refresh-paths', () => {
  if (!currentConfig) return { ts: '', conan: '' }
  refreshPaths(currentConfig)
  saveLauncherConfig(currentConfig)
  return {
    ts: currentConfig.teamspeak.exePath,
    conan: currentConfig.conan.exePath,
  }
})

ipcMain.handle('update:install-now', () => {
  import('electron-updater').then((mod: any) => {
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? mod.default
    autoUpdater.quitAndInstall()
  }).catch(() => {})
})

ipcMain.handle('mods:check', () => checkMods(currentConfig?.conan.exePath ?? ''))

ipcMain.handle('mods:open-collection', () => { openCollection() })

ipcMain.handle('mods:write-modlist', () => writeModlist(currentConfig?.conan.exePath ?? ''))
