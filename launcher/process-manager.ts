import { EventEmitter } from 'events'
import { execFile, execSync, spawn } from 'child_process'
import { createConnection } from 'net'
import type { LauncherConfig } from './launcher-config.js'
import { buildTs3Url } from './launcher-config.js'
import type { AppHandle } from '../src/index.js'

export type ComponentStatus = 'stopped' | 'starting' | 'running' | 'error'
export type ComponentId = 'teamspeak' | 'intermediate' | 'conan'

export interface ComponentState {
  status: ComponentStatus
  detail: string
}

export interface StatusSnapshot {
  teamspeak: ComponentState
  intermediate: ComponentState
  conan: ComponentState
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Scans full process list for any entry containing `nameSubstring` (case-insensitive).
// Avoids /FI "IMAGENAME eq" which requires an exact match and misses variants like
// ConanSandbox-Win64-Shipping.exe or ts3client_win32.exe.
function isProcessRunning(nameSubstring: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 4000 },
      (err, stdout) => resolve(!err && stdout.toLowerCase().includes(nameSubstring.toLowerCase())),
    )
  })
}

function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

function killBySubstring(nameSubstring: string): Promise<void> {
  return new Promise(resolve => {
    execFile(
      'taskkill',
      ['/F', '/IM', `${nameSubstring}*`, '/T'],
      { timeout: 8000 },
      () => resolve(),
    )
  })
}

// ── TeamSpeakProcess ──────────────────────────────────────────────────────────

export class TeamSpeakProcess extends EventEmitter {
  readonly id: ComponentId = 'teamspeak'
  private _status: ComponentStatus = 'stopped'
  private _detail = 'No iniciado'
  private _poll: ReturnType<typeof setInterval> | null = null
  private _watcher: ReturnType<typeof spawn> | null = null

  get status(): ComponentStatus { return this._status }
  get detail(): string { return this._detail }

  private setState(status: ComponentStatus, detail: string): void {
    this._status = status
    this._detail = detail
    this.emit('status-change')
  }

  private clearPoll(): void {
    if (this._poll) { clearInterval(this._poll); this._poll = null }
  }

  private clearWatcher(): void {
    if (this._watcher) {
      this._watcher.removeAllListeners('exit')
      this._watcher.kill()
      this._watcher = null
    }
  }

  async start(): Promise<void> {
    if (this._status === 'starting' || this._status === 'running') return
    this.clearPoll()
    this.clearWatcher()
    this.setState('starting', 'Iniciando TeamSpeak…')

    const url = buildTs3Url(this.config)
    const urlPart = this.config.teamspeak.autoConnect.enabled && url
      ? ` "${url.replace(/"/g, '\\"')}"`
      : ''

    // Use cmd /c start so Windows can handle UAC elevation and path resolution,
    // just like double-clicking the exe in Explorer does.
    const cmd = `cmd.exe /c start "" "${this.config.teamspeak.exePath}"${urlPart}`
    try {
      execSync(cmd, { timeout: 5000 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState('error', `No se pudo iniciar TeamSpeak: ${msg}`)
      return
    }

    const deadline = Date.now() + 15_000

    // Phase 1: wait for ts3client process to appear
    this._poll = setInterval(async () => {
      if (Date.now() > deadline) {
        this.clearPoll()
        this.setState('error', 'Timeout: TeamSpeak no respondió')
        return
      }
      // SaltyChat port (8089) is optional — TS3 is considered running as soon as
      // the process exists. SaltyChat status only affects the detail text.
      if (await isProcessRunning('ts3client')) {
        this.clearPoll()
        const addr = this.config.teamspeak.autoConnect.address || 'servidor'
        const wsOk = await checkPort(8089)
        this.setState('running', wsOk ? `Conectado a ${addr}` : `Sin SaltyChat · ${addr}`)
        this.watchTs3()
      }
    }, 1000)
  }

  private watchTs3(): void {
    // Spawn a PowerShell watcher that blocks on Wait-Process until ts3client exits.
    // This fires the 'exit' event the moment TS3 closes, replacing the 5s poll.
    const ps = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        "Get-Process -Name 'ts3client*' -ErrorAction SilentlyContinue | Wait-Process; exit 0"],
      { stdio: 'ignore', windowsHide: true },
    )
    this._watcher = ps
    ps.once('exit', async () => {
      this._watcher = null
      if (this._status !== 'running') return
      // Confirm TS3 is actually gone — Wait-Process can exit early if the
      // pipeline was empty (e.g. Get-Process found nothing on the first try).
      if (!await isProcessRunning('ts3client')) {
        this.setState('error', 'TeamSpeak cerrado')
      } else {
        this.watchTs3()
      }
    })
  }

