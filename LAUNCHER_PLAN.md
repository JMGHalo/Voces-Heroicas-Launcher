# Plan de desarrollo — Launcher Electron (TS3 + App intermedia + Conan Exiles)

> Documento de planificación para agentes que vayan a construir la **UI launcher**
> que envuelve los tres procesos. Pensado para ejecutarse en frío: todo el
> contexto necesario está aquí. Complementa a [PLAN.md](PLAN.md) (que cubre la
> app intermediaria, ya implementada).
>
> **Estado al escribir este documento:** la app intermediaria existe y funciona
> standalone (`npm run dev`). El launcher es la pieza que falta.

---

## 1. Objetivo

Producir **un instalador Windows ligero** (`Voces Heroicas Launcher Setup.exe`)
que el jugador ejecuta una vez y le permite:

1. Ver el estado de los **3 procesos** (TeamSpeak3, App intermedia, Conan Exiles).
2. **Iniciar / parar / reiniciar** cada uno **individualmente**.
3. Opcionalmente, **iniciar/parar todo** con un solo click.
4. **Auto-actualizarse** desde GitHub Releases cuando hay una versión nueva.

UI mínima, robusta, sin login.

**Lo que NO es este launcher:**
- No instala TS3, ni el plugin SaltyChat, ni Conan Exiles. Asume que ya están
  instalados en la máquina del jugador.
- No descarga mods. Asume que el `.pak` ya está en la carpeta `Mods` de Conan.
- No es multi-perfil ni multi-cuenta.

---

## 2. Componentes que orquesta

| # | Componente | Cómo se gestiona | Cómo se detecta su estado |
|---|---|---|---|
| 1 | **TeamSpeak3** | Spawn del `.exe` externo (`ts3client_win64.exe`) con **path configurable** y argumento `ts3server://...` para autoconectar al servidor del clan. | Buscar el proceso por nombre **+** intentar conexión TCP al WS de SaltyChat (`127.0.0.1:8089`). |
| 2 | **App intermedia** | **Embebida** en el main process del launcher: importar `createApp()` desde `src/index.ts` y arrancarla in-process. **No** se spawnea como child process. | `getStatus()` del `AppHandle` + estado interno (running/stopped). |
| 3 | **Conan Exiles** | **Lanzado únicamente vía Steam URL** (`steam://rungameid/440900`). No requiere path al ejecutable: Steam se encarga. Asumimos que todos los jugadores tienen Conan en Steam (es donde está el workshop). | Buscar proceso `ConanSandbox.exe` en la lista de procesos. |

**Por qué la intermedia va embebida y no spawneada:**
- Evita un proceso Node.js extra que arrastrar al empaquetado.
- Acceso directo a eventos (`status-change`, `mod-request`, `log`) sin IPC extra.
- Ya está diseñada para esto: `createApp()` devuelve un `AppHandle` exportable
  (ver fase 7 del PLAN.md).
- Único riesgo: si la intermedia crashea, podría arrastrar al main process. Se
  mitiga con `try/catch` alrededor de `start()` y los handlers de
  `uncaughtException` / `unhandledRejection` ya existentes.

---

## 3. Arquitectura

```
┌─────────────────── Electron ──────────────────────┐
│                                                   │
│  Main process (Node)                              │
│  ├─ window manager (BrowserWindow único)          │
│  ├─ ProcessManager                                │
│  │   ├─ TeamSpeakProcess  (spawn / kill / status) │
│  │   ├─ IntermediateApp   (createApp() embebido)  │
│  │   └─ ConanProcess      (spawn / kill / status) │
│  ├─ StatusPoller (cada 2s → broadcast por IPC)    │
│  └─ launcher-config.json (paths + opciones)       │
│                                                   │
│        ▲                                          │
│        │ IPC (start/stop/restart, status, logs)   │
│        ▼                                          │
│  Renderer process (Chromium)                      │
│  └─ index.html + renderer.ts + styles.css         │
│      └─ 3 cards con estado y botones              │
└───────────────────────────────────────────────────┘
```

### 3.1 Estados de cada componente

Cada componente reporta exactamente uno de:

- `stopped` — no corriendo (gris)
- `starting` — arrancando, aún no se confirma estado (amarillo)
- `running` — corriendo y operativo (verde)
- `error` — ha intentado arrancar pero ha fallado, o se ha cerrado inesperadamente (rojo)

