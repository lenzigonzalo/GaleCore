# GaleCore — Referencia de reglas (racional y notas)

Documento acompañante de `galecore_rules_core.json`. El JSON quedó adelgazado a **solo lo
operativo** (thresholds, flags, estructura, endpoints, fórmulas de una línea que cargan
parámetros). Toda la prosa —racional, interpretación, notas de diseño— vive acá, indexada por
nodo. Las validaciones que justifican cada valor están en `galecore-research-backtesting.md`.

**Regla de trabajo:** ante cualquier cambio de lógica, primero se actualiza el JSON (fuente de
verdad operativa) y este `.md` (fuente de verdad del porqué); recién después el backend/frontend.

---

## Estado y alcance (`_meta`)

- `version: 1.4.0-candidate`, `status: paper_only`, `enabled_for_live: false`.
- Encoda la **config C** validada en research (BT-15/16/17). Habilita a lo sumo paper: la
  ventana OOS 2018–2025 está agotada. La operación real exige validación en paper + capital en
  zona operable (§7.4 de la definición).

## Universo (`universe`)

- SPY + QQQ. La capa gamma (`signal_gates.gamma_support`) aplica **solo a SPY** — BT-6 midió
  que el GEX de cadena-QQQ (±2B) ignora el hedging que vive en NDX/futuros y no paga en QQQ.

## Estructuras (`strategy_scope`)

- **PCS-only en producción.** `structure_selection.enabled: false`. BT-11: iron condor y CCS no
  disparan ni una señal a probabilidades honestas (delta 0.25–0.30) — el IC es in-edgeable
  porque la calibración de calls muestra que el delta subestima el riesgo call ~1,5× (factor
  1,4–1,7 estable). Revivir IC/CCS exige un ciclo de research nuevo.
- `default_structure: put_credit_spread`. `forced_structure_while_disabled: put_credit_spread`.

## Gates de entrada (`signal_gates`) — el corazón de la restricción

Formaliza en el JSON los filtros H3 que hasta v1.3.1 vivían solo en los scripts de backtesting.
Cortocircuitantes, se evalúan tras `macro_regime`. El embudo medido (SPY, 206 días operables/año):

| Gate | Sobreviven/año | Racional |
|---|---|---|
| régimen (macro_regime) | 146 | VIX<30, TS normal, IVR 25–65, IV momentum ≤12% |
| `tail_score` | 121 | VVIX + skew25; **load-bearing**: sin él 2018 = −$2.605 y C3 falla (BT-10c) |
| `gamma_support` (GEX≥0) | 84 | seguro de cola; FLAG configurable (ver abajo) |
| `volatility_risk_premium` | 23 | **el más restrictivo** (~62 días); VRP≥1.2 |
| muro + crédito + `edge` | 14 | strikes sanos y que paguen más que el riesgo real |

### `volatility_risk_premium` (VRP ≥ 1.2)
- Denominador `realized_vol_30d_trailing` **deliberado**. Mide si vender prima paga *ahora*, y su
  lentitud en transiciones es protección, no bug. BT-16 refutó reemplazarlo por HAR-RV: el
  pronóstico decae más rápido y **reabrió el bear 2022** (año señal-día −$1.077, C3 falla). Un
  estimador más "preciso" es peor para un vendedor de cola que uno conservador.
- Falla conocida (no bloqueante): VRP >1.55 en calma es espejismo de denominador (BT-10b) — es
  *conditioner*, no gate.

### `tail_score`
- VVIX (warn ≥110 / block ≥130, CBOE) + skew25 RoC5d (warn ≥5% / block ≥8%). Puntos
  none/warn/block = 0/1/2; suma ≥2 → engine_out. Suavizado de rachas (huecos ≤2d). Score de
  mercado (SPY), aplica a todo el universo.

### `gamma_support` (GEX ≥ 0) — **APAGADO (2026-07-27), rol movido al macro**
- **Decisión del operador (2026-07-27):** `enabled: false`, y el requisito GEX ≥ 0 se movió al check
  macro `gex_total` bajando `gex_threshold_by_symbol` de 50B → **0** (SPY y QQQ). Motivo: con el piso
  macro en 50B, este gate ≥0 era **inerte** (50B > 0 nunca deja pasar GEX negativo), y el 50B era más
  estricto que lo backtesteado. Ahora el veto de gamma negativa lo hace el macro, activo en el handler.
- Contexto histórico: `enabled: true` mantenía el veto de gamma negativa. Los 15 episodios de estrés
  de BT-0 tenían GEX<0 en D0. **Su única activación medida (ago-2015) está FUERA de la ventana OOS
  2018–2025** — por eso quitarlo sale "gratis" en el backtest: la ventana no contiene el evento
  contra el que protege. `enabled: false` daba +2,3 trades/año (7,4→9,9 en cartera V2, BT-17 P1).
- **Advertencia:** apagar el gate ≥0 dedicado + mover el veto al macro es una **cesión de seguridad
  real** (gamma negativa no testeada), no un almuerzo gratis. El macro sigue vetando GEX<0, pero se
  perdió el margen del piso de 50B.
