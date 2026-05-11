import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { shell } from 'electron'

const CONAN_APP_ID = '440900'
const COLLECTION_ID = '3723737069'
export const COLLECTION_URL = `https://steamcommunity.com/sharedfiles/filedetails/?id=${COLLECTION_ID}`

// ── Steam API types ───────────────────────────────────────────────────────────

interface SteamCollectionChild {
  publishedfileid: string
  sortorder: number
  filetype: number
}

interface SteamCollectionDetail {
  publishedfileid: string
  result: number
  children?: SteamCollectionChild[]
}

interface SteamCollectionResponse {
  response: {
    result: number
    resultcount: number
    collectiondetails: SteamCollectionDetail[]
  }
}

// ── Steam API ─────────────────────────────────────────────────────────────────

// Returns mod IDs sorted by their position in the collection
async function fetchCollectionModIds(): Promise<string[]> {
  const res = await fetch(
    'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v0001/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `collectioncount=1&publishedfileids[0]=${COLLECTION_ID}`,
    },
  )
  if (!res.ok) throw new Error(`Steam API respondió ${res.status}`)

  const data = await res.json() as SteamCollectionResponse
  const detail = data.response?.collectiondetails?.[0]
  if (!detail || detail.result !== 1) throw new Error('Colección no encontrada en Steam')

  const children = detail.children ?? []
  if (children.length === 0) throw new Error('La colección está vacía')

  return children
    .sort((a, b) => a.sortorder - b.sortorder)
    .map(c => c.publishedfileid)
}

// ── Local file helpers ────────────────────────────────────────────────────────

// Find the .pak file inside a mod's workshop folder.
// Returns a path relative to modDir using forward slashes (Conan format), or null.
function findPakRelative(modDir: string): string | null {
  if (!existsSync(modDir)) return null
  try {
    const entries = readdirSync(modDir)
    const direct = entries.find(f => f.toLowerCase().endsWith('.pak'))
    if (direct) return direct

    // Some mods nest the .pak one level deep
    for (const entry of entries) {
      try {
        const sub = readdirSync(join(modDir, entry))
        const nested = sub.find(f => f.toLowerCase().endsWith('.pak'))
        if (nested) return `${entry}/${nested}`
      } catch { /* not a directory */ }
    }
  } catch {}
  return null
}

// Walk up the exe path to find the Steam library root (parent of "steamapps" folder)
function getSteamLibrary(exePath: string): string {
  let p = exePath
  while (true) {
    const parent = dirname(p)
    if (parent === p) break
    if (basename(p).toLowerCase() === 'steamapps') return parent
    p = parent
  }
  return ''
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ModCheckResult {
  conanFound: boolean
  missing: string[]       // mod IDs not yet downloaded
  modlistExists: boolean
  modlistPath: string
  error?: string          // set when Steam API or path detection fails
}

export async function checkMods(conanExePath: string): Promise<ModCheckResult> {
  if (!conanExePath) {
    return { conanFound: false, missing: [], modlistExists: false, modlistPath: '' }
  }

  const lib = getSteamLibrary(conanExePath)
  if (!lib) {
    return { conanFound: true, missing: [], modlistExists: false, modlistPath: '',
      error: 'No se pudo encontrar la carpeta de Steam' }
  }

  const workshopPath = join(lib, 'steamapps', 'workshop', 'content', CONAN_APP_ID)
  const modlistPath  = join(lib, 'steamapps', 'common', 'Conan Exiles', 'ConanSandbox', 'Mods', 'modlist.txt')

  let modIds: string[]
  try {
    modIds = await fetchCollectionModIds()
  } catch (err) {
    // Can't reach Steam API — still report modlist status
    return {
      conanFound: true, missing: [], modlistExists: existsSync(modlistPath), modlistPath,
      error: `Sin conexión a Steam: ${(err as Error).message}`,
    }
  }

  const missing = modIds.filter(id => !findPakRelative(join(workshopPath, id)))
  return { conanFound: true, missing, modlistExists: existsSync(modlistPath), modlistPath }
}

export interface WriteResult {
  ok: boolean
  path?: string
  error?: string
  missing?: string[]
}

export async function writeModlist(conanExePath: string): Promise<WriteResult> {
  if (!conanExePath) return { ok: false, error: 'Ruta de Conan Exiles no detectada' }

  const lib = getSteamLibrary(conanExePath)
  if (!lib) return { ok: false, error: 'No se pudo encontrar la carpeta de Steam' }

  let modIds: string[]
  try {
    modIds = await fetchCollectionModIds()
  } catch (err) {
    return { ok: false, error: `Error al obtener colección: ${(err as Error).message}` }
  }

  const workshopPath = join(lib, 'steamapps', 'workshop', 'content', CONAN_APP_ID)
  const missing: string[] = []
  const lines:   string[] = []

  for (const id of modIds) {
    const modDir     = join(workshopPath, id)
    const pakRelPath = findPakRelative(modDir)
    if (!pakRelPath) {
      missing.push(id)
    } else {
      // Conan expects: backslashes up to the mod-ID folder, then forward slash before the .pak
      lines.push(`*${modDir}/${pakRelPath}`)
    }
  }

  if (missing.length > 0) {
    return { ok: false, error: `Mods no descargados (${missing.length})`, missing }
  }

  const modsDir = join(lib, 'steamapps', 'common', 'Conan Exiles', 'ConanSandbox', 'Mods')
  mkdirSync(modsDir, { recursive: true })
  const modlistPath = join(modsDir, 'modlist.txt')
  writeFileSync(modlistPath, lines.join('\n') + '\n', 'utf8')

  return { ok: true, path: modlistPath }
}

export async function subscribeToAll(): Promise<void> {
  // Opens the collection page inside the Steam client (not the browser).
  // The user clicks "Suscribirse a todos" once and Steam handles everything.
  await shell.openExternal(`steam://openurl/${COLLECTION_URL}`)
}
