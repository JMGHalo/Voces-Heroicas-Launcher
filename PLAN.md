# Plan de desarrollo — App intermediaria (servidor SaltyChat ↔ Conan)

> Documento de planificación. Pensado para que cualquier agente pueda continuar el
> trabajo en frío. Todo el contexto necesario está aquí: protocolo, estado actual,
> fases, criterios de aceptación y fuera de alcance.

---

## 1. Contexto

El proyecto **Voces Heroicas Launcher** envolverá tres procesos en una app de
escritorio (Electron):

1. Conan Exiles (con un mod `.pak`)
2. TeamSpeak 3 (con el plugin SaltyChat instalado)
3. **App intermediaria** (este documento)

La app intermediaria:

- Recibe `GET` HTTP desde el mod de Conan Exiles (en `127.0.0.1:7777`).
- Traduce esos GETs a comandos del protocolo SaltyChat.
- Mantiene una conexión WebSocket persistente con SaltyChat (`ws://127.0.0.1:8089`).
- Gestiona `Ping`/`Pong` con SaltyChat de forma transparente al mod.

Cada jugador ejecuta su propia instancia local. No hay servidor central.

Referencia del protocolo: <https://github.com/SaltyHub-net/saltychat-docs/blob/master/commands.md>

---

## 2. Estado actual del repo

Carpeta: `D:\VocesHeroicasLauncher`

```
voces-heroicas-launcher/
├─ package.json            # Fastify v4 (Node 18 limita a v4), ws, tsx, TypeScript
├─ tsconfig.json
├─ config.json             # puerto, WS URL, SUID, rangos de voz, log level
├─ PLAN.md                 # este documento
├─ src/
│  ├─ index.ts             # createApp() exportable + standalone con isMain
│  ├─ config.ts            # loadConfig() — crea config.json si no existe
│  ├─ logger.ts            # niveles debug/info/warn/error, setLogLevel()
│  ├─ http-server.ts       # 6 rutas (init/self/player/remove/shutdown/health)
│  ├─ saltychat/
│  │  ├─ client.ts         # SaltyChatClient: backoff 1→30s, auto-Pong, EventEmitter
│  │  ├─ messages.ts       # builders: buildInitiate/Self/Player/Remove/Pong
│  │  ├─ parse.ts          # parseIncoming → unión discriminada por Command
│  │  └─ types.ts          # Vector3, Command enum, InitiateParams, SelfState, PlayerState, mensajes entrantes
│  └─ state/
│     ├─ player-registry.ts  # Map con TTL: cull automático a los 5s
│     └─ session.ts          # SessionState: initiated, playerName, lastInstanceState
├─ test/
│  ├─ fake-saltychat.ts    # WS server falso: PluginState, InstanceState, Ping cada 5s
│  ├─ fake-mod.ts          # secuencia completa: init → 200 ticks → remove → shutdown
│  └─ scenarios.md         # guion de 7 escenarios manuales
└─ src/
   └─ saltychat-ws.ts      # LEGACY — ya no se importa, puede eliminarse
```

**Funciona ahora (MVP implementado):**
- Servidor HTTP en `127.0.0.1:7777` con las 6 rutas del protocolo
- Conversión uu→m automática en `/self` y `/player`
- Validación de queries con schema Fastify (pattern numérico, enum `alive`)
- Throttle en `/self`: descarta duplicados de posición en < 100 ms
- Cliente WS con backoff exponencial 1s→2s→4s→…→30s
- Auto-respuesta a `Ping` con `Pong` (mismo `ServerUniqueIdentifier`)
- Auto-cull de jugadores fantasma: cull cada 2s, TTL 5s → `RemovePlayer` a SC
- Config externa en `config.json` (se auto-crea si no existe)
- Logger con niveles `debug/info/warn/error` y `LOG_LEVEL` por config
- `uncaughtException` / `unhandledRejection` logados sin matar el proceso
- `createApp()` exportable para consumo desde Electron
- Banco de pruebas: `fake-saltychat.ts` + `fake-mod.ts`