**Reglas de transición:**
- `stopped → starting` al pulsar "Iniciar".
- `starting → running` cuando se confirma estado (proceso vivo + check específico).
- `starting → error` si tras 15s no se confirma estado, o si el spawn falla.
- `running → stopped` al pulsar "Parar" (cierre limpio o `kill` tras 5s).
- `running → error` si el proceso muere por su cuenta sin que el usuario lo pidiera.
- `error → stopped` al pulsar "Parar" (reset del estado).

---

## 4. Estructura de carpetas final

> Mantener **plana y simple**. Sin sobreingeniería, sin packages anidados, sin
> carpetas para futuras expansiones que no van a existir.

```
voces-heroicas-launcher/
├─ package.json              # actualizar: añadir electron, electron-builder, electron-updater
├─ tsconfig.json             # ya existe; añadir path para launcher/
├─ electron-builder.json     # NUEVO — config de empaquetado y publish
├─ config.json               # config de la intermediaria (ya existe)
├─ PLAN.md                   # plan de la intermedia
├─ LAUNCHER_PLAN.md          # este documento
├─ README.md                 # NUEVO — descripción + cómo instalar/compilar
├─ .gitignore                # NUEVO
│
├─ src/                      # ya existe — la intermedia (no tocar)
│  └─ ...
│
├─ launcher/                 # NUEVO — todo el código del launcher
│  ├─ main.ts                # entrypoint Electron main process + auto-updater
│  ├─ preload.ts             # bridge contextIsolation
│  ├─ process-manager.ts     # clases TeamSpeakProcess / ConanProcess / IntermediateApp
│  ├─ launcher-config.ts     # carga / valida launcher-config.json (vive en %APPDATA%)
│  └─ renderer/
│     ├─ index.html
│     ├─ renderer.ts
│     └─ styles.css
│
├─ build/                    # NUEVO — assets para electron-builder
│  ├─ icon.ico               # icono del .exe
│  └─ icon.png
│
├─ .github/                  # NUEVO (fase L9, opcional)
│  └─ workflows/
│     └─ release.yml
│
├─ dist/                     # generado por tsc — código compilado (gitignore)
└─ release/                  # generado por electron-builder — instalador (gitignore)
```

`launcher-config.json` no está en el repo: vive en
`%APPDATA%/VocesHeroicasLauncher/` y se crea al primer arranque.

**Nada más.** No carpetas `services/`, `models/`, `utils/`, `shared/`,
`components/`. Todo plano dentro de `launcher/`.

---

## 5. UI

### 5.1 Layout

Una sola ventana, **fija a 520×420 px**, no redimensionable, sin minimizar al
tray (cierre = stop de todo).

```
┌────────────────────────────────────────────────────┐
│  Voces Heroicas Launcher                       [X] │
├────────────────────────────────────────────────────┤
│                                                    │
│  ● TeamSpeak 3                       [⏵] [⟳] [■]  │
│    Conectado al servidor                           │
│                                                    │
│  ● App intermedia                    [⏵] [⟳] [■]  │
│    HTTP :7777 · WS conectado                       │
│                                                    │
│  ● Conan Exiles                      [⏵] [⟳] [■]  │
│    No iniciado                                     │
│                                                    │
├────────────────────────────────────────────────────┤
│  [ Iniciar todo ]              [ Parar todo ]      │
└────────────────────────────────────────────────────┘
```

- Cada fila: punto de color (estado) + nombre + línea de detalle + 3 botones.
- Botones: ⏵ Iniciar, ⟳ Reiniciar, ■ Parar.
- Botones deshabilitados según el estado:
  - `stopped` → solo ⏵ activo.
  - `starting` → todos deshabilitados (con spinner en el punto de color).
  - `running` → ⟳ y ■ activos.
  - `error` → ⏵ y ■ activos.
- "Iniciar todo" arranca los 3 en orden: **TS3 → intermedia → Conan**. Espera a
  que cada uno llegue a `running` antes de empezar el siguiente (timeout 30s
  global; si uno falla, no continúa).
- "Parar todo" para los 3 en orden inverso: **Conan → intermedia → TS3**.

### 5.2 Detalles visuales

- Tema oscuro plano. Sin animaciones más allá del spinner.
- Tipografía del sistema (Segoe UI en Windows).
- No menú nativo (`Menu.setApplicationMenu(null)`).
- Sin DevTools en producción.

