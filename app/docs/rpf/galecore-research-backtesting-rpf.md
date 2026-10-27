> ⚠️ **COPIA RPF — snapshot 2026-07-29.** Copia del backtesting compartido
> [`../galecore-research-backtesting.md`](../galecore-research-backtesting.md), traída a la carpeta RPF
> para que la estrategia nueva ("Disparo por prima real") referencie su research desde acá. Es el ciclo
> **BT-0…BT-17** que **validó y podó** el diseño RPF (BT-11 mató el motor IC/CCS → **PCS-only**; las
> iteraciones H2/H3 fijaron delta y gestión). El original en la raíz de `docs/` sigue siendo el que citan
> los docs de la estrategia **implementada**. Cuerpo debajo: copia verbatim del original.

---

# GaleCore — Backtesting pendientes

> **Propósito:** registro de todas las validaciones empíricas pendientes que sostienen la definición
> de la estrategia de disparo por prima real (edge + estados). Cada supuesto del diseño que no está
> derivado matemáticamente ni calculado con datos propios queda listado acá con: qué hay que calcular,
> qué dato histórico se necesita, dónde impacta y qué criterio decide.
>
> **Regla:** ningún nodo nuevo del JSON pasa a `enabled: true` hasta que su backtest correspondiente
> lo justifique. Los valores actuales de la tabla de barras son **placeholders**, no calibraciones.

**Fecha:** 2026-07-06 · actualizado 2026-07-08 (feedback ronda 2: se agrega BT-0)
**Base de reglas:** v2.1.5 (regime engine de 8 regímenes) — decisión fijada en sesión de diseño.
**Estado:** ningún backtest ejecutado. Dataset SPY EOD 2013–2023 adquirido en Parquet (ver §2.1).

---

## 1. Taxonomía de los números del diseño (qué es sólido y qué no)

| Número / regla | Origen real | ¿Requiere backtest? |
|---|---|---|
| `edge > 1 ⟺ EV > 0` | Identidad matemática (derivada) | No la identidad; sí su insumo (POP) |
| `POP ≈ 1 − \|delta\|` | Aproximación teórica estándar | **Sí — validación #1.** Todo el edge cuelga de esto |
| `VRP medio ~1.1–1.3`, `vrp_min = 1.2` | Prior de literatura (hecho estilizado de índices) | Sí — validar en SPY/QQQ, nuestra ventana |
| DTE 45, profit target 50%, POP 60–80%, regla 1/3 | Research Tastytrade — medido en *sus* datos, mayormente **strangles** (riesgo indefinido) | Sí — la evidencia es más débil para spreads definidos |
| Fricción ~8–10% del crédito | Estimación gruesa | **No: cálculo directo hoy** (sección 7) |
| Correlación SPY/QQQ ~0.95 | Hecho estilizado | Verificación trivial, datos gratis |
| Tabla `vrp_min`/`min_edge` por régimen | **Inventada.** Estructura razonada (monotonía, piso = 1 + fricción); niveles sin base empírica | **Sí — lo más desnudo del diseño** |
| Umbrales de tail_risk_score | Calibrados con ~5 crashes reales (muestra de un dígito) | Sí — tratarlos como provisorios y sobreajustados |
| Cobertura de los puntos ciegos (VRP-trailing y delta-POP) por detección temprana del régimen | **Apuesta de diseño** — asumida en la definición, nunca medida | **Sí — BT-0 (nuevo, feedback ronda 2)** |

---

## 2. Dataset indispensable (hay uno solo difícil)

### 2.1 El dato duro — cadenas de opciones históricas EOD

**Cadenas de opciones históricas EOD de SPY y QQQ**, por strike y expiración, con:

- bid / ask
- delta
- IV
- open interest

Con esto se reconstruye: el spread que el sistema habría armado, su crédito real, su POP, su edge,
y su **mark-to-market día a día** (necesario para profit target 50%, rolls y salidas).

- No hace falta intradía: el loop decide en horizonte diario → EOD alcanza para v0.
- Sin este dataset **no hay backtest de nada**.
- Fuentes candidatas (dato pago): CBOE DataShop, ORATS, Polygon.io, OptionMetrics.
- Ventana mínima deseable: ≥ 5 años (incluye al menos un shock de vol; ideal ≥ 10 años para
  cubrir 2018, 2020, 2022).

**Estado (2026-07-08): SPY EOD 2013–2023 ADQUIRIDO** en Parquet (~500 MB, 11 años; por strike:
bid/ask/last, delta/gamma/vega/theta/rho, IV, volumen). Evaluado 2023: 250 días completos,
zona operativa siempre poblada, bid-ask mediana 0,61% del mid, crossed markets despreciables.
**Faltantes: (a) Open Interest** — no viene en el dataset; bloquea la reconstrucción de GEX
(escalón c de BT-5 y componente GEX de BT-0) y el filtro de microestructura; **(b) QQQ**
(bloquea BT-6). Prioridad de adquisición: OI primero, QQQ después, luego años post-2023.

### 2.2 Datos derivables o gratuitos

| Insumo | Fuente | Para qué |
|---|---|---|
| OHLC diario SPY/QQQ | gratis (yfinance, Tastytrade) | RV30 → denominador del VRP |
| VIX, VIX9D, VIX3M, VVIX, SKEW | CBOE, gratis | clasificar el régimen histórico día a día |
| HY OAS | FRED — **integración ya existente en el repo** | insumo de tail_risk_score |
| IV30 | de las cadenas (o VIX/VXN como proxy v0) | numerador del VRP |
| GEX histórico | **reconstruible** de las cadenas (OI + gamma por strike — misma cuenta que `GammaExposureHandler`) | escalón (c) de la escalera de atribución |
| Correlación SPY/QQQ | del OHLC | validar el veto de correlación |

### 2.3 Lo que NO se puede backtestear (aceptado)

- **Aggressive flow** — no existe histórico de nuestro `FlowAggregatorService`. Se excluye del
  backtest; queda como señal solo-live.
- **Microestructura fina intradía** — se aproxima con bid-ask EOD. Suficiente para v0.

---

## 3. Backtests pendientes — detalle

### BT-0 — Latencia de detección del regime engine (nuevo — feedback ronda 2)

La definición descarga los dos puntos ciegos conocidos del trigger (VRP con RV trailing que
miente en calma→tormenta; delta-POP que subestima pérdidas con colas gordas) en la **detección
temprana del régimen**. Ambos fallan en el mismo momento; si el régimen llega tarde, fallan
juntos. BT-0 mide esa apuesta.

| | |
|---|---|
| **Qué calcular** | Para cada episodio histórico de expansión de vol en la ventana 2013–2023 (ago-2015, feb-2018, dic-2018, mar-2020, 2022): reconstruir día a día la clasificación del regime engine con sus reglas actuales y medir el **lead time** (en días) entre (i) la degradación de régimen que dispara el motor, (ii) el día en que RV30 alcanza a IV30 (fin del espejismo del VRP) y (iii) el día en que delta-POP empieza a subestimar la pérdida realizada |
| **Dato necesario** | Familia VIX (VIX, VIX9D, VIX3M, VVIX, SKEW — CBOE, gratis) + HY OAS (FRED, integrado) + IV de los parquets + OHLC. **Componente GEX del régimen: bloqueado por falta de OI** — se corre BT-0 sin él y se repite al conseguirlo |
| **Dónde impacta** | La apuesta central del diseño (§3.1 y §6 de la definición). Si el lead time no es positivo, se endurecen los inputs rápidos (iv_momentum, vix_term_structure) **antes** de construir nada |
| **Criterio** | Lead time **positivo en todos los episodios mayores** — se reporta el peor episodio, no el promedio. Complemento de BT-1: BT-1 mide *dónde* se rompe delta-POP; BT-0 mide si el régimen te saca *antes* de ahí. Se corren juntos sobre los mismos episodios |

**⚙ PRIMERA CORRIDA (2026-07-08) — SPY 2013–2025, 15 episodios (drawdown ≥7% desde máx 60d),
inputs rápidos v2.1.5 (VIX≥30 ∨ VIX9D>VIX3M ∨ RoC5d VIX>12%), lead = inicio de racha continua:**

1. **La apuesta de diseño SE SOSTIENE:** lead mediano **+3 días**, positivo en **11/15** episodios;
   el engine estaba fuera **en el peor día en 14/15** (única falla: oct-2023, grind lento de −8,8%).
   Los 5 episodios catastróficos (−34% mar-2020, −20% Q4-2018, −21% abr-2022, −19% mar-2025,
   −17% ago-2022) TODOS cubiertos en el peor día, con 55–100% de la ventana de daño fuera.
2. **Protege de la trampa exacta que temíamos:** VRP en el momento de detección > 1.2 en 12/15 —
   el engine te saca mientras el VRP-trailing todavía dice "prima rica". Validación empírica
   directa del punto ciego calma→tormenta.
3. **Los 4 episodios tardíos son grinds lentos** (sep-2020, dic-2022, oct-2023, abr-2022 lead 0)
   — drawdowns graduales sin shock de vol, el modo de pérdida lenta (no catastrófica) de la
   venta de prima. El engine anticipa shocks; los grinds los detecta tarde por construcción.
4. **El costo, medido:** engine fuera el **28,3%** de los días; 119 rachas falso-positivas
   (13% de los días, mediana 3 días). El anticipador es `iv_momentum` (RoC5d>12) que dispara
   el 18,6% de los días — es a la vez el héroe del lead time y el generador de ruido. Su
   calibración (12%) es trade-off ocurrencias↔anticipación → se decide en BT-5 con P&L, no acá.
5. **🐛 Componente GEX EXCLUIDO — fórmula y umbral incompatibles:** la reconstrucción histórica
   con la fórmula del JSON (Σ OI·gamma·100·spot²·0.01, calls−puts) da mediana ~0B / p90 7B
   contra un umbral de crisis de 25B → dispararía el 99,7% de los días. Consistente con el bug
   de `netGexBillions` visto en la API (2026-07-06, valores −5×10¹⁶). **Recalibrar
   fórmula/umbral GEX antes de sumarlo al régimen** — issue abierto. `spot_vs_zgl` tampoco
   testeado (requiere ZGL histórico; posible con OI, pendiente junto al fix GEX).
6. Cache generado: `data/derived/spy_gex_daily.parquet` (GEX diario reconstruido 2013–2025).

### BT-1 — Validación de `POP ≈ 1 − |delta|` (prioridad máxima)

| | |
|---|---|
| **Qué calcular** | Frecuencia real de expiración ITM del strike corto, por bucket de delta (0.05–0.10, 0.10–0.15, … 0.30–0.35), por subyacente y por régimen |
| **Dato necesario** | Cadenas EOD (delta al momento de entrada) + OHLC (para saber el resultado al vencimiento) |
| **Dónde impacta** | `definitions.pop_proxy` — es el insumo de **edge, priorityScore y creditRatio**. Si el delta subestima la probabilidad real de pérdida, TODO el edge del diseño está inflado |
| **Criterio** | Si el ITM real por bucket excede el delta en > X% de forma sistemática (sobre todo en regímenes tensos), el `colchón_incertidumbre` de `min_edge` debe absorber esa diferencia medida — no un número inventado |

**⚙ PRIMERA CORRIDA (2026-07-08) — SPY+QQQ 2013–2025, DTE 30–50, 1,17M observaciones:**

1. **Global: el delta SOBRESTIMA levemente el ITM** (ratio real/pred 0.65–1.0, mejora al crecer
   delta) → `POP = 1−|delta|` es conservador en promedio. Bien para el vendedor.
2. **Por año: el signo se invierte en años bajistas.** 2022: ITM real +3,3pp sobre lo predicho
   (SPY; QQQ +2,6pp) — en stress el delta subestima. **Ese ~3pp (≈15% relativo sobre base 21%)
   es el tamaño medido del `colchón_incertidumbre` para regímenes malos.**
3. **HALLAZGO MAYOR — asimetría put/call brutal (zona 0.10–0.35):**
   - **Puts: pred 21% → ITM real 11,5–12,7%.** El delta sobrestima el riesgo put ~2× (drift
     alcista + put skew). El edge de PCS calculado con delta está sistemáticamente subestimado.
   - **Calls: pred 21,7% → ITM real 33,5%.** El delta SUBESTIMA el riesgo call en +12pp: un
     short call delta 0.20 expiró ITM 1 de cada 3 veces (POP real ~66%, no ~80%).
   - Consistente en ambos índices. Refleja el drift realizado del período (13 años, mayormente
     alcista, incl. 2 bears) — no es conocible ex ante, pero 13 años de persistencia exigen
     respuesta de diseño: **el edge del lado call no puede usar el mismo POP-delta que el put.**
   - Decisión pendiente que esto abre: corrección empírica por lado (tabla de calibración), o
     `min_edge` más exigente para CCS/lado call del IC, o preferencia estructural por PCS.
4. Nota metodológica: observaciones diarias solapadas (mismo contrato en días sucesivos) — n
   inflado pero medias insesgadas; la significancia real la da el conteo de vencimientos.

### BT-2 — Distribución del VRP y calibración de `vrp_min`

| | |
|---|---|
| **Qué calcular** | Serie histórica `VRP = IV30/RV30` diaria por subyacente; distribución por régimen; P&L de trades simulados en función del VRP al momento de entrada |
| **Dato necesario** | IV30 (cadenas o proxy VIX/VXN) + OHLC (RV30) + serie de régimen (VIX family, gratis) |
| **Dónde impacta** | `alpha_gate.vrp_min` por régimen (nodo nuevo del JSON). Hoy 1.2 es convención de literatura |
| **Criterio** | El corte de VRP que históricamente separó trades ganadores de perdedores **en neto**, por régimen. Documentar además el comportamiento del VRP medido en las transiciones calma→tormenta (su punto ciego conocido: RV trailing laggeada) |
| **Extensión (v1, opcional)** | Comparar RV30 trailing vs. **HAR-RV** / EWMA/GARCH (forward-looking) vs. estimador range-based (Yang-Zhang): ¿el estimador mejor reduce los falsos positivos de transición? Solo se adopta si mejora el resultado ajustado por riesgo. **Nota (feedback ronda 2):** este upgrade es *mitigación* del problema de detección de régimen (BT-0), no sustituto del regime engine |

### BT-3 — Calibración de `min_edge` por régimen

| | |
|---|---|
| **Qué calcular** | Distribución histórica del edge de entrada `(credit/width)/(1−POP)` por régimen; P&L **neto** en función del edge de entrada |
| **Dato necesario** | Cadenas EOD (crédito, delta) + serie de régimen + modelo de fricción (sección 7) |
| **Dónde impacta** | Tabla `min_edge` por régimen en los nodos `behavior` del regime engine — hoy los niveles son placeholders (1.10 … 1.35) |
| **Criterio** | Corte de edge neto rentable por régimen, respetando dos invariantes de diseño: **monotonía** (barra no-decreciente con el peligro del régimen) y **piso duro** `min_edge ≥ 1 + fricción` en todo régimen |

