import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { LogLevel } from './logger.js'

const rootDir = process.env.VOCES_APP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../')
const CONFIG_PATH = resolve(rootDir, 'config.json')

export interface AppConfig {
  httpPort: number
  saltyChatWsUrl: string
  serverUniqueIdentifier: string
  voiceRanges: {
    ultraShort: number
    short: number
    long: number
  }
  logLevel: LogLevel
}

const DEFAULTS: AppConfig = {
  httpPort: 7777,
  saltyChatWsUrl: 'ws://127.0.0.1:8089',
  serverUniqueIdentifier: 'VocesHeroicas',
  voiceRanges: {
    ultraShort: 1.8,
    short: 8.0,
    long: 20.0,
  },
  logLevel: 'info',
}

export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8')
    return { ...DEFAULTS }
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AppConfig>
    return {
      ...DEFAULTS,
      ...raw,
      voiceRanges: { ...DEFAULTS.voiceRanges, ...(raw.voiceRanges ?? {}) },
    }
  } catch {
    return { ...DEFAULTS }
  }
}