**Pendiente:**
- Prueba real con 2 jugadores en partida de Conan
- Eliminar `src/saltychat-ws.ts` (legacy, ya no importado)

Arrancar: `npm run dev` (watch) o `npm run start`.

---

## 3. Protocolo: tabla de comandos SaltyChat

### 3.1 Que **expone** la app al mod (HTTP GET)

Todos a `http://127.0.0.1:7777`. Fire-and-forget, responden `{ok:true}`.

| # | URL | Query params | Cuándo | Comando WS |
|---|---|---|---|---|
| 1 | `/init` | `name`, `serverId`, `channelId`, `channelPwd` | Una vez al entrar al servidor | `Initiate` (1) |
| 2 | `/self` | `x`, `y`, `z`, `yaw`, `range`, `alive` | Cada tick (~150 ms) | `SelfStateUpdate` (7) |
| 3 | `/player` | `id`, `x`, `y`, `z`, `yaw`, `range`, `alive` | Cada tick, por jugador cercano | `PlayerStateUpdate` (8) |
| 4 | `/remove` | `id` | Jugador sale del rango/se desconecta | `RemovePlayer` (10) |
| 5 | `/shutdown` | — | Al cerrar Conan | (limpia estado, no envía a SC) |
| 6 | `/health` | — | Diagnóstico desde launcher | (no envía a SC) |

**Conversión de unidades:** Unreal trabaja en `uu` (1 uu ≈ 1 cm). SaltyChat
espera metros. Dividir `x/y/z` por 100 antes de enviar. `range` se asume ya en
metros (lo decide el mod).

**Convenciones:**
- `alive` = `"0"` o `"1"` (query string es texto).
- `yaw` en grados, rango `[0, 360)`.
- `id` = `UniqueNetIdString` del jugador (Steam). Estable mientras juega.
- Bind sólo a `127.0.0.1` (nada de `0.0.0.0`).

### 3.2 Que **maneja internamente** la app vía WS (no expuesto al mod)

| # | Dirección | Acción de la app |
|---|---|---|
| 0 `PluginState` | SC → app | Guardar versión, log informativo |
| 2 `Reset` | SC → app | Marcar desconectado, limpiar mapa de jugadores |
| 3 `Ping` | SC → app | **Responder con `Pong` (4) inmediatamente**, mismo `ServerUniqueIdentifier` |
| 5 `InstanceState` | SC → app | Guardar último estado; exponer en `/health` |
| 6 `SoundState` | SC → app | Log debug |
| 11 `TalkState` | SC → app | Log debug |

### 3.3 Forma del mensaje WebSocket

Todos los comandos van como JSON con esta estructura:

```json
{
  "Command": "SelfStateUpdate",
  "ServerUniqueIdentifier": "VocesHeroicas",
  "Parameter": { ... }
}
```

Parámetros mínimos por comando:

- **Initiate (1):** `Name`, `ServerUniqueIdentifier`, `ChannelId`, `ChannelPassword`,
  `SoundPack` (`"default"`), `SwissChannelIds: []`, `SendTalkStates: false`,
  `SendRadioTrafficStates: false`, `UltraShortRangeDistance: 1.8`,
  `ShortRangeDistance: 8.0`, `LongRangeDistance: 20.0`.
- **SelfStateUpdate (7):** `Position: {X,Y,Z}`, `Rotation`, `VoiceRange`, `IsAlive`.
- **PlayerStateUpdate (8):** `Name`, `Position: {X,Y,Z}`, `Rotation`, `VoiceRange`,
  `IsAlive`. (Omitimos `VolumeOverride`, `DistanceCulled`, `Muffle` — fuera de
  alcance.)
- **RemovePlayer (10):** `Name`.
- **Pong (4):** `Parameter: null`.

`ServerUniqueIdentifier` es una constante de la config (`"VocesHeroicas"` por
defecto). Es el identificador lógico del canal de TS, no del servidor de Conan.

---

## 4. Arquitectura objetivo