### 5.3 Logs

**Fase 1: NO hay panel de logs en la UI.** Si el usuario necesita debugging,
los logs van a un fichero (`%APPDATA%/VocesHeroicasLauncher/launcher.log`)
y a la consola del proceso si se ejecuta desde terminal.

Si en el futuro se quiere panel de logs, se añade como ventana secundaria
abrible con `Ctrl+L`. **Fuera de alcance ahora.**

---

## 6. Configuración

### 6.1 `launcher-config.json`

Se crea con valores por defecto al primer arranque. Ubicación: `%APPDATA%/VocesHeroicasLauncher/launcher-config.json`
(la carpeta de instalación es read-only en NSIS por defecto).

```json
{
  "teamspeak": {
    "exePath": "C:\\Program Files\\TeamSpeak 3 Client\\ts3client_win64.exe",
    "autoConnect": {
      "enabled": true,
      "address": "",
      "port": 9987,
      "nickname": "",
      "serverPassword": "",
      "channel": "",
      "channelPassword": ""
    }
  },
  "conan": {
    "steamAppId": "440900"
  },
  "intermediate": {
    "autoStart": true
  },
  "ui": {
    "startAllOnLaunch": false,
    "stopAllOnClose": true
  },
  "updates": {
    "checkOnLaunch": true,
    "channel": "stable"
  }
}
```

- **TS3 path:** configurable, **obligatorio** que el usuario lo confirme la
  primera vez. Si está vacío o el archivo no existe al pulsar Iniciar → diálogo
  nativo con file picker y se persiste.
- **TS3 autoconnect:** el launcher arranca TS3 pasándole como **primer argumento**
  una URL `ts3server://`. Formato:

  ```
  ts3server://<address>?port=<port>&nickname=<nick>&password=<server_pwd>&channel=<channel>&channel_password=<channel_pwd>
  ```

  Todos los valores van URL-encoded. Campos vacíos se omiten del query string.
  Si `autoConnect.enabled` es `false`, TS3 se lanza sin args y el usuario se
  conecta manualmente.
- **Conan:** se lanza con `start steam://rungameid/440900`. No hay `exePath`
  configurable: Steam siempre es suficiente y mantenerlo evita una rama de
  código y un campo más que pedir.
- **Updates:** ver sección 9.

### 6.2 Detección automática del path de TS3

Al primer arranque, si `teamspeak.exePath` está vacío:

