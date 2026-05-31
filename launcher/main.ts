import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from 'electron'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { loadLauncherConfig, refreshPaths, saveLauncherConfig } from './launcher-config.js'
import { ProcessManager } from './process-manager.js'
import type { ComponentId } from './process-manager.js'
import { checkMods, writeModlist, subscribeToAll, getSteamLibrary } from './mod-manager.js'

const require = createRequire(import.meta.url)

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
    height: 452,
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

  // Start update check and path verification after renderer is fully loaded
  mainWindow.webContents.once('did-finish-load', () => {
    ensurePaths().catch(() => {})
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
  try {
    // Use createRequire to load the CJS module directly — avoids ESM/CJS
    // interop issues where dynamic import() misplaces named exports.
    const { autoUpdater } = require('electron-updater')

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () =>
      mainWindow?.webContents.send('update:checking'))
    autoUpdater.on('update-available', (info: any) =>
      mainWindow?.webContents.send('update:available', info))
    autoUpdater.on('update-not-available', (info: any) =>
      mainWindow?.webContents.send('update:not-available', {
        current: app.getVersion(), latest: info?.version,
      }))
    autoUpdater.on('update-downloaded', (info: any) =>
      mainWindow?.webContents.send('update:downloaded', info))
    autoUpdater.on('error', (err: Error) =>
      mainWindow?.webContents.send('update:error', err.message))

    autoUpdater.checkForUpdates().catch((err: Error) =>
      mainWindow?.webContents.send('update:error', err.message))
  } catch (err) {
    mainWindow?.webContents.send('update:error', (err as Error).message)
  }
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

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from 'fs'

async function ensurePaths(): Promise<{ ts: string; conan: string }> {
  if (!currentConfig) return { ts: '', conan: '' }
  refreshPaths(currentConfig)

  if (!currentConfig.teamspeak.exePath || !existsSync(currentConfig.teamspeak.exePath)) {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Seleccionar TeamSpeak 3',
      defaultPath: 'C:\\Program Files\\TeamSpeak 3 Client',
      filters: [{ name: 'Ejecutables', extensions: ['exe'] }],
      properties: ['openFile'],
    })
    if (!canceled && filePaths[0]) currentConfig.teamspeak.exePath = filePaths[0]
  }

  if (!currentConfig.conan.exePath || !existsSync(currentConfig.conan.exePath)) {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Seleccionar Conan Exiles',
      filters: [{ name: 'Ejecutables', extensions: ['exe'] }],
      properties: ['openFile'],
    })
    if (!canceled && filePaths[0]) currentConfig.conan.exePath = filePaths[0]
  }

  saveLauncherConfig(currentConfig)
  return {
    ts: currentConfig.teamspeak.exePath,
    conan: currentConfig.conan.exePath,
  }
}

ipcMain.handle('config:refresh-paths', () => ensurePaths())

ipcMain.handle('tools:install-ts3', () =>
  shell.openExternal('https://www.teamspeak.com/en/downloads/#ts3client'))

ipcMain.handle('tools:install-saltychat', () =>
  shell.openExternal('https://saltyhub.net/saltychat'))

ipcMain.handle('update:install-now', () => {
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.quitAndInstall()
  } catch {}
})

ipcMain.handle('mods:check', () => checkMods(currentConfig?.conan.exePath ?? ''))

ipcMain.handle('mods:subscribe-all', () => subscribeToAll())

ipcMain.handle('mods:write-modlist', () => writeModlist(currentConfig?.conan.exePath ?? ''))

// ── CrispyLights Engine.ini ───────────────────────────────────────────────────

const CRISPY_HEADER = '[/Game/Mods/CrispyLights/Settings.Settings_C]'
const CRISPY_SECTION = `[/Game/Mods/CrispyLights/Settings.Settings_C]
DynamicShadows=False
VolumetricShadows=True
ShadowsEverywhere=True`

function getEngineIniPath(conanExePath: string): string {
  const lib = getSteamLibrary(conanExePath)
  if (!lib) return ''
  return join(lib, 'steamapps', 'common', 'Conan Exiles', 'ConanSandbox', 'Saved', 'Config', 'Windows', 'Engine.ini')
}

function removeCrispySection(content: string): string {
  const lines = content.split(/\r?\n/)
  const result: string[] = []
  let inSection = false
  for (const line of lines) {
    if (line.trim() === CRISPY_HEADER) { inSection = true; continue }
    if (inSection && line.trim().startsWith('[')) inSection = false
    if (!inSection) result.push(line)
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n')
}

ipcMain.handle('engine:apply-crispy-lights', () => {
  const exePath = currentConfig?.conan.exePath ?? ''
  if (!exePath) return { ok: false, error: 'Ruta de Conan Exiles no detectada' }
  const iniPath = getEngineIniPath(exePath)
  if (!iniPath) return { ok: false, error: 'No se pudo encontrar la carpeta de Steam' }

  try {
    let existing = ''
    if (existsSync(iniPath)) {
      existing = readFileSync(iniPath, 'utf8')
      if (existing.includes(CRISPY_HEADER)) {
        chmodSync(iniPath, 0o444)
        return { ok: true, alreadyPresent: true }
      }
      chmodSync(iniPath, 0o666)
    } else {
      mkdirSync(dirname(iniPath), { recursive: true })
    }
    const sep = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : ''
    writeFileSync(iniPath, existing + sep + CRISPY_SECTION + '\n', 'utf8')
    chmodSync(iniPath, 0o444)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('engine:remove-crispy-lights', () => {
  const exePath = currentConfig?.conan.exePath ?? ''
  if (!exePath) return { ok: false, error: 'Ruta de Conan Exiles no detectada' }
  const iniPath = getEngineIniPath(exePath)
  if (!iniPath) return { ok: false, error: 'No se pudo encontrar la carpeta de Steam' }

  if (!existsSync(iniPath)) return { ok: true }

  try {
    const content = readFileSync(iniPath, 'utf8')
    if (!content.includes(CRISPY_HEADER)) return { ok: true }
    chmodSync(iniPath, 0o666)
    const cleaned = removeCrispySection(content)
    if (cleaned.trim() === '') {
      unlinkSync(iniPath)
    } else {
      writeFileSync(iniPath, cleaned, 'utf8')
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})
