---
id: D-0001
title: Pivot v1.4.0 — PCS-only, paper primero
date: 2026-09-09
status: vigente
scope: galecore
---
**Contexto.** El backtesting (BT-0..BT-17, `GaleCore/docs/rpf/galecore-research-backtesting-rpf.md`) cerró la config C PCS-only; la línea multi-factor v2.x murió (PR #13 cerrado).

**Decisión.** La estrategia operativa es RPF/PCS sobre SPY (v1.4.0). Va a paper antes que a live. Expectativa: ~6,4 %/año; $200/mes ≈ $32k de capital. No se bajan gates para forzar retorno.

**Consecuencias.** Todo cambio de lógica pasa por research → JSON → backend → front → skill. El GEX es informativo, no operativo.
