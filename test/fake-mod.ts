/**
 * Simula el mod de Conan Exiles enviando la secuencia típica de un jugador.
 * Uso: npx tsx test/fake-mod.ts
 *
 * Prerequisito: fake-saltychat.ts y el servidor (npm run dev) deben estar corriendo.
 */
const BASE = 'http://127.0.0.1:7777'
const PLAYER_ID = 'Steam_76561198000000001'
const SELF_NAME = 'Drogan'
const TICKS = 200
const TICK_MS = 150

async function get(path: string): Promise<void> {
  try {
    const res = await fetch(BASE + path)
    const body = await res.json() as unknown
    const ok = res.status === 200 ? '✓' : '✗'
    console.log(`[MOD] ${ok} GET ${path.split('?')[0]} → ${res.status} ${JSON.stringify(body)}`)
  } catch (e) {
    console.error(`[MOD] Error en GET ${path}: ${e}`)
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

console.log('[MOD] Iniciando secuencia de prueba')

// 1. Init
await get(`/init?name=${SELF_NAME}&serverId=${SELF_NAME}&channelId=1&channelPwd=`)

// 2. Position ticks
for (let i = 0; i < TICKS; i++) {
  const x = (i * 100).toFixed(1)   // en uu (≈1 cm); la app convierte a metros
  const y = '0.0'
  const z = '0.0'
  const yaw = ((i * 3) % 360).toFixed(1)
  const range = '800'  // 8 m en metros ya (el mod decide la escala de range)

  await get(`/self?x=${x}&y=${y}&z=${z}&yaw=${yaw}&range=${range}&alive=1`)
  await get(`/player?id=${PLAYER_ID}&x=${x}&y=${y}&z=${z}&yaw=${yaw}&range=${range}&alive=1`)
  await sleep(TICK_MS)
}

// 3. Remove player
await get(`/remove?id=${PLAYER_ID}`)

// 4. Shutdown
await get('/shutdown')

// 5. Health check
await get('/health')

console.log('[MOD] Secuencia completada')
