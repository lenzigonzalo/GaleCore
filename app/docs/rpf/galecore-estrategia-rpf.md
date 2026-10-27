> ✅ **DEFINICIÓN CANÓNICA v2 — alineada al research (2026-07-29).** Este documento reemplaza
> al diseño original del **2026-07-06** (archivado verbatim en
> [`archive/galecore-estrategia-rpf.diseno-2026-07-06.md`](archive/galecore-estrategia-rpf.diseno-2026-07-06.md)),
> que fue escrito **antes** de correr un solo backtest y quedó desalineado con el ciclo BT-0…BT-17.
>
> **Fuentes de esta versión (jerarquía):**
> 1. [`galecore-rpf-reconciliacion.md`](galecore-rpf-reconciliacion.md) — **libro mayor**: valor
>    final de cada parámetro · BT que lo justifica · estado. Es el contrato; ante cualquier duda
>    de un número, manda el libro mayor.
> 2. [`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md) — evidencia
>    empírica (BT-0…BT-17).
> 3. Este documento — definición conceptual y operativa. La **fuente de verdad operativa** será el
>    JSON de reglas (`galecore_rules_rpf.json`, a construir en Fase 3); acá se define qué debe
>    declarar y por qué.
>
> **Estado:** definición alineada; las 5 decisiones del operador están cerradas (§0). Sin código:
> el JSON y el backend siguen intactos. Todo nodo nace `enabled:false` hasta merge + validación en paper.

---

# GaleCore — RPF "Disparo por prima real" — Definición canónica (v2)

**Fecha de alineación:** 2026-07-29
**Config de referencia:** BT-17 variante C **con la capa gamma mantenida** (delta 0.25 + GEX≥0).
**Base de reglas de régimen:** flags rápidos (VIX family), NO el regime engine de 8 regímenes.
**Estado de validación:** cerrado en research; habilita **paper** (ventana OOS agotada — §12).

---

## 0. Decisiones del operador (cerradas 2026-07-29)

Las cinco que bloqueaban el freeze quedaron resueltas. Detalle y evidencia: libro mayor §11.

| # | Decisión | Resolución |
|---|---|---|
| 1 | Gate GEX≥0 (P1) | **Mantener** — safety-first (seguro anti-crash de gamma negativa). |
| 2 | Regime engine | **Flags rápidos** (lo validado por BT-0), no el de 8 regímenes. |
| 3 | Capital / heat | **Base ref $16k** (respeta maxDD 5% + heat 7% sin relajar nada); **fondeo live ~$32k**. |
| 4 | hard_defense con entrada 0.25 | **delta short > 0.42**. |
| 5 | Arquitectura | **RPF completo** — máquina de estados + loop backend + push `TradeSuggestion`. |

---

## 1. Principios de diseño (invariantes de todo el sistema)

Sobreviven íntegros al research — son la razón por la que sus veredictos son creíbles.

1. **Safety-first.** Jerarquía de autoridad: veto de cola > GEX/régimen > edge. El objetivo no
   es operar más, es que cada trade sea lo más seguro posible.
2. **Gates vs. triggers.** Toda condición es O seguridad (gate binario, no-compensable) O
   oportunidad (trigger continuo). Nunca ambas. Ningún proxy de oportunidad dentro de un gate de
   seguridad (el error del modelo viejo: la banda de IVR en el AND).
3. **Sin compensación cruzada.** Un gate no rescata a otro. VRP alto no compra edge bajo; ni al
   revés. *(Corolario aplicado en Decisión 3: no se relaja el heat cap para que V2 entre a $10k —
   eso sería inventar un parámetro adentro de un gate de seguridad. Se sube el capital.)*
4. **Podar, no sumar.** No se agregan capas sin que la escalera de atribución (BT-5) demuestre que
   pagan. *Aplicado en el research:* IC/CCS podados (BT-11), capa gamma podada en QQQ (BT-6),
   salida 21 DTE podada (BT-4), HAR-RV podado (BT-16), libro combinado podado (BT-14).
5. **JSON-first.** Todo cambio se declara primero en el JSON de reglas, después en backend/frontend.
   Nodos nuevos nacen `enabled:false` hasta su validación.
6. **El sistema sugiere, nunca ejecuta.** Ninguna orden se envía sin aprobación manual. Los trades
   de banda alto-riesgo, sin excepción.

---

## 2. Modelo conceptual

Venta sistemática de prima con riesgo definido (**Put Credit Spread únicamente**) sobre **SPY
únicamente**, capturando theta y el Variance Risk Premium en entornos donde la estructura de gamma
del mercado amortigua el movimiento.

> **Qué cambió vs. el diseño original:** el diseño de 2026-07-06 admitía IC/PCS/CCS sobre SPY+QQQ
> con un regime engine de 8 regímenes y POP teórico `1−|delta|`. El research **podó** todo eso:
> **BT-11** mató IC/CCS (in-edgeable a probabilidad honesta), la decisión del operador dejó
> **SPY-only** (QQQ replicó pero salió del trading), y **BT-1** demostró que el delta miente
> sistemáticamente → la POP pasó a ser una **tabla empírica calibrada**, no una fórmula teórica.

**La arquitectura de dos ejes ortogonales se conserva** — es lo que separa RPF del modelo viejo:

- **Entorno habilitado** (seguridad, binario, lento): ¿se puede operar sin peligro estructural?
- **Trigger de oportunidad** (continuo, rápido): ¿la prima que se paga AHORA tiene expectativa
  positiva real?

**Arquitectura invertida (Decisión 5 = RPF completo):** el backend corre el loop (Tier A lento
arma/desarma; Tier B rápido vigila el edge y dispara) y empuja `TradeSuggestion` vía SignalR. El
frontend deja de ser el loop y pasa a ser el **tablero de diagnóstico** del loop. Esto **no está
implementado hoy** (el código corre una cascada lineal) — es desarrollo nuevo de la Fase 5 (§13).

---

## 3. El trigger — dos condiciones ortogonales en AND

```
TRIGGER  ⟺  alpha_gate  AND  edge_gate      (escalonado: arma → dispara)
```

### 3.1 alpha_gate — ¿de dónde sale la plata? (nivel entorno, Tier A)

```
VRP = atm_iv / rv30  ≥  1.2        (plano, NO tabla por régimen)
```

La prima económicamente cara: implícita por encima de realizada. **Validado (BT-2/3):** P&L medio
con VRP≥1.2 = $25.5 vs $9.5 en lo rechazado (2.7×); banda 1.2–1.4 con p5 positivo.

- **`vrp_min = 1.2` plano**, no la tabla por régimen del diseño original. El barrido empírico no
  justificó dinamizar esta barra; el dinamismo entra por `min_edge` (§6).
- **Denominador = RV30 trailing.** El upgrade a pronóstico HAR-RV se probó y **falló (BT-16)**: en
  el bear 2022 el HAR decae más rápido, reabre días del oso y viola C1/C3. La paranoia del trailing
  en transiciones era la feature, no el bug.
- Punto ciego conocido (RV trailing miente en calma→tormenta): lo cubre la detección temprana del
  régimen (BT-0: lead +3 días) + tail_gate + gamma_gate. Por eso el VRP nunca es load-bearing solo.

### 3.2 edge_gate — ¿el spread captura bien esa prima? (nivel spread, Tier B)

```
edge_emp = (crédito / ancho) / p_pérdida_empírica(delta)
disparo:  edge_emp ≥ min_edge(régimen)
```

- **La POP NO es `1−|delta|`.** BT-1 midió que el delta **sobrestima** el riesgo put ~2× (drift
  alcista + put skew) y **subestima** el riesgo call ~1.5×. El edge usa una **tabla empírica de
  probabilidad de pérdida por bucket de delta**, lado put, **trailing, anti-lookahead, SIN
  shrinkage** (ver `pop_calibration` en el JSON).
- Con POP empírica el edge recupera su semántica (BT-3 run-2: mediana 1.11 vs 0.59 con delta).
- **Caveat estructural (libro mayor §10.2):** la calibración put es **hija del drift** (13 años
  mayormente alcistas). Si el drift cambia, el factor cambia (el test IWM lo demostró). Se
  monitorea el factor por ventana; el colchón de `min_edge` debe cubrir el gap medido (~0.2).

---

## 4. Métricas y roles

| Métrica | Rol final | Cambio vs. diseño |
|---|---|---|
| `credit_ratio` (regla 1/3) | **retirada como piso**; queda `≥10%` anti-pennies + `credit_min $0.30` | El 33.3% presuponía strangles/IC; a delta 0.25 un PCS paga ~10-15% del ancho (BT-3 run-2) |
| `edge_emp` | **gate + selector** dentro del símbolo | ahora con POP empírica, no `1−POP` |
| `priorityScore` | **dormido** (SPY-only, un solo símbolo) | era desempate multi-símbolo; sin QQQ no actúa |

**Selección de strikes dentro del símbolo:**

```
candidatos → short al delta objetivo 0.25
           → restricción de sanidad: short_strike ≤ put_wall
           → piso anti-pennies (credit_ratio ≥ 10% y crédito ≥ $0.30)
           → elegir el de MAYOR edge_emp entre los que pasan
           → disparar solo si edge_emp ≥ min_edge(régimen)
```

---

## 5. Flujo de entrada completo

```
TIER A — LENTO (entorno / armado)
 1. data quality        quotes frescos (≤15s), sin crossed market, spread ≤ 5%
 2. régimen operable    flags rápidos: NO (VIX≥30 ∨ VIX9D>VIX3M ∨ RoC5d VIX>12%)
 3. tail_gate           VVIX (110/130) + skew25 RoC5d (5%/8%), score < 2
 4. gamma_gate          GEX ≥ 0   (SPY; dealers long gamma = amortiguan)
 5. alpha_gate          VRP ≥ 1.2
        └── todo pasa → ARMED   (falla → DORMANT / VETOED)

TIER B — RÁPIDO (oportunidad / disparo, solo si ARMED)
 6. strike engine       PCS: short delta 0.25, long = short − $5
 7. sanidad + piso      short ≤ put_wall · credit_ratio ≥ 10% · crédito ≥ $0.30 · OI ≥ 100
 8. edge selector       máx edge_emp entre los que pasan
 9. edge gate           edge_emp ≥ min_edge(régimen)

SELECCIÓN / ASIGNACIÓN
10. cupo                cartera V2: ≤ 2 posiciones, la 2ª con vencimiento distinto · heat ≤ 7%
11. sizing              contratos = floor(presupuesto / pérdida_máx_por_contrato)
        └── FIRE → TradeSuggestion (estado TRIGGERED)
```

**Lectura:** el entorno decide *si se puede*, el alfa decide *si vale la pena*, el edge decide
*cuál y cuándo*, la asignación decide *cuánto y sin duplicar*.

> **Nota sobre la capa de muros:** el put_wall entra como **restricción de sanidad**
> (`short ≤ put_wall`), NO como ancla de strikes. El anclaje a muros del diseño viejo producía
> créditos de centavos (BT 3-bis; caso 6-jul edge 0.53). El muro muerde <1% de las entradas, pero
> donde muerde filtra configuraciones tóxicas (−$152 avg). No es barrera anti-crash: los crashes
> lo atraviesan (3-bis).

---

## 6. Barras — vrp_min y min_edge

- **`vrp_min = 1.2` plano** (§3.1).
- **`min_edge` por régimen — CALIBRADO (BT-3 run-2), reemplaza los placeholders del diseño:**

| Régimen (flag rápido) | `min_edge` |
|---|---|
| normal | **1.05** |
| low_vol | **1.10** |
| elevated | **1.10** |
| caution | **1.20** |

**Invariantes que la calibración respeta:** monotonía (barra no-decreciente con el peligro),
piso duro `min_edge ≥ 1 + fricción/crédito`, sin compensación cruzada. El piso de fricción real es
**~1.02–1.06** para trades que pagan crédito decente (fricción $6.30/contrato, liquidez SPY) → la
tabla sobrevive con margen.

**Cooldown:** histéresis sobre el edge. En la práctica la **ocupación de la posición** (17 días
promedio) hace ~80% del trabajo del cooldown (BT-7/BT-15); el δ de histéresis queda como
refinamiento menor, no bloqueante.

---

## 7. Allocation policy

### 7.1 Universo
**SPY únicamente.** QQQ replicó el diseño (BT-6) pero el operador lo sacó del trading (2026-07-14);
IWM refutado (BT-6). El **veto de correlación SPY/QQQ del diseño original está muerto** (no hay
segundo símbolo).

### 7.2 Cuánto — riesgo por trade (en % del Net Liq)

| Banda | Riesgo/trade | Comportamiento |
|---|---|---|
| **Estándar** | ≤ 5% (target 3.5%) | sugerencia normal |
| **Alto riesgo** | 5–8% | flag `high_risk`: solo régimen benigno, **aprobación manual explícita siempre** |
| **Nunca** | > 8% | no se sugiere bajo ninguna circunstancia |

### 7.3 Cartera V2 y capital (Decisión 3)

- **Cartera V2 (BT-15):** máximo **2 posiciones simultáneas**, la 2ª solo con **vencimiento
  distinto** a la abierta. V2 sube trades/año (4.9→7.4 a delta 0.30) y, sorprendentemente, MEJORA
  el peor año (la 2ª posición entra en clusters buenos y diluye).
- **Jamás apilar el mismo lado / mismo vencimiento** (doble fricción, correlación 1.0, evasión de
  la contabilidad de riesgo).
- **Heat total del libro ≤ 7%** — intacto, no se relaja.
- **Capital:** V2 corre ~$820 de riesgo simultáneo y midió maxDD **−8.3%** a 1 contrato. Para
  respetar heat 7% y el tope de maxDD 5% **sin tocar los límites**, base de referencia **$16k**.
  El objetivo de negocio del operador ($200/mes) exige **~$32k** de fondeo live (la escala la cierra
  el capital, no un parámetro de señal). En paper el capital es nocional; la base se fija en $16k
  para que los límites de riesgo del JSON se cumplan como están escritos.

---

## 8. Máquina de estados (por símbolo)

Arquitectura elegida (Decisión 5). **Cada estado se computa de los outputs de los gates + cupo +
cooldown.** No implementada hoy → Fase 5.

| Estado | Condición | Significado |
|---|---|---|
| `VETOED` | veto de cola activo (tail_gate score ≥ 2) | peligro activo — nada se evalúa |
| `DORMANT` | sin veto ∧ ¬(entorno completo habilitado) | sin peligro pero sin setup |
| `ARMED` | Tier A completo pasa (régimen ∧ tail ∧ GEX≥0 ∧ VRP≥1.2) | el edge se vigila como trigger |
| `WAITING_CAPACITY` | ARMED ∧ edge ≥ barra ∧ ¬cupo | trade bueno sin cupo (las 2 posiciones V2 ocupadas) |
| `TRIGGERED` | ARMED ∧ edge ≥ barra ∧ cupo ∧ ¬cooldown | se emite `TradeSuggestion` |
| `COOLDOWN` | recién disparó | suprime re-disparo con la prima oscilando |
| `IN_POSITION` | posición abierta | trigger de entrada apagado; solo gestión |

> `WAITING_CAPACITY` existe **porque V2 permite 2 cupos**: cuando ambos están ocupados y aparece un
> trade que cruza la barra, el sistema lo señaliza sin poder abrirlo. Con V1 (1 posición) este
> estado casi no se activaría.

---

## 9. Salidas y gestión de posiciones

Política **B**, validada por BT-4 (domina en velocidad de capital):

- **Profit target: cierre al 50% del crédito.** (win 99%, p5 positivo, libera capital en ~17 días
  vs ~43 → rota ~2.6× más rápido.)
- **SIN salida forzada por DTE.** BT-4 **refutó** el roll/salida a 21 DTE: destruye el win rate
  (97→75%) y vuelve negativa la cola porque cristaliza drawdowns que casi siempre se recuperan.
- **`hard_defense` (Decisión 4): delta short > 0.42 ∨ pérdida ≥ 2× crédito → defensa/cierre.** El
  umbral subió de 0.30 (diseño) a 0.42 porque con entrada a delta 0.25 un umbral de 0.30 dispararía
  casi en la entrada; BT-12 midió deterioro gradual sin acantilado hasta 0.35 → la defensa vive
  ~0.40–0.45.
- **`daily_kill_switch`:** MTM diario −1% → freno del libro.
- **Rolls:** solo spread OTM, por crédito neto, nueva expiración ≥ 21 DTE. ITM se cierra, no se rolla.
- **Riesgo ex-div SPY:** el bloqueo de CCS ≤3 días del ex-dividend queda declarado en el JSON pero
  **inactivo** (no hay CCS con PCS-only); reactiva si alguna vez vuelve el lado call.
- **Mutación de estructura (PCS→IC):** **muerta** — IC prohibido (BT-11).

---

## 10. Estructura y strike engine

- **Estructura: Put Credit Spread únicamente.** IC y CCS `enabled:false` (BT-11: in-edgeable a
  probabilidad honesta — un IC necesitaría crédito ≥63% del ancho para EV>0, el mercado no lo
  ofrece). El motor `structure_selection` multi-factor queda retirado (degradaba el baseline).
- **Delta objetivo del short: 0.25** (BT-17 ganador; BT-12 confirmó meseta 0.28–0.32, no pico).
- **Ancho: $5** ($10 rechazado — es apalancamiento, no alpha: mismo total con 2× max loss, BT-17).
- **DTE: [35, 50], target 45.**
- **Restricción de sanidad:** `short_strike ≤ put_wall`. **Sin put wall, el gate bloquea**
  (`signal_gates.gates.short_below_put_wall.on_missing_wall: "no_trade"`). Es la excepción al
  "sin datos no bloquea" del resto del embudo: acá el dato que falta es la referencia contra la que
  se verifica, así que dejarlo pasar apagaba la restricción justo cuando no había con qué aplicarla.
  Ojo con la asimetría: sin **short strike** el gate sigue en `no_data` y no bloquea — ahí no falta
  un dato, falta el candidato. Se volvió alcanzable el 2026-08-18, cuando los muros pasaron a exigir
  que el neto del strike tenga el signo de su lado (ver `docs/gex/gex_endpoint.md` §1): un
  `putWall` null dejó de ser una rareza de datos y pasó a ser un resultado legítimo.
- **Piso anti-pennies:** `credit_ratio ≥ 10%` **y** `crédito ≥ $0.30`.
- **Microestructura:** `open_interest ≥ 100` (bajó de 2000 — el OI no predice calidad de quote en
  SPY moderno, BT §8) · `spread ≤ 5%` (gate primario, se auto-protege).
- **Fricción:** ~$6.30/contrato (PCS 2 legs, round trip, cierre 50%; comisiones + fees + slippage +
  gestión esperada). El piso de `min_edge` se expresa como `1 + fricción$/crédito$`, no constante.

---

## 11. Restricciones operativas duras

- Solo **SPY** (otros subyacentes requieren un ciclo de research nuevo con réplica + walk-forward).
- Solo **PCS** (crédito, riesgo definido, lado put).
- **Prohibido:** naked shorts, ratio spreads, long direccional, IC, CCS.
- El sistema **sugiere, nunca ejecuta.** Aprobación manual siempre; banda `high_risk` sin excepción.
- Nodos nuevos `enabled:false` hasta merge + validación en paper.

---

## 12. Estado de validación empírica

**El research está cerrado (BT-0…BT-17, 2026-07-14).** Lo que quedó probado:

- La config **gana siempre que opera** (win ~97%, p5 positivo bajo gestión B) y **casi nunca opera**
  (régimen-cero estructural: espera máxima 272 días con V2, p90 155). El sistema es safety-first de
  renta chica, no una máquina de yield: ~$340/año de estrategia con 1 contrato; ~6.4% anual blended
  con T-bill sobre $16k. La renta la escala el **capital**, no un parámetro.
- Pasó el **walk-forward** (H2/H3: criterios C1–C3 pre-declarados, corridos una vez, sin retoques).

**Caveats que sobreviven al freeze (libro mayor §10 — deben quedar en el JSON y el tablero):**

1. **Ventana OOS 2018–2025 agotada.** Todo veredicto habilita **a lo sumo paper**, nunca real directo.
2. **Calibración POP put hija del drift** — monitorear el factor por ventana (C4 quedó en falla
   declarada en H3, absorbido por barras robustas, no resuelto).
3. **P1 (GEX) tiene un punto ciego de ventana:** el único episodio que justifica el gate (ago-2015)
   está **fuera** del OOS. Se mantiene por safety-first, no porque el OOS lo exija.
4. **La config final (delta 0.25 + GEX) es una INTERPOLACIÓN, no una fila medida.** El ganador de
   BT-17 (variante C) es delta 0.25 **sin** GEX (10.6 tr/año); BT-15 midió V2 **con** GEX a delta
   **0.30** (7.4 tr/año). La conjunción elegida junta dos palancas validadas por separado.
   **Números esperados acotados A↔C: ~8 trades/año, win ~97%, peor año ≤ −$140.** Si en paper no
   matchean, se corre la fila de confirmación (delta 0.25 + GEX + V2) con datos frescos.

---

## 13. Frontera diseño→implementación (Fase 5)

Con la Decisión 5 (RPF completo), esto **deja de ser "formalizar un contrato" y pasa a ser
desarrollo de orquestación nuevo** en el backend. La señal está validada por datos; la máquina de
estados y el loop se validan **por diseño y en paper**, no con backtest.

> ✅ **Diseño canónico escrito (2026-07-29):** [`galecore-rpf-fase5-orquestacion.md`](galecore-rpf-fase5-orquestacion.md)
> resuelve las piezas de abajo (contrato, máquina de estados, loop, ack, deltas JSON). Decisiones
> nuevas: entregable = doc-only; cierre del ciclo = **ack explícito del operador**; persistencia
> in-memory; TTL = 2× Tier B; δ cooldown `null`. La **implementación** queda para Fase 6.

| Pieza | Estado | Nota |
|---|---|---|
| Contrato `TradeSuggestion` | ✅ diseñado (Fase 5) | payload, TTL 2× Tier B, `state`=foto, persistencia in-memory, SignalR grupo `rpf` |
| Máquina de estados por símbolo | ✅ diseñado (Fase 5) | 7 estados (§8) + precedencia; función pura de outputs de gates + cupo + cooldown |
| Loop en backend | ✅ diseñado (Fase 5) | `RpfLoopService`: Tier A lento cacheado + Tier B rápido; molde `FlowBroadcastService` |
| Ack del operador | ✅ diseñado (Fase 5) | Accept/Dismiss en el hub; Accept confirma + cooldown, NO ejecuta; `IN_POSITION` lo confirma la cuenta |
| Frontend = tablero | a re-encuadrar (Fase 6) | deja de ser el loop; consume `RpfStateUpdate`/`TradeSuggestion` |
| δ del cooldown | `null` (refinamiento) | la ocupación hace el grueso; el cooldown implementado es anti-doble-emisión |
| Merge JSON-first | Fase 3 → deltas en Fase 6 | `galecore_rules_rpf.json`; `state_machine`/`trade_suggestion`/`orchestration` `enabled:false` |

---

## 14. Lo que queda abierto (no bloquea la definición)

| Pendiente | Tipo |
|---|---|
| Régimen-cero: qué hace el sistema en los meses/años sin señal posible (esperar vs 2ª pata no correlacionada) | límite estructural **nombrado, no feature** (medido: hasta 272 días con V2) |
| Filtro de volumen (>200) — revisar con el mismo método que el OI (BT §8) | calibración menor |
| `spot_vs_zgl` como gate adicional | pendiente de dato (ZGL histórico + OI) |
| Fila de confirmación delta 0.25 + GEX (si paper no matchea la interpolación) | validación condicional |
| 2ª pata / más subyacentes para la renta | ciclo de research nuevo (pre-declarado) |
