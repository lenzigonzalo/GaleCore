# Endpoint GammaExposure (GEX)

Referencia de uso, arquitectura interna y guía de mejoras del endpoint de Gamma Exposure.

> Última actualización: tras la sesión de fixes de OI/muros, latencia y AUTH timeout DXLink.
> Código relevante:
> - `DataFeed.Application/App/GammaExposure/GammaExposureHandler.cs`
> - `DataFeed.Application/App/GammaExposure/GammaExposureResponse.cs`
> - `DataFeed.Infrastructure/Providers/Tastytrade/TastytradeSocketProvider.cs` (`GetMultiGreeksAsync`)
> - `DataFeed.Infrastructure/Providers/Tastytrade/DxLinkHandshake.cs`

---

## 1. Qué hace

Calcula el **Gamma Exposure (GEX) por strike** del subyacente para la expiración regular más
cercana dentro de un horizonte de DTE, e infiere niveles clave de la estructura de gamma:

- **Gamma Zero Level (ZGL)** — precio donde el Net GEX cruza de negativo a positivo (gamma flip).
- **Call Wall** — strike por **encima** del spot con mayor `CallGEX`, **entre los que además tienen
  `NetGEX > 0`** (resistencia). `null` si ninguno califica.
- **Put Wall** — strike por **debajo** del spot con mayor `|PutGEX|`, entre los que además tienen
  `NetGEX < 0` (soporte). `null` si ninguno califica.

  El ranking es **por lado** y la guarda es **por neto**, y cada mitad responde a una falla distinta
  (medido en SPY el 2026-08-18: cadena completa, 17 vencimientos, cobertura 100%, spot 767.85):
  * **Por qué el ranking no es por neto.** Es lo que dibuja `GexBarsPanel` —barras por lado, no
    netas—, así que con el argmax del neto la línea del muro dejaba de caer sobre el pico visible.
    Y es más estable: el margen entre el #1 y el #2 del Call Wall global caía de 23.8% a 6.1%,
    porque el neto es una resta de dos números grandes y el ganador se da vuelta con menos movimiento.
  * **Por qué hace falta la guarda.** Sin ella, el Call Wall del 0DTE de ese día salía 770: OI de
    puts 6x el de calls y gamma neto −$30B. Un muro donde el dealer está net short gamma es lo
    contrario de lo que la palabra promete. La guarda además resuelve el vencimiento sin OI
    (ese día, 2026-09-01 con 30 strikes y OI 0), donde el argmax elegía un strike arbitrario entre
    puros ceros en vez de devolver `null`.

  En el agregado los dos criterios daban lo mismo (775 / 765); la diferencia aparece por vencimiento
  (7 de 17 en el Call Wall, 2 de 17 en el Put Wall). Congelado por `GammaExposureWallTests.cs`.

  > **Todo lo de arriba es cómo elegir bien el mejor argmax, y desde el 2026-08-28 sabemos que ese
  > no era el problema.** El problema es el objeto: un strike suelto no es una concentración. Los
  > dos muros se quedan como están —son el nivel con nombre y valor, y RPF los usa como gate—, pero
  > la pantalla les agrega el sombreado de `CallBand` / `PutBand` al lado, que es lo que dice cuánta
  > masa hay realmente alrededor de ese número.

