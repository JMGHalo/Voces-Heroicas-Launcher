export {} // make this file a module so declare global works

type ComponentStatus = 'stopped' | 'starting' | 'running' | 'error'
type ComponentId = 'teamspeak' | 'intermediate' | 'conan'

interface ComponentState {
  status: ComponentStatus
  detail: string
}

interface StatusData {
  teamspeak: ComponentState
  intermediate: ComponentState
  conan: ComponentState
}

interface ModCheckResult {
  conanFound: boolean
  missing: string[]
  modlistExists: boolean
  modlistPath: string
  error?: string
}

interface ModWriteResult {
  ok: boolean
  path?: string
  error?: string
  missing?: string[]
}

declare global {
  interface Window {
    launcher: {
      start: (id: string) => void
      stop: (id: string) => void
      restart: (id: string) => void
      startAll: () => void
      stopAll: () => void
      onStatus: (cb: (data: StatusData) => void) => void
      onError: (cb: (data: { id: string; message: string }) => void) => void
      onUpdateChecking: (cb: () => void) => void
      onUpdateAvailable: (cb: (info: unknown) => void) => void
      onUpdateNotAvailable: (cb: (info: { current: string; latest: string }) => void) => void
      onUpdateDownloaded: (cb: (info: unknown) => void) => void
      onUpdateError: (cb: (message: string) => void) => void
      installUpdate: () => void
      refreshPaths: () => Promise<{ ts: string; conan: string }>
      tools: {
        installTs3: () => Promise<void>
        installSaltychat: () => Promise<void>
      }
      mods: {
        check: () => Promise<ModCheckResult>
        subscribeAll: () => Promise<void>
        writeModlist: () => Promise<ModWriteResult>
      }
    }
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function updateCard(id: ComponentId, state: ComponentState): void {
  const dot    = el(`dot-${id}`)
  const detail = el(`detail-${id}`)

  dot.className = `dot ${state.status}`
  detail.textContent = state.detail

  const start   = document.querySelector<HTMLButtonElement>(`.btn-start[data-id="${id}"]`)
  const restart = document.querySelector<HTMLButtonElement>(`.btn-restart[data-id="${id}"]`)
  const stop    = document.querySelector<HTMLButtonElement>(`.btn-stop[data-id="${id}"]`)

  if (start)   start.disabled   = state.status === 'starting' || state.status === 'running'
  if (restart) restart.disabled = state.status === 'starting' || state.status === 'stopped'
  if (stop)    stop.disabled    = state.status === 'starting' || state.status === 'stopped'
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(message: string): void {
  const toast = el('toast')
  toast.textContent = message
  toast.classList.remove('hidden')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000)
}

// ── Wire up status updates ────────────────────────────────────────────────────

window.launcher.onStatus((data: StatusData) => {
  updateCard('teamspeak', data.teamspeak)
  updateCard('intermediate', data.intermediate)
  updateCard('conan', data.conan)
})

window.launcher.onError((data) => {
  const prefix = data.id === 'all' ? '' : `[${data.id}] `
  showToast(`${prefix}${data.message}`)
})

// ── Update banner ─────────────────────────────────────────────────────────────

window.launcher.onUpdateChecking(() => {
  showToast('Buscando actualizaciones…')
})

window.launcher.onUpdateAvailable(() => {
  const banner = el('update-banner')
  el('update-message').textContent = 'Hay una actualización disponible — Descargando…'
  banner.classList.remove('hidden')
})

window.launcher.onUpdateNotAvailable((info) => {
  showToast(`El launcher está actualizado (instalado: ${info?.current ?? '?'} · último: ${info?.latest ?? '?'})`)
})

window.launcher.onUpdateError((message) => {
  showToast(`Error de actualización: ${message}`)
})

window.launcher.onUpdateDownloaded(() => {
  el('update-message').textContent = 'Actualización lista'
  const btn = el<HTMLButtonElement>('btn-update-install')
  btn.classList.remove('hidden')
})

el<HTMLButtonElement>('btn-update-install').addEventListener('click', () => {
  window.launcher.installUpdate()
})

// ── Per-component buttons ─────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('.btn-start').forEach(btn => {
  btn.addEventListener('click', () => window.launcher.start(btn.dataset.id!))
})

document.querySelectorAll<HTMLButtonElement>('.btn-restart').forEach(btn => {
  btn.addEventListener('click', () => window.launcher.restart(btn.dataset.id!))
})

document.querySelectorAll<HTMLButtonElement>('.btn-stop').forEach(btn => {
  btn.addEventListener('click', () => window.launcher.stop(btn.dataset.id!))
})

// ── Global buttons ────────────────────────────────────────────────────────────

el<HTMLButtonElement>('btn-start-all').addEventListener('click', () => {
  window.launcher.startAll()
})

el<HTMLButtonElement>('btn-stop-all').addEventListener('click', () => {
  window.launcher.stopAll()
})

el<HTMLButtonElement>('btn-refresh-paths').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-refresh-paths')
  btn.disabled = true
  try {
    const result = await window.launcher.refreshPaths()
    const ts = result.ts || '(no detectado)'
    const conan = result.conan || '(no detectado)'
    showToast(`Rutas actualizadas — TS3: ${ts} · Conan: ${conan}`)
    await refreshModStatus()
  } finally {
    btn.disabled = false
  }
})

// ── Install helpers ───────────────────────────────────────────────────────────

el<HTMLButtonElement>('btn-install-ts3').addEventListener('click', () => {
  window.launcher.tools.installTs3()
})

el<HTMLButtonElement>('btn-install-saltychat').addEventListener('click', () => {
  window.launcher.tools.installSaltychat()
})

// ── Mod management ────────────────────────────────────────────────────────────

async function refreshModStatus(): Promise<void> {
  const dot    = el('dot-mods')
  const detail = el('detail-mods')
  try {
    const r = await window.launcher.mods.check()
    if (!r.conanFound) {
      dot.className = 'dot stopped'
      detail.textContent = 'Conan Exiles no detectado — usa ↺ Rutas'
    } else if (r.error) {
      dot.className = 'dot error'
      detail.textContent = r.error
    } else if (r.missing.length > 0) {
      dot.className = 'dot error'
      detail.textContent = `Faltan ${r.missing.length} mod(s) — suscríbete a la colección primero`
    } else if (r.modlistExists) {
      dot.className = 'dot running'
      detail.textContent = 'modlist.txt activo'
    } else {
      dot.className = 'dot stopped'
      detail.textContent = 'Mods descargados — haz clic en "Aplicar mods"'
    }
  } catch {
    dot.className = 'dot error'
    detail.textContent = 'Error al verificar mods'
  }
}

el<HTMLButtonElement>('btn-subscribe-mods').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-subscribe-mods')
  btn.disabled = true
  try {
    await window.launcher.mods.subscribeAll()
    showToast('Abriendo colección en Steam — haz clic en "Suscribirse a todos"')
  } finally {
    btn.disabled = false
  }
})

el<HTMLButtonElement>('btn-check-mods').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-check-mods')
  btn.disabled = true
  try {
    await refreshModStatus()
  } finally {
    btn.disabled = false
  }
})

el<HTMLButtonElement>('btn-write-modlist').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-write-modlist')
  btn.disabled = true
  try {
    const r = await window.launcher.mods.writeModlist()
    if (r.ok) {
      showToast('modlist.txt escrito correctamente')
    } else {
      showToast(`Error: ${r.error}`)
    }
    await refreshModStatus()
  } finally {
    btn.disabled = false
  }
})

refreshModStatus()