1. Leer registro `HKLM\SOFTWARE\TeamSpeak 3 Client\InstallLocation` (también
   `HKCU\` y la variante `WOW6432Node` por compatibilidad x86).
2. Si no se encuentra, dejar el campo vacío. La primera vez que el usuario
   pulse Iniciar, abrir file picker.

El path es **siempre editable** desde un botón "Configurar…" pequeño en la
esquina inferior izquierda de la ventana (abre un diálogo con los campos del
config). No hace falta una ventana de settings completa.

---

## 7. ProcessManager — API interna

Cada componente implementa una interfaz común. **Una sola interfaz, tres
implementaciones.** Sin clases base abstractas innecesarias.

```ts
type ComponentStatus = 'stopped' | 'starting' | 'running' | 'error'

interface ManagedComponent {
  readonly id: 'teamspeak' | 'intermediate' | 'conan'
  readonly status: ComponentStatus
  readonly detail: string                    // texto bajo el nombre en la UI
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  on(event: 'status-change', cb: () => void): void
}
```

### 7.1 TeamSpeakProcess

- `start()`: construye la URL `ts3server://...` desde
  `teamspeak.autoConnect` (URL-encoding de cada valor; omite campos vacíos).
  Si `autoConnect.enabled` es `false`, no pasa argumento.
  Llama `child_process.spawn(exePath, [url], { detached: true, stdio: 'ignore' })`.
  Marca `starting`. Tras spawn exitoso, lanza poll cada 1s buscando el proceso
  por PID **y** comprobando si el WS de SaltyChat (`ws://127.0.0.1:8089`) acepta
  conexión. Si ambas condiciones se cumplen → `running`. Si tras 15s no →
  `error`.
- `stop()`: `taskkill /PID <pid> /T`. Si no muere en 5s, `taskkill /F`.
- Detail: `"Conectado a <address>"` / `"Sin SaltyChat"` / `"No iniciado"`.

**Nota sobre la URL:** TS3 acepta el esquema `ts3server://` como argumento de
línea de comandos desde la versión 3.x. Si TS3 ya estaba abierto antes de
pulsar Iniciar, el cliente vivo recibe la URL y se conecta sin abrir una
segunda instancia (comportamiento nativo de TS3).

### 7.2 IntermediateApp

- `start()`: `import('../src/index.js')` → `createApp()` → `start()`. Marca
  `running` cuando `start()` resuelve sin errores.
- `stop()`: `appHandle.stop()`.
- Detail: `getStatus()` → `"HTTP :7777 · WS conectado"` /
  `"HTTP :7777 · WS desconectado"`. Actualizado cada 2s.
- **NB:** la intermedia gana eventos `status-change` (definidos en fase 7 del
  PLAN.md). Suscribirse a ellos en lugar de polling cuando sea posible.

### 7.3 ConanProcess

- `start()`: `child_process.exec(`start steam://rungameid/${steamAppId}`, { shell: true })`.
  Marca `starting`. Polling cada 2s buscando `ConanSandbox.exe` en la lista
  de procesos (usar `tasklist` o librería `ps-list`). Cuando aparece → `running`.
  Timeout 60s (Conan tarda en arrancar, especialmente la primera vez tras
  validación de Steam).
- `stop()`: `taskkill /IM ConanSandbox.exe /F`.
- Detail: `"En ejecución"` / `"Iniciando vía Steam…"` / `"No iniciado"`.

**Nota:** si Steam no está corriendo, la URL lo lanza primero y luego inicia
Conan, lo que puede tardar hasta 60s. Si Steam no está instalado, la llamada
falla silenciosamente y el timeout marca `error`. Es responsabilidad del
jugador tener Steam instalado.

### 7.4 StatusPoller

Un solo `setInterval(2000)` en main que recoge el status de los 3 y emite
`ipcMain.send('status-update', { teamspeak, intermediate, conan })` al renderer.

---

## 8. IPC

Canal único, mensajes tipados. **Sin sobreingeniería.**

**Renderer → Main:**
- `component:start` `(id)`
- `component:stop` `(id)`
- `component:restart` `(id)`
- `all:start`
- `all:stop`

**Main → Renderer:**
- `status-update` `({ teamspeak, intermediate, conan })`
- `error` `({ id, message })` — muestra toast/diálogo.

`preload.ts` expone vía `contextBridge` un único objeto `window.launcher` con
estos métodos. **Sin frameworks (React/Vue).** HTML + TS plano.

---

## 9. Empaquetado y auto-update

### 9.1 Stack

- **Electron** (última stable, actualmente 33.x).
- **electron-builder** para producir el instalador.
- **electron-updater** para auto-actualización vía GitHub Releases.
- **tsc** para compilar TS → JS antes de empaquetar (no usar webpack/vite a
  menos que necesario).

### 9.2 Por qué NSIS y no portable

El `.exe` portable es más simple, pero **electron-updater no soporta target
portable**. Como el usuario quiere auto-update, hay que usar NSIS (instalador).

Configuración elegida: **NSIS one-click, per-user, sin atajos en escritorio
opcionales**. Resultado final UX:

1. Usuario descarga `Voces Heroicas Launcher Setup-X.Y.Z.exe` de GitHub.
2. Doble click → instala en `%LOCALAPPDATA%/Programs/voces-heroicas-launcher/`
   (sin admin) y abre el launcher.
3. En arranques siguientes, el launcher comprueba updates en background; si
   hay uno, lo descarga y lo aplica al próximo cierre (o al pulsar
   "Actualizar y reiniciar" en el banner).

### 9.3 Flujo de build local

```
npm run build         # tsc → dist/
npm run launcher:dist # tsc && electron-builder → release/
```

`dist/` contiene:
- `dist/launcher/main.js`, `preload.js`, `process-manager.js`, etc.
- `dist/launcher/renderer/index.html` (copiado tal cual), `renderer.js`, `styles.css`.
- `dist/src/...` (la intermedia compilada).

### 9.4 `electron-builder` config

Fichero separado en `electron-builder.json` (más legible que dentro de
`package.json` cuando crece):

```json
{
  "appId": "net.vocesheroicas.launcher",
  "productName": "Voces Heroicas Launcher",
  "directories": {
    "output": "release",
    "buildResources": "build"
  },
  "files": [
    "dist/**/*",
    "config.json",
    "node_modules/**/*",
    "package.json"
  ],
  "extraResources": [
    "config.json"
  ],
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico",
    "artifactName": "${productName} Setup-${version}.${ext}"
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowToChangeInstallationDirectory": false,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Voces Heroicas"
  },
  "publish": [
    {
      "provider": "github",
      "owner": "JMGHalo",
      "repo": "voces-heroicas-launcher"
    }
  ]
}
```

> El bloque `publish` es lo que usa **tanto** electron-builder (al publicar la
> release) **como** electron-updater (al comprobar updates). No duplicar la
> configuración en otro sitio.

### 9.5 Auto-update — implementación

En `launcher/main.ts`:

```ts
import { autoUpdater } from 'electron-updater'

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

app.on('ready', () => {
  if (config.updates.checkOnLaunch) {
    autoUpdater.checkForUpdates().catch(err => log.warn('updater', err))
  }
})

autoUpdater.on('update-available', (info) =>
  mainWindow.webContents.send('update:available', info))
autoUpdater.on('update-downloaded', (info) =>
  mainWindow.webContents.send('update:downloaded', info))
autoUpdater.on('error', (err) =>
  mainWindow.webContents.send('update:error', err.message))

ipcMain.handle('update:install-now', () => {
  autoUpdater.quitAndInstall()
})
```

**UX en el renderer:**
- Banner sutil arriba: `"Hay una actualización disponible — Descargando…"`.
- Cuando termina: `"Actualización lista [Reiniciar ahora]"`.
- Si el usuario ignora el banner, se aplica automáticamente al cerrar el
  launcher (`autoInstallOnAppQuit`).
- En caso de error de update, log a fichero. **No** bloquear la UI.

### 9.6 Releases en GitHub — workflow

Repositorio: `github.com/<owner>/voces-heroicas-launcher` (público o privado;
si es privado, el updater necesitará un token — ver sección 10).

Flujo de release **manual** (válido para empezar):

1. Bump de versión: `npm version patch|minor|major`. Crea tag `vX.Y.Z`.
2. `git push --tags`.
3. `npm run launcher:dist`. Genera en `release/`:
   - `Voces Heroicas Launcher Setup-X.Y.Z.exe`
   - `latest.yml` (manifest que electron-updater lee)
   - `*.blockmap` (para deltas)
4. Subir esos 3 ficheros a la release de GitHub para el tag `vX.Y.Z`,
   marcarla como Latest.

Esto se puede automatizar con GitHub Actions más adelante (ver fase L9).

### 9.7 `package.json` — scripts añadidos

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc",
    "launcher:dev": "tsc && electron dist/launcher/main.js",
    "launcher:dist": "tsc && electron-builder",
    "release": "npm run launcher:dist -- --publish always"
  }
}
```

`npm run release` requiere `GH_TOKEN` en el entorno con permisos `repo`.
electron-builder se encarga de subir los artefactos a la release del tag actual.

---

## 9.8 Repositorio Git / GitHub

**Repositorio:** `github.com/JMGHalo/voces-heroicas-launcher` (público).
- `JMGHalo` es el username técnico de GitHub (lo que va en URLs y en el campo
  `owner` de electron-builder / electron-updater).
- `JoshPhantom` es el nombre público del autor/publisher (va en
  `package.json:author`, copyright del instalador, etc.).

El directorio `D:\VocesHeroicasLauncher` aún **no es un repositorio Git** (el
contexto inicial lo confirma). Antes de la primera release hay que:

1. `git init` en la raíz del proyecto.
2. Crear `.gitignore` con:
   ```
   node_modules/
   dist/
   release/
   *.log
   .env
   .env.*
   ```
3. Crear `README.md` mínimo con:
   - Qué es el launcher (1 párrafo).
   - Cómo se instala (descargar el `.exe` de la última release de
     `github.com/JMGHalo/voces-heroicas-launcher/releases/latest`).
   - Cómo se compila desde código (`npm install` + `npm run launcher:dev`).
   - Link a `PLAN.md` y `LAUNCHER_PLAN.md` para desarrolladores.
4. Actualizar `package.json`:
   - `"author": "JoshPhantom"`
   - `"repository": { "type": "git", "url": "https://github.com/JMGHalo/voces-heroicas-launcher.git" }`
   - `"license": "MIT"` (o lo que prefiera el autor; declararla explícitamente).
5. Crear el repo público `voces-heroicas-launcher` en la cuenta `JMGHalo`. La
   app intermedia **vive dentro de este mismo repo** (carpeta `src/`), no en
   uno separado.
6. `git remote add origin https://github.com/JMGHalo/voces-heroicas-launcher.git`,
   `git push -u origin main`.