  async init(): Promise<void> {
    if (await isProcessRunning('ts3client')) {
      const addr = this.config.teamspeak.autoConnect.address || 'servidor'
      const wsOk = await checkPort(8089)
      this.setState('running', wsOk ? `Conectado a ${addr}` : `Sin SaltyChat · ${addr}`)
      this.watchTs3()
    }
  }

  constructor(private config: LauncherConfig) { super() }
}

// ── IntermediateApp ───────────────────────────────────────────────────────────

export class IntermediateApp extends EventEmitter {
  readonly id: ComponentId = 'intermediate'
  private _status: ComponentStatus = 'stopped'
  private _detail = 'No iniciado'
  private _handle: AppHandle | null = null
  private _poll: ReturnType<typeof setInterval> | null = null

  get status(): ComponentStatus { return this._status }
  get detail(): string { return this._detail }

  private setState(status: ComponentStatus, detail: string): void {
    this._status = status
    this._detail = detail
    this.emit('status-change')
  }

  private clearPoll(): void {
    if (this._poll) { clearInterval(this._poll); this._poll = null }
  }

  async start(): Promise<void> {
    if (this._status === 'starting' || this._status === 'running') return
    this.clearPoll()
    this.setState('starting', 'Iniciando VH Bridge…')

    try {
      const { createApp } = await import('../src/index.js')
      this._handle = await createApp()
      await this._handle.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState('error', `Error: ${msg}`)
      return
    }

    this.setState('running', 'HTTP :7777 · WS desconectado')

    this._poll = setInterval(() => {
      if (!this._handle || this._status !== 'running') return
      const s = this._handle.getStatus() as { saltychat?: { connected?: boolean } }
      const ws = s.saltychat?.connected ? 'WS conectado' : 'WS desconectado'
      this._detail = `HTTP :7777 · ${ws}`
      this.emit('status-change')
    }, 2000)
  }

  async stop(): Promise<void> {
    this.clearPoll()
    if (this._handle) {
      try { await this._handle.stop() } catch {}
      this._handle = null
    }
    this.setState('stopped', 'No iniciado')
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }
}

// ── ConanProcess ──────────────────────────────────────────────────────────────

export class ConanProcess extends EventEmitter {
  readonly id: ComponentId = 'conan'
  private _status: ComponentStatus = 'stopped'
  private _detail = 'No iniciado'
  private _poll: ReturnType<typeof setInterval> | null = null
  private _missCount = 0

  get status(): ComponentStatus { return this._status }
  get detail(): string { return this._detail }

  private setState(status: ComponentStatus, detail: string): void {
    this._status = status
    this._detail = detail
    this.emit('status-change')
  }

  private clearPoll(): void {
    if (this._poll) { clearInterval(this._poll); this._poll = null }
  }

  async start(): Promise<void> {
    if (this._status === 'starting' || this._status === 'running') return
    this.clearPoll()

    const exePath = this.config.conan.exePath
    const useDirect = exePath.length > 0

    this.setState('starting', useDirect ? 'Iniciando Conan…' : 'Iniciando vía Steam…')

    try {
      if (useDirect) {
        // Launch the game exe directly, skipping the Funcom launcher
        execSync(`cmd.exe /c start "" "${exePath}"`, { timeout: 5000 })
      } else {
        execSync(`cmd.exe /c "start steam://rungameid/${this.config.conan.steamAppId}"`, {
          timeout: 5000,
        })
      }
    } catch {
      // start is non-blocking and may return non-zero; ignore
    }

    // When launching directly, ConanSandbox-Win64-Shipping.exe appears quickly.
    // Via Steam URL it can take up to 60 s (Steam + Funcom launcher first).
    const deadline = Date.now() + (useDirect ? 30_000 : 60_000)

    this._poll = setInterval(async () => {
      if (Date.now() > deadline) {
        this.clearPoll()
        this.setState('error', 'Timeout: Conan no inició')
        return
      }
      if (await isProcessRunning('conan')) {
        this.clearPoll()
        this.setState('running', 'En ejecución')
        this.watchConan()
      }
    }, 2000)
  }