**⚙ PRIMERA CORRIDA BT-2/BT-3 (2026-07-08) — 2.692 PCS SPY simulados (delta ~0.20, ancho $5,
DTE 35–50, hold a vencimiento, neto de fricción), 2013–2025:**

1. **🔴 HALLAZGO QUE ROMPE PARÁMETROS: el piso 1/3 y el edge>1 con delta-POP son inalcanzables
   en el PCS canónico.** Credit ratio mediano 11,6%; **0,0% de los días** ofreció ratio ≥33,3%
   a delta 0.20/ancho $5. Edge de entrada: mediana 0,59, p90 0,74 — **nunca cruzó 1 en 13 años**.
   El pipeline como está parametrizado habría disparado CERO trades. Causa: la regla 1/3 de
   Tastytrade presupone strangles/IC con deltas más altos; a delta 0.20 un spread paga ~10-15%
   del ancho, no 33%.
2. **Y SIN EMBARGO los trades fueron +EV:** win rate 88–99%, P&L medio positivo en todos los
   regímenes ($11–62/contrato neto). La reconciliación es BT-1: el delta miente 2× en puts
   (ITM real 11,5% vs 21% predicho) → el edge real con POP real ≈ 1,05–1,10, no 0,59. **El
   edge con delta-POP subestima sistemáticamente el lado put** — la fórmula necesita POP
   calibrado (tabla empírica de BT-1) o el min_edge debe recalibrarse como corte relativo.
3. **✅ VRP≥1.2 VALIDADO como gate:** P&L medio con VRP≥1.2 = $25,50 vs $9,55 en lo rechazado
   (2,7×); banda 1.2–1.4 con p5 POSITIVO (las pérdidas se concentran en entradas de VRP bajo).
   No monótono perfecto (banda 1.4–1.7 mezcla calma-pre-tormenta), pero el corte 1.2 funciona.
4. **El régimen `elevated` (VIX 25–30 sin flags de stress) es el sweet spot:** 98,9% win,
   P&L medio $62, p5 positivo — prima rica sin tormenta.
5. **Matiz sobre engine_out:** los trades dentro de ventanas vetadas promediaron +$22,7 (la
   prima post-crash es enorme) — el valor del engine NO está en el promedio sino en la cola
   (p5 −$431) y en la secuencia; eso lo mide BT-5/BT-7, no este promedio.
6. **Decisión abierta (bloqueante para BT-5):** recalibrar piso de calidad + edge:
   (a) POP empírico por lado desde BT-1 en la fórmula del edge, o (b) min_edge como percentil
   histórico del edge-delta (corte relativo), o (c) mover la selección a deltas mayores
   (0.30–0.35) donde el 1/3 es alcanzable — cambia el carácter de la estrategia (menos POP).

**⚙ SEGUNDA CORRIDA — OPCIÓN (a): POP EMPÍRICO EN EL EDGE (2026-07-08). DECISIÓN ADOPTADA.**

1. **Tabla de calibración construida** (SPY 2013–2025, DTE 30–50, por lado y bucket de delta;
   cache: `data/derived/pop_calibration_spy.parquet`). Factores ITM-real/delta: **puts 0,34–0,69**
   (el delta sobrestima el riesgo put), **calls 1,27–1,59** (lo subestima ~1,5×). Monótona y
   estable. El edge pasa a ser `edge_emp = (credit/width) / p_itm_empírica(lado, delta)`.
2. **Con POP empírico el edge recupera su semántica:** mediana 1,11 (antes 0,59), 73% de los
   días >1 — los trades +EV ahora miden +EV.
3. **El gate completo (régimen operable AND VRP≥1.2 AND edge_emp≥1.05) sobre 13 años:**
   - **304 señales-día ≈ 23/año (~2/mes)** — la baja ocurrencia esperada, ahora cuantificada.
   - **Win 97,4% | P&L medio $43,36/contrato | p5 POSITIVO (+$47,85)** — la cola izquierda de
     lo seleccionado es ganadora; las pérdidas quedaron en lo rechazado.
   - Complemento rechazado: win 91,2%, avg $13,79 → el gate selecciona 3× mejor.
   - Único año negativo: 2015 (−$400, flash crash de agosto). 2018 y 2022: el sistema
     correctamente casi no operó (engine_out) — 2022 tomó 2 señales, ambas ganadoras.
4. **Barrido de `min_edge` por régimen (datos, no placeholders):**
   - `normal`: p5 positivo ya en 1,0; barra **1,05** retiene ~14 señales/año con avg $53.
   - `low_vol`: prima fina y cola presente en cualquier barra (p5 −150/−240) → barra **1,10**
     — consistente con la intuición original ("VRP en vol baja es espejismo de denominador").
   - `elevated`: n=11 (insuficiente para calibrar) → barra **1,10** por prudencia.
5. **Piso de calidad:** con edge_emp en su lugar, el credit ratio pierde poder predictivo
   (bandas no monótonas). Se propone **ratio ≥10% como guardia anti-pennies** (banda 8–10% fue
   la peor: avg $4,2) + el `credit_min` absoluto existente ($0,30). El 33,3% queda **retirado
   como piso** para spreads de un solo lado; se conserva solo como métrica display.
6. **Caveats obligatorios:** calibración in-sample (tabla y evaluación en el mismo período) →
   pendiente walk-forward; la calibración put es dependiente del drift (13 años mayormente
   alcistas, incl. 2 bears); hold-to-expiration (BT-4 recalcula con gestión al 50%); señales-día
   ≠ trades (el cooldown las comprime); falta réplica QQQ.

### BT-4 — Gestión activa: ¿50% profit / 45 DTE es óptimo en spreads definidos?

| | |
|---|---|
| **Qué calcular** | Mismo set de trades con políticas alternativas: hold-to-expiration vs. cierre 50% vs. cierre 25/75% vs. salida a 21 DTE. Comparar distribución completa (no solo media): win rate, peor trade, peor racha |
| **Dato necesario** | Cadenas EOD con mark-to-market diario (path-level obligatorio) |
| **Dónde impacta** | `trade_management` (profit target, DTE de salida). El prior Tastytrade de 50% está validado mayormente en **strangles**; para spreads de riesgo definido la evidencia es más débil |
| **Criterio** | La política que domina ajustada por riesgo. Nota: la gestión **reescribe la distribución** — el edge calculado a vencimiento y el edge con gestión al 50% son números distintos; el segundo es el real y es el que calibra BT-3 |

**⚙ PRIMERA CORRIDA (2026-07-08) — mark-to-market diario de los 2.692 PCS (79.747 path-rows),
4 políticas, foco en las 304 señales gated:**

| Política (gated) | win% | avg$ | p5$ | días prom | $/día |
|---|---|---|---|---|---|
| A: hold a vencimiento | 97,4 | **43,4** | **+47,8** | 42,7 | 1,0 |
| B: cierre al 50% profit | **99,0** | 25,1 | +22,7 | **16,5** | **1,5** |
| C: 50% o salida 21 DTE | 85,5 | 10,4 | −110 | 14,5 | 0,7 |
| D: salida 21 DTE sola | 74,7 | 9,6 | −121 | 21,8 | 0,4 |

1. **🔴 La salida forzada a 21 DTE queda REFUTADA para spreads OTM de riesgo definido:** destruye
   el win rate (97→75%) y vuelve negativa la cola (p5 −$110/−$121) porque **cristaliza drawdowns
   que casi siempre se recuperan** (el ITM real es bajo — BT-1). El prior de Tastytrade está
   calibrado para strangles de riesgo indefinido (gamma risk); acá vende barato el rebote.
   Exactamente la sospecha del feedback ronda 1 ("¿o es el default de Tasty que copiaste?").
2. **El 50% profit target es válido y domina en velocidad de capital:** win 99%, p5 positivo,
   libera el capital en 16,5 días vs 42,7 → $/día 1,5 vs 1,0. Cobra menos por trade (−42%)
   pero rota 2,6× más rápido — con la regla de 1 posición por símbolo, permite tomar más
   señales del año.
3. **Decisión adoptada: política B (50% profit target, SIN salida forzada por DTE).** Las
   salidas defensivas siguen siendo `hard_defense` (no testeada acá — requiere sim de triggers
   intradía de delta, pendiente).
4. Matiz de fricción: se cobró fricción completa a todas las políticas; hold-to-exp con
   expiración worthless paga menos cierre → A está levemente subestimada. No cambia el orden.

### BT-5 — Escalera de atribución por capas (¿qué protección paga?)

Correr la estrategia incrementalmente y medir cada escalón contra el anterior:

```
(a) vender pelado           (solo cascada de strikes + piso 1/3)
(b) + alpha_gate            (VRP ≥ vrp_min)
(c) + gamma                 (GEX+ & spot > ZGL — soporte de dealers)
(d) + cola                  (tail_risk_score / veto de estrés)
(e) + anti-correlación      (veto SPY/QQQ mismo lado)
```

| | |
|---|---|
| **Qué calcular** | Por escalón: retorno ajustado por riesgo, peor día/semana, peor trade, peor racha, ocurrencias perdidas |
| **Dato necesario** | Todo el dataset (cadenas + GEX reconstruido + tail inputs + régimen) |
| **Dónde impacta** | La existencia misma de cada capa. **Principio: podar, no sumar** — si un escalón no mejora el resultado ajustado por riesgo más de lo que cuesta en oportunidades, esa protección es overhead y se saca |
| **Criterio clave (capa de cola)** | Counterfactual: ¿cuántas veces el veto de cola te habría sacado *antes* del peor día? Eso — no el Sharpe — justifica o mata la capa |
| **Pregunta que debe responder sí o sí** | ¿El alpha_gate (IV/RV) por sí solo ya filtra los malos trades, o gamma/cola/anti-correlación aportan por encima? |

**⚙ FIX GEX + PRIMERA CORRIDA BT-5 (2026-07-08):**

**Fix del GEX (prerequisito):**
- Diagnóstico completo del caos de unidades: el JSON declara `Σ OI·gamma·100·spot²·0.01` en $B;
  el backend (`GammaExposureHandler.cs:280`) calcula **sin el ×0.01** y guarda por strike **/1e6
  (millones)** en un campo que se expone como `NetGexBillions` (por eso la API dio −5×10¹⁶).
  Bug de código flaggeado como tarea separada.
- Con la fórmula del JSON sobre 13 años reales: mediana 0,1B, p10 −7,6B, p90 +7,3B → **el
  umbral 25B/50B es inalcanzable y queda retirado.** Señal recalibrada: **`GEX ≥ 0`**
  (dealers long gamma = amortiguan; <0 = amplifican).
- **Validación 15/15:** en TODOS los episodios BT-0 el GEX reconstruido era **negativo en D0**.
  La tesis original de GaleCore (gamma como soporte) confirmada con 13 años de datos.

**La escalera (señales-día, P&L hold neto):**

| Capa | n/año | win% | avg$ | p5$ | p1$ | pérdidas >$200 |
|---|---|---|---|---|---|---|
| L0 pelado (PCS mecánico) | 207 | 91,9 | 17,1 | −434 | −454 | 195 |
| L1 +alpha (VRP≥1.2) | 82 | 93,8 | 24,2 | −305 | −457 | 58 |
| L2 +régimen/cola | 51 | 94,7 | 25,5 | −138 | −460 | 31 |
| L3 +edge≥barra | 21 | 97,8 | 46,2 | +50 | −445 | 5 |
| **L4 +gamma (GEX≥0)** | **10** | **99,2** | **50,9** | **+49** | **+46** | **1** |

1. **Toda capa paga:** avg monótono 17→51; las pérdidas grandes colapsan 195→58→31→5→1.
   Respuesta a la pregunta del feedback: el alpha_gate solo NO alcanza (58 pérdidas grandes);
   régimen, edge y gamma aportan cada uno por encima.
2. **Counterfactual 2015 (la única pérdida del portfolio sim):** las dos entradas de agosto
   2015 tenían **GEX negativo** (−0,95B / −3,59B) → **la capa gamma las filtra.** Queda UNA
   pérdida grande en 13 años (30-nov-2015, GEX +0,15B marginal). Con L4, hasta el **p1 es
   positivo**.
3. **El costo de la capa gamma, explícito:** halvea las ocurrencias (21→10/año) y el P&L total
   (12.330→6.766) para eliminar 4 de 5 pérdidas de cola. Por mandato safety-first se adopta
   como veto; es la capa más cara en ocurrencias — si alguna vez se poda algo, es la primera
   candidata a re-examen con más datos.
4. **Caveat mayor:** la escalera completa es in-sample con 5 capas ajustadas sobre los mismos
   13 años — el riesgo de sobreajuste del feedback (2.3) aplica con fuerza. Walk-forward
   obligatorio antes de cualquier `enabled:true`.
5. Escalón (e) anti-correlación: pendiente (requiere réplica QQQ — BT-6).

### BT-6 — Veto de correlación SPY/QQQ

| | |
|---|---|
| **Qué calcular** | Correlación rodante SPY/QQQ; P&L de cartera con 2 posiciones mismo lado vs. 1 sola (la de mayor score); drawdown conjunto en shocks |
| **Dato necesario** | OHLC (gratis) + trades simulados de BT-5 |
| **Dónde impacta** | Nodo nuevo `correlation_veto` en risk_limits; allocation policy (concentrar vs. repartir) |
| **Criterio** | Si 2 posiciones correlacionadas empeoran el peor-caso sin mejorar el retorno, el veto queda; definir mecanismo (veto duro vs. tope de heat combinado) |

**⚙ RÉPLICA QQQ COMPLETA + PRIMERA CORRIDA BT-6 (2026-07-08):**

**La réplica confirma el diseño (validación cruzada entre índices):**

| | SPY | QQQ |
|---|---|---|
| Calibración puts (factor ITM/delta en zona) | 0,44–0,58 | 0,50–0,62 |
| Calibración calls | 1,46–1,59 | 1,49–1,65 |
| edge_emp mediana | 1,11 | 1,12 |
| Gate L3: señales/año · win · avg · p5 | 20,5 · 97,8% · $46,2 · +$50 | 17,3 · 96,0% · $45,8 · +$52 |
| Cartera (1 pos, hold): total · pérdidas | $1.568 · 1 | $1.526 · 1 |

La asimetría put/call, el edge empírico y el gate L3 **replican casi idénticos** en el segundo
índice — el hallazgo de BT-1 no era idiosincrasia de SPY. Cache: `pop_calibration_qqq.parquet`,
`qqq_gex_daily.parquet`, `bt3_trades_qqq.parquet`.

**🔴 PODA: la capa gamma NO paga en QQQ** — en ninguna variante (GEX propio ≥0: avg 45,8→38,8,
pérdidas>200 8→5; GEX de mercado/SPY: 40,6, 6; ambos: p5 se vuelve negativo). Nota estructural:
el GEX de cadena-QQQ (±2B) ignora que el hedging Nasdaq vive también en NDX/futuros. **Decisión:
capa gamma queda para SPY (donde deja 1 pérdida en 13 años con 99,2% win) y `enabled:false`
para QQQ** hasta walk-forward o mejor señal. Primera aplicación real de "podar, no sumar".

