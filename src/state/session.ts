import type { InstanceStateMsg } from '../saltychat/types.js'

export class SessionState {
  initiated = false
  playerName = ''
  lastInstanceState: InstanceStateMsg | null = null

  reset() {
    this.initiated = false
    this.playerName = ''
    this.lastInstanceState = null
  }
}