### 9.8.1 Higiene de secretos (repo público)

El repositorio será público. **Nada sensible puede llegar al repo, ni ahora
ni accidentalmente en el futuro.** Reglas firmes:

- **`launcher-config.json` NO se commitea.** Vive en `%APPDATA%/VocesHeroicasLauncher/`
  y se crea con plantilla en el primer arranque. Aunque actualmente solo
  contiene paths y datos del servidor TS3 (que el usuario ha confirmado serán
  públicos), tratarlo como artefacto local evita derivar de aquí algún hábito
  malo. Está cubierto: no aparece en `files` del electron-builder ni se genera
  desde el repo.
- **`.env` y `.env.*` en `.gitignore`** desde el primer commit. El `GH_TOKEN`
  para publicar releases vive en el entorno local del desarrollador o en
  `secrets.GITHUB_TOKEN` de GitHub Actions; **jamás** en el repo.
- **No hardcodear el token de GitHub** en ningún sitio del código. electron-updater
  no lo necesita para repos públicos.
- **Datos del servidor TS3:** el usuario confirma que serán públicos cuando
  exista. Aun así, se distribuyen vía la **plantilla por defecto** de
  `launcher-config.json` que se genera al primer arranque (ver sección 6.1),
  no como constantes en el código. Por ahora dejar los campos vacíos
  (`address: ""`, etc.) hasta que el servidor exista. Cuando se cree, se
  actualizan los defaults en una versión posterior.