**BT-6 — correlación y veto:**
- Subyacentes correlacionan **0,931** diario; pero las señales gated solo coinciden **37%** de
  los días (132 días simultáneos en 13 años ≈ 10/año).
- En esos 132 días: correlación de P&L **−0,05** y **cero días donde ambos pierden**.
- Lectura honesta: **no hay evidencia in-sample de que el veto al mismo lado pague** — porque
  los gates ya esquivan las tormentas donde vivirían las pérdidas conjuntas. El escenario que
  justifica el veto (crash que mata ambos a la vez) es exactamente el que la muestra no
  contiene *gracias a* los gates (que son in-sample).
- Costo del veto medido: ~10 señales/año del segundo índice renunciadas (menos en cartera real
  por ocupación). **Decisión pendiente del operador:** mantener el veto como seguro de cola por
  principio (costo modesto, beneficio no medible in-sample) vs. relajarlo a "ambos permitidos
  si ambos pasan todos los gates". Safety-first sugiere mantener; el dato no lo exige.

**⚙ TEST OUT-OF-FAMILY: IWM (2026-07-08) — VEREDICTO: NO ENTRA AL UNIVERSO, y la validación
fue oro:**

1. **La calibración IWM CONFIRMA la explicación por drift del hallazgo BT-1:** en IWM (sin el
   drift persistente de large caps) el delta es casi honesto — puts 0,52–0,87 (sesgo mucho
   menor que SPY) y **calls 0,81–1,16 (≈ justo, sin la subestimación 1,5× de SPY/QQQ)**. La
   "mentira del delta" no es universal: es hija del drift del subyacente. Esto **endurece el
   caveat** sobre la calibración put de SPY/QQQ: si el drift cambia, el factor cambia — el
   walk-forward debe monitorearlo por ventana.
2. **La fricción IWM es 2× SPY:** bid-ask 2,44% del mid (vs 0,61%) → ~$13,3/contrato.
3. **Ancho $5:** edge_emp mediana 0,87 (<1) — la prima small-cap no es rica (VRP fino, como se
   sospechaba). L1/L2 con avg NEGATIVO (vender puts IWM neto de fricción no pagó). El gate L3
   deja solo **1,6 señales/año** (21 en 13 años — eso sí: 95% win, sin pérdidas grandes,
   p5 +$60). El sistema correctamente casi nunca encuentra trade en IWM.
4. **Ancho $2 (la promesa de granularidad): REFUTADA por fricción** — $13,3 sobre crédito
   ~$29 = 45% del crédito; cartera 13 años en **negativo** (−$181). La granularidad fina
   existe pero la microestructura se la come.
5. **Overlap:** IWM aporta solo 0,8 señales/año propias. No mitiga el régimen-cero.
6. **Decisión:** IWM queda **fuera del universo operable** (regla SPY/QQQ intacta). Su valor
   fue diagnóstico: los gates rechazan solos un mercado sin prima rica — el sistema funcionando
   fuera de su hábitat. Cache: `pop_calibration_iwm.parquet`, `bt3_trades_iwm.parquet`.

### BT-7 — Secuencia y riesgo de ruina (validación path-level)

| | |
|---|---|
| **Qué calcular** | Sobre la configuración ganadora: distribución de colas — peor día, peor semana, peor trade individual, peor racha, riesgo de ruina dado el sizing (1%/trade, heat 3%) |
| **Dato necesario** | Los mismos trades de BT-3/BT-5, evaluados en secuencia real (no promediada) |
| **Dónde impacta** | `risk_limits` (sizing, heat) y la viabilidad global. En venta de prima la distribución tiene sesgo negativo: el número que decide si seguís vivo no es el drawdown promedio, es el peor caso |
| **Criterio** | Una curva con buen Sharpe y un día de −40% es **inoperable**. El sizing debe sobrevivir a la peor secuencia histórica con margen |

**⚙ PRIMERA CORRIDA BT-7 + BT-8 (2026-07-08) — cartera realista: 1 posición SPY por vez,
entrada en señal gated, gestión B (50%), 1 contrato:**

1. **Compresión de señales (BT-8 por ocupación):** 304 señales-día → **68 trades reales =
   5,2/año**. La ocupación de la posición (17 días promedio) hace el 80% del trabajo del
   cooldown; el δ de histéresis queda como refinamiento menor.
2. **Secuencia (BT-7): 1 sola pérdida en 13 años** (flash crash ago-2015, −$446 = max loss
   pleno). Peor racha: 1. Max drawdown de equity = ese único trade = **4,5% del Net Liq $10k**
   (dentro del tope de 5%; por encima del target 3,5% — el ancho $5 con crédito fino da max
   loss ~$445). Años negativos: 1 de 11 con trades.
3. **Win 98,5% | avg $23/trade | total $1.568 en 13 años con 1 contrato ≈ $120/año.** Sobre
   $10k: **~1,2% anual con 1 contrato** — la escala honesta del sistema a este capital. El edge
   es real pero chico en dólares absolutos: es un sistema safety-first de renta chica, no una
   máquina de yield. Escala linealmente con contratos (capital).
4. **Régimen-cero MEDIDO:** espera mediana entre entradas 36 días; p90 154 días; **máxima 803
   días** (2017–2018: vol baja sin VRP — cero trades en dos años). La pregunta abierta de la
   definición (§6.2 del feedback ronda 1) ahora tiene número: el sistema pasa años esperando
   por diseño.
5. Ocupación del capital: en posición ~35% de los días. El colchón está ocioso el 65% del
   tiempo — coherente con "el capital ocioso es defensa".

### BT-8 — Cooldown / histéresis del edge

| | |
|---|---|
| **Qué calcular** | Frecuencia de re-cruces del edge alrededor de `min_edge` (oscilación de prima); efecto de distintos δ de histéresis (`re-armar solo si edge < min_edge − δ`) sobre señales duplicadas |
| **Dato necesario** | Serie de edge diaria (de cadenas EOD; ideal muestreo intradía, aceptable EOD para v0) |
| **Dónde impacta** | Nodo nuevo `cooldown` — anclado a prima normalizada, no a timer fijo |
| **Criterio** | El δ mínimo que elimina >90% de las señales duplicadas sin retrasar materialmente las entradas genuinas |

---

### BT-9 — Walk-forward (ESPECIFICACIÓN PRE-DECLARADA — escrita 2026-07-09 ANTES de correr)

**Esquema:** ventana expansiva, recalibración anual. Calibrar 2013→(Y−1), operar Y congelado.
Primera: 2013–2017 → OOS 2018. Última: 2013–2024 → OOS 2025. **8 años OOS** (incluyen
Volmageddon, Q4-2018, COVID, bear 2022, ago-2024, mar-2025). SPY + QQQ pooled.

**Se recalibra por ventana:** SOLO la tabla POP de puts (por bucket), usando exclusivamente
contratos con **vencimiento ≤ corte** (guardia anti-lookahead: un trade entrado en nov-(Y−1)
que vence en ene-Y no existe para la calibración de Y).

**Congelado (arquitectura):** gates y su orden, flags de régimen (VIX 30/40, TS, RoC 12%),
`vrp_min = 1.2`, gestión, fricción, GEX≥0 (solo SPY), muro-sanidad, y **las barras min_edge
(1.05 normal / 1.10 resto)**. Advertencia de leakage declarada: las barras se eligieron con
barrido full-sample → se corre **sensibilidad con barras ±0.05** (1.00/1.05/1.10 base y
desplazadas) para verificar que el veredicto no dependa del valor fiteado.

**Criterios de éxito (definidos ahora, inamovibles):**
- **C1** — Agregado OOS pooled (8 años, 2 símbolos, nivel señal-día): avg neto > 0 Y win ≥ 90%.
- **C2** — El gate separa OOS: avg de seleccionados > avg de rechazados en el agregado pooled.
- **C3** — Ninguna ventana OOS con suma < −$700 por símbolo (≈1,5 max losses; lo peor
  in-sample fue −$400).
- **C4** — Estabilidad de calibración: el factor put de zona (buckets 0.15–0.25) varía ≤ ±0.15
  absoluto entre ventanas consecutivas. Si falla C4, la tabla es inestable y el colchón de
  incertidumbre debe absorber el gap medido (no invalida C1–C3, pero condiciona el diseño).
- Veredicto: **C1+C2+C3 aprueban → habilita discusión de `enabled:true` (paper)**. Cualquier
  fallo → se reporta tal cual, sin re-tocar barras ni criterios después de visto el resultado.

**Nota:** el test de transferencia de régimen queda embebido (calibración 2013–2017 ≈ calma →
OOS 2018 = dos shocks; calibración pre-2020 → OOS COVID; pre-2022 → OOS bear).

**⚙ RESULTADO (2026-07-09, corrido inmediatamente después de pre-declarar): VEREDICTO REPROBADO.**

| Criterio | Resultado | Detalle |
|---|---|---|
| C1 (avg>0, win≥90%) | ✅ pasa (justo) | avg $13,31 · win 90,4% — degradado desde $43-46 / 97%+ in-sample |
| C2 (gate separa) | ⚠️ pasa (trivial) | sel $13,31 vs rech $12,60 — la separación 3× in-sample casi desapareció OOS |
| **C3 (sin ventana < −$700)** | **❌ FALLA** | **2018: SPY −$5.496 / QQQ −$4.743** (win 52-58%); 2020 y QQQ-2024 también negativas |
| **C4 (factor estable ±0.15)** | **❌ FALLA** | saltos de 0,17 (2018→19) y 0,27 (2022→23); factor deriva 0,33→0,61 entre ventanas |

**El mecanismo de la falla (el hallazgo central):** la calibración 2013–2017 (años calmos de
drift) aprendió factor put 0,33 ("el delta miente 3×") → infló el edge de 2018 → el gate
disparó masivamente hacia Volmageddon y Q4-2018 en los días en que los flags de régimen
estaban apagados. **La tabla de calibración tiene la misma enfermedad de lag que el RV30**:
aprende del pasado calmo y miente en la transición — el espejismo del estimador, un nivel
meta más arriba. Es exactamente lo que el test IWM advirtió (calibración hija del drift), ahora
demostrado out-of-time. Corolario devastador y honesto: **buena parte del resultado in-sample
"perfecto" provenía de que la calibración full-sample ya conocía 2018/2022.**

**Consecuencias (conforme a la spec, sin retocar nada post-resultado):**
1. **`enabled:true` NEGADO.** El sistema como está calibrado no se habilita ni en paper con
   pretensión de validez.
2. La sensibilidad de barras (±0.05) no altera el veredicto — no es un problema de barras,
   es la calibración.
3. Matiz de medición: C3 se midió a nivel señal-día (solapamiento infla la suma); a nivel
   cartera 1-posición la pérdida 2018 sería menor pero múltiple — el veredicto no cambia.
4. **Camino siguiente (a diseñar como hipótesis NUEVA pre-declarada, y re-walk-forwardear):**
   calibración POP conservadora con piso anti-lag (ej. `p_loss = max(p_empírica, α·delta)` con
   α ~0,7–0,8), y/o calibración condicional al régimen (tabla de años-stress cuando hay señales
   de alerta), y/o activar los checks de cola dormidos (SKEW/VVIX/HY) que podrían haber
   cerrado 2018 antes. NADA de esto se prueba "hasta que pase" — una sola iteración
   pre-declarada, o el walk-forward pierde su valor.

### BT-9b — Iteración 2 (H2): ESPECIFICACIÓN PRE-DECLARADA (2026-07-09, antes de correr)

**Cambio 1 — Shrinkage 50% hacia el delta (sin parámetro libre):**
```
p_pérdida = ( |delta| + p_empírica_trailing ) / 2
```
Principio de ignorancia: a mitad de camino entre lo que pricea el mercado (risk-neutral) y lo
que realizó la historia. La tabla empírica solo puede acreditar la MITAD del beneficio del
drift — nunca el total, porque el drift no es conocible ex ante (lección de IWM + BT-9).
El 50% se fija por simetría, no por tuning; se declara y no se toca.

**Cambio 2 — Activar tail_risk_score con los umbrales propios de v2.1.5 (no fiteados):**
- Ángulos históricamente disponibles: **VVIX nivel** (warn ≥110 / block ≥130, CBOE) y
  **skew 25Δ RoC 5d** (warn ≥5% / block ≥8%; skew = IV_put25Δ / IV_ATM de nuestras cadenas
  SPY, DTE 25–35). HY OAS excluido: FRED restringió las series ICE a ~3 años (no cubre
  2018/2020); put_call_flow sin histórico.
- Puntos none/warn/block = 0/1/2; **score ≥ 2 → engine_out** (mapeo conservador del
  `degrade_to_caution_min: 2` de v2.1.5 a nuestro proxy binario). Score de mercado (SPY),
  aplica a ambos símbolos. Mismo suavizado de rachas (huecos ≤2d).

**Sin otros cambios:** mismas ventanas, mismas barras congeladas (1.05/1.10), mismos gates,
misma fricción. **Mismos criterios C1–C3.** C4 se evalúa sobre el **factor efectivo** usado
(el shrunk `(1+f)/2`), que es lo que realmente entra al edge — umbral ±0.15 sin cambios.

**Compromiso:** esta es LA iteración. Si falla, la conclusión es que la estrategia necesita
replanteo profundo (no más ajustes de calibración), y se reporta así.

**⚙ RESULTADO H2 (2026-07-09, corrido una vez): VEREDICTO APROBADO — CON LETRA CHICA EXISTENCIAL.**

| Criterio | Resultado |
|---|---|
| C1 (avg>0, win≥90%) | ✅ **avg $91,25 · win 100%** (11/11) |
| C2 (gate separa) | ✅ **$91,25 vs $12,47 — separación 7×** (en BT-9 era 1,06×) |
| C3 (sin ventana < −$700) | ✅ peor ventana: $0 — **2018 quedó completamente cerrado** (0 señales) |
| C4 (factor efectivo ±0.15) | ✅ máx salto 0,135 — el shrinkage estabiliza la calibración |

**La letra chica:** el sistema que sobrevive al walk-forward dispara **11 señales en 8 años OOS
× 2 símbolos ≈ 0,7 señales/año por símbolo** (~1 trade/año el libro entero tras compresión).
El engine_out sube a 42,1% de los días (tail score activo). P&L OOS total: ~$1.000 en 8 años
con 1 contrato. **La versión honesta y segura de la estrategia existe, gana siempre que
opera (100% win, p5 +$70), y casi nunca opera.**

**Lecturas:**
1. Formalmente: H2 habilita la discusión de `enabled:true` en paper — todos los criterios
   pre-declarados pasan, la calibración es estable, el gate OOS separa de verdad.