- **Call Band / Put Band** — la **banda de gamma** del lado: la ventana de ancho `0.25 × EM` que
  maximiza la suma de `|GEX|` de ese lado, entre los strikes que están **fuera de la zona del
  dinero** (`|K − spot| ≥ 0.15 × EM`). Devuelve `{ low, high, edge, pctOfSide, xMed, width }`, con
  `edge` = el borde **externo**, el más lejos del spot. Solo se calcula **por vencimiento**
  (`byExpiry[]`): el ancho es una fracción del Expected Move, y el agregado no tiene un `t`.

  * **Es contexto visual, no un nivel.** La pantalla la dibuja **solo como zona sombreada**, sin
    fila propia y sin etiqueta: el muro contesta *qué número* y la banda *qué tan ancha es la
    concentración alrededor*. Los dos como texto sobre el mismo eje duplicarían la lectura.
  * **La zona del dinero sale del pool entero**, no solo de la comparación: los strikes pegados al
    spot siempre concentran gamma, y con ellos adentro la ventana más densa puede **ser** la pila
    del dinero (QQQ 18-Sep: argmax 710 con el spot en 708.02).
  * **`xMed`** — la banda contra la ventana **mediana** del mismo lado. Viaja en la respuesta como
    diagnóstico y **ninguna pantalla lo dibuja**: no lleva umbral —no hay falla observada contra la
    cual declararlo— y no es comparable entre símbolos ni épocas (su mediana sobre la historia de
    cadenas va de 205.8 en 2013 a 19.4 en 2025, según cuántos strikes lejanos liste la cadena).
  * **`null` es un resultado válido** — sin EM, o con el lado sin suficientes strikes con GEX (< 6).
    Ahí simplemente no se pinta el sombreado; el muro se muestra igual.
  * **No predice.** Medido sobre 926 observaciones de SPY/QQQ/IWM 2013–2025, el borde se comporta
    como un strike cualquiera de su mismo delta y su mismo lado (+0.010, IC [−0.019, +0.040]).
    Describe dónde está apilado el open interest; no dice que el precio frene ahí.

  Los dos parámetros los declara `gex.wall_band` en `galecore_rules_gex.json` y viajan por
  `GammaExposureRequest.WallBandWidthEm` / `WallBandMoneyZoneEm`. Congelado por
  `GammaExposureBandTests.cs`. Origen: [`research/got/`](../../research/got/) §61.4 y el
  [hallazgo del 2026-08-28](../../research/got/hallazgos/2026-08-28-la-banda-no-predice.md).

Es el insumo principal de la **Capa 1** de la estrategia (régimen macro / GEX y Spot vs ZGL).

---

## 2. Request

```
GET /App.Analytics/GammaExposure?Symbol={SYMBOL}&MinDelta={delta}&MaxDTE={dte}
```

Header requerido: `X-API-KEY`.

| Parámetro  | Default | Descripción                                                        |
|------------|---------|--------------------------------------------------------------------|
| `Symbol`   | —       | Subyacente (ej. `SPY`, `QQQ`)                                      |
| `MinDelta` | `0.10`  | Delta mínimo absoluto (filtro de salida; ver nota)                |
| `MaxDTE`   | `60`    | DTE máximo para elegir la expiración regular más cercana          |

> **Nota sobre `MinDelta`:** hoy el filtro de salida por `MinDelta` está comentado en el handler
> (se devuelven todos los strikes con IV). No confundir con la **banda de delta de suscripción
> de Candle** (0.02–0.98), que es una optimización interna distinta (ver §5).

---

## 3. Response (campos principales)

```json
{
  "symbol": "SPY",
  "spot": 730.13,
  "expiration": "2026-07-17",
  "dte": 37,
  "expirationType": "Regular",
  "gammaZeroLevel": 725.98,
  "callWall": 750.0,
  "putWall": 720.0,
  "riskFreeRate": 0.045,
  "strikesWithOI": 133,
  "strikesWithGEX": 133,
  "callGEX": 106346.6,
  "putGEX": -275984.4,
  "netGEX": -169.6,
  "strikes": [
    {
      "strike": 735.0,
      "callDelta": 0.51, "callGamma": 0.0095, "callIV": 0.178,
      "callOI": 51190, "callGEX": ..., "callPrevClose": 15.5,
      "putDelta": -0.49, "putGamma": 0.0103, "putIV": 0.165,
      "putOI": ..., "putGEX": ..., "putPrevClose": ...,
      "netGEX": ...
    }
  ]
}
```

