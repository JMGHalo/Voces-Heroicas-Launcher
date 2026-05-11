import type { InitiateParams, SelfState, PlayerState } from './types.js'

function wrap(command: string, suid: string, parameter: unknown): string {
  return JSON.stringify({ Command: command, ServerUniqueIdentifier: suid, Parameter: parameter })
}

export function buildInitiate(params: InitiateParams, suid: string): string {
  return wrap('Initiate', suid, params)
}

export function buildSelf(state: SelfState, suid: string): string {
  return wrap('SelfStateUpdate', suid, state)
}

export function buildPlayer(state: PlayerState, suid: string): string {
  return wrap('PlayerStateUpdate', suid, state)
}

export function buildRemove(name: string, suid: string): string {
  return wrap('RemovePlayer', suid, { Name: name })
}

export function buildPong(suid: string): string {
  return wrap('Pong', suid, null)
}
