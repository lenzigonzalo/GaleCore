> ⚠️ **DISEÑO CANÓNICO — restaurado 2026-07-29.** Este es el diseño de referencia de la estrategia
> nueva **"Disparo por prima real" ("Real Premium Firing" / RPF)**, cerrado el **2026-07-06**
> (commit `95ed70d`). Se restauró acá como documento aparte: el archivo original fue **sobrescrito**
> por la definición de la implementación PCS-only ([`galecore-estrategia-definicion.md`](../galecore-estrategia-definicion.md)).
>
> **Qué está implementado y qué no:**
> - La **arquitectura RPF** — máquina de estados por símbolo (VETOED · DORMANT · **ARMED** ·
>   WAITING_CAPACITY · **TRIGGERED** · COOLDOWN · IN_POSITION), los dos tiers (A *arma* / B *dispara*),
>   y el loop en el backend que empuja `TradeSuggestion` por SignalR — **NO está en el código**
>   (verificado 2026-07-29: cero referencias en `source/`).
> - Lo que corre hoy es una **cascada lineal** `OPERAR / ESPERAR / NO_OPERAR` que conservó los
>   *gates* de RPF (VRP, edge, tail_score) pero descartó su arquitectura de estados y su inversión
>   backend↔frontend.
>
> **Tensiones sin resolver frente al backtesting** (decisión del operador pendiente):
> - RPF admite **IC / PCS / CCS** y el **regime engine de 8 regímenes**; el ciclo BT-0…BT-17
>   ([`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md)) concluyó **PCS-only** y
>   relajó el macro. Falta reconciliar qué partes de RPF sobreviven a los resultados del backtest.
> - El **plan de validación** original (BT-1…BT-8) evolucionó al backtesting ejecutado; ver
>   [`galecore-rpf-plan-validacion.md`](galecore-rpf-plan-validacion.md).
>
> El cuerpo debajo es el documento original de 2026-07-06 **sin modificar**.

---

# GaleCore — Definición de la estrategia (disparo por prima real)

> **Propósito:** consolidación de la definición cerrada de la nueva estrategia de disparo
> autónomo por edge, resultado de las sesiones de diseño. Este documento es la referencia
> conceptual; la fuente de verdad operativa sigue siendo el JSON de reglas (los nodos nuevos
> se listan en §10 y entran `enabled:false` hasta su backtest).
>
> **Documentos relacionados:**
> - `galecore-backtesting-pendientes.md` — validaciones empíricas pendientes (BT-1…BT-8)
> - `GaleCore-Estrategia-Resumen.docx` — one-pager en lenguaje natural (pre-feedback; §4 corrige su prosa del edge)
> - Feedback externo incorporado: `feedback-mejora-edge-estados.md` (revisión de otra sesión)

**Fecha de consolidación:** 2026-07-06
**Base de reglas:** v2.1.5 (regime engine de 8 regímenes) — decisión fijada.
**Estado:** definición conceptual cerrada; formalizaciones pendientes en §13.

---

## 1. Principios de diseño (invariantes de todo el sistema)

1. **Safety-first.** La jerarquía de autoridad es: veto de cola > GEX/régimen > edge.
   El objetivo diferencial no es operar más — es que cada trade sea lo más seguro posible.
2. **Gates vs. triggers.** Toda condición es O BIEN seguridad (gate binario, no-compensable)
   O BIEN oportunidad (trigger continuo). Nunca ambas. Ningún proxy de oportunidad dentro
   del gate de seguridad (el error del modelo viejo: la banda de IVR en el AND).
3. **Sin compensación cruzada.** Un gate no rescata a otro. VRP alto no compra edge bajo,
   geometría linda no compra vol barata, "posición chiquita" no compra correlación.
4. **Podar, no sumar.** No se agregan protecciones sin que la escalera de atribución (BT-5)
   demuestre que pagan. El riesgo actual no es que falte una capa — es sumar sin validar.
5. **JSON-first.** Todo cambio de lógica o parámetro se declara primero en el JSON de reglas,
   después en backend/frontend. Nodos nuevos nacen `enabled:false` hasta su backtest.
6. **El sistema sugiere, no ejecuta.** Ninguna orden se envía jamás sin aprobación manual.
   Los trades de banda alto-riesgo, bajo ninguna circunstancia (§7).

---

## 2. Modelo conceptual

Venta sistemática de prima con riesgo definido (IC / PCS / CCS) sobre SPY y QQQ,
capturando theta y el Variance Risk Premium en entornos donde la estructura de gamma
del mercado amortigua el movimiento.

**El problema del modelo anterior:** la cascada de 4 capas en AND incluía un proxy de
oportunidad independiente (banda de IV Rank) dentro del gate de seguridad. Los gates de
seguridad correlacionados no multiplican las ocurrencias hacia abajo; un proxy independiente
sí — mataba ocurrencias sin comprar seguridad.

**La mejora central:** separar la decisión en dos ejes:
- **Entorno habilitado** (seguridad, binario, lento): ¿se puede operar sin peligro estructural?
- **Trigger de oportunidad** (continuo, rápido): ¿la prima que se está pagando AHORA tiene
  expectativa positiva real?

Arquitectura invertida: el backend corre el loop (Tier A lento arma/desarma; Tier B rápido
vigila el edge y dispara) y empuja `TradeSuggestion` vía SignalR. El frontend
(PositionBuilder) pasa de ser el loop a ser el tablero de diagnóstico del loop.

---

## 3. El trigger — dos condiciones ortogonales en AND

```
TRIGGER  ⟺  alpha_gate  AND  edge_gate      (escalonado: arma → dispara)
```

### 3.1 alpha_gate — ¿de dónde sale la plata? (nivel entorno, Tier A)

```
VRP = IV30 / RV30  ≥  vrp_min(régimen)
```

La prima económicamente cara: implícita por encima de realizada. Sin esto, se vende seguro
subvaluado por más linda que sea la estructura.

- **RV30 trailing NO es la fuente de alfa** — es el estimador observable (laggeado) de la RV
  futura, bajo supuesto de persistencia. Es sistemáticamente ciego en las transiciones
  calma→tormenta (falso positivo que liquida). Ese punto ciego lo cubren los gates
  independientes del entorno (iv_momentum, tail_score, GEX) — por eso el VRP nunca es
  load-bearing solo.
- Upgrade reservado (si BT-2 lo pide): RV forward (EWMA/GARCH) o estimador range-based
  (Yang-Zhang). Afinar el estimador, no agregar gates.

### 3.2 edge_gate — ¿el spread captura bien esa prima? (nivel spread, Tier B)

```
edge = (crédito / ancho) / (1 − POP)        con POP ≈ 1 − |delta_short|
edge > 1  ⟺  EV > 0        (identidad: EV = crédito − (1−POP)·ancho)
disparo:  edge ≥ min_edge(régimen)
```

- **Corrección de prosa (feedback §4):** el denominador `(1−POP)×ancho` es *probabilidad de
  pérdida × ancho*, NO "la pérdida promedio" (esa es `p·(ancho−crédito)`).
- **El edge mide geometría, no alfa.** POP y crédito salen de la misma superficie implícita:
  el edge compara el spread contra lo que el mercado ya priceó, nunca contra la realidad.
  Un edge alto con IV barata es un trade lindo sin ventaja → por eso el AND con alpha_gate.
- Se eligió AND de dos pisos (no una métrica fusionada edge×VRP) por el principio 3:
  el producto permitiría que una dimensión compre a la otra.

---

## 4. Métricas y roles (resolución del choque con priorityScore)

| Métrica | Naturaleza | Pregunta que responde | Cuándo actúa |
|---|---|---|---|
| `creditRatio` (regla 1/3) | absoluta, con target ≥ 33.3% | ¿el spread paga suficiente? | **piso** — mata los pennies antes que el edge los vea |
| `edge` | absoluta, con umbral | ¿disparo o no? ¿qué strike? | **gate + selector** dentro del símbolo |
| `priorityScore` | relativa, ordinal | ¿cuál primero entre elegibles? | **desempate** solo si 2 símbolos cruzan edge a la vez con 1 cupo |

- edge y priorityScore usan los mismos insumos (credit/width, POP) pero los combinan distinto
  para propósitos distintos: ratio con breakeven (disparar) vs. blend ponderado sin corte
  natural (ordenar). No compiten: actúan en momentos distintos del pipeline.
- Con un solo símbolo operable, priorityScore queda dormido; el motor real es
  **creditRatio (piso) + edge (selector + gate)**.
- Composición virtuosa multi-símbolo: edge garantiza EV>0; priorityScore (POP al 60%) elige
  el más seguro entre los rentables.

**Selección de strikes dentro del símbolo:**

```
candidatos → piso 1/3 (descarta crédito < 33.3% del ancho)
           → elegir el de MAYOR edge entre los que pasan
           → disparar solo si edge ≥ min_edge(régimen)
```

---

## 5. Flujo de entrada completo

```
TIER A — LENTO (entorno / armado)
 1. data quality        quotes frescos, sin crossed market        (hard_gates)
 2. régimen seguro      GEX+ ∧ spot>ZGL · VIX/régimen ok ·
                        tail_score < block · iv_momentum no-crisis
 3. alpha_gate          VRP ≥ vrp_min(régimen)
        └── todo pasa → ARMED   (falla → DORMANT / VETOED)

TIER B — RÁPIDO (oportunidad / disparo, solo si ARMED)
 4. strike engine       estructura por gex_skew (IC/PCS/CCS)
 5. piso 1/3            creditRatio ≥ 33.3%
 6. edge selector       máx edge entre los que pasan el piso
 7. edge gate           edge ≥ min_edge(régimen)

SELECCIÓN / ASIGNACIÓN
 8. veto correlación    mismo lado en el otro índice → bloqueado (§7)
 9. cupo                heat ≤ 7% · 1 posición por símbolo · presupuesto de riesgo
10. priorityScore       desempate si 2 elegibles simultáneos
11. sizing              contratos = floor(presupuesto / pérdida_máx_por_contrato)
        └── FIRE → TradeSuggestion (estado TRIGGERED)
```

**Lectura:** el entorno decide *si se puede*, el alfa decide *si vale la pena*, el edge decide
*cuál y cuándo*, la asignación decide *cuánto y sin duplicar*.

---

## 6. Barras dinámicas — vrp_min / min_edge por régimen

**Estructura elegida: tabla por régimen, NO fórmula continua.** El dinamismo entra por una
sola puerta (el régimen del regime engine); una curva f(VIX,...) duplicaría el clasificador,
sería incalibrable e inauditable. Cada nodo `behavior` del régimen carga sus dos barras.

**Racional del dinamismo:** cada barra sube exactamente cuando su propia debilidad es más
peligrosa — `vrp_min` compensa la desconfianza en el estimador RV trailing; `min_edge`
compensa que el delta subestima la probabilidad real de pérdida en regímenes tensos.

**Invariantes (la calibración de BT-2/BT-3 debe respetarlos):**
- **Monotonía:** barras no-decrecientes con el peligro del régimen.
- **Piso duro:** `min_edge ≥ 1 + fricción/crédito` en todo régimen.
- **Sin compensación cruzada** entre barras.

**Valores placeholder (a reemplazar por BT-2/BT-3):**

| Régimen | `vrp_min` | `min_edge` |
|---|---|---|
| optimal | 1.15 | 1.10 |
| normal | 1.20 | 1.15 |
| low_vol_grind | 1.25 | 1.15 |
| elevated_vol | 1.35 | 1.25 |
| caution / dislocation | 1.45 | 1.35 |
| crisis | — (bloqueado) | — |

**Piso de fricción — CALCULADO (2026-07-06, datos reales; detalle en doc de backtesting §7):**
fricción ≈ $6.30–9.30 por contrato (PCS 2 legs, round trip, cierre 50%). Para trades que
cumplen la regla 1/3: **piso ≈ 1.02–1.06** según ancho → la tabla placeholder sobrevive con
margen. El piso se expresa como función del crédito (`1 + fricción$/crédito$`), no constante.

**Cooldown:** histéresis local sobre el edge — dispara al cruzar `min_edge`; no re-arma hasta
que caiga bajo `min_edge − δ` y vuelva a cruzar. Anclado a prima, no a timer. δ pendiente (BT-8).

---

## 7. Allocation policy (cerrada 2026-07-06)

### 7.1 Cuánto — riesgo por trade (base: Net Liq mínimo inicial $10k)

La estructura del mercado impone la unidad mínima de riesgo: ancho $5 (realista mínimo
disponible lejos del ATM) con crédito 1/3 = max loss $333 = 3.3% de $10k. Reglas por debajo
de eso son inoperables por aritmética, no por apetito.

| Banda | Riesgo/trade | Comportamiento |
|---|---|---|
| **Estándar** | ≤ 5% (target 3.5%) | sugerencia normal — cubre ancho $5 crédito 1/3 |
| **Alto riesgo** | 5–8% | flag `high_risk`: solo régimen optimal/normal, única posición del libro, **aprobación manual explícita siempre** — cubre ancho $10 (6.7%) |
| **Nunca** | > 8% | no se sugiere bajo ninguna circunstancia |

- **Todo en % del Net Liq corriente** (no dólares fijos): el crecimiento de cuenta desbloquea
  anchos automáticamente; la caída los restringe sola.
- Sanity: 3.5–5% ≈ 1/10 de Kelly (POP 80%, payoff 1/3) — conservador si el POP es honesto (BT-1).
  Peor racha de 5 pérdidas máximas ≈ 16% drawdown en banda estándar.
- `size_factor` por régimen solo reduce la banda, nunca la amplía.
- **Heat total del libro ≤ 7%** (dos estándar, o una high_risk sola).
- Nota XSP: la premisa del feedback ("XSP ~1/10 del notional de SPY") es **incorrecta** —
  XSP = SPX/10 ≈ mismo nivel que SPY. XSP no aporta granularidad; aporta settlement en
  efectivo / sin asignación / tratamiento 1256. Decisión de incluirlo: opcional, no bloqueante.

### 7.2 Cuántas — una posición por símbolo, mutable

> **Máximo 1 posición por símbolo por vencimiento** (con DTE 35–45 colapsa a 1 por símbolo).
> La posición puede **mutar de estructura** (PCS→IC, CCS→IC) como acción de gestión —
> completar el lado opuesto suma crédito y REDUCE max loss sin buying power adicional.
> Jamás apilar el mismo lado (misma apuesta con strikes promediados: doble fricción,
> correlación 1.0, evasión de la contabilidad de riesgo). Confirma la regla existente
> "≤1 posición por ticker" y le da el porqué.

Nuevo disparo sobre símbolo con posición abierta solo puede proponer: (a) completar lado
opuesto → IC, o (b) roll/reemplazo. Nunca entrada adicional.

### 7.3 Correlación SPY/QQQ — veto duro al mismo lado

> Con posición abierta en un índice, el otro solo puede entrar por el **lado opuesto**
> (SPY PCS + QQQ CCS se compensan en crash; mismo lado se suma). IC bloquea ambos lados.
> Cero parámetros.

- Se descartó el tope de heat combinado: a esta escala requeriría un parámetro inventado
  (~5%) y es compensación dentro de un gate de seguridad (viola principio 3).
- Regla puramente restrictiva → puede activarse en paper desde el día 1; BT-6 decide si queda.

---

## 8. Máquina de estados (por símbolo)

Estados del diagrama de diseño + `IN_POSITION` (definido con §7.2):

| Estado | Condición | Significado |
|---|---|---|
| `VETOED` | gates técnicos ok ∧ veto de cola activo | peligro activo (crisis) — nada se evalúa |
| `DORMANT` | sin veto ∧ ¬(gamma ok ∧ prima cara) | sin peligro pero sin setup |
| `ARMED` | entorno habilitado completo (Tier A pasa) | el edge se vigila como trigger |
| `WAITING_CAPACITY` | ARMED ∧ estructura ok ∧ edge ≥ barra ∧ ¬cupo | trade bueno sin presupuesto/cupo |
| `TRIGGERED` | ARMED ∧ estructura ok ∧ edge ≥ barra ∧ cupo ∧ ¬cooldown | se emite TradeSuggestion |
| `COOLDOWN` | recién disparó | suprime re-disparo con la prima oscilando |
| `IN_POSITION` | posición abierta en el símbolo | trigger de entrada apagado; solo gestión (completar-IC / roll) |

**Refinamientos pendientes (no bloquean la definición):** confirmar partición VETOED/DORMANT
y existencia de WAITING_CAPACITY como estados separados vs. atributos; alcance de la
histéresis (régimen vs. por-estado); δ del cooldown (BT-8).

---

## 9. Salidas y gestión de posiciones

**La estrategia nueva ADOPTA la gestión existente sin cambios**, hasta que BT-4 diga otra cosa:

- Profit target: cierre al **50% del crédito**.
- `hard_defense`: delta short > 0.30 o pérdida ≥ 2× crédito → defensa/cierre.
- `daily_kill_switch`: MTM diario −1% → freno del libro.
- Rolls: solo spread OTM, por crédito neto, nueva expiración ≥ 21 DTE. ITM se cierra, no se rolla.
- Riesgo ex-div SPY: sin CCS ≤ 3 días del ex-dividend (block), warn ≤ 7.
- Gestión de estructura: completar lado untested → IC (§7.2).

El feedback señaló correctamente que el doc de mejora omitía las salidas: **existen y quedan
declaradas acá como parte de la definición.** Advertencia registrada: la evidencia Tastytrade
del 50% es más fuerte en riesgo indefinido que en spreads definidos → BT-4 lo testea, no lo asume.

---

## 10. Mapeo al JSON v2.1.5 (nombres fijados; nodos nuevos `enabled:false`)

| Concepto | Nodo | Origen |
|---|---|---|
| alpha_gate | activar y promover el `iv_vs_rv` **que ya existe deshabilitado** en regime_engine.checks | reconciliado, no inventado |
| barras dinámicas | `behavior.{vrp_min, min_edge}` por régimen | nodo nuevo |
| definición del edge | `definitions.edge` (fórmula + refs a pop_proxy/credit_ratio) | nodo nuevo |
| fricción | `execution.friction` — **extiende** el modelo de slippage existente (comisiones + gestión) | extensión |
| anti-correlación | `risk_limits.correlation_veto` (veto duro mismo lado) | nodo nuevo |
| bandas de riesgo | `risk_limits.risk_bands` (estándar/high_risk/never + heat 7%) | nodo nuevo |
| 1 posición por símbolo | regla existente confirmada (concentración por subyacente) | existente |
| cooldown | `position_builder.cooldown` (histéresis sobre edge, δ) | nodo nuevo |
| estados | capa de orquestación **encima** de las capas — cada estado se computa de outputs existentes + cooldown | presentación |
| ranking | `position_builder.ranking` (priorityScore) **queda como está** — rol de desempate | existente |

---

## 11. Restricciones operativas duras

- Solo SPY y QQQ (XSP/otros requieren aprobación explícita).
- Solo estructuras de crédito con riesgo definido: IC / PCS / CCS.
- Prohibido: naked shorts, ratio spreads, long direccional.
- El sistema **sugiere, nunca ejecuta**. Aprobación manual siempre; banda high_risk sin excepción.
- Nodos nuevos `enabled:false` hasta backtest.

---

## 12. Validación empírica en vivo (2026-07-06)

Un solo día de datos reales demostró que el rediseño cambia decisiones concretas:

- El trade que la cascada actual dispara (PCS SPY 710/700): **edge 0.53** (mitad del breakeven
  de EV), creditRatio 8.7% — el sistema dice OPERAR porque su gate de crédito es absoluto
  ($0.30) y los strikes anclados a muros no cobran casi nada.
- **VRP del día:** SPY 0.99, QQQ 0.91 — IV bajo RV, sin alfa. Ningún vrp_min armaría el sistema.
- **El trigger nuevo rechaza por ambos gates el trade que el sistema actual sugiere.**
- Colateral: Layer 4 aprobó max loss $913 con límite de $83 (`heatOk:true`) — bug del sizing
  actual a revisar aparte.

---

## 13. Lo que queda abierto (no bloquea la definición)

| Pendiente | Tipo |
|---|---|
| Contrato `TradeSuggestion` (payload, TTL, persistencia, campo state) | frontera diseño→implementación |
| Refinamientos de la máquina de estados (§8) | formalización menor |
| Calibración de barras, δ cooldown, validación POP, escalera de atribución | backtests BT-1…BT-8 (doc aparte) |
| Régimen-cero: qué hace el sistema cuando vender prima no paga por meses | límite estructural **nombrado, no feature** |
| XSP como universo opcional (cash settlement, sin asignación) | decisión opcional del operador |
| Merge de v2.1.5 + nodos nuevos al repo | implementación (JSON-first) |
