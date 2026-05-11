export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const COLORS: Record<string, string> = {
  server:    '\x1b[36m',  // cyan
  saltychat: '\x1b[35m',  // magenta
  http:      '\x1b[32m',  // green
  session:   '\x1b[34m',  // blue
  registry:  '\x1b[33m',  // yellow
  warn:      '\x1b[33m',  // yellow
  error:     '\x1b[31m',  // red
  debug:     '\x1b[90m',  // dark grey
}

const RESET = '\x1b[0m'

let currentLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel) {
  currentLevel = level
}

export function log(channel: string, message: string, level: LogLevel = 'info') {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel]) return
  const color = COLORS[channel] ?? COLORS['error']
  const tag = `[${channel.toUpperCase()}]`.padEnd(12)
  const time = new Date().toTimeString().slice(0, 8)
  console.log(`\x1b[90m${time}${RESET} ${color}${tag}${RESET} ${message}`)
}
