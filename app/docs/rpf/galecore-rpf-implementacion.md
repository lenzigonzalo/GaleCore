# RPF — Implementación

> **Qué es este documento.** Cómo está implementada RPF **hoy** en el código: switch Workers, ranking de
> oportunidades, símbolos de los legs. Complementa a
> [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md), que es la definición **conceptual** (qué
> hace y por qué), y a [`galecore-rpf-fase5-orquestacion.md`](galecore-rpf-fase5-orquestacion.md), que es
> el **diseño** de la orquestación. Este describe el estado del código.
>
> Escrito el 2026-08-07 consolidando lo que hasta entonces vivía en `CLAUDE.md`. La fuente de verdad de
> los parámetros sigue siendo
> [`galecore_rules_rpf.json`](../../source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json).

---

## 1. Switch "Workers"

Kill switch de `RpfLoopService`. Vive en la cabecera del tab RPF (`WorkersSwitch` en `pages/Rpf.tsx`) y
también en la card de RPF en Main. La **convención** de plataforma (contrato uniforme, dónde vive el
estado, por qué persiste a disco) está en `CLAUDE.md`; acá va lo propio de RPF.

### Contrato

- `GET /App/Rpf/Workers` → `{ enabled, source }`. `source` es `"override"` si el operador ya usó el
  switch, `"rules"` si todavía manda `state_machine.enabled` del JSON.
- `POST /App/Rpf/Workers` con `{ enabled }` → prende/apaga.

Estado en `Files/Rpf/rpf_workers_state.json` (gitignoreado). Dueño: `RpfWorkerSwitch` (singleton, en
`DataFeed.Api/Infrastructure/`).

`RpfLoopService.LoadConfig()` lo **relee en cada tick**, así que apagar corta el loop dentro de un tick,
sin reiniciar la API.

### En OFF: el sistema no hace nada y el tablero vuelve al estado inicial

No alcanza con frenar el loop. Los cuatro efectos:

1. **El loop no corre la cascada ni emite** — rama inerte de `ExecuteAsync`.
2. **Se limpia `RpfStateStore`** — desde el POST y **también** al entrar en inerte, así queda cubierto el
   apagado por fuera del switch. Sin esto, un tablero que se conectara después recibiría por
   `SubscribeRpf` un estado congelado como si fuera vigente.
3. **Se emite `ReceiveRpfWorkers(enabled)`** al grupo `rpf`; el front hace `setWorkers(false)`, que vacía
   `states` y `suggestions`.
4. **El semáforo `LOOP ONLINE` sale de dos fuentes:** `workersEnabled !== false` **y** frescura del
   último timestamp (`STALE_MS` = 75s ≈ 2 ticks + margen). La frescura hace que un loop **crasheado**
   también se vea offline, no solo uno apagado a propósito. Antes `loopOnline` era un latch que nunca
   volvía a false.

El switch **no** toca DXLink, el hub, ni los otros workers (`FlowBroadcastService`,
`SkewSnapshotService`).

## 2. Ranking de oportunidades (`position_builder.ranking`)

Cuando hay múltiples tickers operables, el orden de prioridad viaja **JSON → API → frontend**.

Criterio: **regla 1/3 de Tastytrade** como métrica de calidad del spread. El nodo
`position_builder.ranking` del JSON declara:

```
priorityScore = (pop/100) * 0.6 + (credit/width) * 0.4
```

Quien lo computa es `RpfTickHandler.cs`, **después** de tener el crédito snapshot de microstructure —
antes de eso no hay `credit` real con el que calcular. Llena dos campos:

- `strikeEngine.creditRatio` = credit/width × 100, target **≥ 33.3%**
- `strikeEngine.priorityScore`

El frontend muestra `creditRatio` con semáforo: **verde ≥ 33.3%**, **amarillo 25–33%**, **rojo < 25%**.

## 3. `strikeEngine.legSymbols` — formato DXLink, no OCC

`legSymbols` contiene símbolos en formato **DXLink streamer** (ej: `.SPY260717P695`), **no** OCC —
DXLink no interpreta OCC. Salen de `GammaExposureStrike.CallStreamerSymbol / PutStreamerSymbol`,
poblados en `GammaExposureHandler.cs` desde el `strikeMap` de la cadena de opciones de Tastytrade.

Es un traspié fácil: el OCC (21 chars, `SPY   260516P00520000`) es el formato de la REST de Tastytrade,
y suscribir un leg al feed con ese string no falla ruidosamente — simplemente no llega dato.

## 4. Transporte — SignalR, no HTTP

La convención de rutas `/App/<Prefijo>/*` aplica **solo a HTTP**. La orquestación de RPF viaja por
SignalR sobre el hub compartido `/hubs/marketdata`:

| Método de hub | Dirección | Qué hace |
|---|---|---|
| `SubscribeRpf` | cliente → server | Une al grupo `rpf` y manda el estado actual |
| `AcceptSuggestion` / `DismissSuggestion` | cliente → server | Ack explícito del operador |
| `ReceiveRpfState` | server → cliente | Estado por símbolo |
| `ReceiveTradeSuggestion` | server → cliente | Sugerencia de trade |
| `ReceiveRpfWorkers` | server → cliente | Cambio del switch |

Son métodos de hub, no rutas: la convención de path no les aplica.

## 5. Mapa de código

| Archivo | Rol |
|---|---|
| `DataFeed.Api/Infrastructure/RpfLoopService.cs` | El loop (`BackgroundService`); relee config por tick |
| `DataFeed.Api/Infrastructure/RpfWorkerSwitch.cs` | Estado del kill switch |
| `DataFeed.Application/App/Rpf/RpfStateMachine.cs` | Máquina de 7 estados + precedencia |
| `DataFeed.Application/App/Rpf/RpfStateStore.cs` | Estado publicado por símbolo (in-memory) |
| `DataFeed.Application/App/Rpf/Engine/RpfTickHandler.cs` | Cascada por tick, crédito, ranking |
| `DataFeed.Application/App/Rpf/Engine/RpfCascadeResolver.cs` | Resolución de la cascada |
| `DataFeed.Tests/RpfRulesJsonTests.cs` · `RpfStateMachineTests.cs` · `RpfCascadeResolverTests.cs` | Suite |
| `galecore-monitor/src/pages/Rpf.tsx` · `store/useRpfStore.ts` | Tablero |
