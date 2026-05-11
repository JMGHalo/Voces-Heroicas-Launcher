import { Command, type IncomingMessage } from './types.js'

export function parseIncoming(raw: string): IncomingMessage {
  const data = JSON.parse(raw) as Record<string, unknown>
  const cmdNum: number =
    typeof data['Command'] === 'number'
      ? (data['Command'] as number)
      : Number(data['Command'])
  const p = (data['Parameter'] ?? {}) as Record<string, unknown>

  switch (cmdNum) {
    case Command.PluginState:
      return {
        command: Command.PluginState,
        version: String(p['Version'] ?? ''),
        isTalking: Boolean(p['IsTalking']),
        isMicrophoneMuted: Boolean(p['IsMicrophoneMuted']),
        isSoundMuted: Boolean(p['IsSoundMuted']),
      }

    case Command.Reset:
      return { command: Command.Reset }

    case Command.Ping:
      return {
        command: Command.Ping,
        serverUniqueIdentifier: String(data['ServerUniqueIdentifier'] ?? ''),
      }

    case Command.InstanceState:
      return {
        command: Command.InstanceState,
        isConnectedToServer: Boolean(p['IsConnectedToServer']),
        isInChannel: Boolean(p['IsInChannel']),
        channelId: String(p['ChannelId'] ?? ''),
        channelName: String(p['ChannelName'] ?? ''),
        serverUniqueIdentifier: String(data['ServerUniqueIdentifier'] ?? ''),
      }

    case Command.SoundState:
      return {
        command: Command.SoundState,
        isMicrophoneMuted: Boolean(p['IsMicrophoneMuted']),
        isSoundMuted: Boolean(p['IsSoundMuted']),
        isTalking: Boolean(p['IsTalking']),
      }

    case Command.TalkState:
      return {
        command: Command.TalkState,
        name: String(p['Name'] ?? ''),
        isTalking: Boolean(p['IsTalking']),
      }

    default:
      // Unknown command — cast to satisfy return type; handled as default in client
      return { command: cmdNum } as unknown as IncomingMessage
  }
}
