import { WebSocket } from 'ws'
import { log } from './logger.js'

export interface PlayerPosition {
  playerId: string
  x: number
  y: number
  z: number
  yaw: number
  timestamp: number
}

// SaltyChat escucha en este puerto por defecto (ver config del plugin TS3)
const SALTYCHAT_WS_URL = 'ws://127.0.0.1:8089'
const RECONNECT_DELAY_MS = 5000

export class SaltyChatClient {
  private ws: WebSocket | null = null
  private connected = false

  constructor() {
    this.connect()
  }

  private connect() {
    log('saltychat', 'Conectando a SaltyChat WebSocket...')

    this.ws = new WebSocket(SALTYCHAT_WS_URL)

    this.ws.on('open', () => {
      this.connected = true
      log('saltychat', 'Conectado')
    })

    this.ws.on('message', (data) => {
      // SaltyChat puede enviar mensajes de vuelta (ej. estado del cliente TS3)
      log('saltychat', `← ${data.toString()}`)
    })

    this.ws.on('close', () => {
      this.connected = false
      log('saltychat', `Desconectado. Reintentando en ${RECONNECT_DELAY_MS / 1000}s...`)
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
    })

    this.ws.on('error', () => {
      // El evento close se dispara justo después, ahí reconectamos
    })
  }

  sendPosition(pos: PlayerPosition) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return

    // Protocolo SaltyChat: comando PlayerState
    // https://github.com/saltychat/SaltyChat-fivem (misma interfaz para mods custom)
    const payload = {
      Command: 'PlayerState',
      ServerUniqueIdentifier: 'VocesHeroicas',
      Parameter: {
        Name: pos.playerId,
        Position: { X: pos.x, Y: pos.y, Z: pos.z },
        Rotation: pos.yaw,
        VoiceRange: 20.0,
        IsAlive: true,
        IsSending: false,
      }
    }

    this.ws!.send(JSON.stringify(payload))
  }

  get isConnected() {
    return this.connected
  }
}