- **Logs de la intermediaria** pueden contener nombres de jugadores y posiciones.
  Aceptable que vayan a fichero local; **no** subirlos como issues/attachments
  sin filtrar primero.
- Antes del primer `git push`, ejecutar `git status` y revisar a mano que no
  hay ficheros con credenciales, tokens, ni `launcher-config.json`.
- Recomendado: activar **GitHub secret scanning** y **Dependabot alerts** en
  el repo (Settings → Code security).

### 9.9 GitHub Actions (opcional, fase L9)

Workflow `.github/workflows/release.yml` que dispara al push de tag `v*`:

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run launcher:dist
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Con esto, taggear y push libera automáticamente la nueva versión con sus
artefactos. **Fase L9, opcional para el MVP.**

---

## 10. Fases de desarrollo

Cada fase es un PR/commit lógico independiente. Ejecutar en orden.

### Fase L1 — Esqueleto Electron + UI estática

**Objetivo:** Ventana Electron que muestra los 3 cards con datos hardcodeados.
Botones presentes pero no hacen nada.

**Ficheros nuevos:**
- `launcher/main.ts` — crea `BrowserWindow` 520×420 sin redim, carga `index.html`.
- `launcher/preload.ts` — vacío con `contextBridge`.
- `launcher/renderer/index.html`, `renderer.ts`, `styles.css` — UI estática.
- `build/icon.ico`, `icon.png` — placeholder si hace falta.
- `package.json` — añadir `electron`, `electron-builder` como devDeps.
- `tsconfig.json` — incluir `launcher/**/*` en `include`.

**Criterio de aceptación:** `npm run launcher:dev` abre la ventana con los 3
cards visibles, todos en estado `stopped`.

### Fase L2 — `launcher-config.json` y detección de paths

**Objetivo:** Cargar/crear el config, detectar paths de TS3 vía registro,
exponerlo al main process.

**Ficheros nuevos:**
- `launcher/launcher-config.ts` — `loadLauncherConfig()` similar a `src/config.ts`.

**Criterio de aceptación:** Al primer arranque se crea `launcher-config.json`
con el path de TS3 detectado (si existe). Cambios manuales se respetan.

### Fase L3 — ProcessManager: IntermediateApp embebida

**Objetivo:** El card "App intermedia" funciona end-to-end. Es el más fácil y
sirve de validación del IPC.

