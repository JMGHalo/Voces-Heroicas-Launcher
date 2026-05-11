import Fastify from 'fastify'
import { log } from './logger.js'
import type { SaltyChatClient } from './saltychat/client.js'
import type { PlayerRegistry } from './state/player-registry.js'
import type { SessionState } from './state/session.js'
import type { AppConfig } from './config.js'

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
    const { name, serverId, channelId, channelPwd } = req.query
    session.playerName = name
    session.initiated = true
    log('http', `→ Initiate name=${name} serverId=${serverId} channelId=${channelId}`)
    saltyChat.initiate({
      Name: name,
      ServerUniqueIdentifier: serverId,
      ChannelId: channelId,
      ChannelPassword: channelPwd,
      SoundPack: 'default',
      SwissChannelIds: [],
      SendTalkStates: false,
      SendRadioTrafficStates: false,
      UltraShortRangeDistance: config.voiceRanges.ultraShort,
      ShortRangeDistance: config.voiceRanges.short,
      LongRangeDistance: config.voiceRanges.long,
    })
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
      Rotation: parseFloat(q.yaw),
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
      Rotation: parseFloat(q.yaw),
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
      for (const r of ['/init', '/self', '/player', '/remove', '/shutdown', '/health']) {
        log('server', `  → GET ${r}`)
      }
    },
    stop: () => fastify.close(),
  }
}