| Campo               | Descripción                                                                 |
|---------------------|-----------------------------------------------------------------------------|
| `spot`              | Precio del subyacente (REST `MarketData/ByType`, `Mark` o `Last`)          |
| `gammaZeroLevel`    | Interpolado donde Net GEX cruza de − a +; el cruce más cercano al spot      |
| `callWall`/`putWall`| Muros filtrados por lado del spot (call arriba, put abajo)                  |
| `strikesWithOI`     | Strikes con OI > 0 (diagnóstico de calidad del fetch de Candle)             |
| `strikesWithGEX`    | Strikes con GEX no nulo                                                     |
| `*PrevClose`        | Cierre del candle diario anterior por leg                                   |

`GEX (millones) = gamma × OI × 100 × spot²` ; calls positivo, puts negativo.

---

## 4. Lógica interna (flujo del handler)

1. **PASO 1 — spot + option chain (REST).**
   - Spot vía `MarketData/ByType`. Option chain vía `OptionChains` (nested).
   - La **chain se cachea por día** (`_chainCache`); en cache-miss se piden spot + chain **en paralelo** (`Task.WhenAll`).
2. **PASO 2 — armar símbolos streamer.** De cada strike se toman `CallStreamerSymbol`/`PutStreamerSymbol`
   (formato DXLink, ej. `.SPY260717P735`) y se mapea `streamerSym → (strike, C/P)`.
3. **PASO 3 — Greeks + OI vía WebSocket** (`GetMultiGreeksAsync`):
   - Suscribe **Greeks** de todos los símbolos en un bloque (IV/delta/gamma real-time).
   - Filtra por **banda de |delta| 0.02–0.98** y pide **Candle** (OI + prevClose) solo de esos.
   - OI/prevClose se **cachean por día** (`_oiCache`); en warm se saltea casi toda la Fase 2.
4. **PASO 4 — GEX por strike** con los Greeks de DXLink y el OI del candle.
5. **PASO 5 — orden por strike.**
6. **PASO 6 — Gamma Zero, Call Wall, Put Wall.**

---

## 5. Particularidades de DXLink (claves para no romper esto)

### 5.1. Límite de suscripción de Candle (CRÍTICO)
DXLink rechaza con `ERROR / BAD_ACTION: "Your subscription size for event type 'Candle' is too big"`
si hay **demasiadas suscripciones Candle ACTIVAS en el canal** (el límite es sobre el total activo,
no por mensaje). Con ~500 legs de SPY esto rompía el OI → muros y gammaZero `null`.

**Solución implementada:** los Candle se procesan en **lotes (batch 80)** con ciclo
`add → esperar snapshot → remove`, manteniendo las activas siempre ≤ batch size. Los Greeks
(streaming liviano) no tienen este límite y van en un solo bloque.

> ⚠️ No volver a suscribir todos los Candle de una. Si se sube el universo de strikes, respetar el batching.

### 5.2. No tragar los ERROR
El handler de mensajes loguea los `ERROR` de DXLink (antes un `catch {}` vacío los ocultaba, lo que
escondió el bug del límite de Candle por mucho tiempo). Mantener ese log.

### 5.3. `socket.Start()` puede no conectar
Bajo churn de conexiones, `await socket.Start()` puede retornar con `IsRunning=false` (conexión no
establecida); como `ErrorReconnectTimeout` es ~60s, no reintenta a tiempo y SETUP/AUTH se mandan al
vacío → `AUTH timeout`. **`DxLinkHandshake.EnsureConnectedAsync`** reintenta `Start()` hasta conectar
antes del handshake. (Beneficia a todos los métodos del socket provider, no solo GEX.)

### 5.4. Cierre de snapshot
Cada símbolo Candle cierra su snapshot con flag `SNAPSHOT_END (0x08)` o `SNAPSHOT_SNIP (0x10)`. Se usa
para marcar como recibido a los símbolos sin OI útil y no esperar el timeout del lote.

