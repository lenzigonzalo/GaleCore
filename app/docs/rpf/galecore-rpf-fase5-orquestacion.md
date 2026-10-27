> ✅ **DISEÑO CANÓNICO DE ORQUESTACIÓN (Fase 5) — 2026-07-29.** Formaliza la frontera
> diseño→implementación de §13 de [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md):
> contrato `TradeSuggestion` + máquina de estados + loop backend. La **capa de señal ya está
> implementada y validada** (`SignalGates/*`); esta fase diseña la **orquestación** encima.
>
> **Estado:** solo diseño — **sin código**. Todo nace `enabled:false`. Se valida **por diseño y en
> paper**, no por backtest (la señal ya trae su evidencia BT-0…BT-17).
>
> **Fuentes (jerarquía):**
> 1. [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md) §8 (máquina de estados) y §13 (frontera).
> 2. [`galecore-rpf-reconciliacion.md`](galecore-rpf-reconciliacion.md) — libro mayor de parámetros.
> 3. Este documento — arquitectura de la orquestación. La fuente de verdad operativa sigue siendo el
>    JSON (`galecore_rules_rpf.json`); acá se define qué deben declarar los nodos `state_machine` y
>    `trade_suggestion` cuando se implementen (§9).

---

# GaleCore — RPF Fase 5: Orquestación (diseño canónico)

**Fecha:** 2026-07-29
**Base:** Decisión 5 del operador (RPF completo — máquina de estados + loop backend + push
`TradeSuggestion`). Config de señal: BT-17 variante C con gamma (delta 0.25 + GEX≥0), SPY-only, PCS-only.

---

## 0. Decisiones de esta fase (cerradas 2026-07-29)

Las 5 decisiones del research/config están cerradas (definición §0). Fase 5 agrega dos de arquitectura
de orquestación y fija tres recomendaciones que estaban `pending` en el JSON:

| # | Decisión | Resolución |
|---|---|---|
| 6 | Entregable de Fase 5 | **Solo diseño canónico** (este doc). Sin código; el esqueleto queda para Fase 6. |
| 7 | Cierre del ciclo `TRIGGERED → IN_POSITION` | **Ack explícito del operador** (Accept/Dismiss desde el tablero). |
| — | Persistencia del estado/sugerencias | **In-memory singleton** (recomputa de los gates al reiniciar; molde `FlowAggregatorService`). |
| — | TTL de la sugerencia | **2× cadencia Tier B**; cada tick la refresca o la expira (el edge es sensible al quote). |
| — | δ del cooldown | **`null`** — la ocupación de la posición (~17d) hace el 80% del trabajo (definición §6). |

**Principio rector (definición §1.6):** el sistema **sugiere, nunca ejecuta**. La orquestación
empuja `TradeSuggestion`; ninguna orden sale sin aprobación manual, y la banda `high_risk` exige
aprobación explícita siempre.

---

## 1. Mapa de reutilización — qué NO se construye

La señal completa ya corre. Fase 5 es una **capa de coordinación** encima de piezas existentes.

| Pieza existente | Rol en Fase 5 | Se toca |
|---|---|---|
| `SignalGates/SignalGatesEvaluator` (estático) | Motor de señal: VRP, edge, tail, put_wall, credit. | No |
| `SignalGates/PopCalibrationTable`, `SkewHistory` | Insumos del edge y del tail. | No |
| `ValidationLayer/ValidationLayerHandler` + `PositionBuilder/PositionBuilderHandler` | Cascada macro→gates→strike/micro/sizing. El loop la invoca vía MediatR. | No |
| ⚠️ **Desactualizado desde 2026-08-06:** esos dos handlers se eliminaron con la estrategia v1.4.0. RPF ya no depende de ellos — corre su propio `Rpf/Engine/RpfTickHandler` sobre los primitivos de `App/Shared/CascadeUtils`. | | |
| `Api/Infrastructure/FlowBroadcastService : BackgroundService` | **Molde** del loop (timer, singleton hosted, broadcast SignalR). | No (se clona el patrón) |
| `Infrastructure/…/IMarketDataBroadcaster` | Transporte. Se le **agregan** 2 métodos (§5.4). | Sí (extensión) |
| `Api/Hubs/MarketDataHub` | Se le **agregan** métodos de suscripción `rpf` y ack (§6). | Sí (extensión) |

