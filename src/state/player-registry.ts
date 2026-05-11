import type { PlayerState } from '../saltychat/types.js'

interface PlayerEntry {
  state: PlayerState
  lastUpdate: number
}

export class PlayerRegistry {
  private players = new Map<string, PlayerEntry>()
  private cullTimer: ReturnType<typeof setInterval>
  private onRemove: (name: string) => void

  constructor(onRemove: (name: string) => void) {
    this.onRemove = onRemove
    // Cull every 2s; removes players not updated in the last 5s
    this.cullTimer = setInterval(() => this.cull(), 2_000)
    this.cullTimer.unref?.()
  }

  update(state: PlayerState) {
    this.players.set(state.Name, { state, lastUpdate: Date.now() })
  }

  remove(name: string) {
    this.players.delete(name)
  }

  clear() {
    this.players.clear()
  }

  get size() {
    return this.players.size
  }

  private cull() {
    const cutoff = Date.now() - 5_000
    for (const [name, entry] of this.players) {
      if (entry.lastUpdate < cutoff) {
        this.players.delete(name)
        this.onRemove(name)
      }
    }
  }

  destroy() {
    clearInterval(this.cullTimer)
  }
}
