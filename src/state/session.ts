import type { InstanceStateMsg, InitiateParams } from '../saltychat/types.js'

export class SessionState {
  initiated = false
  playerName = ''
  serverUniqueIdentifier = ''
  lastInstanceState: InstanceStateMsg | null = null
  lastInitParams: InitiateParams | null = null

  reset() {
    this.initiated = false
    this.playerName = ''
    this.lastInstanceState = null
    // serverUniqueIdentifier and lastInitParams kept — used to re-initiate after SaltyChat Reset
  }
}