2. Estratégicamente: el régimen-cero no es un caso borde — es el estado normal. La renta a
   este nivel de seguridad es ~$100-250/año total. La pregunta pasa de "¿funciona?" (sí) a
   "¿el negocio justifica la infraestructura?" — decisión de negocio, no de backtest.
3. Palancas legítimas para subir ocurrencia SIN romper la disciplina: más capital (escala
   lineal por contrato), más subyacentes validados (cada uno con su réplica + walk-forward),
   o una calibración condicional al régimen más fina — que sería un NUEVO ciclo de research
   con nueva pre-declaración, no un ajuste de esta.
4. El compromiso se cumplió: una iteración, corrida una vez, reportada tal cual.

### BT-10 — Descomposición del colapso de ocurrencia H2 (2026-07-10)

**Motivación:** H2 aprobó el walk-forward pero dispara ~0,7 señales/año. BT-9b metió dos cambios
a la vez (shrinkage 50% + tail_score) sin medir el aporte de cada uno al colapso de ocurrencia
(~10/año in-sample → ~0,4/año OOS en SPY). Se corrió la misma maquinaria walk-forward (ventana
expansiva, calibración put anti-lookahead, barras congeladas, gates congelados) en variantes
aisladas, SPY OOS 2018–2025, nivel señal-día, hold neto.

| Variante | señ/año | win% | avg$ | 2018$ | peor año$ |
|---|---|---|---|---|---|
| V0 trailing puro (=BT-9) | 26,2 | 90,5 | 6,2 | −4.103 | −4.103 |
| V2 trailing + tail_score | 21,5 | 91,9 | 9,9 | −2.232 | −2.232 |
| V1 shrinkage solo (sin tail) | 0,4 | 100 | 73,7 | 0 | +74 |
| V3 H2 completo | 0,4 | 100 | 73,7 | 0 | +74 |

1. **El colapso de ocurrencia es 100% del shrinkage:** V1 = V3 señal por señal; el tail_score
   no filtra ni una señal marginal una vez puesto el shrinkage (bajo delta 0.20).
2. **El tail_score solo NO salva C3:** con tabla trailing plena deja 2018 en −$2.232 y 2020 en
   −$2.075. Como conmutador de calibración condicional queda pre-refutado a delta 0.20.
3. **Análisis de bloqueador marginal bajo H2:** el edge gate rechaza el 95,1% de los días OOS y
   es el único bloqueador en 191 días (~24/año); régimen 0 días, GEX 2 días. Aritmética: el
   shrinkage impone p_pérdida ≥ |delta|/2 → crédito requerido mediano $0,82 vs $0,62 ofrecido —
   solo 1,5% de los días operables ofrece crédito suficiente. Contrafactual de los bloqueados:
   win 92,7%, avg +$13, pero con 2018 −$2.232 y 2020 −$2.222 adentro.
4. **🐛 ERRATUM BT-9:** la corrida original NO aplicó el piso anti-pennies (ratio ≥10% =
   crédito ≥ $0,50) que BT-3 run-2 ya había adoptado — solo corrió `credit_min` $0,30. Con el
   piso puesto, 2018 se reduce 4,5× (−$903) y win sube a 94%. No cambia veredictos (2020 −$1.776
   sigue violando C3; H2 da idéntico con o sin piso), pero corrige la narrativa: el "disparo
   masivo hacia Volmageddon" fue en gran parte créditos de centavos ya prohibidos por diseño.
5. Nota de reproducción: la reconstrucción aproxima BT-9 (2018: −$4.103/win 60% vs −$5.496/52–58%
   reportado) — mecanismo idéntico, diferencia residual por detalles de tabla/series.

### BT-10b — Scan exploratorio de fuentes de prima desde ARMED (2026-07-10 — EXPLORATORIO)

Sobre los 194 días OOS operables (todos los gates menos edge), 4 familias de hipótesis con
pagador económico identificado ex-ante. **Estatus: exploratorio — genera hipótesis, no habilita.**

- **Resaca post-stress (CONFIRMADA direccional):** RV30 cayendo fuerte (Δ10d en los 2 cuartiles
  inferiores) = 100% win, avg $51, cero días del cluster 2018/2020. La zona de peligro es RV
  *plana* (calma-espejismo), no RV subiendo (esa ya la corta el VRP).
- **VRP como trigger tiene techo:** banda 1,20–1,25 = 100% win / cero cluster; VRP >1,55 = el
  peor cuartil. VRP extremo en entorno verde es espejismo de denominador, medido. (Idem IV
  percentil: banda media p16–p51 perfecta; extremos malos — la banda IVR de Tastytrade reaparece
  como *conditioner* de trigger, no como gate.)
- **Skew nivel (REFUTADA):** forma de U sin hipótesis causal; no se adopta.
- **Pinning GEX-magnitud (DÉBIL):** no monótona; no se adopta.
- Counterfactuales de calibración condicional simple (tabla plena si condición): **todos fallan
  C3** (peor-año ≤ −$1.395). Un conmutador solo no alcanza a delta 0.20.

**Hallazgo central — el delta (opción c de BT-3, nunca corrida):** reconstrucción de PCS a
delta 0.25/0.30 desde cadenas crudas (réplica sanity delta-0.20 vs cache: corr crédito 1,000),
mismo pipeline walk-forward, OOS 2018–2025 SPY:

| Config (trailing sin shrinkage, tail activo) | señ/año | win% | avg$ | total 8a | peor año |
|---|---|---|---|---|---|
| delta 0.20 | 21,4 | 91,8 | 9,6 | 1.644 | −2.232 → **C3 falla** |
| delta 0.25 | 17,8 | 93,0 | 38,6 | 5.482 | −559 → pasa pero **frágil a barras** (−0.05 → −$1.829) |
| **delta 0.30** | **14,4** | **93,9** | **60,4** | **6.951** | **−385 → C3 pasa, robusto ±0.05** |

- A 0.30: C2 separa fuerte ($60,4 vs −$16,5 rechazadas); 2018 −$160; 2020 **+$1.996** (cobra la
  resaca sola); **el tail_score se vuelve load-bearing** (sin él 2018 = −$2.605 → C3 falla).
  El shrinkage a 0.30 sigue matando todo (edge mediano 0,79) — la palanca es el delta, no la
  calibración.
- Explicación económica: en el wing lejano el precio es casi puro premio de crash (probabilidad
  inestimable — el empate que el shrinkage declara); cerca del dinero domina la vol realizada
  estimable: factor empírico/delta sube 0,33→~0,5–0,6, crédito mediano $0,57→$0,92.
- Caveats: hold-to-exp (falta gestión B); C4-style inestabilidad persiste (saltos 0,16–0,19);
  **conflicto de diseño: `hard_defense` (delta short >0.30) dispararía en la entrada** —
  gestión defensiva a redefinir antes de adoptar; win 93,9% pasa C1 con menos margen.

### BT-10c — Iteración 3 (H3, delta 0.30): ESPECIFICACIÓN PRE-DECLARADA (2026-07-10, antes de correr)

**Estatus de superficies:** SPY queda **contaminado por el scan** (sus números arriba son
exploratorios). La superficie de confirmación fresca es **QQQ OOS 2018–2025**, no tocada por el
scan. Excepción puntual a la directiva solo-SPY autorizada 2026-07-10, únicamente como
validación out-of-family (mismo rol que IWM en BT-6).

**Pipeline (congelado):**
- PCS QQQ: expiración DTE∈[35,50] más cercana a 45; short put = |delta| más cercano a 0.30;
  long = short − $5; crédito = mark_short − mark_long > 0; hold a vencimiento; fricción $6,30.
- Edge: `(crédito/5) / p_trailing` — tabla empírica put **sin shrinkage**, ventana expansiva
  anual, solo vencimientos ≤ corte, buckets n≥50, interpolación lineal (obs QQQ propias).
- Gates congelados: régimen operable ∧ VRP≥1.2 ∧ short ≤ put_wall ∧ crédito ≥ $0,30 ∧
  tail_score de mercado (SPY: VVIX 110/130 + skew25 RoC5d 5%/8%, score≥2 → out, huecos ≤2d) —
  **sin capa GEX** (per BT-6: gamma `enabled:false` en QQQ). Barras: 1,05 normal / 1,10
  low_vol y elevated / 1,20 caution.
- **Criterios (inamovibles, por año-ventana):** C1 avg>0 ∧ win≥90% · C2 avg seleccionadas >
  avg rechazadas-por-edge · C3 ninguna ventana anual < −$700 · C4 factor efectivo (mediana
  p_trail/|delta| por ventana) varía ≤ ±0,15 entre ventanas consecutivas (su falla condiciona
  el diseño, no invalida C1–C3) · Robustez: el veredicto C3 no debe flipear con barras ±0,05.
- **Compromiso:** una corrida, sin retoques. Si QQQ falla → el hallazgo delta-0.30 se degrada a
  idiosincrasia de SPY y no se adopta sin un ciclo nuevo. Si pasa → habilita la discusión de
  rediseño (gestión defensiva para deltas 0.30, gestión B, merge JSON) antes de cualquier
  `enabled:true`.

**⚙ RESULTADO H3 (2026-07-10, corrido una vez sobre QQQ): VEREDICTO APROBADO — con C4 en falla
declarada y margen fino en C1.**

| Criterio | Resultado |
|---|---|
| C1 (avg>0, win≥90%) | ✅ **avg $59,11 · win 90,6%** — pasa al filo (margen 0,6pp) |
| C2 (gate separa) | ✅ seleccionadas $59,1 vs rechazadas $30,7 (n=117 vs 62) |
| C3 (sin año < −$700) | ✅ peor año: **2018 −$513**; 2022 correctamente en cero señales |
| C4 (saltos factor ≤0,15) | ❌ salto máx **0,215** (2018→19); factor deriva 0,43→0,73 |
| Robustez barras ±0,05 | ✅ C3 pasa en las tres (peor-año −$513 idéntico) |

- **14,6 señales/año, total $6.916 en 8 años** — réplica cruzada casi idéntica al scan SPY
  (14,4/año, avg $60,4): el hallazgo no es idiosincrasia de un índice.
- **La letra chica de C4:** el shrinkage era lo que estabilizaba la calibración en H2; H3
  renuncia a él y la inestabilidad vuelve (como en BT-9). Las barras robustas la absorben en
  esta muestra, pero el diseño queda condicionado: el factor de calibración se monitorea por
  ventana y el colchón de `min_edge` debe cubrir el gap medido (~0,2 de factor).
- Distribución anual grumosa: 2021 concentra 48 de 117 señales; 2019 solo 4. La ocurrencia
  promedio (~14/año) no es un flujo parejo.
- **Consecuencia:** el hallazgo delta-0.30 queda VALIDADO out-of-family. Antes de discutir
  `enabled:true` (paper) faltan, en orden: (a) recalcular con gestión B (50%) path-level,
  (b) redefinir la gestión defensiva (`hard_defense` delta>0.30 dispara en la entrada),
  (c) corrida formal SPY como réplica (sus números de scan coinciden pero quedan marcados
  exploratorios), (d) merge JSON-first de los nodos nuevos (`delta_target` 0.30, edge trailing,
  tail_score, sin shrinkage) `enabled:false`.

**⚙ (a) GESTIÓN B PATH-LEVEL sobre H3 (2026-07-10) — mejora todos los márgenes de criterio.**
MTM diario EOD de las señales gated OOS; política BT-4-B exacta (cierre al valor observado
cuando el spread ≤ 50% del crédito, sin salida por DTE; fricción $6,30 en ambas políticas —
A levemente subestimada, mismo caveat BT-4). La corrida SPY a nivel hold reproduce el scan
exacto (n=115, avg $60,4 ✓), lo que de paso formaliza la réplica del punto (c):

| | win% | avg$ | total$ | p5$ | días | $/día | peor año |
|---|---|---|---|---|---|---|---|
| QQQ A hold | 90,6 | 59,1 | 6.916 | −390 | 42,7 | 1,38 | −513 (2018) |
| **QQQ B 50%** | **97,4** | 47,7 | 5.577 | **+41** | **17,6** | **2,71** | **−83 (2018)** |
| SPY A hold | 93,9 | 60,4 | 6.951 | −118 | 42,9 | 1,41 | −385 (2022) |
| **SPY B 50%** | **96,5** | 35,5 | 4.080 | **+32** | **21,0** | 1,69 | −449 (2018) |

1. **C1 y C3 pasan bajo B en ambos índices, con márgenes mucho más holgados:** el filo de C1
   en QQQ (90,6%) desaparece (97,4%); el peor año QQQ pasa de −$513 a **−$83**; p5 POSITIVO en
   ambos. El patrón BT-4 se repite en el nuevo delta: B cobra menos por trade (−20/−40%) pero
   rota el capital ~2× más rápido y arregla la cola.
2. El 96–97% de las señales alcanza el profit target; la ocupación baja de ~43 a ~18–21 días —
   con la regla de 1 posición por símbolo, en cartera real B permite tomar más señales del año
   (mismo argumento BT-7).
3. Matiz: algún año individual empeora bajo B (SPY 2018 −$160→−$449) porque los ganadores
   cobran la mitad mientras los perdedores no cambian — el criterio C3 sigue pasando.
4. **Pendiente (a) CERRADO. La config de referencia de H3 pasa a ser: delta 0.30 + trailing +
   tail_score + gestión B.** Siguen (b) hard_defense, (d) merge JSON.

### BT-11 — Motor de estructuras (IC/PCS/CCS) con config H3: ESPECIFICACIÓN PRE-DECLARADA (2026-07-10, antes de correr)

**Pregunta:** el sistema desplegado sugiere estructura vía `structure_selection` (multi_factor).
Todo lo validado hasta hoy es PCS. ¿El motor de estructuras, congelado tal como está en el JSON,
mejora o degrada la config de referencia H3 (delta 0.30 + trailing + tail_score + gestión B)?

**Advertencias de honestidad (declaradas antes de correr):**
- **No queda superficie virgen** — SPY y QQQ 2018–2025 ya fueron usados (scan + BT-10c). El
  veredicto habilita a lo sumo paper. Ventana reutilizada, declarado.
- Los umbrales del motor (neutral_z 1.0, extreme_z 1.5, cortes gex_skew 0.6/0.4, trend
  0.002) son priors de diseño jamás calibrados: se toman **congelados**. Si falla, la
  conclusión es "el motor como está no paga" — no se prueban otros umbrales.
- **Sin flow histórico las reglas 2–5 no pueden matchear** (lectura estricta): el motor
  efectivo es regla 1 (|z|<1 ∧ skew simétrico → IC), 6 (z>1.5 ∧ simétrico ∧ trend up → PCS),
  7 (z<−1.5 ∧ simétrico ∧ down → CCS), 8 (fallthrough → no_trade).
- Expectativa previa registrada: la tabla trailing de calls (lag conservador: años alcistas
  enseñan "calls peligrosos") puede dejar el edge de IC/CCS bajo — "PCS-only era la respuesta"
  es un resultado posible y válido.