**Piezas nuevas (Fase 6):** `RpfLoopService`, `RpfStateStore`, DTO `TradeSuggestion` + `RpfStateUpdate`.
Nada más.

---

## 2. Arquitectura de la orquestación

```
                          ┌───────────────────── RpfLoopService (BackgroundService, singleton) ─────────────────────┐
                          │  timer rápido                                                                            │
   Tastytrade / DXLink ──▶│  Tier A (lento, cacheado): macro_regime + VRP + tail + GEX≥0  →  ¿ARMED?                 │
   (handlers existentes)  │  Tier B (rápido): si ARMED → arma PCS (δ0.25/$5) → edge → cupo → cooldown → ¿TRIGGERED?  │
                          │        │                                                                                 │
                          │        ▼                                                                                 │
                          │  RpfStateStore (in-memory): estado por símbolo · cooldown timers · sugerencia vigente    │
                          └────────┬────────────────────────────────────────────────────────────────────────────────┘
                                   │  cambio de estado / nueva sugerencia
                                   ▼
                        IMarketDataBroadcaster → MarketDataHub  (grupo "rpf")
                                   │  RpfStateUpdate / TradeSuggestion                    ▲
                                   ▼                                                      │ AcceptSuggestion(id) / DismissSuggestion(id)
                        Frontend = TABLERO (ya no corre la cascada)  ──────────────────────┘
```

**Lectura:** el backend es el loop; el frontend es diagnóstico + ack. Esto invierte lo implementado
hoy (el frontend corre la cascada lineal) — es el cambio central de la Decisión 5.

---

## 3. El loop — `RpfLoopService`

`BackgroundService` singleton (registrado en `Program.cs` como hosted service, igual que
`FlowBroadcastService`). **SPY-only → un solo símbolo**, pero se escribe iterando una lista para no
recablearlo si vuelve un segundo subyacente.

### 3.1 Cadencias — dos tiers, un timer físico

| Tier | Qué evalúa | Escala natural | Cadencia | Fuente de datos |
|---|---|---|---|---|
| **A — arma/desarma** | macro_regime (VIX, TS, IV RoC, GEX≥0) + tail_gate + VRP | diaria/horaria | **lenta** (ref: 5 min) | `MacroRegimeHandler`, GEX handler, `SkewHistory`, IV/RV |
| **B — dispara** | strike engine PCS + edge + cupo + cooldown | quote (≤15s) | **rápida** (ref: 30 s) | quotes de la cadena + `PopCalibrationTable` |

Un único timer a la cadencia rápida (30 s). Tier A se recomputa cada N ticks (N = 10 → 5 min) y su
resultado se cachea en el store; Tier B corre en cada tick **solo si Tier A dejó el símbolo `ARMED`**.
Esto respeta el escalonado "arma → dispara" de la definición §3 sin dos timers.

> Las cadencias 5 min / 30 s son **referencia de diseño**, no valores calibrados — se declaran en el
> nodo JSON `orchestration` (§9) y se afinan en paper. La freshness dura (`data_quality.max_quote_age_seconds = 15`)
> ya es un gate; la cadencia solo acota cuánto se retrasa una decisión, no su validez.

### 3.2 Tick (pseudocódigo)

