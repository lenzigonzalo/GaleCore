# RPF — Libro mayor de reconciliación (Fase 0)

> **Propósito:** contrato de la validación de RPF. Una fila por parámetro con **valor final ·
> BT que lo justifica · estado**. Regla dura: *si un parámetro no está acá con su BT, no entra
> al JSON ni al código.* Este documento reconcilia la **definición canónica del 2026-07-06**
> ([`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md), escrita ANTES de correr backtests)
> contra el **research cerrado BT-0…BT-17**
> ([`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md), cerrado 2026-07-14).
>
> **Fecha:** 2026-07-29 · **Estado:** Fase 0 + Fase 1 (decisiones cerradas).
> **Config de referencia vigente:** BT-17 variante C **con la capa gamma mantenida**
> (delta 0.25 + GEX≥0). Ver §1 y caveat §10.5.

---

## 0. Leyenda de estados

| Estado | Significado |
|---|---|
| ✅ **CERRADO** | El research fijó el valor. Entra al JSON tal cual. |
| ⚠️ **DECISIÓN** | Fork del operador; cambia lo que se construye. Bloquea el freeze de la spec. |
| 🔵 **FRONTERA** | Diseño→implementación; se formaliza post-freeze del JSON (Fase 5). |
| 📐 **DERIVADO** | Consecuencia aritmética de una decisión cerrada; no es parámetro libre. |

---

## 1. Config de referencia en una línea

```
PCS · SPY-only · delta 0.25 · ancho $5 · POP empírica put trailing SIN shrinkage
· edge_emp ≥ min_edge(régimen) · VRP≥1.2 · tail_score(VVIX+skew) · GEX≥0 (mantenido)
· gestión B (50%, sin salida DTE) · cartera V2 (2 escalonadas) · OI≥100 · spread≤5%
· fricción $6.30 · base ref $16k / fondeo live ~$32k
```

**Números esperados (interpolados — ver §10.5):** ~8 trades/año, win ~97%, peor año ≤ −$140.
La combinación delta 0.25 + GEX no es una fila impresa del research: se acota entre la variante
A de BT-17 (7.4 tr/año, con GEX, delta 0.30) y la C (10.6 tr/año, sin GEX, delta 0.25).

Escala honesta medida (BT-15/17): ~$340/año de estrategia con 1 contrato; blended con T-bill
~6.4% anual. El objetivo del operador ($200/mes) lo cierra el **capital (~$32k)**, no ningún
parámetro de señal.

---

## 2. Universo y estructura

| Parámetro | Definición 2026-07-06 | Valor final | BT | Estado |
|---|---|---|---|---|
| Tickers | SPY + QQQ | **SPY-only** | decisión operador 14-jul; BT-6 (QQQ replica pero se saca del trading); BT-6 (IWM fuera) | ✅ |
| Estructura | IC / PCS / CCS | **PCS-only** | **BT-11**: IC/CCS in-edgeable a prob. honesta (0 señales en 8 años × 2 símbolos) | ✅ |
| Prohibidos | naked, ratio, long dir | idem + **IC/CCS `enabled:false`** | BT-11 | ✅ |
| Motor `structure_selection` (multi_factor) | activo | **retirado** (a re-diseño con ciclo nuevo si se revive) | BT-11: degrada el baseline en toda métrica | ✅ |

---

## 3. Eje A — ARMA (entorno / gates lentos)

