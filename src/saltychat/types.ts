export interface Vector3 {
  X: number
  Y: number
  Z: number
}

export enum Command {
  PluginState = 0,
  Initiate = 1,
  Reset = 2,
  Ping = 3,
  Pong = 4,
  InstanceState = 5,
  SoundState = 6,
  SelfStateUpdate = 7,
  PlayerStateUpdate = 8,
  BulkUpdate = 9,
  RemovePlayer = 10,
  TalkState = 11,
}

export interface InitiateParams {
  Name: string
  ServerUniqueIdentifier: string
  ChannelId: string
  ChannelPassword: string
  SoundPack: string
  SwissChannelIds: string[]
  SendTalkStates: boolean
  SendRadioTrafficStates: boolean
  UltraShortRangeDistance: number
  ShortRangeDistance: number
  LongRangeDistance: number
}

export interface SelfState {
  Position: Vector3
  Rotation: number
  VoiceRange: number
  IsAlive: boolean
}

export interface PlayerState {
  Name: string
  Position: Vector3
  Rotation: number
  VoiceRange: number
  IsAlive: boolean
}

// ── Incoming messages ─────────────────────────────────────────────────────────

export interface PluginStateMsg {
  command: Command.PluginState
  version: string
  isTalking: boolean
  isMicrophoneMuted: boolean
  isSoundMuted: boolean
}

export interface ResetMsg {
  command: Command.Reset
}

export interface PingMsg {
  command: Command.Ping
  serverUniqueIdentifier: string
}

export interface InstanceStateMsg {
  command: Command.InstanceState
  isConnectedToServer: boolean
  isInChannel: boolean
  channelId: string
  channelName: string
  serverUniqueIdentifier: string
}

export interface SoundStateMsg {
  command: Command.SoundState
  isMicrophoneMuted: boolean
  isSoundMuted: boolean
  isTalking: boolean
}

export interface TalkStateMsg {
  command: Command.TalkState
  name: string
  isTalking: boolean
}

export type IncomingMessage =
  | PluginStateMsg
  | ResetMsg
  | PingMsg
  | InstanceStateMsg
  | SoundStateMsg
  | TalkStateMsg