```
onTick(symbol):
  # Tier A — refresca cada N ticks; si no, usa cache
  if tierACounter % N == 0:
      tierA = runTierA(symbol)          # MediatR: MacroRegime + gates de entorno (VRP, tail, GEX)
      store.setTierA(symbol, tierA)
  tierA = store.tierA(symbol)

  if tierA.tailScore >= 2:  state = VETOED
  elif not tierA.allPass:   state = DORMANT
  else:
      # Tier B — solo si ARMED
      cand = buildPcsCandidate(symbol)   # MediatR: PositionBuilder (δ0.25, $5, DTE 45)
      edge = signalGates.edge(cand)      # SignalGatesEvaluator + PopCalibrationTable
      edgePass = edge >= bar(regime)

      if   not edgePass:              state = ARMED
      elif not capacity(symbol):      state = WAITING_CAPACITY
      elif store.inCooldown(symbol):  state = COOLDOWN
      else:                           state = TRIGGERED

  if hasOpenPosition(symbol): state = IN_POSITION   # gestión manda sobre entrada (§4)

  store.transition(symbol, state)        # emite RpfStateUpdate si cambió
  if state == TRIGGERED: emitSuggestion(symbol, cand, edge)   # §5
```

`capacity`, `hasOpenPosition` salen de las posiciones de cuenta (`/Data/Account/*`), no de estado
inventado — así el reinicio del proceso no las pierde.

---

## 4. Máquina de estados (por símbolo)

Los 7 estados de la definición §8, **computados** de los outputs de los gates + cupo + cooldown +
posiciones. Ningún estado se "setea" a mano salvo por el ack del operador (§6). Precedencia = el
primero que matchea gana (orden de la tabla).

| Estado | Condición | Emite |
|---|---|---|
| `VETOED` | `tail_score ≥ 2` (gate corrió) | `RpfStateUpdate` |
| `WAITING_CAPACITY` | trigger vivo (Tier A ∧ edge ≥ barra) ∧ **sin cupo** | `RpfStateUpdate` |
| `IN_POSITION` | sin cupo ∧ ¬trigger vivo ∧ hay posiciones abiertas | — (solo gestión) |
| `DORMANT` | sin veto ∧ sin setup operable (Tier A no pasa, o sin cupo por heat y sin posiciones) | `RpfStateUpdate` |
| `ARMED` | Tier A pasa ∧ cupo ∧ edge < barra | `RpfStateUpdate` |
| `COOLDOWN` | trigger vivo ∧ cupo ∧ cooldown activo | `RpfStateUpdate` |
| `TRIGGERED` | trigger vivo ∧ cupo ∧ sin cooldown | `RpfStateUpdate` + `TradeSuggestion` |

> **Resolución de una ambigüedad de la definición §8 (decisión operador 2026-07-29).** La tabla §8
> lista `IN_POSITION` = "posición abierta" con autoridad, pero su propia nota dice que
> `WAITING_CAPACITY` aparece "cuando ambos cupos [V2] están ocupados y aparece un trade que cruza la
> barra". Las dos cosas no coexisten: si *cualquier* posición abierta forzara `IN_POSITION`, el 2º
> cupo de V2 nunca armaría y `WAITING_CAPACITY` sería inalcanzable — matando lo que BT-15 validó
> (4.9→7.4 trades/año, mejor peor-año). Resolución: **`IN_POSITION` = libro lleno *sin* trigger vivo**
> (solo queda gestionar); con 1 de 2 cupos el sistema sigue armando/disparando la 2ª. Y **`VETOED`
> gana sobre `IN_POSITION`**: el peligro de cola domina la lectura (safety-first §1.1); la gestión de
> la posición abierta sigue por `trade_management`, el estado solo comunica el entorno.

### 4.1 Diagrama de transiciones

```
DORMANT ──Tier A ok & cupo──▶ ARMED ──edge≥barra──▶ TRIGGERED ──ack Accept/Dismiss / TTL──▶ COOLDOWN ──vencido──▶ ARMED
   ▲                            │                        │
   │ Tier A cae / sin cupo      │ edge < barra           │ el operador abre → el libro se llena
   └────────────────────────────┘                        ▼
                                                (cupo agotado)
ARMED/TRIGGERED ──edge≥barra & ¬cupo──▶ WAITING_CAPACITY        libro lleno & ¬trigger ──▶ IN_POSITION
cualquier estado ──tail≥2──▶ VETOED  (autoridad; vuelve al que corresponda al bajar el veto)
```