**Ficheros nuevos:**
- `launcher/process-manager.ts` — clase `IntermediateApp` que envuelve
  `createApp()`. Tipo `ManagedComponent` definido aquí.

**Cambios:**
- `launcher/main.ts` — instancia el manager, registra IPC handlers para los
  3 canales, monta el StatusPoller.
- `launcher/preload.ts` — expone `window.launcher.{start,stop,restart,onStatus}`.
- `launcher/renderer/renderer.ts` — engancha botones a IPC, escucha
  `status-update` y repinta.

**Criterio de aceptación:** Botones del card "App intermedia" arrancan/paran
la intermedia. El detail muestra el puerto y el estado del WS de SaltyChat.

### Fase L4 — TeamSpeakProcess

**Objetivo:** Spawn/kill de TS3 + detección por PID + check WS de SaltyChat.

**Cambios:**
- `launcher/process-manager.ts` — añadir clase `TeamSpeakProcess`.
- `launcher/main.ts` — registrarla en el manager.

**Dependencias nuevas:** ninguna (usar `child_process`, `net` nativos).

**Criterio de aceptación:** Pulsar Iniciar abre TS3. Cuando SaltyChat carga
y abre el puerto 8089, el card pasa a `running`. Pulsar Parar mata TS3 con
`taskkill`.

### Fase L5 — ConanProcess

**Objetivo:** Lanzar Conan vía Steam URL + detectar `ConanSandbox.exe`.

**Cambios:**
- `launcher/process-manager.ts` — clase `ConanProcess`.

**Dependencias nuevas:** opcionalmente `ps-list` (~50 KB) para listar procesos
de forma cross-version. Si se prefiere zero-deps, parsear `tasklist /FO CSV`.

**Criterio de aceptación:** Pulsar Iniciar abre Conan a través de Steam (o
del exe si está configurado). Cuando el proceso aparece en la lista → `running`.

### Fase L6 — Iniciar todo / Parar todo

**Objetivo:** Botones globales con orquestación secuencial.

**Cambios:**
- `launcher/main.ts` — handlers `all:start` y `all:stop` con la lógica de
  esperar transición a `running` con timeout 30s por componente.
- `launcher/renderer/renderer.ts` — añadir botones globales y feedback visual.

**Criterio de aceptación:** "Iniciar todo" levanta los 3 en orden TS3 →
intermedia → Conan. Si TS3 falla, no se intenta arrancar el resto y se
muestra error.

### Fase L7 — Empaquetado NSIS

**Objetivo:** Producir `release/Voces Heroicas Launcher Setup-X.Y.Z.exe` que
instala y funciona en una máquina limpia (con TS3, Conan y Steam preinstalados).

**Cambios:**
- `electron-builder.json` con la config de la sección 9.4.
- `.gitignore` — añadir `dist/` y `release/`.
- `git init` + repo en GitHub (sección 9.8) si aún no se ha hecho.
- `build/icon.ico` definitivo (no placeholder).

**Criterio de aceptación:** Ejecutar el instalador en otra máquina Windows
deja el launcher operativo en el menú Inicio y permite arrancar los 3
procesos. Funciona sin Node.js instalado en esa máquina.

### Fase L8 — Auto-update

**Objetivo:** El launcher comprueba updates en GitHub Releases y se actualiza
solo.

**Cambios:**
- `package.json` — añadir `electron-updater` como dependencia (no devDep,
  va al runtime).
- `launcher/main.ts` — integración del `autoUpdater` (sección 9.5).
- `launcher/renderer/index.html` + `renderer.ts` — banner de update con
  botón "Reiniciar ahora".
- Subir manualmente una release `v0.1.0` y luego una `v0.1.1` para verificar.

**Criterio de aceptación:** Una instancia con `v0.1.0` instalado detecta
`v0.1.1` en GitHub, descarga el delta, muestra el banner y al pulsar
"Reiniciar ahora" se actualiza.

### Fase L9 — GitHub Actions release (opcional)

**Objetivo:** Automatizar el publicado al taggear.

**Cambios:**
- `.github/workflows/release.yml` (sección 9.9).

**Criterio de aceptación:** `git tag v0.1.2 && git push --tags` produce una
release de GitHub con los 3 artefactos sin intervención manual.

---

