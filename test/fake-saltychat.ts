/**
 * Servidor WebSocket falso que simula SaltyChat (TS3 plugin).
 * Uso: npx tsx test/fake-saltychat.ts
 */
import { WebSocketServer, WebSocket } from 'ws'

const PORT = 8089
const HOST = '127.0.0.1'
const SUID = 'VocesHeroicas'

const wss = new WebSocketServer({ host: HOST, port: PORT })
console.log(`[FAKE-SC] Escuchando en ws://${HOST}:${PORT}`)

wss.on('connection', (ws: WebSocket) => {
  console.log('[FAKE-SC] Cliente conectado')

  function send(obj: unknown) {
    const raw = JSON.stringify(obj)
    console.log(`[FAKE-SC] → ${raw}`)
    ws.send(raw)
  }

  // Simulate PluginState (command 0)
  send({
    Command: 0,
    ServerUniqueIdentifier: SUID,
    Parameter: {
      Version: '2.0.0-fake',
      IsTalking: false,
      IsMicrophoneMuted: false,
      IsSoundMuted: false,
    },
  })

  // Simulate InstanceState (command 5)
  send({
    Command: 5,
    ServerUniqueIdentifier: SUID,
    Parameter: {
      IsConnectedToServer: true,
      IsInChannel: true,
      ChannelId: '1',
      ChannelName: 'VocesHeroicas',
    },
  })

  ws.on('message', (data) => {
    const raw = data.toString()
    console.log(`[FAKE-SC] ← ${raw}`)
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>
      if (msg['Command'] === 'Pong' || msg['Command'] === 4) {
        console.log('[FAKE-SC] ✓ Pong recibido')
      }
    } catch {
      console.error('[FAKE-SC] Error parseando mensaje')
    }
  })

  // Send Ping every 5 s
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log('[FAKE-SC] → Ping')
      send({ Command: 3, ServerUniqueIdentifier: SUID, Parameter: null })
    }
  }, 5_000)

  ws.on('close', () => {
    clearInterval(pingTimer)
    console.log('[FAKE-SC] Cliente desconectado')
  })
})