| Parámetro | Definición 2026-07-06 | Valor final | BT | Estado |
|---|---|---|---|---|
| **Regime engine** | 8 regímenes (v2.1.5) | **flags rápidos**: VIX≥30 ∨ VIX9D>VIX3M ∨ RoC5d VIX>12% | BT-0 (lead +3d, 11/15 episodios); el de 8 regímenes **nunca se backtesteó** | ✅ **CERRADO** (operador 29-jul: flags rápidos) |
| **alpha_gate `vrp_min`** | tabla por régimen 1.15–1.45 | **1.2 plano** | BT-2/3: P&L VRP≥1.2 = $25.5 vs $9.5 rechazado (2.7×); banda 1.2–1.4 p5 positivo | ✅ |
| Denominador VRP | RV30 trailing | **RV30 trailing** (HAR-RV probado y refutado) | BT-16: HAR reabrió el bear 2022 (−$1.077), C1/C3 fallan | ✅ |
| **tail_gate** | tail_risk_score genérico (HY OAS, etc.) | **VVIX (110/130) + skew25 RoC5d (5%/8%), score≥2 → out**, huecos ≤2d | BT-9b (habilitó H2); BT-10c (load-bearing a delta 0.30+) | ✅ |
| **gamma_gate `GEX`** | GEX+ & spot>ZGL, umbral 25B/50B | **`GEX ≥ 0`, solo SPY**; umbral 25B **retirado** | BT-5 (fix unidades; 15/15 episodios GEX<0 en D0); BT-6 (poda QQQ) | ✅ **CERRADO** (operador 29-jul: mantener, safety-first) |
| `spot_vs_zgl` | gate activo | **no testeado** (requiere ZGL histórico + OI) | BT-0 nota 5 | 🔵 pendiente dato |

**Nota GEX (P1):** el gate protegió **1 sola vez en 13 años (ago-2015)**, que está *fuera* de
la ventana OOS 2018–2025. BT-17 advierte: quitarlo sale "gratis" en OOS solo porque la ventana
no contiene el episodio contra el que protege. Mantener = seguro anti-crash (−2.3 trades/año);
quitar = +2.3 trades/año con cola no testeada. **Es cesión de seguridad real, no almuerzo gratis.**

---

## 4. Eje B — DISPARA (spread / gates rápidos)

| Parámetro | Definición 2026-07-06 | Valor final | BT | Estado |
|---|---|---|---|---|
| **delta short** | no fijado (ancla a muros / expected move) | **0.25** | **BT-17** (ganador, variante C); BT-12 (meseta 0.28–0.32, no pico); BT-10c/H3 venía de 0.30 | ✅ |
| **ancho** | $5 / $10 (high_risk) | **$5** | BT-13c (a riesgo constante gana $5); BT-17 ($10 = apalancamiento: mitad de trades, 2× max loss, mismo total) | ✅ |
| DTE | 35–45 | **[35, 50], target 45** | research usó [35,50] cercano a 45 en todas las corridas | ✅ |
| **POP** | `1 − \|delta\|` | **tabla empírica put, trailing, anti-lookahead, SIN shrinkage** | BT-1 (delta miente 2× en puts, 1.5× en calls); BT-9 (shrinkage falla ocurrencia); BT-10c (trailing puro a 0.30 pasa) | ✅ |
| **edge** | `(cr/width)/(1−POP)` | `edge_emp = (crédito/ancho) / p_loss_empírica(delta)` | BT-3 run-2 (recupera semántica: mediana 1.11 vs 0.59) | ✅ |
| **min_edge por régimen** | placeholders 1.10–1.35 | **normal 1.05 · low_vol 1.10 · elevated 1.10 · caution 1.20** | BT-3 run-2 (barrido con datos); congelado en BT-9…17 | ✅ |
| Piso de calidad (1/3 rule) | target ≥ 33.3% | **retirado como piso** (no monótono con edge_emp); queda `credit_ratio ≥ 10%` anti-pennies + `credit_min $0.30` | BT-3 run-2 punto 5; erratum BT-10 (el piso 10% no se aplicó en BT-9 original) | ✅ |
| **Muros (put_wall)** | ancla de strikes | **restricción de sanidad** `short_strike ≤ put_wall` | 3-bis: muerde <1% de entradas pero donde muerde, −$152 avg; refutado como anti-crash | ✅ |
| **Microestructura OI** | `open_interest_min: 2000` | **`≥ 100`** | §8: OI no predice calidad de quote en SPY (era 2018+); spread≤5% es el gate real | ✅ |
| Filtro spread | — | **`spread ≤ 5%` (gate primario)** | §8: se auto-protege, muerde en 2013–2017 (correcto) | ✅ |
| Filtro volumen (>200) | activo | **pendiente revisar** (muerde parecido) | §8 pendiente | 🔵 |
| priorityScore (ranking) | desempate multi-símbolo | **dormido** (SPY-only) | §4 def.: con 1 símbolo queda inactivo | 📐 |

