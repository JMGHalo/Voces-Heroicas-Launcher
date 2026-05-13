import { readFileSync } from 'fs'
import { join } from 'path'
import { log } from '../logger.js'

const KNOWN_PORTS = [8088, 38088]
const SETTINGS_PATH = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  'TS3Client', 'plugins', 'SaltyChat', 'settings.json'
)

function portFromAddress(address: string): number | null {
  // Handles "127.0.0.1:8088", ":8088", or just "8088"
  const match = address.match(/:?(\d+)$/)
  if (!match) return null
  const port = parseInt(match[1], 10)
  return isNaN(port) ? null : port
}

export function detectSaltyChatUrl(): string {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf8')
    const settings = JSON.parse(raw)
    const address: string = settings.WebSocketAddress ?? ''
    const port = portFromAddress(address)

    if (port) {
      log('saltychat', `Puerto detectado desde settings.json: ${port}`)
      return `ws://127.0.0.1:${port}`
    }
  } catch {
    // File missing or unreadable — fall through to defaults
  }

  log('saltychat', `settings.json no encontrado — usando puerto por defecto ${KNOWN_PORTS[0]}`)
  return `ws://127.0.0.1:${KNOWN_PORTS[0]}`
}