> `IN_POSITION` no es un destino del ack — surge de las **posiciones de cuenta**: cuando el operador
> abre el spread y el libro queda lleno sin un trigger vivo. El ack solo arranca el `COOLDOWN`.

### 4.2 Qué guarda el store (lo NO recomputable)

`RpfStateStore` (singleton, in-memory) guarda por símbolo: estado actual, `tierA` cacheado, timers de
cooldown, y la **sugerencia vigente + su estado de ack**. Todo lo demás (Tier A, edge, cupo, posición)
se recomputa cada tick. **Al reiniciar el proceso:** el estado se reconstruye en el primer tick; el
cooldown se pierde (aceptable — es refinamiento menor, definición §6); `IN_POSITION` reaparece de las
posiciones de cuenta.

---

## 5. Contrato `TradeSuggestion`

### 5.1 Payload

```jsonc
TradeSuggestion {
  "id":          "guid",              // idempotencia del ack
  "symbol":      "SPY",
  "structure":   "put_credit_spread",
  "legs": [                            // formato DXLink streamer (.SPY260717P695), como strikeEngine.legSymbols
    { "action": "sell", "streamerSymbol": "...", "strike": 695, "delta": -0.25 },
    { "action": "buy",  "streamerSymbol": "...", "strike": 690 }
  ],
  "credit":      1.05,                 // $ neto
  "width":       5,
  "creditRatio": 0.21,                 // display (piso ≥0.10)
  "edgeEmp":     1.14,                 // con POP empírica
  "bar":         1.05,                 // min_edge del régimen vigente
  "regime":      "normal",
  "deltaShort":  0.25,
  "dte":         45,
  "riskPerTradePct": 0.035,            // para pintar banda estándar/high_risk
  "highRisk":    false,                // true ⇒ aprobación explícita obligatoria
  "contracts":   1,                    // sizing = floor(presupuesto / max_loss)
  "state":       "TRIGGERED",          // espeja el estado que la emitió
  "createdAt":   "2026-07-29T14:00:00Z",
  "ttlSeconds":  60                    // 2× cadencia Tier B (§5.3)
}
```

### 5.2 Semántica del campo `state`

El `state` de la sugerencia es una **foto** del estado de la máquina al emitirla (`TRIGGERED`). No
muta dentro del payload; los cambios posteriores viajan como `RpfStateUpdate` separados y como el
`ackStatus` de la propia sugerencia (§6). Una sugerencia `TRIGGERED` que el operador no atiende **no
se ejecuta sola** — expira por TTL y el símbolo cae a `COOLDOWN` o vuelve a `ARMED`.

### 5.3 TTL y ciclo de vida

- `ttlSeconds = 2 × cadenciaTierB` (ref 60 s). El edge se recomputa cada tick; una sugerencia más
  vieja que eso puede estar stale.
- Cada tick Tier B con el símbolo aún `TRIGGERED` **refresca** la sugerencia vigente (mismo `id`,
  `createdAt`/números actualizados) en lugar de emitir una nueva → evita spam.
- Al vencer el TTL sin ack: la sugerencia se descarta y el símbolo transiciona según los gates
  (normalmente `COOLDOWN` si acaba de disparar, o `ARMED`).

### 5.4 Entrega

- **Transporte:** SignalR, grupo nuevo `rpf` (aparte de los grupos de precio/flow).
- **Broadcaster:** dos métodos nuevos en `IMarketDataBroadcaster`:
  - `BroadcastRpfStateAsync(symbol, RpfStateUpdate)` → evento hub `ReceiveRpfState`.
  - `BroadcastTradeSuggestionAsync(symbol, TradeSuggestion)` → evento hub `ReceiveTradeSuggestion`.