---

## 5. Riesgo, sizing y cartera

| Parámetro | Definición 2026-07-06 | Valor final | BT | Estado |
|---|---|---|---|---|
| **Cartera** | 1 pos/símbolo | **V2: 2 posiciones escalonadas** (vencimientos distintos) | BT-15 (C1+C2+C3 pasan; 7.4 trades/año, mejora peor año) | ✅ |
| Sizing bandas | ≤5% (target 3.5%) / 5–8% high_risk / >8% nunca | **idem** (en % Net Liq) | §7.1 diseño; no refutado | ✅ |
| **Heat cap** | 7% | **7% intacto** (no se relaja) | BT-15 nota V2: $820 riesgo simultáneo → base ≥ ~$12k para respetarlo | ✅ **CERRADO** (29-jul: cap intacto, se sube capital) |
| **maxDD real** | tope 5% (target 3.5%) | **tope 5% intacto**; a base ref $16k el maxDD $840 = 5.3% ≈ límite | BT-15: max loss ~$410 y 2018 encadena MTM → base ≥ ~$16k | ✅ **CERRADO** (29-jul) |
| **Base de capital** | $10k mínimo | **$16k referencia (respeta ambos límites) · fondeo live ~$32k (objetivo negocio)** | BT-15/17: $16k por maxDD 5%, $32k por $200/mes | ✅ **CERRADO** (29-jul) |
| Veto correlación SPY/QQQ (§7.3) | veto duro mismo lado | **muerto** (SPY-only) | BT-6 (sin evidencia in-sample) + decisión SPY-only | ✅ |

---

## 6. Gestión de posiciones

| Parámetro | Definición 2026-07-06 | Valor final | BT | Estado |
|---|---|---|---|---|
| **Profit target** | 50% del crédito | **50%** | BT-4 (política B domina en $/día; win 99%) | ✅ |
| **Salida forzada DTE** | roll ≥ 21 DTE | **eliminada** (sin salida por DTE) | BT-4: 21 DTE destruye win 97→75%, p5 −$110 (cristaliza rebotes) | ✅ |
| **hard_defense** | delta short > 0.30 ∨ pérdida ≥ 2× crédito | **delta short > 0.42 ∨ pérdida ≥ 2× crédito** (con entrada 0.25, 0.30 dispararía casi en la entrada) | BT-12 nota 4: deterioro gradual sin acantilado hasta 0.35 → umbral vive ~0.40–0.45 | ✅ **CERRADO** (recomendación 29-jul: 0.42) |
| daily_kill_switch | MTM −1% diario | **−1%** | §9 diseño; no refutado | ✅ |
| Rolls | OTM only, crédito neto, ≥21 DTE nueva | **idem**; ITM se cierra no se rolla | §9 diseño; no refutado | ✅ |
| Ex-div SPY (CCS) | block ≤3d, warn ≤7d | **conservar en JSON** (moot con PCS-only, reactiva si vuelve CCS) | §9 | 📐 |
| Mutación PCS→IC | acción de gestión | **muerta** (IC prohibido) | BT-11 | ✅ |

---

## 7. Cooldown / histéresis

| Parámetro | Definición 2026-07-06 | Valor final | BT | Estado |
|---|---|---|---|---|
| Cooldown | histéresis sobre edge, δ pendiente (BT-8) | **δ = refinamiento menor** (la ocupación de la posición hace ~80% del trabajo) | BT-7/BT-15: 304 señales-día → 68 trades por ocupación (17d prom.) | 📐 |

---

## 8. Orquestación — máquina de estados y arquitectura *(frontera)*

