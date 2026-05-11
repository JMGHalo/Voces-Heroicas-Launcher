# Escenarios de prueba manual

## Prerequisitos

```bash
# Instalar dependencias si es la primera vez
npm install
```

---

## Escenario 1 — Flujo completo con fake-saltychat

**Qué se prueba:** comunicación bidireccional HTTP ↔ WS completa.

```bash
# Terminal A: servidor WS falso
npx tsx test/fake-saltychat.ts

# Terminal B: app intermediaria
npm run dev

# Terminal C: mod falso (esperar a que B esté arriba)
npx tsx test/fake-mod.ts
```

**Resultado esperado:**

| Terminal | Mensajes clave |
|----------|---------------|
| A | `← {"Command":"Initiate",...}` — `← SelfStateUpdate` (×200) — `✓ Pong recibido` cada 5 s |
| B | `← PluginState`, `← InstanceState`, `← Ping`, `→ Pong`, `→ RemovePlayer` |
| C | `✓ GET /init → 200`, `✓ GET /self → 200` (×200), `✓ GET /remove → 200`, `✓ GET /shutdown → 200` |

---

## Escenario 2 — Reconexión con backoff exponencial

**Qué se prueba:** la app no se cuelga si SaltyChat no está disponible.

1. Arrancar sólo `npm run dev` (sin fake-saltychat).
2. Observar los logs de reintento: `Reintentando en 1s...`, `2s...`, `4s...`, hasta `30s...`.
3. Arrancar `npx tsx test/fake-saltychat.ts`.
4. Verificar que la app reconecta y el delay vuelve a 1 s.

---

## Escenario 3 — Auto-cull de jugadores fantasma

**Qué se prueba:** jugadores sin actualización se eliminan solos en ≤ 7 s.

```bash
# Con fake-saltychat + app corriendo, añadir un jugador manualmente:
curl "http://127.0.0.1:7777/player?id=TestPlayer&x=0&y=0&z=0&yaw=0&range=800&alive=1"

# No enviar más updates y esperar 7 s.
# fake-saltychat debe mostrar:
# ← {"Command":"RemovePlayer","Parameter":{"Name":"TestPlayer"}}
```

---

## Escenario 4 — Validación de parámetros (400 vs 200)

```bash
# Debe devolver 400 (alive fuera de enum)
curl "http://127.0.0.1:7777/self?x=0&y=0&z=0&yaw=0&range=800&alive=2"

# Debe devolver 400 (falta parámetro requerido)
curl "http://127.0.0.1:7777/player?id=X&x=0&y=0&z=0&yaw=0&range=800"

# Debe devolver 400 (x no es numérico)
curl "http://127.0.0.1:7777/self?x=abc&y=0&z=0&yaw=0&range=800&alive=1"

# Debe devolver 200
curl "http://127.0.0.1:7777/health"
```

---

## Escenario 5 — Throttle de /self duplicado

**Qué se prueba:** que la misma posición en < 100 ms no satura SaltyChat.

Enviar dos requests identicos a `/self` con < 100 ms de diferencia y verificar
en fake-saltychat que sólo llega un `SelfStateUpdate`.

---

## Escenario 6 — Carga (resilencia)

```bash
# Requiere: npm install -g autocannon
autocannon -c 10 -d 10 "http://127.0.0.1:7777/self?x=0&y=0&z=0&yaw=0&range=800&alive=1"
```

**Criterio:** CPU < 20 %, sin crashes, todas las respuestas `200`.

---

## Escenario 7 — Config externa

1. Cambiar `httpPort` en `config.json` a `7778`.
2. Reiniciar `npm run dev`.
3. Verificar que el servidor escucha en `http://127.0.0.1:7778`.
4. Restaurar el puerto a `7777`.
