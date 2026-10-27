---
id: D-0002
title: skew25 domina el tail_score; necesita historia
date: 2026-09-09
status: vigente
scope: galecore
---
**Contexto.** En el veto de cola, el skew (no el VVIX) explica ~77 % de las decisiones. El skew25 necesita ~6 días de historia para ser estable.

**Decisión.** La persistencia de skew25 (`SkewSnapshotService`, `skew25_history.json`) es prerrequisito del tail_score real. Mismo criterio aplica a GEX: sin historia no hay análisis de evolución (UC-2).