**Pipeline congelado:**
- Inputs del motor reconstruidos con las fórmulas del JSON: `zscore = ret5d_log/(atm_iv/√252)`;
  `gex_skew = callGEX/(callGEX+|putGEX|)` de cadenas (OI×gamma, DTE<90) con cortes 0.6/0.4;
  `trend` EMA20/50 (neutral <0.2%). Estructura del día = primera regla que matchea.
- Legs delta 0.30 espejado (short put 0.30 / short call 0.30), ancho $5 por lado; IC = ambos.
  Restricción de sanidad ambos muros (`short_put ≤ put_wall`, `short_call ≥ call_wall`).
  Ex-div SPY: block CCS con ex-dividend ≤3 días (fechas de `dividend_amount`); IC sin block
  (la regla del JSON aplica a CCS, se toma como está).
- Edge con tabla trailing **por lado** (obs de calls a construir con la misma metodología
  anti-lookahead que puts, DTE 30–50, buckets n≥50). Para IC (pérdidas mutuamente
  excluyentes al vencimiento): `edge_IC = (crédito_total/ancho) / (p_put + p_call)`.
- Fricción: $6,30 spreads / $12,60 IC (2×). Crédito mínimo total $0,30. Gates de entorno y
  barras idénticos a H3 (GEX≥0 solo SPY). Gestión B path-level sobre el crédito total.
- **Criterios:** C1–C4 + robustez de barras ±0,05, idénticos a BT-10c, sobre el flujo de
  señales del motor completo. **Vara adicional (la pregunta del test):** contra el baseline
  PCS-only H3+B, el motor no debe degradar C3 y debe mejorar ocurrencia o total neto.
  SPY principal, QQQ réplica. **Una corrida, sin retoques.** Si falla → producción PCS-only,
  IC/CCS quedan `enabled:false`, y el motor pasa a re-diseño con ciclo nuevo.

**⚙ RESULTADO BT-11 (2026-07-10, corrido una vez): VEREDICTO REPROBADO — el motor de
estructuras, como está, degrada el sistema en vez de mejorarlo.**

| | señ/año | win% (B) | avg$ (B) | total 8a (B) | peor año (B) |
|---|---|---|---|---|---|
| Baseline PCS-only H3+B (SPY) | 14,4 | 96,5 | 35,5 | 4.080 | −449 |
| **Motor BT-11 (SPY)** | **2,2** | 100 | 50,1 | **903** | +42 |
| Baseline PCS-only H3+B (QQQ) | 14,6 | 97,4 | 47,7 | 5.577 | −83 |
| **Motor BT-11 (QQQ)** | **2,9** | **87,0 → C1 FALLA** | 19,5 | **449** | −312 |

1. **IC y CCS no dispararon NI UNA señal en 8 años × 2 símbolos.** Todas las señales
   sobrevivientes son PCS. La causa es aritmética y honesta: la tabla trailing de calls
   confirma OOS el hallazgo BT-1 (factor call ≈ 1,4–1,7 estable en todas las ventanas —
   el delta subestima el riesgo call ~1,5×). Con p honesto, `p_put+p_call ≈ 0,6` a delta
   0.30 espejado → un IC necesitaría crédito ≥ ~$3,15 (63% del ancho) para tener EV>0:
   el mercado no lo ofrece jamás. **El iron condor a probabilidades honestas es
   estructuralmente in-edgeable en estos deltas.** CCS ídem (crédito requerido ~$2,40).
2. **El motor degrada el baseline en toda métrica de flujo:** la regla 1 secuestra los días
   simétricos (la mayoría del entorno ARMED) hacia IC — que nunca puede disparar — y la
   regla 6 raciona el PCS a días con z>1.5 ∧ trend up ∧ skew simétrico: ocurrencia 14,4→2,2
   señales/año (SPY), total $4.080→$903. En QQQ además **C1 falla** (win 87%). La vara
   pre-declarada (no degradar C3, mejorar ocurrencia o total) NO se cumple.
3. **Consecuencia (conforme al compromiso): producción PCS-only.** IC y CCS quedan
   `enabled:false`; `structure_selection` del JSON pasa a re-diseño con ciclo nuevo si se
   quiere revivir. La config validada del sistema sigue siendo: **PCS SPY delta 0.30 +
   trailing puts + tail_score + gestión B** (+ réplica QQQ).
4. Curiosidad registrada NO adoptada (anti data-mining): las 18 señales SPY del motor
   (z>1.5 ∧ trend up ∧ simétrico) dieron 100% win / avg $89 hold — el momentum con muros
   equilibrados como *conditioner* de calidad es hipótesis para un ciclo futuro, no un
   ajuste de este.
5. Activos nuevos del test: `pop_obs_calls_{spy,qqq}.parquet` (calibración call por lado,
   validada estable) y `{sym}_structinputs_daily.parquet` (gex_skew, call_wall, zscore,
   trend históricos). El costo del test fue bajo y el diagnóstico definitivo.
6. Matiz de medición declarado: C2 y la sensibilidad de barras se reportaron parciales
   (P&L de rechazadas IC/CCS no computado) — el veredicto no depende de ellos: la falla es
   por C1 (QQQ) y por la vara de degradación vs baseline, ambas terminales.

### BT-12 — Robustez y monotonía del delta: ESPECIFICACIÓN PRE-DECLARADA (2026-07-10, antes de correr)

**Pregunta:** ¿el delta 0.30 de la config de referencia es una meseta o un pico fiteado?
**Este test NO busca un delta mejor.** Compromiso inamovible: la config queda en 0.30 sea cual
sea el resultado — las únicas ramas son (i) "robusto confirmado" o (ii) "frágil → se re-abre el
ciclo". Migrar el delta por rendimiento observado sería fitting sobre la ventana agotada.

**Pipeline:** idéntico a H3+B (trailing puts anti-lookahead, tail_score, gates congelados,
GEX≥0 solo SPY, gestión B path-level), variando solo el delta objetivo del short put:
**grilla 0.15 / 0.20 / 0.25 / 0.28 / 0.30 / 0.32 / 0.35**. SPY + QQQ, OOS 2018–2025.
C1/C3 se juzgan sobre gestión B (la config de referencia).

**Predicciones escritas antes de correr:**
1. *Meseta:* 0.28 y 0.32 pasan C1/C3 con métricas similares a 0.30. Si solo 0.30 pasa →
   hallazgo frágil, downgrade y re-apertura del ciclo.
2. *Monotonía del mecanismo:* factor de honestidad (p_emp/delta → 1), crédito y ocurrencia
   de cruce de barra crecen con el delta; win% por trade decrece.
3. *Extremos:* 0.15 casi sin señales (pennies + edge inalcanzable); 0.20 falla C3 (ya medido
   a nivel hold: −$2.232 en 2018).
4. Uso colateral: el comportamiento en 0.32–0.35 informa el rediseño de `hard_defense`
   (pendiente b) — perfil de riesgo de la zona a la que deriva una entrada 0.30 testeada.

**Una corrida, sin retoques.**

**⚙ RESULTADO BT-12 (2026-07-10, corrido una vez): ROBUSTO CONFIRMADO — 0.30 es meseta, no
pico. La config queda en 0.30, conforme al compromiso.**

Gestión B (la vara pre-declarada), OOS 2018–2025:

| tgt | SPY: n/año · winB · avgB · peor añoB | QQQ: n/año · winB · avgB · peor añoB |
|---|---|---|
| 0.15 | 20,0 · 99,4% · $17 · −100 | 23,5 · 99,5% · $21 · +177 |
| 0.20 | 21,2 · 98,8% · $22 · −542 | 26,9 · 99,5% · $35 · +412 |
| 0.25 | 17,6 · 97,9% · $33 · −91 | 19,2 · 100% · $44 · +234 |
| **0.28** | 15,2 · 96,7% · $33 · −473 | 16,5 · 98,5% · $46 · +13 |
| **0.30** | 14,4 · 96,5% · $36 · −449 | 14,6 · 97,4% · $48 · −83 |
| **0.32** | 12,1 · 96,9% · $44 · −374 | 13,5 · 94,4% · $44 · −323 |
| 0.35 | 12,5 · 96,0% · $52 · −363 | 13,8 · 92,7% · $43 · −129 |

1. **Predicción 1 (meseta) CONFIRMADA:** 0.28/0.30/0.32 pasan C1 y C3 en ambos índices con
   métricas y patrones anuales casi idénticos. El 0.30 no es un número fiteado.
2. **Predicción 2 (monotonía) parcialmente confirmada, con una inversión:** el factor de
   honestidad sube monótono con el delta (0,44→0,55 SPY; 0,42→0,56 QQQ) y el win% baja,
   como se predijo — pero la **ocurrencia BAJA con el delta** (predije que subía): la tabla
   trailing le ve *más* mispricing relativo al wing lejano, así que los deltas bajos cruzan
   la barra más seguido. Predicción invertida, declarada.
3. **Predicción 3 (extremos mueren) REFUTADA en la dirección informativa:** bajo gestión B,
   0.15 y 0.20 PASAN C1/C3 (QQQ 0.20-B: total $7.424, el mayor de la grilla) — la gestión al
   50% acorta la exposición y esquiva los desastres que a nivel hold los hunden (0.20-hold:
   peor año −$2.232 SPY / −$1.599 QQQ, C3 falla). **Lectura honesta:** el edge de los deltas
   bajos existe solo *a través de la política de gestión* (path-dependent, frágil a fills);
   la meseta 0.28–0.32 pasa en hold Y en B en SPY (QQQ-hold solo 0.30 pasa — fragilidad
   registrada). **NO se adopta 0.20 por su total** — sería el fitting que este test juró no
   hacer; queda registrado como curiosidad para un eventual ciclo futuro.
4. **Insumo para hard_defense (pendiente b):** el deterioro hacia 0.32–0.35 es gradual, sin
   acantilado (win B 96→92,7%; primer p5 negativo recién en QQQ 0.35). Una entrada 0.30 que
   deriva a 0.35 no es todavía una emergencia — el umbral de defensa puede vivir más arriba
   (~0.40–0.45), a calibrar en el rediseño de (b).

### BT-13 — Ciclo exploratorio: monetizar el entorno con otras estructuras (2026-07-11 — EXPLORATORIO)

**Motivación (pregunta del operador):** el entorno medido (gates H3) quedó validado; ¿hay
estructuras distintas al PCS $5 que lo moneticen mejor — long del subyacente, wheel, CSP,
wings anchos, diagonales/calendars? **Estatus: exploratorio en su totalidad** — todo corre
sobre la ventana OOS 2018–2025 agotada y las mismas 115 señales gated H3 SPY (aísla
estructura de señal); genera hipótesis, no habilita nada, la config de referencia no se toca.
Scripts persistidos: `research/backtesting/explore_{armed_spy_long,wheel_csp,wing_width,diagonal,bwb}.py`.

**⚙ (a) ARMED como señal direccional del subyacente — REFUTADA, con hallazgo colateral.**
Long SPY al prenderse ARMED / flat al apagarse (señal EOD, entrada al cierre): CAGR 0,8%
con 11,8% de exposición; días ARMED 2,8bp/día vs 5,6bp/día los OFF (t −0,73). ARMED
selecciona días quietos *por diseño* (GEX+ pinning, VRP alto = realizada pobre) — filtra el
drift a propósito. **Hallazgo colateral (escalera por gate):** las capas de seguridad solas
(régimen operable + tail_score = "L2") SÍ son filtro direccional genuino para un long de
stock: CAGR ~igual a buy&hold con **la mitad del maxDD** (−15,3% vs −34,1%) y Sharpe 1,2
vs 0,8 — validación en el subyacente del lead time de BT-0 (2018: +3,8% vs −6,3%; 2022 casi
no expuesto; costo: pierde las recuperaciones en V, 2019 −1,9% vs +28,8%). GEX≥0 y VRP≥1.2
destruyen el filtro long (exposición 12%, CAGR 0,8%) — correctos para prima, tóxicos para drift.

**⚙ (b) Wheel / cash-secured put — el wing consume el 87% de la prima; la wheel es una CSP
con pasos extra.** Sobre las mismas señales: prima bruta del short $450/señal, PCS-B retiene
$35,5 — **el wing de la misma expiración se lleva ~87% de la prima bruta** (la compra de
premio de crash que BT-10b describió, ahora en P&L). CSP-B: $264/señal (7,4× PCS-B) con peor
año −$644, PERO capital ~$42k/contrato (cash-secured), retorno sobre capital 10× peor que
PCS, y heat incomputable (1 contrato ≈ 100% del NL de referencia $10k; un gap −30% ≈ −$12k =
27× el max loss del PCS). A riesgo constante la CSP muere ($3,1/señal). **Wheel:** solo 6,1%
de las señales expira ITM → la fase covered-call es anecdótica (n=3 episodios en cartera
secuencial); lo poco visible confirma la calibración de calls (la clásica vendió CC delta
0.30 en el crash 2018 y cristalizó −$2.739; la variante env-aware esperó y terminó mejor:
$11.4k vs $9.9k en 8 años). **Desaconsejada por diseño:** la pata CC vende el lado que la
calibración midió subvaluado (factor call 1,4–1,7×) y la asignación viola dos reglas duras
(long direccional, riesgo indefinido). **Libro combinado (la vía que no rompe nada):**
L2-long SPY + overlay PCS-B en ARMED = CAGR 12,83% / Sharpe 1,24 / maxDD −14,9% (vs B&H
12,47 / 0,70 / −34,1); ocupación del capital ~35%→~70%.

**⚙ (c) Ancho del wing — el ranking se invierte con la vara; la config de referencia queda
reivindicada.** Por señal (1 contrato) ensanchar paga más: $5→$35,5 · $10→$67,5 · $20→$132 ·
wing d0.10→$164 · CSP→$264 (captura 19/33/53/67/100% de la prima bruta). **A riesgo
constante ($500 max loss — la métrica del heat) gana el $5:** $43,8/señal y $5.034 total vs
$40,8/$4.491 ($10), $38,4/$3.687 ($20), $29,7/$3.411 (d0.10), $3,1/$357 (CSP). El 87% que se
lleva el wing es compensación exacta por el riesgo que absorbe, no plata regalada. El $10
queda dominado por el $5; el wing d0.10 dominado por el $20; **el $20 es el único dial
no-dominado: −27% de total a cambio de peor-año 5× mejor (−$98 vs −$541)** — suavidad, no
rentabilidad. Implicación para §7.4 de la definición: al crecer el NL, desplegar más riesgo
por señal con **más contratos de $5** (mejor retorno por heat), no con wings anchos — salvo
preferencia explícita de suavidad de cola (→ $20).

**⚙ (d) Diagonales / calendar (short adelante) — convexidad CONFIRMADA, familia REPROBADA
como reemplazo.** La variante "calendar de venta" estricta (vender el vencimiento largo)
queda descartada sin test: al vencer el front deja naked short (prohibido). Testeadas con
short 45d delta-0.30 y long ~90d, un ciclo por señal sin rolls, salida al vencimiento del
front con marks reales:

| Variante | cnet | win% hold | avg$/señal | riesgo cte $500: total 8a | peor año |
|---|---|---|---|---|---|
| PCS $5 (ref) | +$0,93 | 93,9 | $60 | $8.532 | −$508 (2022) |
| D1 diag K−5 ~90d | −$3,27 (débito) | 55,6 | $107 | $5.484 | −$455 (2019) |
| D2 diag d0.10 ~90d | +$2,16 | 98,3 | $289 | $3.415 | **−$7 (2018)** |
| D3 calendar mismo K | −$4,44 (débito) | 48,5 | $78 | $5.189 | **−$2.641 (2019)** |

- **Convexidad real y medida:** el wing back-month retiene 47–58% de su costo al vencer el
  front (mecánica √T) y es long vega vivo — los peores trades del PCS se transforman
  (2022-09-12: PCS −$385 vs D1 +$440, D3 +$548); 2020 y 2022 mejores que el PCS en todas
  las variantes.
- **El costo es estructural en NUESTRO entorno:** D1/D3 entran en débito (win ~50%) y
  sangran en los grinds alcistas (2019, 2023) — ARMED tiene pinning *diario* pero drift
  *acumulado* (~1-2%/mes): el spot se escapa de la carpa del calendar en los 45 días del
  ciclo. D3 violaría C3 por paliza. La familia débito está desalineada con el entorno medido.
- **D2 registrada como hipótesis defensiva** (única variante crédito): ningún año perdedor
  a riesgo constante en los 8 OOS, 40% del total del PCS; su max loss nominal ($4.635)
  exagera el riesgo real (el wing a 45d del vencimiento nunca vale cero) — misma salvedad
  que la CSP, en dirección conservadora. No-dominada junto al PCS $20.

**⚙ (e) Put Broken Wing Butterfly — aplicable pero DOMINADA; la carpa tiene un agujero.**
Estructura: long K3=K2+5 / short 2× K2 (delta 0.30 de la ref) / long K1=K2−W, misma
expiración, W ∈ {10,15,20}, crédito neto exigido >0, fricción $12,60 (4 legs).
Descomposición: PCS ancho (K2/K1) + put debit spread (K3/K2). Predicción pre-declarada
(confirmada): menos retorno por unidad de riesgo que el PCS (el debit spread compra la
prima más sobrepreciada de la curva); peores-años mejores.

| Riesgo cte $500, gestión B | total 8a | peor año |
|---|---|---|
| PCS $5 (ref) | $5.034 | −$541 |
| PCS $20 | $3.687 | −$98 |
| D2 diagonal (d) | $3.415 | −$7 |
| BWB +5/−15 | $2.904 | −$10 |
| BWB +5/−20 | $2.646 | **+$18 (ningún año perdedor)** |

- **La suavidad es real y extrema:** la zona de max loss (bajo el ala rota) no se tocó NI
  UNA VEZ en 8 años (ninguna W); la carpa cobra en los peores trades del PCS (2022-09-12:
  −$385 → +$54/+$124; 2024-06: −$400 → +$85/+$134). Carpa alcanzada en 12–14% de las
  señales, avg ~$160.
- **El agujero de la carpa (el hallazgo del test):** la protección es *localizada* — el
  2018-09-18 aterrizó en la parte baja de la carpa y la BWB-15/-20 perdió −$809/−$791,
  **casi 2× el PCS (−$429)**: el peor trade individual de todo el set comparado es de una
  BWB. La estructura no elimina la cola, la redistribuye — protege el selloff moderado y
  castiga el que cae un escalón más profundo. PCS $20 (pérdida gradual) y D2 (vega viva)
  no tienen este perfil.
- Artefacto declarado: la BWB-10 salió a débito en 15 señales (excluidas), concentradas en
  skew empinado (incl. 2018) — auto-filtro accidental de skew que rompe comparabilidad.
- Matiz de gestión: la regla B (50% del crédito neto) dispara TPs muy tempranos en la BWB
  (crédito chico); la gestión natural de una BWB (% de la carpa) sería otro grado de
  libertad — quedó congelado deliberadamente.
- **Veredicto: dominada por D2 y PCS $20 en la frontera retorno/suavidad** (y los números
  de D2 estaban subestimados mientras el max loss de la BWB es real y alcanzable).
  Hipótesis cerrada, mecanismo registrado.

**Conclusión transversal del ciclo:** ninguna estructura supera al PCS $5 en retorno por
unidad de riesgo dentro del entorno medido; las alternativas intercambian retorno por
suavidad de cola (frontera: PCS $20 → D2; la BWB queda tercera y cerrada). Las palancas
reales de rentabilidad quedaron identificadas:
**(i) libro combinado L2-long + overlay PCS** (usa el 65% del capital ocioso sin romper
reglas) y **(ii) escala lineal en contratos** (la respuesta de BT-7). "Más trades" no sale
de cambiar la estructura — consume el mismo flujo de señales.

**Caveats del ciclo:** ventana agotada + señales fijas (sin re-gateo por estructura); sin
dividendos en las patas de stock (subestima wheel y libro combinado ~0,7–1,3%/año);
fricción estimada ($6,30 spread / $3,15 single-leg / $5 asignación; bid-ask del back-month
algo mayor en la realidad); normalización por max loss conservadora para CSP y D2; B-análogo
de las diagonales (TP al 50% de la prima del short) distinto de la regla B del PCS; n
variable (D1/D3 n=99 por strikes faltantes en el back-month; PCS $20 n=96); P&L del overlay
del libro combinado atribuido al día de salida (Sharpe aproximado).

### BT-14 — Libro combinado L2-long + overlay PCS-B: ESPECIFICACIÓN PRE-DECLARADA (2026-07-11, antes de correr)

**Pregunta:** el hallazgo BT-13(a/b) — long del subyacente filtrado por las capas de
seguridad (L2 = régimen operable ∧ ¬tail_out) más el overlay PCS-B H3 en ARMED — ¿sostiene
su ventaja sobre buy&hold una vez puestos: ejecución realista, dividendos, histéresis N=3,
costos de switching y réplica QQQ? Es el único hallazgo del ciclo que ataca el problema de
negocio de H2/H3 (capital ocioso 65%, régimen-cero).

**Advertencias de honestidad (declaradas antes de correr):**
- Ventana reutilizada (2013–2025; OOS 2018–2025 agotada) — el veredicto habilita a lo sumo
  **paper del libro**, nunca real directo.
- A favor de la validez: los flags L2 son priors de seguridad de v2.1.5 (VIX 30, TS, RoC 12%,
  VVIX/skew) **jamás fiteados a retornos de stock** — el filtro direccional emergió como
  subproducto. Mitiga el sobreajuste, no lo elimina (BT-0 los validó sobre esta misma ventana).
- QQQ como superficie de confirmación ya fue usada por BT-10c/11/12 — declarado.
- Aprobar BT-14 abre además una decisión de IDENTIDAD del producto (libro de stock filtrado
  + overlay de prima vs. sistema de prima puro) — decisión de negocio usuario+socio, no de
  backtest.

**Pipeline congelado:**
- **Filtro L2:** régimen operable (flags rápidos v2.1.5) ∧ ¬tail_out_sm (VVIX 110/130 +
  skew25 RoC5d 5%/8%, score≥2, huecos ≤2d; tail de mercado = SPY para ambos símbolos).
  SIN GEX y SIN VRP en la pata stock (BT-13a midió que destruyen el filtro long). Régimen/VRP
  diarios con ffill≤5d sobre huecos del cache; días sin clasificar = OFF.
- **Cuatro variantes de dinámica, todas pre-declaradas** (no se elige la mejor a posteriori;
  la de referencia para el veredicto es V4, la única operable de verdad):
  V1 cierre-mismo-día (=BT-13a) · V2 ejecución a la apertura siguiente · V3 histéresis
  asimétrica N=3 (degradación inmediata, mejora tras 3 recalculaciones consecutivas,
  §6 de la definición) con cierre-mismo-día · **V4 = histéresis N=3 + apertura siguiente**.
- **Retorno total:** dividendos de `{sym}_underlying_prices.parquet` (`dividend_amount`,
  disponible 1999–2025) devengados al ex-date solo si el libro está long; afuera = cash al
  0% (sin devengar tasa — conservador). Slippage stock: 2bp por vía sobre cada switch.
- **Overlay:** señales H3 (delta 0.30 + trailing anti-lookahead + tail + GEX≥0 solo SPY) +
  gestión B, cartera secuencial 1 posición por símbolo, 1 contrato, base $10k. El overlay
  solo existe 2018–2025 (la tabla trailing empieza en 2018); la pata stock se corre
  2013–2025 y el veredicto C1–C4 se evalúa 2018–2025 (ventana común), con 2013–2017
  reportado como contexto.
- **Métricas:** CAGR, Sharpe, maxDD, peor año, nº de switches y costo total de switching,
  días expuesto; descomposición de concentración (contribución por episodio evitado; métricas
  re-computadas excluyendo el episodio de mayor contribución).
- **Criterios (inamovibles):**
  - **C1 (la promesa central, SPY V4, 2018–2025, neto de todo):** maxDD ≤ 2/3 del maxDD de
    B&H **Y** CAGR ≥ CAGR(B&H) − 1,5pp.
  - **C2 (robustez de ejecución):** el veredicto C1 no flipea entre V1/V2/V3/V4.
  - **C3 (no-concentración):** excluyendo el episodio de mayor contribución del filtro, el
    maxDD del libro sigue ≤ 80% del de B&H en la muestra restante.
  - **C4 (réplica):** C1 se sostiene en QQQ (mismos umbrales; overlay sin GEX).
  - **C5 (aditividad del overlay):** agregar el overlay PCS-B no empeora ni maxDD ni Sharpe
    del libro respecto de la pata stock sola, y su P&L 2018–2025 es > 0.
- **Veredicto:** C1–C5 aprueban → habilita la discusión de paper del libro combinado (con la
  decisión de identidad sobre la mesa). Cualquier falla → el libro queda como curiosidad
  documentada y el sistema sigue PCS-only. **Una corrida por variante, sin retoques
  post-resultado.**

**⚙ RESULTADO BT-14 (2026-07-11, corrido una vez): VEREDICTO REPROBADO — el realismo
pre-declarado desarma el hallazgo exploratorio.** Script: `research/backtesting/bt14_run.py`.

| SPY 2018–2025 (total return neto) | CAGR | Sharpe | maxDD | C1 |
|---|---|---|---|---|
| B&H | 14,21% | 0,78 | −33,7% | — |
| V1 cierre-mismo-día (=BT-13a) | 12,73% | 1,28 | −15,3% | ✅ pasa |
| V2 apertura siguiente | 12,25% | 1,24 | −16,2% | ❌ (gap −1,96pp) |
| V3 histéresis+cierre | 7,03% | 0,87 | −18,9% | ❌ |
| **V4 histéresis+apertura (veredicto)** | **8,18%** | 0,99 | −18,8% | ❌ (gap −6,0pp) |

C1 ❌ · C2 ❌ (el veredicto flipea: solo V1 pasa) · **C3 ✅** (sin el mejor episodio evitado
—abr/may-2022, B&H −12,5%— el maxDD V4 queda en 57% del B&H: el valor no era solo COVID) ·
C4 ❌ (QQQ falla en las CUATRO variantes; V1 QQQ: maxDD 67% del B&H, gap −4,3pp; C3-QQQ 109%
— peor que B&H sin su mejor episodio) · C5 ❌ (overlay 1 contrato: Sharpe del libro no mejora;
SPY −$39 en esta corrida secuencial).

1. **El mecanismo de la falla — la histéresis N=3 del propio diseño mata el libro:** el
   filtro crudo (V1) es excelente y pasa C1, pero "volver lento" cuesta ~4,5pp de CAGR/año
   (exposición 57%→42%): los días perdidos son exactamente los rebotes fuertes post-salida
   (la versión sistematizada del problema 2019 que la spec obligó a medir). La asimetría
   "salir rápido, volver lento" es correcta para vender prima (re-entrar tarde cuesta unas
   señales) e incompatible con un libro de stock (re-entrar tarde cuesta los mejores días).
2. **QQQ no replica ni en la variante ideal** — consistente con la debilidad conocida del
   engine (BT-0: los grinds se detectan tarde; el bear 2022 de QQQ fue un grind profundo).
   El hallazgo direccional de BT-13(a) era en buena parte idiosincrasia de SPY + ejecución
   idealizada.
3. Nota de varianza declarada: el overlay secuencial SPY dio −$39 acá vs +$572 en BT-13(b)
   — las carteras de 1 posición (~37 trades de 115 señales) tienen enorme varianza de
   selección; a 1 contrato el overlay SPY no mueve la aguja en ninguna dirección.
4. **Consecuencia (conforme al compromiso):** el libro combinado queda como curiosidad
   documentada; producción sigue **PCS-only con la config H3 intacta**. Revivir la idea
   exigiría ciclo nuevo pre-declarado con hipótesis distinta (p.ej. re-entrada del stock
   con N=1 como parámetro del libro, no del regime engine) — no un ajuste de este.
5. Mismo patrón que BT-9: lo que brilla idealizado se degrada al ponerle las condiciones
   reales pre-declaradas. La disciplina volvió a pagar.

### BT-15 — Cartera secuencial SPY-only de la config de referencia: ESPECIFICACIÓN PRE-DECLARADA (2026-07-14, antes de correr)

**Motivación (pregunta del operador):** el veredicto de viabilidad de negocio circula con los
números de BT-7 (5,2 trades/año, ~1,2% anual), medidos sobre la config VIEJA (era delta 0.20,
pre-walk-forward, solo SPY). La config de referencia vigente (PCS SPY delta 0.30 + trailing +
tail_score + GEX≥0 + gestión B) nunca se midió como **cartera secuencial con ocupación real**
— solo a nivel señal-día. Decisión de universo del operador (2026-07-14): **QQQ queda fuera
del trading; SPY-only.** El veto de correlación §7.3 deja de ser palanca.

**Advertencias de honestidad (declaradas antes de correr):**
- Ventana OOS 2018–2025 **agotada** (scan BT-10b + BT-10c/11/12/13/14). Todo veredicto
  habilita a lo sumo paper. Esta corrida es la medición de negocio de la config ya validada,
  no una validación nueva.
- BT-14 (nota 3) midió varianza enorme de selección en carteras de 1 posición (~37 trades de
  115 señales): los totales de UNA secuencia tienen ruido de camino. Se reporta la secuencia
  real única (sin cherry-pick de seeds ni reintentos).
- V2 (escalonada) con 2 posiciones típicas delta-0.30 ancho $5 implica riesgo simultáneo
  ~$810–860 ≈ **8,1–8,6% del NL $10k — EXCEDE el heat cap 7%** de §7.1. Se corre igual para
  medir el valor de la palanca; si paga, la consecuencia operativa es base de capital ≥ ~$12k
  o cap explícitamente revisado — decisión de diseño, NO se relaja el cap por resultado.