---

## 6. Latencia (estado actual y evolución)

Medido sobre SPY (cadena completa, ~498 legs), warm = con caches calientes:

| Hito                                         | Latencia warm |
|----------------------------------------------|---------------|
| Roto (sin OI por límite de Candle)           | — (muros null)|
| Fix base (lotes add→wait→remove)             | ~30–40s       |
| #5 SNAPSHOT_END + timeout lote 4s            | ~5s           |
| #1 Filtro banda delta 0.02–0.98              | ~4.4s         |
| #2 Cache diario de OI                        | ~3.7s         |
| #3 Cache de option chain + REST en paralelo  | **~2.4s**     |

### Desglose de los ~2.4s warm
| Segmento                       | Tiempo  |
|--------------------------------|---------|
| spot REST                      | ~210ms  |
| option chain REST              | ~1280ms (cacheado → ~0 en warm) |
| handshake DXLink (connect+auth+channel) | ~830ms  |
| Greeks (Fase 1)                | ~850ms  |
| Candle (Fase 2)                | ~2.3s cold / ~0.5s warm |

---

## 7. #C — Reuso de la conexión persistente (IMPLEMENTADO)

**Causa que lo motivó:** DXLink limita las **sesiones concurrentes por token** (`ERROR "The number of
user sessions has exceeded the configured limit"`). El patrón viejo abría una **sesión nueva por request**
(GetCandleAsync, GetMultiGreeksAsync, Trade/Quote/Greeks…), lo que saturaba el límite — sobre todo en
ValidationLayer, que dispara GEX + Candle + IVRank en paralelo → `AUTH timeout` intermitente.

**Solución:** todos los fetch puntuales pasan por la **única conexión persistente** (`DxLinkStreamingService`)
vía `RequestSnapshotAsync` (request/response sobre el canal compartido):
- Un **collector** por request acumula los eventos que matchean su set `(símbolo, eventType)` y completa
  cuando cada símbolo cumple su condición (Candle → SNAPSHOT_END/OI; Greeks/Quote/Trade → primer evento).
- `ProcessFeedDataAsync` hace **fan-out** de cada evento a los collectors activos (además del broadcast al Monitor).
- **Greeks/Quote/Trade** se suscriben por el **reference-counting** (no pisan al Monitor al desuscribir);
  **Candle** va directo con `fromTime` (el Monitor no usa Candle).
- Normalización del sufijo de agregación (`SPY{=1d}` vs `SPY{=d}`) en el matching.

**Métodos migrados:** `GetCandleAsync`, `GetMultiGreeksAsync` (→ `GammaExposureHandler.FetchGreeksAndOIAsync`),
`GetTradeAsync`, `GetQuoteAsync`, `GetGreeksAsync`, `GetTradeQuoteGreeksAsync`. Ningún endpoint abre sesión propia.

**Resultado:** ValidationLayer 8/8 sin AUTH timeout; GEX warm ~0.6s; el límite de sesiones dejó de aplicar.

### Robustez de la reconexión (RESUELTO)
El *reconnect spiral* (`BAD_ACTION: "Channel with id 3 already exists"`) se arregló:
- **Un solo camino de reconexión:** `IsReconnectionEnabled = false` en el `WebsocketClient` (la
  reconexión la controla el servicio vía `DisconnectionHappened` → `ReconnectWithDelayAsync`), eliminando
  los dos caminos que competían y re-handshakeaban sobre un canal ya abierto.
- **Tear down limpio antes de reconectar** (`TearDownSocketAsync`): desuscribe handlers, hace `Stop`
  (NormalClosure) y `Dispose` del socket viejo → libera la sesión server-side (no acumula zombies) y el
  canal 3, así el `CHANNEL_REQUEST` del socket nuevo nunca colisiona.
