# Mapa de reconciliación — rules.json v2.1.5 (PR #13) vs. backtesting

> **Propósito:** confrontar cada nodo del JSON propuesto en el PR #13
> (`feat(strategy): rules.json v2.1.5`) contra lo que el backtesting
> efectivamente validó (BT-0 → BT-16, `docs/galecore-research-backtesting.md`).
> **No aplica cambios** — es la hoja de decisión para depurar la estrategia final.
>
> **Fecha:** 2026-07-23 · **Base JSON:** v2.1.5 (rama `feat/rules-v2.1.5-json`)
> **Base backtest:** config de referencia H3.

## Config de referencia validada (el objetivo)

De BT-10c → BT-16, veredicto firme y repetido:

> **PCS-only · SPY delta 0.30 · ancho $5 · trailing puts · tail_score · GEX≥0 (solo SPY) · gestión B (cierre 50%) · cartera V2 (2 posiciones escalonadas)** — QQQ réplica out-of-family.

## Leyenda

- ✅ **Alineado** — el JSON ya refleja lo validado, no tocar.
- ⚠️ **Conflicto / decisión** — el JSON contradice el backtest; requiere tu decisión.
- 🔴 **Roto / inválido** — el nodo apunta a algo que el backtest mostró incorrecto.
- 🟡 **Andamiaje apagado** — `enabled:false`, honesto, pero desalineado con lo *activo* en la referencia.

---

## 1 · Alcance y estructura

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `strategy_scope.allowed_strategies` | `[iron_condor, put_credit_spread, call_credit_spread]` | IC y CCS = **0 señales en 8 años**; IC "estructuralmente in-edgeable" a estos deltas | ⚠️🔴 | IC/CCS → declarados pero desactivados; PCS única operable |
| `strategy_scope.default_structure` | `iron_condor` | PCS-only | ⚠️ | `default_structure: put_credit_spread` |
| `strategy_scope.structure_selection_method` | `multi_factor` (motor de 8 reglas) | El motor **degrada** el sistema: la regla 1 secuestra días simétricos a IC (que nunca dispara); ocurrencia 14,4→2,2/año | 🔴 | Motor `multi_factor` → re-diseño (ciclo nuevo). No operable como está |
| `universe.tickers` | `[SPY, QQQ]` | SPY principal + QQQ réplica validada; QQQ hoy sin alfa (NO_OPERAR puntual) | ✅ | Mantener |

**Referencia:** BT-11 REPROBADO (`galecore-research-backtesting.md:724`).

---

## 2 · El gate que falta (lo más importante)

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `definitions.iv_rv_ratio` + check `iv_vs_rv` | Existe; `enabled:false`; acción `warn` | El **VRP con RV30 trailing es el gate DURO de entrada** — eje de todo el backtest | ⚠️🟡 | Elevar a gate duro (no `warn`); computar el ratio (dato base `rv_short` ya existe) |
| *(ausente)* tabla `vrp_min`/`min_edge` por régimen | No existe en el JSON | Tabla placeholder central de calibración (sección 5); target de BT-2/BT-3 | ⚠️ | Decidir: ¿incorporar la tabla por régimen? |
| `definitions.credit_ratio` / `credit_ratio_min_by_iv_rank` | Regla 1/3 (0.25–0.33) como calidad | La calidad validada es **edge = (credit/width)/(1−POP)** con POP trailing; el creditRatio solo dejó pasar el trade patológico edge-0.53 | ⚠️ | Decidir: ¿edge gate reemplaza o convive con 1/3? |

**Nota clave:** hoy el JSON **no tiene** el gate de alfa que el backtest más valida.
`iv_vs_rv` está apagado y como `warn`. Sección 7 + hallazgo colateral (`:1301`).

---

## 3 · Números de la posición (conflictos duros)

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `strike_engine.checks.put_strike_delta` | `|Δput| ≤ 0.20` | **delta 0.30** — meseta validada, robusta ±0.05 | ⚠️ | 0.20 → 0.30 |
| `strike_engine.checks.call_strike_delta` | `|Δcall| ≤ 0.18` | PCS-only ⇒ el call side no opera | ⚠️ | Moot bajo PCS-only |
| `regimes[].delta_max_put/call` | 0.15–0.20 según régimen | 0.30 base | ⚠️ | Reconciliar con 0.30 (o justificar reducción por régimen) |
| `spread_width.symbol_overrides.SPY` | default **10**, min 5 | **$5 óptimo** por unidad de riesgo | ⚠️ | SPY default 10 → 5 |
| `spread_width.symbol_overrides.QQQ` | default 5 | $5 | ✅ | Mantener |
| `dte_selection` | target 45, 35–45 | ~45 DTE, buckets 30–50 | ✅ | Compatible (menor) |
| `definitions.pop_proxy` | `(1−|delta|)×100` | POP≈1−|delta| **subestima riesgo call ~1.5×**; se usa POP empírico trailing por lado | ⚠️ | Reemplazar proxy por tabla empírica trailing (`pop_obs_*`) |

**Referencia:** BT-10c/BT-12 delta 0.30 (`:597`, `:748`); BT-13 ancho $5; BT-1 POP.

**Tell interno:** `hard_defense` dispara a `Δ > 0.32` — coherente con entrada 0.30, no con 0.20. El diseño de gestión ya asumía 0.30 mientras los checks de strike quedaron en 0.20.

---