```
                ┌─────────────── App intermediaria ───────────────┐
HTTP GET (mod)  │                                                  │  WS bidireccional
  ─────────►   │ Fastify    →   commands/dispatcher  →   ws       │  ◄──►  SaltyChat
                │ (REST)         (traduce + cachea)       (cliente)│        (TS3 plugin)
                │                       │                          │
                │                       ▼                          │
                │                state/PlayerRegistry              │
                │                state/SessionState                │
                │                       │                          │
                │                       ▼                          │
                │                 logger / events                  │
                └──────────────────────────────────────────────────┘
                                        │
                                        ▼
                          (futuro) Electron IPC → UI
```

Diseño guiado por:
- **Sin acoplamiento** entre HTTP y WS. El dispatcher es el único que sabe
  ambos lados.
- **EventEmitter en el dispatcher** para que Electron se enganche sin tocar la
  lógica.
- **Toda la configuración vía objeto**, no globales. Permite arrancar varias
  instancias en tests.

---

## 5. Fases de desarrollo

Cada fase es un PR (o commit lógico) independiente. Se ejecutan **en orden**.

### Fase 1 — Tipos y dispatcher de comandos SaltyChat

**Objetivo:** Tener un módulo que sepa **construir** todos los comandos
salientes y **parsear** todos los entrantes, con tipos. Aún no se cablea con
Fastify.

**Ficheros nuevos:**
- `src/saltychat/types.ts` — interfaces `Vector3`, `InitiateParams`,
  `SelfState`, `PlayerState`, enum `Command` con los IDs (0–11).
- `src/saltychat/messages.ts` — funciones `buildInitiate(...)`, `buildSelf(...)`,
  `buildPlayer(...)`, `buildRemove(...)`, `buildPong()`.
- `src/saltychat/parse.ts` — `parseIncoming(raw: string): IncomingMessage`
  unión discriminada por `Command`.

**Criterio de aceptación:**
- `npm run build` compila sin errores.
- Tests unitarios sencillos (fase 4) cubrirán esto luego; por ahora basta con
  un `console.log` de prueba en `index.ts` que imprima un mensaje construido.

### Fase 2 — Cliente SaltyChat completo

**Objetivo:** Reemplazar `SaltyChatClient.sendPosition` por una API real con
todos los comandos. Manejar Ping/Pong y los mensajes entrantes informativos.

**Ficheros afectados:**
- `src/saltychat-ws.ts` → renombrado a `src/saltychat/client.ts`.
- Nuevos métodos públicos:
  - `initiate(params)`
  - `updateSelf(state)`
  - `updatePlayer(state)`
  - `removePlayer(id)`
  - `disconnect()` (cierre limpio)
- Eventos emitidos (`extends EventEmitter`):
  - `'connected'` / `'disconnected'`
  - `'instance-state'` con el último `InstanceState`
  - `'ping'` / `'pong'` (telemetría)
  - `'sound-state'`, `'talk-state'` (debug)
- Auto-respuesta a `Ping` con `Pong` usando el `ServerUniqueIdentifier` configurado.
- Backoff exponencial al reconectar (1s, 2s, 4s, hasta 30s).

**Config inyectada:**
```ts
new SaltyChatClient({
  wsUrl: 'ws://127.0.0.1:8089',
  serverUniqueIdentifier: 'VocesHeroicas',
})
```

**Criterio de aceptación:**
- Si SaltyChat no está corriendo, la app sigue arriba y reintenta sin spamear.
- Cuando SaltyChat manda `Ping`, vemos en el log `← Ping` y `→ Pong`.

### Fase 3 — Endpoints HTTP definitivos

**Objetivo:** Implementar las 6 rutas de la sección 3.1. Eliminar `/position`.

**Ficheros afectados:**
- `src/http-server.ts` — rutas nuevas, validación con `schema` de Fastify.
- `src/state/player-registry.ts` (nuevo) — `Map<id, PlayerState>` con TTL.
- `src/state/session.ts` (nuevo) — guarda `lastInstanceState`,
  `lastPluginState`, `initiated: boolean`.