- **Re-suscripción** de los feeds activos tras reconectar (`ResubscribeActive`).
- Validado: con desconexiones reales, el persistente reintenta con socket fresco hasta recuperar, **sin
  spiral** (0 `BAD_ACTION`); los requests en vuelo esperan la reconexión y siguen.

### Concurrencia de Candle (RESUELTO)
Los Candle se reference-countean por símbolo (`CandleSubscribe`/`CandleUnsubscribe`) con la `fromTime` más
vieja pedida. Antes, dos requests concurrentes del mismo símbolo (ej. IVRank y MarketDataCandle pidiendo
`SPY{=1d}`) se pisaban: el `remove` de uno mataba el snapshot del otro → timeout de 30s.

### Follow-ups pendientes
- **Métodos muertos:** `GetMultiQuoteAsync` y `GetMultiCandleAsync` sin uso (aún abren sesión propia); borrarlos.
- **Cachear símbolos sin OI** (los in-band con OI=0 se re-fetchean cada vez). Ganancia chica; baja prioridad.
- **Límite de sesiones DXLink** sigue siendo una restricción externa de la cuenta: si se satura (muchas
  conexiones en paralelo o zombies), el persistente puede tardar en re-autorizar. Ya se recupera solo.

---

## 8. Invariantes / no romper

- Mantener el **batching de Candle** (límite de DXLink). No suscribir todos de una.
- Mantener `EnsureConnectedAsync` (evita el AUTH timeout intermitente).
- Mantener el **log de ERROR de DXLink** (no volver al `catch {}` vacío).
- Los caches (`_chainCache`, `_oiCache`) son **por día UTC**; el OI es el del candle diario más reciente
  que lo trae y no cambia intradía, por eso es seguro cachearlo. Si se necesita refresco intradía de OI,
  invalidar por tiempo.
- **El OI se busca en los últimos `OiLookbackDays` (30) días de candles.** DXLink sólo publica el candle de
  un día si el contrato operó; con la ventana anterior de 2 días, un strike sin operaciones recientes
  entraba al GEX con OI 0 aunque tuviera contratos abiertos (2026-09-24, SPY 2026-11-20: call 515 con OI
  97 y call 550 con OI 25 entraban con 0). El OI del candle es el de ese día, así que si el contrato no
  volvió a operar puede diferir en lo que se operó ese último día. El **cierre previo** sigue tomándose
  sólo de candles de los últimos 2 días (lo usa RPF).
- **El símbolo que no se puede analizar es un 409, no un 500.** Los tres casos —no lista opciones,
  todas las expiraciones vencidas, ninguna dentro de `MaxDTE`— salen como
  `OptionChainNotFoundException` con `code: "option_chain_not_found"`, que
  `DataFeedControllerBase` mapea a 409 al lado de `broker_account_not_linked`. Dejó de ser un caso de
  laboratorio con el buscador de símbolos de GEX: el operador puede elegir cualquier cosa que
  Tastytrade conozca. El `catch (Exception)` del final la **deja pasar derecho** — envuelta en un
  `Exception` genérico pierde el tipo y vuelve a ser el 500 que se quería evitar.
- Call Wall siempre **arriba** del spot; Put Wall siempre **abajo** (definición estándar de muros GEX),
  y ambos exigen que el **neto del strike tenga el signo del lado** (ver §1). Un muro `null` es un
  resultado válido, no un dato faltante: significa que ningún strike de ese lado califica.

---

## 9. Bugs conocidos / observaciones abiertas

- **`AUTH timeout` residual / outlier de latencia:** muy reducido tras `EnsureConnectedAsync`, pero
  puede aparecer un outlier ocasional (se vio una corrida de ~71s, no reproducible). Si reaparece,
  revisar el handshake / agregar retry de extremo a extremo.
- **Signo/magnitud de `netGEX`:** en pruebas SPY dio negativo grande (≈ −169B). La Capa macro espera
  GEX positivo; revisar la convención de signo/escala del agregado por separado (no es bug de este fix).