## 11. Tabla de dependencias nuevas

| Paquete | Versión | Tipo | Para qué |
|---|---|---|---|
| `electron` | última stable | devDep | Main + renderer. |
| `electron-builder` | última stable | devDep | Empaquetado NSIS. |
| `electron-updater` | última stable | **dep** (no devDep) | Auto-update vía GitHub Releases. Va al runtime. |
| `ps-list` (opcional) | ^8 | dep | Detectar `ConanSandbox.exe`. Si se omite, parsear `tasklist`. |

**No añadir:** React, Vue, Svelte, Vite, webpack, electron-forge, electron-log,
frameworks de IPC, ORMs, ni nada que no esté en esta tabla.

---

## 12. Decisiones de diseño registradas

| Decisión | Por qué |
|---|---|
| Intermedia embebida, no spawneada | Evita un proceso Node extra al empaquetar. Acceso directo al `AppHandle` y eventos. |
| Target NSIS (no portable) | electron-updater no soporta portable. NSIS one-click per-user es el camino más simple compatible con auto-update. |
| Sin React/Vue | UI de 3 filas y 8 botones no justifica un framework. HTML+TS plano es más fácil de mantener. |
| Ventana fija no redimensionable | Layout cerrado, no hay nada que beneficie de más espacio. |
| Sin tray icon ni minimizar | Cierre = stop. Una cosa menos que documentar y depurar. |
| Detección de TS3 vía WS de SaltyChat | El proceso vivo no garantiza que SaltyChat esté cargado. El WS sí. |
| Conan **solo** vía Steam URL (no path configurable) | El workshop del mod vive en Steam, así que todos los jugadores lo tienen ahí. Una rama menos de código y un campo menos en config. |
| TS3 con `ts3server://` URL | TS3 conecta automáticamente al servidor configurado sin que el jugador toque nada. Si TS3 ya estaba abierto, reutiliza la instancia. |
| `launcher-config.json` en `%APPDATA%` | NSIS instala en `%LOCALAPPDATA%/Programs/...`, que en arquitectura NSIS es read-only desde la app. La config debe vivir fuera. |
| Repo Git único (launcher + intermedia) | Versionan juntos. Una release = un launcher con su intermedia compatible incluida. Evita problemas de matching de versiones. |
| Auto-update vía electron-updater + GitHub Releases | Estándar de facto en Electron. No requiere infraestructura propia. |
| Logs solo a fichero (no UI) | YAGNI. Si hace falta debug, abrir el log. |

---

## 13. Fuera de alcance (deliberado)

No implementar hasta que el launcher base esté validado:

- Tray icon, minimizar a bandeja.
- Panel de logs en la UI.
- Multi-perfil / multi-cuenta.
- Descarga/instalación automática de mods o del plugin SaltyChat.
- Ventana de configuración completa (sólo el diálogo simple "Configurar…" para
  los campos esenciales — el resto se edita en `launcher-config.json`).
- Conan vía path directo / Epic Games / fuera de Steam.
- Telemetría / crash reporting.
- Versión Mac/Linux.
- Internacionalización (UI siempre en español).
- Canales de update múltiples (`stable`/`beta`). Por ahora solo `stable`.
- Firma de código del instalador (Authenticode). SmartScreen mostrará warning
  hasta que se firme; aceptable para el MVP.

---

## 14. Checklist para "Launcher MVP completado"

- [ ] Fase L1: ventana Electron con UI estática.
- [ ] Fase L2: `launcher-config.json` carga y detecta path de TS3.
- [ ] Fase L3: card de la intermedia arranca/para correctamente.
- [ ] Fase L4: card de TS3 arranca/para correctamente **y autoconecta** al
      servidor configurado mediante URL `ts3server://`.
- [ ] Fase L5: card de Conan arranca/para correctamente vía Steam URL.
- [ ] Fase L6: "Iniciar todo" / "Parar todo" funcionan en orden.
- [ ] Fase L7: instalador NSIS se ejecuta en máquina limpia.
- [ ] Fase L8: instancia con versión vieja detecta release nueva en GitHub,
      descarga y aplica el update.
- [ ] Fase L9 (opcional): GitHub Actions publica releases al taggear.
- [ ] Prueba real: jugador arranca el launcher, pulsa "Iniciar todo", entra a
      la partida y oye voces atenuadas por distancia.