| Parámetro | Definición 2026-07-06 | Estado real | BT | Estado |
|---|---|---|---|---|
| Máquina de estados (7 estados) | VETOED · DORMANT · ARMED · WAITING_CAPACITY · TRIGGERED · COOLDOWN · IN_POSITION | **nunca implementada** (código = cascada lineal) | research valida la *señal*, no la orquestación | ✅ **CERRADO** (operador 29-jul: RPF completo) → 🔵 formalizar Fase 5 |
| Loop en backend + push `TradeSuggestion` (SignalR) | arquitectura invertida | **nunca implementada** (cero refs en `source/`) | — | 🔵 / ⚠️ **DECISIÓN 5** |
| Contrato `TradeSuggestion` (payload, TTL, state) | pendiente §13 | **sin formalizar** | — | 🔵 |

---

## 9. Régimen-cero (límite estructural nombrado, no feature)

| Métrica | Valor medido | BT |
|---|---|---|
| Espera máxima entre entradas | **803 días** (2017–2018, config vieja) → **272 días** (V2) | BT-7 / BT-15 |
| Espera p90 | 154 → 155 días | BT-7 / BT-15 |
| % días en posición | ~35% (V1) | BT-7 |

Consecuencia: el sistema pasa años esperando **por diseño**. No se resuelve con parámetros; las
palancas son capital (escala lineal) o un ciclo de research nuevo (2ª pata no correlacionada).

---

## 10. Caveats transversales que sobreviven al freeze

Estos no son parámetros pero condicionan la validez y deben quedar escritos en la spec:

1. **Ventana OOS 2018–2025 agotada** desde BT-10b. Todo veredicto habilita **a lo sumo paper**,
   nunca real directo.
2. **Calibración POP put es hija del drift** (13 años mayormente alcistas). Si el drift cambia, el
   factor cambia (BT-6 test IWM lo demostró). Monitorear el factor por ventana (criterio C4);
   C4 quedó en falla declarada en H3 (salto 0.215) — absorbido por barras robustas, no resuelto.
3. **In-sample vs walk-forward:** los números "perfectos" pre-BT-9 conocían 2018/2022. El
   walk-forward (BT-9b/H2, BT-10c/H3) es la evidencia válida; el resto es contexto.
4. **P1 (GEX) tiene un punto ciego de ventana:** el episodio que justifica el gate (2015) está
   fuera del OOS. Ver §3.
5. **La config final (delta 0.25 + GEX) es una INTERPOLACIÓN, no una fila medida.** El ganador
   de BT-17 (variante C) es delta 0.25 **sin** GEX (10.6 tr/año); BT-15 midió V2 **con** GEX a
   delta **0.30** (7.4 tr/año). La conjunción elegida —delta 0.25 **con** GEX— junta dos
   palancas validadas por separado (delta 0.25 = clavija limpia BT-12/17; GEX = seguridad BT-5)
   pero **nunca se imprimió como una sola corrida**. Números esperados acotados A↔C: ~8 tr/año,
   win ~97%, peor año ≤ −$140 (el GEX solo estrecha la cola, no aporta pérdidas). Decisión del
   operador (29-jul, opción **a**): se adopta como interpolación con este caveat; si en paper
   los ~8 tr/año no matchean, se corre la fila de confirmación (delta 0.25 + GEX + V2) con datos
   frescos. La etiqueta correcta NO es "variante C" a secas sino "variante C con capa gamma".

---

## 11. Decisiones del operador — TODAS CERRADAS (2026-07-29)

Las cinco filas ⚠️ que bloqueaban el freeze de la spec quedaron resueltas:

| # | Decisión | Resolución | Impacto |
|---|---|---|---|
| **1** | GEX≥0: mantener vs quitar (P1) | ✅ **mantener** (safety-first) | −2.3 tr/año vs cola no testeada; config queda interpolada (§10.5) |
| **2** | Regime engine: flags rápidos vs 8 regímenes | ✅ **flags rápidos** (lo validado) | no reabre research |
| **3** | Capital base / heat cap para V2 | ✅ **base ref $16k, cap 7% + maxDD 5% intactos; fondeo live ~$32k** | ningún límite de seguridad se relaja |
| **4** | Umbral hard_defense con entrada 0.25 | ✅ **delta 0.42** | defensa coherente con entrada 0.25 |
| **5** | Arquitectura: estados+loop backend vs cascada | ✅ **RPF completo** (estados + loop backend + push) | agranda Fase 5; es la visión objetivo |