**Cada ruta:**
1. Valida query (números numéricos, `alive` ∈ `{0,1}`, strings no vacíos).
2. Convierte unidades (uu→m).
3. Actualiza registry/session.
4. Llama al método correspondiente del `SaltyChatClient`.
5. Responde `200 {ok:true}` siempre que la validación pase. Si el WS está
   desconectado, igual responde `ok` (el mod no debe bloquearse). Logamos un
   warn por cada N descartados.

**`/health` ampliado:**
```json
{
  "status": "ok",
  "saltychat": { "connected": true, "instanceState": "Ingame" },
  "session": { "initiated": true, "playerName": "Drogan" },
  "players": 7,
  "uptime": 123.4
}
```

**Criterio de aceptación:**
- Las 6 rutas devuelven `200` con queries válidas y `400` con inválidas.
- El registry se actualiza correctamente (verificable vía `/health`).
- `/shutdown` deja `players: 0` y `initiated: false`.

### Fase 4 — Auto-cull de jugadores y robustez

**Objetivo:** Que la app sobreviva a comportamientos imperfectos del mod.

**Cambios:**
- `PlayerRegistry` ejecuta un `setInterval(2000)` que elimina jugadores sin
  update en >5 s y emite `RemovePlayer` a SaltyChat.
- Throttle a nivel de cliente: si dos `/self` consecutivos vienen con la misma
  posición en <100 ms, se descarta el segundo (evita saturar SaltyChat si el
  mod tiene un bug de tick).
- Errores no capturados (`uncaughtException`, `unhandledRejection`) se logan y
  NO matan el proceso.
- Logger gana niveles `debug` / `info` / `warn` / `error` y un flag
  `LOG_LEVEL` por env var.

**Criterio de aceptación:**
- Si el mod deja de enviar a un jugador, en ≤7 s SaltyChat recibe su
  `RemovePlayer`.
- Spam de 1000 reqs/s al servidor: la CPU se mantiene < 20 % y no se cae.

### Fase 5 — Configuración externa

**Objetivo:** No más constantes hardcodeadas.

**Fichero nuevo:** `config.json` en la raíz del proyecto.

```json
{
  "httpPort": 7777,
  "saltyChatWsUrl": "ws://127.0.0.1:8089",
  "serverUniqueIdentifier": "VocesHeroicas",
  "voiceRanges": {
    "ultraShort": 1.8,
    "short": 8.0,
    "long": 20.0
  },
  "logLevel": "info"
}
```

- `src/config.ts` lo carga, valida con un schema y exporta tipado.
- Si falta el fichero, se crea con valores por defecto al primer arranque.

**Criterio de aceptación:**
- Cambiar el puerto en `config.json` y reiniciar levanta el servidor en el
  nuevo puerto.

### Fase 6 — Banco de pruebas

**Objetivo:** Poder validar el flujo sin tener TS3 ni Conan abiertos.

**Ficheros nuevos:**
- `test/fake-saltychat.ts` — servidor WS de mentira (`ws.Server`) que:
  - Acepta una conexión.
  - Envía `PluginState`, `InstanceState`.
  - Manda un `Ping` cada 5 s y comprueba que llega `Pong`.
  - Loga todos los mensajes que recibe.
- `test/fake-mod.ts` — script que dispara la secuencia de un jugador típico:
  `/init` → 200 ticks de `/self` y `/player` → `/remove` → `/shutdown`.
- `test/scenarios.md` — guion en markdown de qué se prueba manualmente.

**Cómo se usa:**
```bash
# Terminal A
npx tsx test/fake-saltychat.ts
# Terminal B
npm run dev
# Terminal C
npx tsx test/fake-mod.ts
```

**Criterio de aceptación:**
- Ejecutar los 3 procesos produce logs coherentes en cada uno y no hay errores.

### Fase 7 — Integración Electron-ready

**Objetivo:** Preparar la app para vivir dentro del main process de Electron.

**Cambios:**
- Refactor de `src/index.ts` para exportar:
  ```ts
  export async function createApp(config): Promise<AppHandle>
  // AppHandle = { start, stop, on(event), getStatus() }
  ```
- Cuando arranca standalone (`if (import.meta.url === ...)`) hace lo mismo
  que ahora.
