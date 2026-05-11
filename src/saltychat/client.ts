import { EventEmitter } from 'events'
import { WebSocket } from 'ws'
import { log } from '../logger.js'
import { Command, type InitiateParams, type SelfState, type PlayerState } from './types.js'
import { buildInitiate, buildSelf, buildPlayer, buildRemove, buildPong } from './messages.js'
import { parseIncoming } from './parse.js'

export interface SaltyChatClientConfig {
  wsUrl: string
  serverUniqueIdentifier: string
}

export class SaltyChatClient extends EventEmitter {
  private ws: WebSocket | null = null
  private connected = false
  private reconnectDelay = 1000
  private destroyed = false
  private droppedCount = 0
  readonly config: SaltyChatClientConfig

  constructor(config: SaltyChatClientConfig) {
    super()
    this.config = config
    this.connect()
  }

  private connect() {
    if (this.destroyed) return
    log('saltychat', 'Conectando...')
    this.ws = new WebSocket(this.config.wsUrl)

    this.ws.on('open', () => {
      this.connected = true
      this.reconnectDelay = 1000
      this.droppedCount = 0
      log('saltychat', 'Conectado')
      this.emit('connected')
    })

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString())
    })

    this.ws.on('close', () => {
      this.connected = false
      this.emit('disconnected')
      if (!this.destroyed) {
        log('saltychat', `Desconectado. Reintentando en ${this.reconnectDelay / 1000}s...`)
        setTimeout(() => this.connect(), this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      }
    })

    this.ws.on('error', () => {
      // El evento close se dispara justo después; reconectamos ahí
    })
  }

  private handleMessage(raw: string) {
    try {
      const msg = parseIncoming(raw)
      switch (msg.command) {
        case Command.PluginState:
          log('saltychat', `← PluginState v${msg.version}`)
          this.emit('plugin-state', msg)
          break

        case Command.Reset:
          log('saltychat', '← Reset')
          this.emit('reset')
          break

        case Command.Ping:
          log('saltychat', '← Ping')
          this.send(buildPong(this.config.serverUniqueIdentifier))
          log('saltychat', '→ Pong')
          this.emit('ping')
          this.emit('pong')
          break

        case Command.InstanceState:
          log('saltychat', `← InstanceState connected=${msg.isConnectedToServer} inChannel=${msg.isInChannel}`)
          this.emit('instance-state', msg)
          break

        case Command.SoundState:
          log('saltychat', `← SoundState muted=${msg.isSoundMuted} talking=${msg.isTalking}`, 'debug')
          this.emit('sound-state', msg)
          break

        case Command.TalkState:
          log('saltychat', `← TalkState ${msg.name} talking=${msg.isTalking}`, 'debug')
          this.emit('talk-state', msg)
          break

        default: {
          const unknown = msg as { command: number }
          log('saltychat', `← Desconocido(${unknown.command})`, 'debug')
        }
      }
    } catch (e) {
      log('warn', `Error parseando mensaje SaltyChat: ${e}`)
    }
  }

  private send(payload: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload)
      return
    }
    this.droppedCount++
    if (this.droppedCount % 100 === 1) {
      log('warn', `SaltyChat desconectado — ${this.droppedCount} comandos descartados`)
    }
  }

  initiate(params: InitiateParams) {
    this.send(buildInitiate(params, this.config.serverUniqueIdentifier))
  }

  updateSelf(state: SelfState) {
    this.send(buildSelf(state, this.config.serverUniqueIdentifier))
  }

  updatePlayer(state: PlayerState) {
    this.send(buildPlayer(state, this.config.serverUniqueIdentifier))
  }

  removePlayer(name: string) {
    this.send(buildRemove(name, this.config.serverUniqueIdentifier))
  }

  disconnect() {
    this.destroyed = true
    this.ws?.close()
  }

  get isConnected() {
    return this.connected
  }
}
