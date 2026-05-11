import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

export interface LauncherConfig {
  teamspeak: {
    exePath: string
    autoConnect: {
      enabled: boolean
      address: string
      port: number
      nickname: string
      serverPassword: string
      channel: string
      channelPassword: string
    }
  }
  conan: {
    steamAppId: string
    exePath: string   // direct exe path; empty = fall back to Steam URL
  }
  intermediate: {
    autoStart: boolean
  }
  ui: {
    startAllOnLaunch: boolean
    stopAllOnClose: boolean
  }
  updates: {
    checkOnLaunch: boolean
    channel: string
  }
}

function detectConanPath(): string {
  try {
    // 1. Find Steam install dir from registry
    const steamReg = execSync(
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const steamPath = steamReg.match(/InstallPath\s+REG_SZ\s+(.+)/)?.[1]?.trim()
    if (!steamPath) return ''

    // 2. Collect all Steam library folders
    const libraries: string[] = [steamPath]
    const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
    if (existsSync(vdfPath)) {
      const vdf = readFileSync(vdfPath, 'utf8')
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        const p = m[1].replace(/\\\\/g, '\\')
        if (!libraries.includes(p)) libraries.push(p)
      }
    }

    // 3. Find the library that has appmanifest_440900.acf
    for (const lib of libraries) {
      const manifest = join(lib, 'steamapps', 'appmanifest_440900.acf')
      if (!existsSync(manifest)) continue
      const content = readFileSync(manifest, 'utf8')
      const installDir = content.match(/"installdir"\s+"([^"]+)"/)?.[1]
      if (!installDir) continue
      const base = join(lib, 'steamapps', 'common', installDir)
      // Known exe locations, in order of preference
      const candidates = [
        join(base, 'ConanSandbox', 'Binaries', 'Win64', 'ConanSandbox-Win64-Shipping.exe'),
        join(base, 'ConanSandbox.exe'),
      ]
      for (const c of candidates) {
        if (existsSync(c)) return c
      }
    }
  } catch {}
  return ''
}

function detectTs3Path(): string {
  const keys = [
    'HKLM\\SOFTWARE\\TeamSpeak 3 Client',
    'HKCU\\SOFTWARE\\TeamSpeak 3 Client',
    'HKLM\\SOFTWARE\\WOW6432Node\\TeamSpeak 3 Client',
    'HKCU\\SOFTWARE\\WOW6432Node\\TeamSpeak 3 Client',
  ]
  for (const key of keys) {
    try {
      const out = execSync(`reg query "${key}" /v InstallLocation`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const match = out.match(/InstallLocation\s+REG_SZ\s+(.+)/)
      if (match) {
        const dir = match[1].trim()
        const exe = join(dir, 'ts3client_win64.exe')
        if (existsSync(exe)) return exe
      }
    } catch {}
  }
  return ''
}

function makeDefaults(): LauncherConfig {
  return {
    teamspeak: {
      exePath: detectTs3Path() || 'C:\\Program Files\\TeamSpeak 3 Client\\ts3client_win64.exe',
      autoConnect: {
        enabled: true,
        address: '',
        port: 9987,
        nickname: '',
        serverPassword: '',
        channel: '',
        channelPassword: '',
      },
    },
    conan: { steamAppId: '440900', exePath: detectConanPath() },
    intermediate: { autoStart: true },
    ui: { startAllOnLaunch: false, stopAllOnClose: true },
    updates: { checkOnLaunch: true, channel: 'stable' },
  }
}

function getConfigPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'launcher-config.json')
}

export function loadLauncherConfig(): LauncherConfig {
  const path = getConfigPath()
  const defaults = makeDefaults()

  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(defaults, null, 2), 'utf8')
    return defaults
  }

  let config: LauncherConfig
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LauncherConfig>
    config = {
      ...defaults,
      ...raw,
      teamspeak: {
        ...defaults.teamspeak,
        ...(raw.teamspeak ?? {}),
        autoConnect: {
          ...defaults.teamspeak.autoConnect,
          ...(raw.teamspeak?.autoConnect ?? {}),
        },
      },
      ui: { ...defaults.ui, ...(raw.ui ?? {}) },
      updates: { ...defaults.updates, ...(raw.updates ?? {}) },
    }
  } catch {
    config = defaults
  }

  refreshPaths(config)
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8')
  return config
}

export function saveLauncherConfig(config: LauncherConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8')
}

export function refreshPaths(config: LauncherConfig): void {
  const ts = detectTs3Path()
  if (ts) config.teamspeak.exePath = ts
  const conan = detectConanPath()
  if (conan) config.conan.exePath = conan
}

export function buildTs3Url(config: LauncherConfig): string {
  const ac = config.teamspeak.autoConnect
  if (!ac.address) return ''
  const params = new URLSearchParams()
  if (ac.port !== 9987) params.set('port', String(ac.port))
  if (ac.nickname) params.set('nickname', ac.nickname)
  if (ac.serverPassword) params.set('password', ac.serverPassword)
  if (ac.channel) params.set('channel', ac.channel)
  if (ac.channelPassword) params.set('channel_password', ac.channelPassword)
  const query = params.toString()
  return `ts3server://${ac.address}${query ? '?' + query : ''}`
}
