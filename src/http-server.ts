import Fastify from 'fastify'
import { log } from './logger.js'
import type { SaltyChatClient } from './saltychat/client.js'
import type { PlayerRegistry } from './state/player-registry.js'
import type { SessionState } from './state/session.js'
import type { AppConfig } from './config.js'
import type { PlayerState, SelfState } from './saltychat/types.js'

const NUM_PATTERN = '^-?[0-9]+(\\.[0-9]+)?$'

// Converts Unreal units to metres (1 uu ≈ 1 cm)
function uu(v: string): number {
  return parseFloat(v) / 100
}

function instanceLabel(session: SessionState): string {
  const s = session.lastInstanceState
  if (!s) return 'Unknown'
  if (s.isInChannel) return 'Ingame'
  if (s.isConnectedToServer) return 'Connected'
  return 'Disconnected'
}

interface InitQuery   { name: string; serverId: string; channelId: string; channelPwd: string }
interface SelfQuery   { x: string; y: string; z: string; yaw: string; range: string; alive: string }
interface PlayerQuery { id: string; x: string; y: string; z: string; yaw: string; range: string; alive: string }
interface RemoveQuery { id: string }
interface BulkQuery  { data?: string }

export function createHttpServer(
  config: AppConfig,
  saltyChat: SaltyChatClient,
  session: SessionState,
  registry: PlayerRegistry,
) {
  const fastify = Fastify({ logger: false })

  // Throttle state for /self — discard if same position in < 100 ms
  let lastSelf = { x: 0, y: 0, z: 0, t: 0 }

  // ── /init ──────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: InitQuery }>('/init', {
    schema: {
      querystring: {
        type: 'object',
        required: ['name', 'serverId', 'channelId', 'channelPwd'],
        properties: {
          name:       { type: 'string', minLength: 1 },
          serverId:   { type: 'string', minLength: 1 },
          channelId:  { type: 'string', minLength: 1 },
          channelPwd: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { name, serverId: rawServerId, channelId, channelPwd } = req.query
    // HTTP query strings decode '+' as a space. TS3 server UIDs are base64 and
    // contain '+' and '/', so restore any spaces back to '+' before using the value.
    const serverId = rawServerId.replace(/ /g, '+')

    // Store the Blueprint-provided SUID in both the session and the client so every
    // subsequent message (SelfStateUpdate, PlayerStateUpdate, Pong, …) carries the
    // correct identifier — mismatch here is what caused the 6-second InstanceTimeout loop.
    session.serverUniqueIdentifier = serverId
    saltyChat.config.serverUniqueIdentifier = serverId

    const initParams = {
      Name: name,
      ServerUniqueIdentifier: serverId,
      ChannelId: parseInt(channelId, 10),
      ChannelPassword: channelPwd,
      SoundPack: 'default',
      SwissChannelIds: [],
      SendTalkStates: false,
      SendRadioTrafficStates: false,
      UltraShortRangeDistance: config.voiceRanges.ultraShort,
      ShortRangeDistance: config.voiceRanges.short,
      LongRangeDistance: config.voiceRanges.long,
    }
    session.playerName = name
    session.initiated = true
    session.lastInitParams = initParams
    log('http', `→ Initiate name=${name} serverId=${serverId} channelId=${channelId}`)
    saltyChat.initiate(initParams)
    return reply.code(200).send({ ok: true })
  })

  // ── /self ──────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: SelfQuery }>('/self', {
    schema: {
      querystring: {
        type: 'object',
        required: ['x', 'y', 'z', 'yaw', 'range', 'alive'],
        properties: {
          x:     { type: 'string', pattern: NUM_PATTERN },
          y:     { type: 'string', pattern: NUM_PATTERN },
          z:     { type: 'string', pattern: NUM_PATTERN },
          yaw:   { type: 'string', pattern: NUM_PATTERN },
          range: { type: 'string', pattern: NUM_PATTERN },
          alive: { type: 'string', enum: ['0', '1'] },
        },
      },
    },
  }, async (req, reply) => {
    const q = req.query
    const x = uu(q.x), y = uu(q.y), z = uu(q.z)
    const now = Date.now()

    // Throttle: skip duplicate position within 100 ms
    if (x === lastSelf.x && y === lastSelf.y && z === lastSelf.z && now - lastSelf.t < 100) {
      return reply.code(200).send({ ok: true })
    }
    lastSelf = { x, y, z, t: now }

    saltyChat.updateSelf({
      Position: { X: x, Y: y, Z: z },
      Rotation: -parseFloat(q.yaw),
      VoiceRange: parseFloat(q.range),
      IsAlive: q.alive === '1',
    })
    return reply.code(200).send({ ok: true })
  })

  // ── /player ────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: PlayerQuery }>('/player', {
    schema: {
      querystring: {
        type: 'object',
        required: ['id', 'x', 'y', 'z', 'yaw', 'range', 'alive'],
        properties: {
          id:    { type: 'string', minLength: 1 },
          x:     { type: 'string', pattern: NUM_PATTERN },
          y:     { type: 'string', pattern: NUM_PATTERN },
          z:     { type: 'string', pattern: NUM_PATTERN },
          yaw:   { type: 'string', pattern: NUM_PATTERN },
          range: { type: 'string', pattern: NUM_PATTERN },
          alive: { type: 'string', enum: ['0', '1'] },
        },
      },
    },
  }, async (req, reply) => {
    const q = req.query
    const state = {
      Name: q.id,
      Position: { X: uu(q.x), Y: uu(q.y), Z: uu(q.z) },
      Rotation: -parseFloat(q.yaw),
      VoiceRange: parseFloat(q.range),
      IsAlive: q.alive === '1',
    }
    registry.update(state)
    saltyChat.updatePlayer(state)
    return reply.code(200).send({ ok: true })
  })

  // ── /remove ────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: RemoveQuery }>('/remove', {
    schema: {
      querystring: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.query
    registry.remove(id)
    saltyChat.removePlayer(id)
    log('http', `→ RemovePlayer ${id}`)
    return reply.code(200).send({ ok: true })
  })

  // ── /bulk ──────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: BulkQuery }>('/bulk', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          data: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const raw = (req.query.data ?? '').trim()
    if (!raw) return reply.code(200).send({ ok: true, count: 0 })

    const playerStates: PlayerState[] = []
    let selfState: SelfState | null = null

    for (const entry of raw.split('|')) {
      if (!entry) continue
      const parts = entry.split(',')
      if (parts.length < 6) continue

      const [id, x, y, z, yaw, range] = parts
      const px = uu(x), py = uu(y), pz = uu(z)
      const rot = -parseFloat(yaw)
      const vr = parseFloat(range)

      if (!id || [px, py, pz, rot, vr].some(isNaN)) continue

      const pos = { X: px, Y: py, Z: pz }

      const state: PlayerState = { Name: id, Position: pos, Rotation: rot, VoiceRange: vr, IsAlive: true }
      registry.update(state)

      if (session.initiated && id === session.playerName) {
        selfState = { Position: pos, Rotation: rot, VoiceRange: vr, IsAlive: true }
      } else {
        playerStates.push(state)
      }
    }

    if (selfState) saltyChat.updateSelf(selfState)
    for (const s of playerStates) saltyChat.updatePlayer(s)

    const count = playerStates.length + (selfState ? 1 : 0)
    log('http', `→ Bulk ${count} players (self=${!!selfState})`)
    return reply.code(200).send({ ok: true, count })
  })

  // ── /shutdown ──────────────────────────────────────────────────────────────
  fastify.get('/shutdown', async (_req, reply) => {
    session.reset()
    registry.clear()
    log('http', '→ Shutdown — estado limpiado')
    return reply.code(200).send({ ok: true })
  })

  // ── /health ────────────────────────────────────────────────────────────────
  fastify.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      saltychat: {
        connected: saltyChat.isConnected,
        instanceState: instanceLabel(session),
      },
      session: {
        initiated: session.initiated,
        playerName: session.playerName,
      },
      players: registry.size,
      uptime: process.uptime(),
    })
  })

  const HOST = '127.0.0.1'

  return {
    start: async () => {
      await fastify.listen({ port: config.httpPort, host: HOST })
      log('server', `HTTP en http://${HOST}:${config.httpPort}`)
      for (const r of ['/init', '/self', '/player', '/bulk', '/remove', '/shutdown', '/health']) {
        log('server', `  → GET ${r}`)
      }
    },
    stop: () => fastify.close(),
  }
}