- **`RpfStateUpdate`** (liviano): `{ symbol, state, tierA: {gate→pass}, edge, bar, regime, capacity, cooldownRemainingSec, suggestionId? }` — alimenta el cockpit del tablero.
  - **Heartbeat (impl 6a-activación):** se emite en **cada tick**, no solo en cambio de estado. Sin
    esto, un `DORMANT` que coincide con el default del store nunca se emitiría y el tablero quedaría
    en "loop offline" con el loop corriendo. Si la cascada tira excepción, se emite igual un estado
    (`DORMANT` con `tierA.cascade_ok=false`) para no confundir un error con "loop apagado".

---

## 6. Ciclo de ack del operador (Decisión 7)

El tablero cierra el ciclo `TRIGGERED → IN_POSITION` con **ack explícito**. Dos métodos nuevos en
`MarketDataHub`:

```
SubscribeRpf(symbol)            → une la conexión al grupo "rpf"; empuja el estado actual al conectar
AcceptSuggestion(suggestionId)  → operador aprobó la sugerencia
DismissSuggestion(suggestionId) → operador la descartó
```

| Acción | Efecto en el store | Estado resultante |
|---|---|---|
| `AcceptSuggestion(id)` | marca ack=accepted; arranca cooldown; queda esperando que la posición aparezca en la cuenta | `COOLDOWN`, luego `IN_POSITION` cuando `/Data/Account` refleja el spread |
| `DismissSuggestion(id)` | marca ack=dismissed; arranca cooldown | `COOLDOWN` |
| TTL vence sin ack | descarta la sugerencia; arranca cooldown | `COOLDOWN` → `ARMED` al vencer δ |

**Notas de robustez:**
- **Idempotencia por `id`:** un ack sobre una sugerencia ya vencida/reemplazada se ignora (log, no
  error). Por eso el `id` viaja en el payload.
- **Accept NO ejecuta la orden.** Confirma la intención y silencia el re-disparo; la apertura del
  spread sigue siendo manual (NewPositionForm / broker). `IN_POSITION` lo confirma la cuenta, no el ack
  — así un Accept sin apertura real no miente el estado indefinidamente (cae a `ARMED`/`COOLDOWN` según
  gates cuando expira el "esperando posición").
- **`high_risk`:** el Accept del tablero debe exigir confirmación reforzada en la UI; el backend igual
  solo sugiere.

---

## 7. Frontend = tablero (re-encuadre)

El monitor deja de correr la cascada (`fetchPositionBuilder`/`ValidationLayer` como motor) y pasa a
**consumir el estado del loop**:

- Nuevo store `useRpfStore` (Zustand) alimentado por `ReceiveRpfState` / `ReceiveTradeSuggestion`.
- El cockpit de estrategia (los 5 stages + candidato en vivo, ya construido en la sesión de front)
  se re-cablea a `RpfStateUpdate` en vez de a fetch propio.
- La `SuggestedCard` muestra la `TradeSuggestion` con botones **Accept / Dismiss** (invocan los
  métodos del hub) y un contador de TTL; banda `high_risk` con confirmación reforzada.
- El semáforo de estado por símbolo pinta los 7 estados de §4.
- Fallback: si el loop no emite (backend caído), el tablero muestra "loop offline", **no** revive la
  cascada local (evita dos fuentes de verdad).

> Esto NO es parte de Fase 5 (doc-only); es el hand-off al frontend en Fase 6. Se lista para que el
> re-encuadre del tablero quede especificado junto al contrato que consume.

---

## 8. Cooldown

- `δ = null` (definición §6, JSON `cooldown.delta`). La ocupación de la posición (~17 días) hace
  ~80% del trabajo (BT-7/BT-15).
- El cooldown que sí se implementa en Fase 6 es **anti-doble-emisión**: una ventana corta tras un
  ack/TTL para que la prima oscilando alrededor de la barra no re-dispare en el mismo tick-set. Es un
  timer del store, no una barra de edge. Su duración se declara en `orchestration.cooldown_seconds` (§9).