  private watchConan(): void {
    this._missCount = 0
    // Two consecutive misses (×5 s = 10 s grace) before declaring stopped.
    // This covers the gap between the Funcom launcher closing and the actual
    // game process appearing after the user clicks Play.
    this._poll = setInterval(async () => {
      if (await isProcessRunning('conan')) {
        this._missCount = 0
      } else {
        this._missCount++
        if (this._missCount >= 2) {
          this.clearPoll()
          this.setState('stopped', 'No iniciado')
        }
      }
    }, 5000)
  }

  async init(): Promise<void> {
    if (await isProcessRunning('conan')) {
      this.setState('running', 'En ejecución')
      this.watchConan()
    }
  }

  async stop(): Promise<void> {
    this.clearPoll()
    await killBySubstring('conan')
    if (await isProcessRunning('conan')) {
      this.setState('error', 'No se pudo cerrar Conan')
    } else {
      this.setState('stopped', 'No iniciado')
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    if (this._status !== 'error') await this.start()
  }

  constructor(private config: LauncherConfig) { super() }
}

// ── Wait helper ───────────────────────────────────────────────────────────────

type AnyComponent = TeamSpeakProcess | IntermediateApp | ConanProcess

function waitForStatus(
  component: AnyComponent,
  target: ComponentStatus,
  timeout: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (component.status === target) return resolve()
    if (component.status === 'error') {
      return reject(new Error(`${component.id} en estado error`))
    }

    const timer = setTimeout(() => {
      component.off('status-change', check)
      reject(new Error(`Timeout esperando ${component.id}`))
    }, timeout)

    function check(): void {
      if (component.status === target) {
        clearTimeout(timer)
        component.off('status-change', check)
        resolve()
      } else if (component.status === 'error') {
        clearTimeout(timer)
        component.off('status-change', check)
        reject(new Error(`${component.id} entró en estado error`))
      }
    }

    component.on('status-change', check)
  })
}

// ── ProcessManager ────────────────────────────────────────────────────────────

export class ProcessManager {
  private ts: TeamSpeakProcess
  private intermediate: IntermediateApp
  private conan: ConanProcess

  constructor(config: LauncherConfig) {
    this.ts = new TeamSpeakProcess(config)
    this.intermediate = new IntermediateApp()
    this.conan = new ConanProcess(config)
  }

  getStatus(): StatusSnapshot {
    return {
      teamspeak: { status: this.ts.status, detail: this.ts.detail },
      intermediate: { status: this.intermediate.status, detail: this.intermediate.detail },
      conan: { status: this.conan.status, detail: this.conan.detail },
    }
  }

  async initAll(): Promise<void> {
    await Promise.all([this.ts.init(), this.conan.init()])
  }

  async start(id: ComponentId): Promise<void> {
    if (id === 'teamspeak') return this.ts.start()
    if (id === 'intermediate') return this.intermediate.start()
    if (id === 'conan') return this.conan.start()
  }

  async stop(id: ComponentId): Promise<void> {
    if (id === 'intermediate') return this.intermediate.stop()
    if (id === 'conan') return this.conan.stop()
  }

  async restart(id: ComponentId): Promise<void> {
    if (id === 'intermediate') return this.intermediate.restart()
    if (id === 'conan') return this.conan.restart()
  }

  async startAll(): Promise<void> {
    await this.ts.start()
    await waitForStatus(this.ts, 'running', 30_000)
    await this.intermediate.start()
    await waitForStatus(this.intermediate, 'running', 30_000)
    await this.conan.start()
    await waitForStatus(this.conan, 'running', 60_000)
  }

  async stopAll(): Promise<void> {
    await this.conan.stop()
    await this.intermediate.stop()
  }
}
