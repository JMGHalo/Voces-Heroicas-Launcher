import { fileURLToPath } from 'url'
import { loadConfig, type AppConfig } from './config.js'
import { log, setLogLevel } from './logger.js'
import { SaltyChatClient } from './saltychat/client.js'
import { PlayerRegistry } from './state/player-registry.js'
import { SessionState } from './state/session.js'
import { createHttpServer } from './http-server.js'
import type { InstanceStateMsg } from './saltychat/types.js'

export interface AppHandle {
  start(): Promise<void>
  stop(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): void
  getStatus(): object
}

export async function createApp(_config?: Partial<AppConfig>): Promise<AppHandle> {
  const config = loadConfig()
  setLogLevel(config.logLevel)

  const session = new SessionState()

  const saltyChat = new SaltyChatClient({
    wsUrl: config.saltyChatWsUrl,
    serverUniqueIdentifier: config.serverUniqueIdentifier,
  })

  const registry = new PlayerRegistry((name) => {
    log('registry', `Auto-cull: ${name}`)
    saltyChat.removePlayer(name)
  })

  saltyChat.on('instance-state', (msg: InstanceStateMsg) => {
    session.lastInstanceState = msg
  })

  saltyChat.on('reset', () => {
    session.reset()
    registry.clear()
    log('session', 'Reset recibido — sesión limpiada')
  })

  const http = createHttpServer(config, saltyChat, session, registry)

  return {
    start: () => http.start(),

    stop: async () => {
      await http.stop()
      registry.destroy()
      saltyChat.disconnect()
    },

    on: (event, listener) => saltyChat.on(event, listener),

    getStatus: () => ({
      saltychat: { connected: saltyChat.isConnected },
      session: { initiated: session.initiated, playerName: session.playerName },
      players: registry.size,
      uptime: process.uptime(),
    }),
  }
}

// ── Standalone entry point ────────────────────────────────────────────────────
// Only runs when invoked directly (not imported by Electron or tests)
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  process.on('uncaughtException', (err) => log('error', `Error no capturado: ${err.message}`))
  process.on('unhandledRejection', (reason) => log('error', `Promesa rechazada: ${reason}`))

  const app = await createApp()
  await app.start()
  log('server', 'Servidor intermediario Voces Heroicas listo. Ctrl+C para parar.')

  process.on('SIGINT', async () => {
    log('warn', 'Apagando...')
    await app.stop()
    process.exit(0)
  })
}