## 4 · GEX y régimen

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `definitions.gex_total` (fórmula) | `Σ OI·gamma·100·spot²·0.01` | Reconstrucción da mediana ~0B / p90 7B vs umbral 25B → dispararía 99,7% de los días. Consistente con bug `netGexBillions` | 🔴 | Recalibrar fórmula/umbral antes de usar como gate |
| `gex_threshold_by_symbol` | SPY/QQQ = **25B** (pero regímenes piden `gex_above: 50` y `25`) | Umbral incompatible; componente GEX **excluido del régimen** | 🔴⚠️ | Solo `GEX≥0` como signo, **solo SPY**, hasta el fix. Resolver la inconsistencia 25 vs 50 |
| `spot_vs_zgl` | check activo | No testeado (requiere ZGL histórico, pendiente junto al fix GEX) | ⚠️ | Marcar pendiente |
| `regime_engine` (matriz 8 regímenes) | 8 regímenes por VIX/IVR/GEX/ZGL | Inputs rápidos (VIX≥30 ∨ VIX9D>VIX3M ∨ RoC5d VIX>12%) dan lead +3d mediano, 11/15 episodios | ✅⚠️ | Detección temprana validada; pero condición `gex_below` rota y `crisis.vix_above:40` ≠ detección a VIX≥30 usada en BT-0 |

**Referencia:** BT-0 punto 5 (`:112`).

---

## 5 · tail_risk_score

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `tail_risk_score.inputs` | 4 ángulos: skew, vvix, hy_oas, put_call — **todos `enabled:false`** → score = 0 hoy | La config de referencia corre **con tail_score activo** | 🟡⚠️ | Decidir qué ángulos alimentan la versión validada |
| Ángulos individuales | skew/vvix/put_call/hy_oas | skew/vvix/put_call **nunca backtesteados**; umbrales calibrados con ~5 crashes (muestra de un dígito, provisorios) | ⚠️ | Tratar como provisorios/sobreajustados (sección 1) |
| `individual_override` (pct 99, 2 lecturas) | block_new_entries | No validado | 🟡 | Mantener apagado hasta datos |

**Nota:** el diseño (score de coincidencia, `levels warn/block`, `disabled_angles_contribute:0`) es sano. El problema es que lo *activo* (score=0) ≠ la referencia (tail_score prendido).

---

## 6 · Microestructura, sizing y muros

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `put_strike_outside_wall` (put < put_wall) | discard si falla | Muro como **restricción** de sanidad (no ancla): muerde <1% pero donde muerde evita −$152/trade | ✅ | Mantener (Capa 2 redefinida, 3-bis) |
| `structural_support_loss` (muro entra al short) | close, 2 recalcs | Coherente con muro-restricción dinámico | ✅ | Mantener |
| `credit_minimum` $0.30 absoluto | gate | El $0.30 absoluto dejó pasar el trade edge-0.53 en el sistema viejo | ⚠️ | Cubierto si entra el edge gate; revisar redundancia |
| `correlated_exposure_cap ≤ 2` | mismo lado/cluster | Cartera V2 = 2 posiciones escalonadas | ✅ | Alineado |
| `risk_per_trade` 2.5% / `max_heat` 8% NL | sizing | V2 con 2 posiciones delta-0.30 ancho $5, max loss ~$410/trade | ✅⚠️ | Consistente; validar heat con cartera V2 |
| Lógica "escalonada" (staggering) V2 | no está | BT-15 V2 candidata | ⚠️ | Decidir si se explicita en el contrato |

---

## 7 · Gestión de trade

| Nodo JSON | JSON dice | Backtest | Estado | Acción propuesta |
|---|---|---|---|---|
| `take_profit.pct_of_initial_credit` | **0.5** | = gestión B (cierre al 50%, path-level) | ✅ | Alineado — corazón de la referencia |
| `time_exit.dte_threshold` | 21 (close) | Gestión B: **sin salida por DTE** (BT-4-B) | ⚠️ | Conflicto: la referencia no sale por DTE. Decidir |
| `hard_defense` (Δ>0.32 ∨ pérdida≥2×) | evaluate | Pendiente de validación (b) | ⚠️🟡 | Δ0.32 coherente con entrada 0.30; validar |
| `defensive_roll` (pérdida≥1.0, máx 1) | roll | Modelado como fricción $6,30; ~15% prob. defensa | ✅⚠️ | Compatible con fricción medida (sección 7) |
| `daily_kill_switch` 1.5% NL | block resto sesión | No testeado explícito | 🟡 | Prior de diseño; mantener |

---

## Resumen de decisiones abiertas (para depurar por orden)

**Bloque A — traer el backtest al JSON (conflictos duros, cambian decisiones):**
1. PCS-only: IC/CCS desactivados, `default_structure` = PCS, motor `multi_factor` → re-diseño.
2. delta 0.20/0.18 → **0.30** (checks + regímenes).
3. ancho SPY 10 → **5**.
4. `pop_proxy` → tabla empírica trailing por lado.

**Bloque B — wirear la pata faltante:**
5. VRP/edge como **gate duro** (hoy `iv_vs_rv` apagado + `warn`).
6. Decidir: edge = (credit/width)/(1−POP) ¿reemplaza o convive con regla 1/3?
7. ¿Incorporar tabla `vrp_min`/`min_edge` por régimen?

**Bloque C — marcar lo roto/diferido explícitamente:**
8. GEX: fórmula/umbral rotos → solo `GEX≥0` signo, solo SPY, hasta el fix.
9. Resolver inconsistencia interna del umbral GEX (25 vs 50).
10. tail_score: qué ángulos alimentan la versión validada (vs. 4 apagados).
11. `time_exit` DTE 21 vs. "sin salida por DTE" de la gestión B.
12. Explicitar (o no) la cartera V2 escalonada en el contrato.
