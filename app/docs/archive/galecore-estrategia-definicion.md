# GaleCore — Definición de la estrategia (v1.4.0, PCS-only)

> **Propósito:** referencia conceptual de la estrategia vigente. La **fuente de verdad operativa**
> es el JSON de reglas (`../source/galecore-datafeed/DataFeed.Api/Files/galecore_rules_core.json`);
> el **porqué** de cada parámetro vive en [`galecore-rules-reference.md`](galecore-rules-reference.md);
> las **validaciones empíricas** en [`galecore-research-backtesting.md`](galecore-research-backtesting.md).
>
> **Estado:** `paper_only` — `enabled_for_live: false`. La ventana OOS 2018–2025 está agotada; la
> operación real exige validación en paper + capital en zona operable.
>
> **Historia:** la línea previa v2.x (clasificador multi-factor, 8 regímenes, IC/CCS) fue
> **invalidada** por BT-11 y está archivada en [`archive/`](archive/).
>
> **Alcance:** este doc describe la **cascada lineal PCS-only que corre hoy** (Main).

---

## 1. Qué es

Venta sistemática de prima con **riesgo definido**, capturando el decay temporal (theta) de opciones
OTM sobre índices líquidos (SPY, QQQ) cuando la estructura de gamma del mercado da soporte y la
volatilidad paga. Una sola estructura en producción: **Put Credit Spread (PCS)**.

**Prohibido:** naked shorts, ratio spreads, long direccional. Iron Condor y Call Credit Spread quedaron
`enabled:false` — BT-11 mostró que no disparan señal a probabilidades honestas (el delta subestima el
riesgo call ~1,5×). Revivirlos exige un ciclo de research nuevo.

## 2. Principios (invariantes)

1. **Safety-first.** Jerarquía de autoridad: veto de cola > GEX/régimen > edge. El objetivo no es
   operar más, sino que cada trade sea lo más seguro posible.
2. **Cash es una posición.** ~3% anual en T-bills es parte del retorno, no capital ocioso.
3. **Riesgo definido siempre.** Ninguna pérdida es abierta.
4. **Calidad de ejecución sobre frecuencia.** ~14 trades/año sobrevivientes es la feature, no el bug.

## 3. El embudo de decisión (gates cortocircuitantes)

Se evalúa en cascada; si un gate falla, no se abre nada. Embudo medido (SPY, ~206 días operables/año):

| Gate | Sobreviven/año | Qué mide |
|---|---|---|
| **macro_regime** | 146 | VIX<30, term structure normal, IV Rank 25–65, IV momentum ≤12% |
| **tail_score** | 121 | VVIX + skew25 RoC — veto de cola *(load-bearing: sin él 2018 quiebra)* |
| **gamma_support** (GEX≥0) | 84 | seguro de cola; flag configurable, solo SPY |
| **volatility_risk_premium** (≥1.2) | 23 | el más restrictivo — ¿vender prima paga *ahora*? |
| **muro + crédito + edge** | 14 | strikes sanos que paguen más que el riesgo real |

Detalle y racional de cada gate: ver `galecore-rules-reference.md` §`signal_gates`.

## 4. Motor de strikes y gestión

- **Delta short put ∈ [0.25, 0.30]** (meseta robusta, BT-12). **Ancho $5** (a riesgo constante domina
  al $10; ensanchar es apalancamiento, no alpha).
- **Gestión B:** cierre al **50% del crédito** — rota capital ~2× más rápido y arregla la cola.
- **Cartera V2:** hasta **2 posiciones escalonadas** (vencimientos distintos) = +170% P&L vs 1 posición.

## 5. Escala del negocio (realidad de capital)

Config C ≈ **6,4% anual sobre $10k** (3,4% estrategia + ~3% cash en T-bills). El objetivo de
**$100–200/mes ≈ ~$32k** de capital al blended de hoy. **El sistema escala con capital, no con más
gates** — bajar barras es la palanca más cargada de cola.

## 6. Decisiones abiertas del operador (no de research)

- **gamma_support flag:** default `true` (safety-first). Apagarlo suma ~2,3 trades/año cediendo
  protección no testeada fuera de la ventana OOS.
- **Brecha de heat:** a $10k, 2 posiciones a $5 (~8,2% de riesgo) exceden el cap 4,5% → el sistema
  queda en 1 posición. Para V2 real: subir el tope explícito o NL ≥ ~$12k.
- **Umbral hard_defense** (0.30 vs 0.40–0.45): conflicto de diseño menor, a redefinir en ciclo futuro.
