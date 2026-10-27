# RPF — "Disparo por prima real" (Real Premium Firing)

> **Subcarpeta aislada** para la estrategia nueva. Objetivo: **no perder nada de lo diseñado** y
> desarrollarla como una estrategia **independiente** de la que corre hoy, dentro de la **misma
> aplicación + API**, reutilizando el código ya desarrollado (GEX, cadenas, Greeks, SignalR, etc.).
>
> **Estado (2026-07-29):** research cerrado, **definición alineada (v2)**, 5 decisiones del operador
> cerradas. **Sin código todavía** — próximo: JSON (Fase 3). Ver "Estado de la validación" abajo.

---

## Qué es RPF (en una línea)

Venta de prima con riesgo definido decidida por **dos ejes ortogonales**: la **seguridad *arma*** el
entorno y la **prima *dispara*** la operación (VRP + edge, en AND no-compensable). El sistema vive como
una **máquina de estados por símbolo** (VETOED · DORMANT · ARMED · WAITING_CAPACITY · TRIGGERED ·
COOLDOWN · IN_POSITION) y — a diferencia de lo implementado — el **loop corre en el backend** y empuja
`TradeSuggestion` por SignalR; el frontend es solo tablero.

Contexto completo de por qué esto es distinto de lo que corre hoy: ver la sección "Estrategia nueva
(RPF)" del [`../README.md`](../README.md).

## Contenido de esta carpeta

| Archivo | Rol |
|---|---|
| [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md) | **Definición canónica v2** — alineada al research (2026-07-29). Reemplaza al diseño original. Es el *qué y por qué*. |
| [`galecore-rpf-implementacion.md`](galecore-rpf-implementacion.md) | **Implementación (2026-08-07).** Cómo está en el código hoy: switch Workers, ranking de oportunidades, `legSymbols`, transporte SignalR, mapa de código. Es el *cómo*. |
| [`galecore-rpf-fase5-orquestacion.md`](galecore-rpf-fase5-orquestacion.md) | **Diseño de orquestación (Fase 5).** Contrato `TradeSuggestion` + máquina de estados + loop backend + ack. Doc-only; implementación = Fase 6. |
| [`galecore-rpf-reconciliacion.md`](galecore-rpf-reconciliacion.md) | **Libro mayor de reconciliación (Fase 0).** Valor final · BT · estado de cada parámetro. Contrato de la validación; ante duda de un número, manda este. |
| [`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md) | **Backtesting ejecutado** (BT-0…BT-17). Evidencia empírica. Copia RPF del research compartido de `../`. |
| [`galecore-rpf-plan-validacion.md`](galecore-rpf-plan-validacion.md) | **Plan de validación** original (BT-1…BT-8). Restaurado de `95ed70d` — contexto histórico del diseño de las validaciones. |
| [`archive/galecore-estrategia-rpf.diseno-2026-07-06.md`](archive/galecore-estrategia-rpf.diseno-2026-07-06.md) | **Diseño original pre-research** (verbatim). Reemplazado por la v2; se conserva por trazabilidad. |
| `new-estrategy-one-pager.docx` | One-pager ejecutivo (lenguaje natural, los 7 estados en español). |
| `GaleCore-Resumen-Config-Referencia.docx` | Resumen ejecutivo para el socio (10-jul) de la config validada H3/Config-C. |
| [`galecore_rules_rpf.json`](../../source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json) | **JSON de reglas — fuente de verdad operativa.** En `DataFeed.Api/Files/Rpf/`, servido tal cual por `GET /App/Rpf/Rules`. Ejes A/B + `pop_calibration` + `state_machine` + `research_provenance`. `paper_only`. |

## JSON de reglas — nuevo e independiente

El JSON de RPF es **completamente nuevo**, sin heredar el schema de `galecore_rules_core.json`.
Ubicado en **`../../source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json`** y servido
tal cual por `GET /App/Rpf/Rules`. Estructura: ejes A/B (arma/dispara) + `pop_calibration`
first-class + `state_machine` + `research_provenance` (ata cada nodo a su BT). Los valores salen del
libro mayor.

> **Actualizado 2026-08-07.** Cuando se escribió este README el JSON vivía en la raíz de `Files/` junto a
> `core/live/paper` y no tenía endpoint. Hoy tiene subcarpeta propia y endpoint; `live`/`paper` ya no
> existen (se fueron con la estrategia v1.4.0 el 2026-08-06).

**Nota — la capa de señal ya existe en código.** `DataFeed.Application/App/SignalGates/*`
(`SignalGatesEvaluator`, `PopCalibrationTable`, `SkewHistory`) ya computa VRP, edge con POP empírica,
tail/skew y gamma dentro de la cascada v1.4.0; y `Files/pop_calibration.json` + `Files/skew25_history.json`
ya sirven los datos. Lo que la Decisión 5 (RPF completo) agrega es la **orquestación** encima:
máquina de estados + loop backend + push `TradeSuggestion`. Consecuencia para Fase 4: el test de
consistencia tiene **tres superficies** — doc ↔ JSON ↔ **código**.

## Estado de la validación (2026-07-29)

Sesión de alineación en curso — plan de 6 fases (validar RPF = alinear definición ↔ research ↔ archivos):

- **Fase 0 ✅** — libro mayor de reconciliación escrito.
- **Fase 1 ✅** — las 5 decisiones del operador cerradas. Las 3 tensiones históricas quedaron
  **resueltas:** estructuras → **PCS-only** (BT-11); régimen → **flags rápidos** (no el de 8);
  parámetros → **calibración del backtest** (delta 0.25, GEX≥0, barras edge 1.05/1.10/1.20, VRP 1.2).
- **Fase 2 ✅** — definición canónica v2 escrita (este es el doc alineado).
- **Fase 3 ✅** — JSON `galecore_rules_rpf.json` (v0.2.0-draft tras Fase 4). Valores del libro mayor.
- **Fase 4 ✅** — test de consistencia doc↔JSON↔**código**. Hallazgo: la capa de señal RPF ya está
  implementada (`SignalGatesEvaluator` + `PopCalibrationTable` + `SkewHistory`) y coincide valor por
  valor con el JSON. Forks decididos: **A** — JSON reestructurado al schema `signal_gates` (reutiliza
  el evaluador sin código nuevo); **B** — iv_rank removido. Gap de etiquetas de régimen **cerrado**
  (`ClassifyRegime` ya existe). Test `DataFeed.Tests/RpfRulesJsonTests.cs` (15) + suite 65/65 verde.
  Divergencias v1.4.0↔RPF catalogadas en reconciliación §12.3 (2 candidatas a limpieza de la vigente).
- **Fase 5 ✅** — **diseño de orquestación** ([`galecore-rpf-fase5-orquestacion.md`](galecore-rpf-fase5-orquestacion.md)):
  contrato `TradeSuggestion` + máquina de estados (7 estados + precedencia) + loop backend
  (`RpfLoopService`, Tier A/B) + **ack explícito del operador** (Accept/Dismiss). Decisiones: doc-only,
  persistencia in-memory, TTL 2× Tier B, δ cooldown `null`. Todo `enabled:false`; se valida por diseño + paper.
- **Fase 6 ⏭** — **implementación** de la orquestación (esqueleto de código + deltas JSON del §9 +
  re-encuadre del tablero). Arranca inerte; se activa solo tras paper.
