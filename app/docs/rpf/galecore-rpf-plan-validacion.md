> ⚠️ **PLAN DE VALIDACIÓN ORIGINAL — restaurado 2026-07-29.** Plan de validación de la estrategia
> **RPF ("Disparo por prima real")** tal como se diseñó el **2026-07-06** (commit `95ed70d`, entonces
> `galecore-backtesting-pendientes.md`). Se restauró acá como documento canónico aparte.
>
> **Este plan ya se ejecutó:** evolucionó al ciclo **BT-0…BT-17** documentado en
> [`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md) (el archivo fue renombrado
> y creció con los resultados). Se conserva acá porque fija el **diseño** de las validaciones
> (BT-1…BT-8) que sostienen [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md).
>
> El cuerpo debajo es el documento original de 2026-07-06 **sin modificar**.

---

# GaleCore — Backtesting pendientes

> **Propósito:** registro de todas las validaciones empíricas pendientes que sostienen la definición
> de la estrategia de disparo por prima real (edge + estados). Cada supuesto del diseño que no está
> derivado matemáticamente ni calculado con datos propios queda listado acá con: qué hay que calcular,
> qué dato histórico se necesita, dónde impacta y qué criterio decide.
>
> **Regla:** ningún nodo nuevo del JSON pasa a `enabled: true` hasta que su backtest correspondiente
> lo justifique. Los valores actuales de la tabla de barras son **placeholders**, no calibraciones.

**Fecha:** 2026-07-06
**Base de reglas:** v2.1.5 (regime engine de 8 regímenes) — decisión fijada en sesión de diseño.
**Estado:** ningún backtest ejecutado. No existe aún infraestructura de backtesting.

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

### BT-1 — Validación de `POP ≈ 1 − |delta|` (prioridad máxima)

| | |
|---|---|
| **Qué calcular** | Frecuencia real de expiración ITM del strike corto, por bucket de delta (0.05–0.10, 0.10–0.15, … 0.30–0.35), por subyacente y por régimen |
| **Dato necesario** | Cadenas EOD (delta al momento de entrada) + OHLC (para saber el resultado al vencimiento) |
| **Dónde impacta** | `definitions.pop_proxy` — es el insumo de **edge, priorityScore y creditRatio**. Si el delta subestima la probabilidad real de pérdida, TODO el edge del diseño está inflado |
| **Criterio** | Si el ITM real por bucket excede el delta en > X% de forma sistemática (sobre todo en regímenes tensos), el `colchón_incertidumbre` de `min_edge` debe absorber esa diferencia medida — no un número inventado |

### BT-2 — Distribución del VRP y calibración de `vrp_min`

| | |
|---|---|
| **Qué calcular** | Serie histórica `VRP = IV30/RV30` diaria por subyacente; distribución por régimen; P&L de trades simulados en función del VRP al momento de entrada |
| **Dato necesario** | IV30 (cadenas o proxy VIX/VXN) + OHLC (RV30) + serie de régimen (VIX family, gratis) |
| **Dónde impacta** | `alpha_gate.vrp_min` por régimen (nodo nuevo del JSON). Hoy 1.2 es convención de literatura |
| **Criterio** | El corte de VRP que históricamente separó trades ganadores de perdedores **en neto**, por régimen. Documentar además el comportamiento del VRP medido en las transiciones calma→tormenta (su punto ciego conocido: RV trailing laggeada) |
| **Extensión (v1, opcional)** | Comparar RV30 trailing vs. forecast forward (EWMA/GARCH) vs. estimador range-based (Yang-Zhang): ¿el estimador mejor reduce los falsos positivos de transición? Solo se adopta si mejora el resultado ajustado por riesgo |

### BT-3 — Calibración de `min_edge` por régimen

| | |
|---|---|
| **Qué calcular** | Distribución histórica del edge de entrada `(credit/width)/(1−POP)` por régimen; P&L **neto** en función del edge de entrada |
| **Dato necesario** | Cadenas EOD (crédito, delta) + serie de régimen + modelo de fricción (sección 7) |
| **Dónde impacta** | Tabla `min_edge` por régimen en los nodos `behavior` del regime engine — hoy los niveles son placeholders (1.10 … 1.35) |
| **Criterio** | Corte de edge neto rentable por régimen, respetando dos invariantes de diseño: **monotonía** (barra no-decreciente con el peligro del régimen) y **piso duro** `min_edge ≥ 1 + fricción` en todo régimen |

### BT-4 — Gestión activa: ¿50% profit / 45 DTE es óptimo en spreads definidos?

| | |
|---|---|
| **Qué calcular** | Mismo set de trades con políticas alternativas: hold-to-expiration vs. cierre 50% vs. cierre 25/75% vs. salida a 21 DTE. Comparar distribución completa (no solo media): win rate, peor trade, peor racha |
| **Dato necesario** | Cadenas EOD con mark-to-market diario (path-level obligatorio) |
| **Dónde impacta** | `trade_management` (profit target, DTE de salida). El prior Tastytrade de 50% está validado mayormente en **strangles**; para spreads de riesgo definido la evidencia es más débil |
| **Criterio** | La política que domina ajustada por riesgo. Nota: la gestión **reescribe la distribución** — el edge calculado a vencimiento y el edge con gestión al 50% son números distintos; el segundo es el real y es el que calibra BT-3 |

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

### BT-6 — Veto de correlación SPY/QQQ

| | |
|---|---|
| **Qué calcular** | Correlación rodante SPY/QQQ; P&L de cartera con 2 posiciones mismo lado vs. 1 sola (la de mayor score); drawdown conjunto en shocks |
| **Dato necesario** | OHLC (gratis) + trades simulados de BT-5 |
| **Dónde impacta** | Nodo nuevo `correlation_veto` en risk_limits; allocation policy (concentrar vs. repartir) |
| **Criterio** | Si 2 posiciones correlacionadas empeoran el peor-caso sin mejorar el retorno, el veto queda; definir mecanismo (veto duro vs. tope de heat combinado) |

### BT-7 — Secuencia y riesgo de ruina (validación path-level)

| | |
|---|---|
| **Qué calcular** | Sobre la configuración ganadora: distribución de colas — peor día, peor semana, peor trade individual, peor racha, riesgo de ruina dado el sizing (1%/trade, heat 3%) |
| **Dato necesario** | Los mismos trades de BT-3/BT-5, evaluados en secuencia real (no promediada) |
| **Dónde impacta** | `risk_limits` (sizing, heat) y la viabilidad global. En venta de prima la distribución tiene sesgo negativo: el número que decide si seguís vivo no es el drawdown promedio, es el peor caso |
| **Criterio** | Una curva con buen Sharpe y un día de −40% es **inoperable**. El sizing debe sobrevivir a la peor secuencia histórica con margen |

### BT-8 — Cooldown / histéresis del edge

| | |
|---|---|
| **Qué calcular** | Frecuencia de re-cruces del edge alrededor de `min_edge` (oscilación de prima); efecto de distintos δ de histéresis (`re-armar solo si edge < min_edge − δ`) sobre señales duplicadas |
| **Dato necesario** | Serie de edge diaria (de cadenas EOD; ideal muestreo intradía, aceptable EOD para v0) |
| **Dónde impacta** | Nodo nuevo `cooldown` — anclado a prima normalizada, no a timer fijo |
| **Criterio** | El δ mínimo que elimina >90% de las señales duplicadas sin retrasar materialmente las entradas genuinas |

---

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
Se deja **nombrado como límite estructural, no como feature**. El backtest debe medir cuánto
tiempo histórico el sistema pasa en régimen-cero (% de días sin señal posible).

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

## 8. Orden recomendado de ejecución

1. ~~**Piso de fricción** (sección 7)~~ — ✅ hecho 2026-07-06 (piso ~1.02–1.06 para trades regla 1/3).
2. **Adquirir cadenas históricas EOD** (sección 2.1) — la inversión que desbloquea todo.
3. **BT-1** (POP vs delta) — si falla, recalibra todo lo demás antes de seguir.
4. **BT-2 + BT-3** (VRP y edge por régimen) — llenan la tabla de barras con datos.
5. **BT-4** (gestión activa) — redefine el edge real; iterar BT-3 con la gestión puesta.
6. **BT-5** (escalera de atribución) — decide qué capas quedan y cuáles se podan.
7. **BT-6 + BT-7 + BT-8** (correlación, secuencia/ruina, cooldown) — sobre la config ganadora.