---

## 9. Deltas JSON-first (para Fase 6)

Cuando se implemente, se declara **primero en el JSON** (principio §1.5). Los nodos ya existen en
`galecore_rules_rpf.json` como reserva `enabled:false`; Fase 6 los completa así (siguen `enabled:false`
hasta validación en paper):

```jsonc
"state_machine": {
  "enabled": false,
  "scope": "por simbolo",
  "precedence": ["IN_POSITION", "VETOED", "DORMANT", "ARMED", "WAITING_CAPACITY", "COOLDOWN", "TRIGGERED"],
  "states": { /* … las 7 condiciones de §4, ya presentes … */ },
  "computed_from": "outputs de macro_regime + signal_gates + cupo (posiciones de cuenta) + cooldown"
},
"trade_suggestion": {
  "enabled": false,
  "transport": "SignalR grupo 'rpf' (backend empuja; frontend = tablero)",
  "payload": [ /* … campos de §5.1 … */ ],
  "ttl": { "mode": "multiple_of_tier_b", "factor": 2 },
  "persistence": "in_memory_singleton",
  "ack": { "mode": "explicit_operator", "methods": ["AcceptSuggestion", "DismissSuggestion"],
           "accept_note": "confirma intencion + cooldown; NO ejecuta; IN_POSITION lo confirma la cuenta" }
},
"orchestration": {                          // NODO NUEVO
  "enabled": false,
  "loop": "RpfLoopService (BackgroundService singleton)",
  "tier_a_refresh_seconds": 300,
  "tier_b_tick_seconds": 30,
  "cooldown_seconds": 120,
  "note": "cadencias de referencia; se afinan en paper. La freshness dura la gatea data_quality (15s)."
}
```

**Test de consistencia:** extender `DataFeed.Tests/RpfRulesJsonTests.cs` para congelar los
invariantes nuevos (state_machine con 7 estados + precedencia; trade_suggestion con ack explícito;
orchestration presente y `enabled:false`). Espeja el patrón de Fase 4.

---

## 10. Fuera de alcance / abierto

| Tema | Estado |
|---|---|
| Multi-símbolo / `WAITING_CAPACITY` load-bearing | dormido — SPY-only; el loop itera lista para no recablear |
| `priorityScore` (desempate multi-símbolo) | dormido (definición §4) |
| δ de histéresis del edge (refinamiento fino) | `null`; la ocupación hace el trabajo |
| Persistencia durable (archivo/DB) del estado/cooldown | descartada para paper; revisitar si live la exige |
| Ejecución automática de órdenes | **prohibida** — el sistema sugiere, nunca ejecuta |

---

## 11. Hand-off a implementación (Fase 6)

Checklist de archivos nuevos/tocados cuando se pase a código:

1. **JSON** — completar `state_machine` / `trade_suggestion`, agregar `orchestration` (§9), todo `enabled:false`.
2. **DTOs** — `TradeSuggestion`, `RpfStateUpdate` (nuevos, en Application).
3. **`RpfStateStore`** — singleton in-memory (estado + cooldown + sugerencia + ack).
4. **`RpfLoopService : BackgroundService`** — el loop (§3), clonando `FlowBroadcastService`; registrar en `Program.cs` (arranca **inerte** mientras `state_machine.enabled:false`).
5. **`IMarketDataBroadcaster`** — +`BroadcastRpfStateAsync`, +`BroadcastTradeSuggestionAsync`; impl SignalR en Api.
6. **`MarketDataHub`** — +`SubscribeRpf`, +`AcceptSuggestion`, +`DismissSuggestion`.
7. **Frontend** — `useRpfStore`, re-cableo del cockpit, botones ack en `SuggestedCard` (§7).
8. **Tests** — extender `RpfRulesJsonTests.cs` (§9); test de la función pura de la máquina de estados.

**Regla de validación:** todo entra `enabled:false`; se activa solo tras correr en paper y confirmar
que la orquestación no desvía la señal ya validada.