**Pipeline congelado:**
- Señales H3 SPY idénticas a BT-10c(a)/BT-12 (script `bt10_mgmtB.py`): PCS delta 0.30, DTE
  [35,50] más cercano a 45, ancho $5, crédito >$0,30, tabla trailing puts anti-lookahead,
  barras 1,05/1,10/1,20, VRP≥1.2, short ≤ put_wall, tail_score (VVIX 110/130 + skew25 RoC5d
  5%/8%, huecos ≤2d), GEX≥0. Fricción $6,30. 1 contrato por posición, base $10k.
- Cartera secuencial EOD: exits se procesan antes que entries (capacidad liberada el mismo
  día es reutilizable). Entrada al cierre del día de señal. Gestión B path-level: cierre al
  primer día con valor del spread ≤ 50% del crédito, si no, settlement a vencimiento.
- **V1 — baseline:** máx 1 posición.
- **V2 — escalonada:** máx 2 posiciones simultáneas, la 2ª solo con vencimiento distinto al
  de la abierta.
- **Cash ocioso a T-bill 3m** (serie mensual real 2018–2025, `research/data/tbill_3m_monthly.csv`):
  devengo diario sobre `NL realizado − $500 × posiciones abiertas`. Se reporta por separado
  (estrategia pura vs estrategia + cash) — el T-bill no entra en los criterios.
- **Métricas:** trades/año tras compresión (sucesor del 5,2), win%, avg$, total y por año,
  peor año, peor racha, maxDD sobre equity MTM diaria, espera entre entradas
  (mediana/p90/máx — sucesor del 803), % días en posición, días con 2 posiciones y peor día
  MTM conjunto (V2), retorno % anual sobre $10k con y sin T-bill.
- **Criterios (inamovibles):**
  - **C1 (V1):** win ≥ 90% ∧ ningún año calendario < −$700.
  - **C2 (V2 paga):** V2 aumenta trades/año Y total neto vs V1.
  - **C3 (V2 no concentra la cola):** peor año y maxDD de V2 no empeoran los de V1 en más
    de $450 (≈1 max loss). Si falla → se queda 1 posición y V2 muere acá.
- **Una corrida por variante, sin retoques post-resultado.**

**⚙ RESULTADO BT-15 (2026-07-14, corrido una vez): C1+C2+C3 PASAN — la palanca escalonada
paga; la escala del negocio a $10k queda medida y es chica.** Script: `bt15_portfolio.py`.

| | trades/año | win% | avg$ | total 8a | peor año | maxDD MTM | espera med/p90/máx | % anual s/$10k (estrategia) | + T-bill |
|---|---|---|---|---|---|---|---|---|---|
| **V1 (1 pos)** | 4,9 | 92,3 | 14,7 | $572 | −$699 (2018) | −$814 (−8,1%) | 34/223/272 d | 0,72% | **3,32%** |
| **V2 (2 pos)** | 7,4 | 94,9 | 26,0 | $1.535 | −$593 (2018) | −$827 (−8,3%) | 16/155/272 d | 1,93% | **4,67%** |

1. **C1 PASA (justo):** 2018 V1 = −$699 contra el límite −$700. C2 PASA: V2 sube trades/año
   (4,9→7,4) y total (2,7×). **C3 PASA y sorprende:** V2 MEJORA el peor año (−$699→−$593) y
   el win% — la 2ª posición entra en clusters buenos y diluye; el peor día MTM con 2 abiertas
   fue −$401 (2018-02-05), un solo max-loss-equivalente, no el doble golpe temido.
2. **La varianza de selección de BT-14 (nota 3), confirmada y cuantificada:** V1 toma 39 de
   115 señales y su avg cae a $14,7 vs $35,5 del nivel señal-día — la cartera de 1 posición
   entra al primer disparo de cada cluster (el peor: recién armado el entorno) y deja pasar
   los mejores. V2 recupera parte ($26,0). El P&L de cartera NO se extrapola multiplicando
   señales × avg señal-día.
3. **Corrección del número de negocio circulante:** el "5,2 trades/año / 1,2% anual" de BT-7
   (config vieja) pasa a **7,4 trades/año / ~1,9% anual de estrategia + ~2,7% del cash a
   T-bill = ~4,7% total** con V2, $10k, 1 contrato. El sucesor del 803: espera máxima 272
   días, p90 155 — el régimen-cero se acortó pero sigue siendo estructural (2022: un solo
   trade, perdedor).
4. **🔴 Hallazgo de riesgo (nuevo, a resolver en diseño):** maxDD de equity MTM = −8,1/−8,3%
   del NL $10k en ambas variantes — **excede el tope de 5% de la definición**. BT-7 reportó
   4,5% con la config vieja; el delta 0.30 con crédito mayor tiene max loss ~$410/trade y
   2018 encadena MTM adverso. A 1 contrato no hay dial de sizing que lo baje: es otro
   argumento de base de capital ≥ ~$16k, no de config.
5. **Decisión que abre (no se toma acá):** adoptar V2 exige NL ≥ ~$12k por heat cap 7%
   (riesgo simultáneo medido ~$820) o revisión explícita del cap. Con la advertencia de
   ventana agotada: habilita a lo sumo paper.

### BT-16 — Denominador del VRP: RV30 trailing → pronóstico HAR-RV: ESPECIFICACIÓN PRE-DECLARADA (2026-07-14, antes de correr)