- Nota de implementación: hoy el handler **no evalúa `signal_gates`** (Fase 2b pendiente), así que este
  flag es declarativo hasta que se cablee; el único cambio con efecto runtime es el umbral macro (→0).

### `edge` (≥ barra por régimen)
- `(crédito/ancho) / p_pérdida_trailing`. `p_loss` de la tabla POP empírica de puts, calibración
  trailing anti-lookahead, ventana expansiva anual, buckets n≥50, **sin shrinkage** (la palanca
  validada es el delta, no la calibración — BT-10b). Barras: low_vol 1.10 / normal 1.05 /
  elevated 1.10 / caution 1.20.
- Último gate; ~49 días/año mueren acá por centavos (crédito mediano $0.88 vs $0.91 necesario).
  **Bajar la barra es la palanca más cargada de cola — no tocar sin ciclo nuevo.**

### `short_below_put_wall` y `credit_minimum`
- Muro como restricción de sanidad: muerde <1% de las entradas, pero los trades sobre el muro
  promediaron −$152 (BT-3bis). NO es protección anti-crash (los crashes atraviesan muros).
- Crédito neto ≥ $0.30 y ratio anti-pennies ≥ 10% del ancho.

## Motor de strikes (`position_builder.layers[strike_engine]`)

- `delta_target`: short put ∈ **[0.25, 0.30]**. Meseta robusta validada en BT-12 (0.28–0.32
  pasan C1/C3 con métricas casi idénticas — 0.30 no es pico fiteado). El rango permite al motor
  elegir dentro de la zona segura según crédito disponible. Delta más bajo = más ocurrencia
  (BT-12: la tabla trailing ve más mispricing en el wing lejano) y mejor win; más alto = más
  crédito/trade.
- `spread_width` SPY/QQQ default **$5**. BT-13c/BT-17: a riesgo constante el $5 domina al $10;
  ensanchar es apalancamiento (más $/trade y más max loss), no alpha. `max $10` disponible como
  degradación si el crédito no cumple.

## Microestructura (`layers[microstructure]`)

- **OI ≥ 100** (bajado de 2000). BT-8: en SPY el OI no predice calidad de quote; el gate de
  spread ≤5% del mid es el que trabaja y se auto-protege. Excepción histórica 2013–2017 (otra
  microestructura) donde el filtro de spread muerde más — correcto y realista.

## Riesgo y sizing (`layers[risk_and_sizing]`)

- `max_positions: 2` escalonadas (vencimientos distintos) = **cartera V2** (BT-15): +170% de P&L
  vs 1 posición, mejora el peor año y el win (la 2ª posición diluye en clusters buenos).
- **Brecha de heat abierta (decisión pendiente del operador, no de research):** el JSON usa
  `max_heat = NL*0.045` (4,5%). Dos posiciones a ancho $5 son ~$820 de riesgo simultáneo = 8,2%
  de $10k. Para operar V2 dentro del cap hace falta subir el tope explícitamente **o** NL ≥
  ~$12k. A $10k el gate de heat deja el sistema en 1 posición.
- Escala del negocio (BT-17): config C ≈ **6,4% anual sobre $10k** (3,4% estrategia + ~3% cash en
  T-bills). Objetivo ~$200/mes ($2.400/año) ≈ ~$32k al blended de hoy. El sistema escala con
  capital, no con más gates.

## Gestión (`trade_management`)

- **Gestión B**: `take_profit.pct_of_initial_credit: 0.5` (cierre al 50% del crédito). Validada
  path-level (BT-4/BT-10c): rota el capital ~2× más rápido y arregla la cola (p5 positivo).
- `hard_defense` dispara con `short_leg_delta_abs > 0.30`. **Conflicto de diseño pendiente:** una
  entrada en el borde superior del rango (0.30) puede quedar cerca del disparo defensivo — BT-12
  sugiere que el umbral de defensa podría vivir más arriba (~0.40–0.45), a redefinir.

## Régimen macro (`macro_regime`)

`gex_threshold_by_symbol` **recalibrado 50B → 0 (2026-07-27)**. Historia: el 50B provenía del
diseño original; BT-5 recalibró la señal gamma operativa a `GEX ≥ 0`. Con el 50B como piso macro,
esa señal ≥0 era inerte y el sistema quedaba más estricto que el backtest. Ahora el macro `gex_total`
exige `GEX ≥ 0` (gamma positivo) para SPY y QQQ — es el veto de gamma negativa activo —, y el gate
dedicado `signal_gates.gamma_support` quedó `enabled: false` (redundante). El handler lee este umbral
del JSON (`ValidationLayerHandler.EvaluateLayer1`, operador `>=`), así que el cambio tiene efecto en runtime.

---

## Trabajo de backend pendiente (no es estrategia, es implementación)

Los handlers (`ValidationLayerHandler.cs`, `PositionBuilderHandler.cs`) hoy calculan VRP,
tail_score y GEX en código. Adoptar este JSON exige que lean el nodo `signal_gates` del JSON en
vez de tener los valores hardcodeados — coherente con la regla "el JSON es la fuente de verdad".