- Eventos expuestos por `AppHandle`:
  - `log` (todos los mensajes del logger)
  - `status-change` (cambios en `/health`)
  - `mod-request` (cada GET, para mostrar en la UI)
- Documentar en este `PLAN.md` qué consume Electron.

**Criterio de aceptación:**
- Importar `createApp` desde otro proceso de Node funciona y los eventos llegan.

---

## 6. Tabla de ficheros final esperada

```
voces-heroicas-launcher/
├─ package.json
├─ tsconfig.json
├─ config.json                    # Fase 5
├─ PLAN.md                        # este documento
├─ src/
│  ├─ index.ts                    # entrypoint + createApp()
│  ├─ config.ts                   # carga/validación de config
│  ├─ logger.ts                   # actualizado con niveles
│  ├─ http-server.ts              # 6 rutas, sin /position
│  ├─ saltychat/
│  │  ├─ client.ts                # SaltyChatClient (era saltychat-ws.ts)
│  │  ├─ messages.ts              # builders de comandos salientes
│  │  ├─ parse.ts                 # parser de comandos entrantes
│  │  └─ types.ts                 # interfaces y enums
│  └─ state/
│     ├─ player-registry.ts       # Map con TTL
│     └─ session.ts               # estado de la sesión actual
└─ test/
   ├─ fake-saltychat.ts
   ├─ fake-mod.ts
   └─ scenarios.md
```

---

## 7. Fuera de alcance (deliberado)

No tocar hasta que el MVP esté validado en partida real:

- Echo (`SelfStateUpdate.Echo`).
- Phone (`PhoneCommunicationUpdate`, comando 20/21).
- Radio (comandos 30–39) — incluye `RadioTowerUpdate`, mic clicks, secondary
  channel, whisper targets.
- Megáfono (40/41).
- Sonidos custom (`PlaySound`, `StopSound`).
- `BulkUpdate` (9) — útil cuando haya muchos jugadores, pero por ahora los
  endpoints separados son más simples para el blueprint.
- `Muffle`, `DistanceCulled`, `VolumeOverride` en `PlayerStateUpdate`.

Si en el futuro se añade radio, lo natural es:
- Nuevas rutas `/radio/start`, `/radio/stop`, `/radio/channel`.
- Nuevos comandos en `messages.ts`.
- Sin tocar el flujo de posición.

---

## 8. Decisiones de diseño registradas

| Decisión | Por qué |
|---|---|
| Fastify v4 (no v5) | Node 18 instalado; v5 requiere Node 20+. Migrar cuando el entorno cambie. |
| HTTP GET (no POST/WebSocket) | El plugin HTTP de Blueprints en UE5 hace GETs limpiamente; los blueprints serializando JSON son un infierno. |
| Bind a 127.0.0.1 | Nadie de fuera debe poder mover voces ajenas. |
| Endpoints separados por jugador (no `/bulk`) | Más sencillo de implementar en el blueprint del mod. Si hay problemas de carga, se añade `/bulk` en una fase futura sin tocar lo existente. |
| Conversión uu→m en la app, no en el mod | Centralizado, fácil de cambiar si SaltyChat cambia de escala. |
| `200 OK` aunque SaltyChat esté caído | El mod no debe bloquearse esperando a TS3. La capa de transporte queda desacoplada. |
| EventEmitter para Electron | Cero acoplamiento con el front. La app intermediaria funciona standalone. |

---

## 9. Checklist para "MVP completado"

- [x] Fase 1: tipos + builders compilan.
- [x] Fase 2: cliente WS responde a Ping con Pong correctamente.
- [x] Fase 3: las 6 rutas HTTP funcionan, `/position` eliminado.
- [x] Fase 4: jugadores fantasma se eliminan solos en ≤7 s.
- [x] Fase 5: `config.json` cargado y validado.
- [x] Fase 6: `fake-saltychat` + `fake-mod` ejecutan un escenario completo sin errores.
- [x] Fase 7: `createApp()` exportable y consumible desde otro proceso.
- [ ] Prueba real: 2 jugadores en partida de Conan, voces se atenúan al alejarse.