**Motivación:** es la extensión opcional de BT-2 (línea "Comparar RV30 trailing vs. HAR-RV…"),
nunca corrida. El gate VRP es el asesino del embudo (mata ~62 días/año de los 84 que llegan
vivos) y sus dos modos de falla están MEDIDOS: (a) lag post-shock — bloquea los días de
"resaca" que BT-10b midió como los mejores del sistema (100% win, avg $51, cero cluster
2018/2020); (b) espejismo de denominador en calma (VRP >1,55 = peor cuartil). Hipótesis con
pagador económico: `VRP = IV / RV_esperada_futura` responde la pregunta correcta ("¿el seguro
está caro respecto de lo que VIENE?"); el trailing responde por lo que YA pasó.

**Advertencias de honestidad:**
- Ventana OOS agotada (enésima reutilización) → habilita a lo sumo paper.
- Riesgo simétrico declarado: HAR también aprende del pasado — en transiciones puede
  sub-pronosticar y abrir días que el trailing (paranoico) cerraba. Mitigantes: fit desde
  2001 (incluye dot-com y 2008, no solo calma), y las capas régimen/tail/GEX siguen cerrando
  transiciones violentas. Si 2018/2020 se ensucian, C1/C3 lo capturan y se archiva.
- Expectativa pre-registrada del operador de research: ~55% pasa y sube a ~10–12 trades/año
  de cartera; ~25% neutro; ~20% falla por lag en transición.

**Pipeline congelado:**
- **Denominador nuevo:** pronóstico HAR del MISMO objeto que mide `rv30` (std de retornos
  log c2c de los próximos 30 días hábiles, anualizada ×√252, en %). Numerador `atm_iv`
  intacto (cache bt3). Verificado: `vrp_cache = atm_iv×100/rv30` exacto y `rv30` = rolling
  30d hábiles (corr 1,000).
- **HAR (Corsi 2009, log-log, 4 coeficientes):** `log(RV_fwd30) ~ log(pk_d) + log(pk_w) +
  log(pk_m)` donde pk = vol Parkinson diaria (`ln(H/L)²/(4·ln2)`, OHLC del parquet),
  promediada en varianza a 1/5/22 días. Predicción con corrección smearing
  (`exp(pred + s²/2)`).
- **Anti-lookahead:** ventana expansiva desde 2001, refit anual; para operar el año Y el fit
  usa solo observaciones cuyo target (30 días hábiles adelante) se completó antes del
  1-ene-Y.
- **Gate:** `vrp_har = atm_iv×100 / har_fcst ≥ 1.2` — umbral CONGELADO (un solo cambio por
  vez; si la distribución del VRP nuevo queda desplazada, se reporta, no se re-tunea).
  TODO lo demás idéntico a BT-15 (señales H3, gestión B, cartera V2).
- **Criterios (inamovibles):**
  - **C1 (seguridad, señal-día bajo B):** win ≥ 90% ∧ ningún año < −$700.
  - **C2 (la tesis):** señales/año > 14,4 (el HAR debe SUBIR ocurrencia, no solo reclasificar).
  - **C3 (cartera V2):** total ≥ BT-15 V2 ($1.535) ∧ peor año y maxDD no empeoran > $450.
  - **C4 (calidad del desbloqueo):** las señales NUEVAS (abre HAR ∧ cerraba trailing) tienen
    win B ≥ 90% ∧ avg > 0 — el test directo de la premisa de la resaca.
- **Diagnósticos a reportar:** P&L contrafactual de los días que HAR cierra y trailing abría
  (esperado: peores); distribución vrp_har vs vrp_trailing; R² OOS del HAR por año.
- **Una corrida, sin retoques post-resultado.**

**⚙ RESULTADO BT-16 (2026-07-14, corrido una vez): VEREDICTO REPROBADO — el escenario de
falla pre-registrado (~20%: lag de HAR en transiciones) es el que ocurrió.** Script:
`bt16_har_vrp.py`.

| Criterio | Resultado |
|---|---|
| C1 (señal-día B: win≥90% ∧ ningún año <−$700) | ❌ **2022 = −$1.077** (win 95,9% pasa) |
| C2 (ocurrencia >14,4/año) | ✅ 15,4/año (marginal) |
| C3 (cartera V2 ≥ $1.535, cola ≤ +$450) | ❌ total $1.460; peor año −$701 (2022) |
| C4 (señales nuevas win≥90% ∧ avg>0) | ✅ 97,1% / $36,6 — pero con 2022 −$692 adentro |

1. **El mecanismo de la falla, medido:** en 2022 (bear grind) el RV30 trailing quedaba alto
   y bloqueaba el año casi entero (1 señal — correcto); el pronóstico HAR decae más rápido
   → VRP_har ≥1.2 reabrió días del oso → las señales nuevas de 2022 perdieron −$692 y el
   año señal-día quedó en −$1.077. La paranoia del trailing en transiciones ERA la feature,
   no el bug.
2. **El doble filo, también del otro lado:** los 60 días que HAR cerró y trailing abría eran
   BUENOS (win 98,3%, avg $40,2 contrafactual) — HAR no solo abrió días malos, cerró buenos.
   El neto reclasificó ~mitad de las señales (55 comunes / 68 nuevas / 60 perdidas) sin
   mejorar nada: mismo total (~$4.1k) con peor cola.
3. **El modelo en sí era débil OOS:** R² (log) negativo en 7 de 8 años. Sin RV intradía
   (5-min), el HAR sobre Parkinson diario de SPY no pronostica mejor que la media — la
   versión "pro" del estimador necesita datos que no tenemos. Limitación registrada; NO es
   invitación a iterar variantes hasta que pase.
4. **La premisa de la resaca sigue viva pero no así:** C4 técnicamente pasa (las nuevas
   ganan 97% de las veces) — el problema es QUÉ años abre. Un desbloqueo de resaca que no
   sepa distinguir "post-shock en recuperación" de "bear en curso" importa la cola de 2022.
   Si se retoma, la hipótesis debería condicionar por régimen/tendencia, como ciclo nuevo.
5. **Consecuencia (conforme al compromiso):** el gate VRP queda con RV30 trailing. La config
   de referencia sigue: PCS SPY delta 0.30 + trailing + tail_score + GEX≥0 + gestión B, con
   BT-15 V2 (2 posiciones escalonadas) como candidata de cartera. Costo del test: un script
   y una corrida; el diagnóstico salvó de desplegar un gate peor.

### BT-17 — Descomposición de clavijas de ocurrencia/renta: ESPECIFICACIÓN PRE-DECLARADA (2026-07-14, antes de correr)

**Motivación (decisión de negocio explícita del operador):** el operador declara que su
objetivo cambió — quiere **más ocurrencia y más renta absoluta cediendo algo de POP**,
manteniendo régimen y tail intactos. Esto NO es un hallazgo de datos que justifique migrar
parámetros; es un cambio de función objetivo del producto, y se declara como tal. BT-12 dejó
el delta congelado en 0.30 por disciplina anti-data-mining; acá se re-abre SOLO porque el
objetivo de negocio cambió, no porque una tabla se vea mejor.

**Las clavijas (se testean aisladas y combinadas, para ver qué compra cada una):**
- **P1 — quitar el gate GEX≥0** (BT-6 lo dejó como "primera candidata a podar"; evitó 1
  pérdida en 13 años a costa de la mitad de las señales; nunca testeado con delta 0.30 + B).
- **P2 — delta objetivo 0.30 → 0.25** (BT-12 midió a 0.25: 17,6 señ/año, win B 97,9%, peor
  año −$91 — meseta robusta, no pico).
- **P3 — ancho $5 → $10** (BT-13c: ~2× crédito/trade, ~2× max loss; palanca de monto, no de
  frecuencia).

**Variantes (todas OOS 2018–2025, gestión B, cartera V2 = 2 posiciones escalonadas):**
- A = baseline BT-15 V2 (delta 0.30, ancho $5, con GEX)
- B = A sin GEX (P1)
- C = B + delta 0.25 (P1+P2)
- D = C + ancho $10 (P1+P2+P3) — la config candidata del objetivo nuevo

**Advertencias de honestidad:**
- Ventana OOS agotada (enésima). Habilita a lo sumo paper.
- P2 se re-abre por cambio de objetivo declarado, NO por rendimiento observado — el número
  0.25 se fija ANTES de ver esta corrida (viene de la meseta BT-12), no se elige el mejor de
  una grilla nueva. Sin grilla nueva de delta.
- **Riesgo por trade cambia con la clavija:** ancho $10 → max loss ~$935 (vs ~$460 a $5).
  Los criterios de cola se evalúan **normalizados por riesgo** además de en dólares brutos,
  para no confundir "más P&L" con "más apalancamiento".
- Heat: ancho $10 × 2 posiciones = ~$1.870 de riesgo simultáneo = 18,7% del NL $10k — MUY por
  encima del cap 7%. La variante D es medición, no config desplegable a $10k; su consecuencia
  operativa (si paga) es capital ≥ ~$27k o ancho $5 con más contratos. Declarado antes de correr.

**Criterios (inamovibles):**
- **C1 (seguridad preservada):** cada variante mantiene win B ≥ 90% Y ningún año < −1,5 max
  loss de esa variante (−$700 a ancho $5; −$1.400 a ancho $10).
- **C2 (la clavija paga ocurrencia):** trades/año de cartera V2 sube monótono A→B→C.
- **C3 (renta absoluta):** total 8a de la variante candidata (D) supera a A; se reporta también
  retorno normalizado por riesgo (total / max-loss-por-trade) para separar renta de apalancamiento.
- **Diagnóstico obligatorio:** cuánto de la ganancia de D es alpha genuino (más señales de
  calidad) vs apalancamiento (mismo trade, más tamaño) — vía la métrica normalizada.
- **Una corrida, sin retoques.**

**⚙ RESULTADO BT-17 (2026-07-14, corrido una vez): C1+C2+C3 PASAN. Ganador = variante C
(sin GEX + delta 0.25, ancho $5). D queda REFUTADA como mejora (es apalancamiento, no
alpha). Con una advertencia de ventana crítica sobre P1.** Script: `bt17_levers.py`.

Cartera V2 (2 posiciones escalonadas), gestión B, OOS 2018–2025:

| Variante | señ | trades/año | win% | total 8a | peor año | maxDD | total norm. a riesgo $5 | % anual + T-bill |
|---|---|---|---|---|---|---|---|---|
| A baseline (d0.30 $5 +GEX) | 115 | 7,4 | 94,9 | $1.535 | −$593 | −8,3% | $1.535 | 4,67% |
| B sin GEX (d0.30 $5) | 189 | 9,9 | 94,9 | $2.008 | −$516 | −8,3% | $2.008 | 5,34% |
| **C +delta (d0.25 $5)** | **222** | **10,6** | **97,6** | **$2.723** | **−$140** | −8,4% | **$2.723** | **6,41%** |
| D +ancho (d0.25 $10) | 90 | 5,5 | 97,7 | $2.653 | −$283 | −13,8% | $1.326 | 6,37% |

1. **C domina todo:** más trades (10,6/año), MEJOR win (97,6% vs 94,9%), MEJOR peor año
   (−$140 vs −$593) y más renta ($2.723). No es un trade-off de POP por frecuencia — en esta
   ventana las tres cosas mejoran juntas. Delta 0.25 aporta lo grueso (crédito más rico cerca
   del dinero + más señales que cruzan la barra).
2. **D es apalancamiento disfrazado de mejora:** ancho $10 da casi el mismo total que C
   ($2.653) pero con la MITAD de trades, el DOBLE de max loss por trade y maxDD −13,8%. La
   columna normalizada por riesgo lo desenmascara: D vale $1.326 contra $2.723 de C. **Ancho
   $10 se rechaza** — coherente con BT-13c (a riesgo constante gana el $5).
3. **🔴 ADVERTENCIA CRÍTICA sobre P1 (quitar GEX):** el gate GEX protegió UNA sola vez en 13
   años — **agosto 2015** (BT-5/BT-6), que está **FUERA de la ventana OOS 2018–2025**. Que
   quitarlo salga "gratis" acá es en parte porque esta ventana NO CONTIENE el episodio contra
   el que GEX protege. No es evidencia de que sea inocuo — es ausencia del test. La capa
   gamma es el seguro anti-crash-de-gamma-negativo (BT-0: los 15 episodios tenían GEX<0 en
   D0). Quitarla sube la ocurrencia hoy y expone la cola mañana. **Decisión honesta: P1 es
   una cesión de seguridad real, no un almuerzo gratis** — debe tomarse como tal, no como
   hallazgo.
4. **Delta 0.25 (P2) es la clavija limpia:** su ganancia es genuina (BT-12 ya lo validó en
   meseta, sin re-tuning), no cede cola medida (2018 mejora), y no toca ninguna capa de
   entorno. Es la única de las tres que se adopta sin asterisco.
5. **La cuenta de negocio, honesta:** C = 3,43% de estrategia + ~3% T-bill = **6,4% anual
   sobre $10k, ~$340/año de estrategia con 1 contrato**. Para el objetivo del operador
   (~$200/mes = $2.400/año) hace falta escala: ~$32k al blended 7,4% (tasas de hoy), o ~$70k
   si se cuenta solo la pata estrategia. Ninguna clavija de señal cierra esa brecha sola —
   la cierra el capital.
6. **Consecuencia:** config candidata pasa a **C = delta 0.25 + ancho $5 + gestión B +
   cartera V2**, con GEX como decisión explícita pendiente (mantener = seguro de cola 2015;
   quitar = +2,3 trades/año a cambio de exposición no testeada). El operador decide P1 con la
   advertencia sobre la mesa. Ventana agotada → paper.

## 3-bis. Test de muros como restricción (2026-07-09) — Capa 2 redefinida con datos

Put wall diario reconstruido 13 años × 2 símbolos (strike con máx gamma×OI de puts, DTE<90 —
misma cuenta que `GammaExposureHandler`; cache `{sym}_walls_daily.parquet`). Tres veredictos:

1. **El muro como ANCLA (Capa 2 original) ya estaba retirado** — producía créditos de centavos
   (caso 6-jul: edge 0,53). Confirmado: no vuelve.
2. **El muro como RESTRICCIÓN: se adopta, y es casi gratis.** El strike delta-0.20 ya nace
   debajo del put wall el **100% (SPY) / 99% (QQQ)** de los días — la restricción
   `short_strike ≤ put_wall` muerde <1% de las entradas. Pero donde muerde, muerde bien:
   los 5–16 trades que entraron POR ENCIMA del muro promediaron **−$152 (SPY) / −$73 (QQQ)**
   con win 60–75% (vs +$17/+$21 y 92% protegidos). Configuración tóxica real, filtro barato.
3. **El muro como PROTECCIÓN ANTI-CRASH: refutado.** Las 13 pérdidas grandes gated (2015,
   2021, 2023, 2024) entraron TODAS cómodamente protegidas ($10–40 debajo del muro) — los
   crashes atraviesan los muros sin frenar. El muro es estructura de buen clima (concentración
   de OI donde los dealers hedgean en calma), no barrera de tormenta. La protección de cola
   real sigue siendo el régimen (BT-0) + gamma agregado (solo SPY).

Curiosidad NO adoptada (anti data-mining): la banda "strike 0–5$ bajo el muro" muestra stats
superiores (p5 positivo en SPY) — sin hipótesis causal clara, se registra y no se codifica.

**Capa 2 queda formalmente redefinida:** selección por delta objetivo → piso anti-pennies →
selector de edge → gate, con `short_strike ≤ put_wall` como restricción de sanidad. El anclaje
a muros y el expected move salen de la definición.

## 4. Requisitos transversales del backtest (no negociables)

1. **Path-level, no agregado.** Simular la secuencia real de trades con mark-to-market diario.
   El promedio miente; la secuencia decide la supervivencia.
2. **Neto, no bruto.** Comisiones + slippage + costo de gestión (rolls, cierres) en cada trade.
   El JSON v2.1.5 ya modela slippage en `execution` — extender con comisiones, no reinventar.
   Pregunta estratégica: *¿el alfa (IV/RV) sobrevive a la fricción?*
3. **Con la gestión puesta.** El edge a vencimiento no es el edge real; recalcular todo con la
   política de gestión activa (BT-4) aplicada.
4. **Por régimen.** Toda métrica se reporta segmentada por régimen del regime engine — las barras
   dinámicas se calibran por régimen, no globalmente.
5. **Colas explícitas.** Todo reporte incluye peor día / peor semana / peor trade / peor racha,
   no solo medias y Sharpe.

---

## 5. Valores placeholder vigentes (a reemplazar por BT-2/BT-3)

| Régimen | `vrp_min` | `min_edge` | Racional del placeholder |
|---|---|---|---|
| optimal | 1.15 | 1.10 | estimadores confiables; piso ≈ fricción |
| normal | 1.20 | 1.15 | base |
| low_vol_grind | 1.25 | 1.15 | VRP en vol baja suele ser espejismo de denominador chico |
| elevated_vol | 1.35 | 1.25 | prima rica pero estimadores sospechosos |
| caution / dislocation | 1.45 | 1.35 | casi-veto: solo oportunidades excepcionales |
| crisis | — | — | bloqueado por régimen; las barras no se evalúan |

**Invariantes de diseño que la calibración debe respetar:**
- Monotonía: barras no-decrecientes con el peligro del régimen.
- Piso duro: `min_edge ≥ 1 + fricción` en todo régimen.
- Sin compensación cruzada: VRP alto no compra `min_edge` bajo, ni al revés (AND no-compensable).

---

## 6. Pregunta abierta registrada (no resolver ahora)

**El régimen-cero:** hay entornos donde vender prima estructuralmente no paga
(IV/RV ≈ 1 por meses, o IV alta pero RV más alta). El sistema correctamente diría "no operar"
durante meses. ¿Espera ociosa, o eventualmente una segunda pata no correlacionada?
Se deja **nombrado como límite estructural, no como feature**.

**MEDIDO (BT-7, 2026-07-08):** espera máxima histórica entre entradas = **803 días**
(2017–2018); p90 = 154 días. El régimen-cero no es hipotético: el sistema pasó dos años
enteros sin operar. La pregunta (esperar vs. segunda pata) sigue abierta, ahora con número.

---

## 7. Piso de fricción — ✅ CALCULADO (2026-07-06, datos reales)

```
fricción_por_trade = comisiones + fees + slippage + costo esperado de gestión
piso_min_edge = 1 + fricción_por_trade / crédito
```

**Insumos reales usados:**
- Schedule Tastytrade (verificado en tastytrade.com/pricing): $1.00/contrato apertura,
  tope $10/leg, $0 al cierre. Fees reg/clearing estimados ~$0.12/contrato/vía (no itemizado público).
- Quotes en vivo del spread real del día: PCS SPY 710/700 exp 2026-08-21 (46 DTE),
  short put bid 4.02/ask 4.05, long put bid 3.15/ask 3.18 — bid-ask $0.03 por leg (~0.7–1.0% del mid).

**Fricción por contrato (PCS 2 legs, ida y vuelta, cierre al 50%):**

| Componente | Base | Conservador |
|---|---|---|
| Comisiones + fees (round trip) | $2.48 | $2.48 |
| Slippage (½ spread c/vía // al natural c/vía) | $3.00 | $6.00 |
| Gestión esperada (~15% prob. defensa) | $0.80 | $0.80 |
| **Total** | **~$6.30** | **~$9.30** |

IC (4 legs): ~2× en dólares (~$12–18), pero también ~2× crédito → % similar.

**El piso NO es constante — depende del crédito cobrado** (fricción en $ es fija por estructura):

| Escenario de crédito | Fricción % | `piso_min_edge` |
|---|---|---|
| Crédito regla 1/3, ancho $10 ($3.33) | 1.9–2.8% | **1.02–1.03** |
| Crédito regla 1/3, ancho $5 ($1.67) | 3.8–5.6% | **1.04–1.06** |
| Crédito patológico del día ($0.87 en $10) | 7.2–10.7% | 1.07–1.11 |

**Conclusiones:**
1. Para trades que cumplen la regla 1/3, el piso real es **~1.02–1.06** — la liquidez de SPY
   (spreads $0.03) hace la fricción mucho menor que la estimación gruesa inicial (8–10%).
2. La tabla placeholder de la sección 5 (`min_edge` ≥ 1.10) **sobrevive con margen** al piso.
3. El piso debe expresarse como función del crédito (`1 + fricción$/crédito$`), no como constante
   — futuro nodo `execution.friction` del JSON.
4. *Caveats:* quotes after-hours; fees estimados; falta QQQ (hoy NO_OPERAR, sin spread armado).

### Hallazgo colateral del cálculo — validación en vivo del rediseño (2026-07-06)

El día del cálculo resultó una demostración empírica del diseño completo:

- **El trade que la cascada actual dispara hoy tiene edge 0.53** (crédito $0.87 / ancho $10 /
  POP 83.7% → `0.087/0.163 = 0.53`, la mitad del breakeven de EV; creditRatio 8.7% vs. target 33.3%).
  El sistema dice OPERAR porque su gate de crédito es absoluto ($0.30) y los strikes anclados a
  muros quedan tan OTM que no cobran casi nada.
- **Hoy no hay alfa:** VRP SPY = 15.46/15.58 = **0.99**; QQQ = 26.67/29.27 = **0.91** — IV por
  debajo de RV, vender prima hoy es vender seguro subvaluado.
- **El trigger nuevo rechazaría por ambos gates (edge Y alfa) el trade que el sistema actual
  sugiere.** Un solo día de datos reales alcanzó para mostrar que el rediseño cambia decisiones
  concretas — no es redundancia.

---

## 8. Filtro OI de microestructura — recalibrado con datos (2026-07-08)

**Decisión confirmada: `open_interest_min` baja de 2000 → 100 para SPY/QQQ** (sujeto a
validación en años de stress). Evidencia (SPY 2025, 33.108 filas en zona operativa):

- El spread es **plano a través del OI**: mediana 1,01% (OI=0) → 0,83% (OI 5000+); el % que
  pasa el filtro de spread ≤5% es 93,8–98,7% en TODOS los buckets. En SPY el OI no predice
  calidad de quote — el filtro de spread (medida directa) es el gate que trabaja.
- En días de stress (p90 IV) tampoco hay gradiente: 1,17–1,54% sin patrón por OI.
- Costo del 2000: mataba el 76% de la zona operativa y la mitad de los strikes redondos de $5.
- OI ≥ 100 conserva el 80% de la zona y filtra solo strikes genuinamente muertos.
- **Validación en años de stress (hecha 2026-07-08, 2018/2020/2022 + 2013):** en la era moderna
  (2018+) el gradiente OI→spread es leve incluso en días p90 de IV (2020 stress: OI<100 pasa el
  filtro de 5% en 82% de los casos; 2022: 95%). **Confirmado OI ≥ 100.** Excepción histórica:
  en 2013–2017 el gradiente era real (OI<100 → spread ~6%, solo 37% pasa) — era otra
  microestructura de mercado; en backtests de esos años el filtro de spread muerde más, lo cual
  es correcto y realista. El filtro de spread ≤5% queda como el gate primario (se auto-protege:
  un quote ancho falla sin importar el OI).
- **Pendiente en el mismo espíritu:** el filtro de volumen (>200) muerde parecido (volumen
  mediano en zona: 17–126) — revisarlo con el mismo método junto a BT-3.
- JSON-first: aplicar al nodo de microestructura junto con el merge v2.1.5.

## 9. Orden recomendado de ejecución

1. ~~**Piso de fricción** (sección 7)~~ — ✅ hecho 2026-07-06 (piso ~1.02–1.06 para trades regla 1/3).
2. ~~**Adquirir cadenas históricas EOD**~~ — ⚙ parcial 2026-07-08: SPY 2013–2023 adquirido; **faltan OI y QQQ** (sección 2.1).
3. **BT-0 + BT-1 juntos** (latencia del régimen + POP vs delta, sobre los mismos episodios) — si cualquiera falla, se recalibra antes de seguir.
4. **BT-2 + BT-3** (VRP y edge por régimen) — llenan la tabla de barras con datos.
5. **BT-4** (gestión activa) — redefine el edge real; iterar BT-3 con la gestión puesta.
6. **BT-5** (escalera de atribución) — decide qué capas quedan y cuáles se podan (escalón GEX requiere OI).
7. **BT-6 + BT-7 + BT-8** (correlación, secuencia/ruina, cooldown) — sobre la config ganadora.