**Freeze desbloqueado.** Fases 2 (definición v2) y 3 (JSON) hechas. Fase 4 abajo.

---

## 12. Fase 4 — reconciliación contra el CÓDIGO (2026-07-29)

Hallazgo al ubicar el JSON en `DataFeed.Api/Files`: **la capa de señal RPF ya está implementada**
(`DataFeed.Application/App/SignalGates/*`: `SignalGatesEvaluator`, `PopCalibrationTable`,
`SkewHistory`; + `Files/pop_calibration.json` y `Files/skew25_history.json` sirviendo datos). Corre
dentro de la cascada v1.4.0. Lo que NO existe es la orquestación (estados + loop + push). Por eso
Fase 4 pasó a tener **tres superficies: doc ↔ JSON ↔ código.**

### 12.1 Alineación confirmada (la señal implementada ES la señal RPF)

Valor por valor, el `signal_gates` del core + `SignalGatesEvaluator` coinciden con el RPF JSON:
VRP 1.2 · tail VVIX 110/130 & skew 0.05/0.08 score≥2 · edge `(cr/w)/pLoss` barras 1.05/1.10/1.10/1.20
· credit_min $0.30 & ratio 10% · short≤put_wall · POP trailing sin shrinkage · PCS. **El gap de los
cortes de etiqueta de régimen quedó CERRADO:** `definitions.regime_classification` ya existe
(0-15 low_vol / 15-25 normal / 25-30 elevated / 30+ caution) y la lee `CascadeUtils.ClassifyRegime`
(en `App/Shared/`; hasta 2026-08-06 vivía en `ValidationLayerHandler`).

### 12.2 Decisiones de Fase 4

| Fork | Decisión | Efecto |
|---|---|---|
| **A** — schema del JSON | ✅ **reestructurar a `signal_gates`** (espeja el core) | RPF reutiliza `SignalGatesEvaluator` SIN código nuevo; los 2 ejes viven en la definición |
| **B** — iv_rank | ✅ **removido** (gate Y display) | consistente con BT-0 + principio 2; "lo que no se usa no se muestra" |

### 12.3 Divergencias: v1.4.0 implementado vs RPF decidido

Estas son diferencias entre la estrategia **vigente** y la config RPF. El RPF JSON encoda los valores
RPF; algunas filas son además **limpiezas pendientes de la estrategia vigente**:

| Parámetro | v1.4.0 implementado | RPF decidido | Nota |
|---|---|---|---|
| delta_target | rango 0.25–**0.30** | **0.25** fijo | RPF más específico |
| ancho | permite hasta **$10** | **$5** | $10 = apalancamiento (BT-17) |
| sizing / heat | **1.5% / 4.5%** | **3.5% / 7%** | tres juegos de números en circulación |
| hard_defense | delta **0.30** | **0.42** | 🔴 v1.4.0: con delta 0.25-0.30 el 0.30 dispara casi en la entrada |
| **time_exit 21 DTE** | **ACTIVO** | **desactivado** | 🔴 v1.4.0 carga una regla que **BT-4 refutó** |
| daily_kill_switch | **1.5%** | **1%** | menor |
| iv_momentum | IV30 RoC | VIX RoC5d | BT-0 usó VIX RoC; divergencia menor a reconciliar |

Las filas 🔴 (`hard_defense 0.30`, `time_exit 21 DTE`) son candidatas a limpieza de la **estrategia
vigente v1.4.0**, fuera del scope RPF — decisión del operador.

### 12.4 Test de consistencia

`DataFeed.Tests/RpfRulesJsonTests.cs` (15 tests): congela invariantes RPF + verifica alineación con
el core + **prueba el reuse real** (corre `SignalGatesEvaluator` sobre el `signal_gates` del RPF JSON,
`ClassifyRegime` sobre su `regime_classification`, `PopCalibrationTable` sobre el served file). Suite
completo: **65/65 verde.** JSON RPF → v0.2.0-draft (reestructurado).

**Próximo:** Fase 5 (contrato `TradeSuggestion` + máquina de estados + loop backend = orquestación,
la parte NO implementada; se valida por diseño + paper).
