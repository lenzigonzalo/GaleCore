---
id: GC-AI-0022
title: Pedir sin nombrar skills (Producto 1, fase 3)
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0022 — Pedir sin nombrar skills

Owner, 03/10: «seguí con 2 y 3… probalo vos con algún caso de uso de trading». Rama desde `feature/GC-AI-0021`.

## Para qué

Que el trader pida en sus palabras («¿hay algo para vender prima esta semana?») y GaleCore-AI elija la capacidad
correcta, parta de su espacio (perfil, objetivos) y use los datos de GaleCore, sin que el trader nombre una skill.

## Qué se hizo

- `catalog --match "<pedido>"` (`application/route.py`): ordena las capacidades por las palabras del pedido contra lo
  que sirven y sus ejemplos de pedidos; pesa más el ejemplo más parecido. Sin coincidencia: lo dice y ofrece
  `capability_builder`. Ejemplos nuevos en `market_watch`, `strategy_design` y `strategy_followup`.
- `CLAUDE.md`: cada sesión parte del espacio (`space context`) y de `catalog --match`.
- Arreglos de la revisión interna de 0019–0021 (03/10, CHANGES_REQUESTED, 3 MAJOR): el modelo sin supervisión no
  recibe `GALECORE_USERNAME`/`GALECORE_PASSWORD`; una corrida de `market_hours` del Programador fuera de la sesión de
  Nueva York se saltea (los feriados no se conocen: límite declarado); dos objetivos largos con el mismo comienzo
  tienen claves distintas.

## Acceptance criteria

- [x] **AC-01 — Ruteo:** 9 pedidos reales van a su capacidad y uno ajeno dice que no hay (`tests/unit/test_route.py`).
- [x] **AC-02 — Caso de uso real (03/10, como host):** «¿Hay algo para vender prima esta semana en SPY o QQQ sin meterme
  en el CPI?» → `space context` (perfil v5: 5 % = 500 USD por operación, 30–45 días) → `catalog --match` → `market_watch`
  → `galecore get` (IV rank SPY 16,4 y QQQ 24,7; IV sobre la realizada +5,1 y +6,5 puntos; CPI 14/10, PPI y ventas
  minoristas 15/10, FOMC 27/10; cadena y griegas de QQQ a 41 días). Respuesta: ningún vencimiento de 30–45 días evita
  el CPI; candidato de referencia QQQ PCS 705/701 13/11 (short delta 0,20, 5,9 % abajo del spot, pérdida máxima
  ≈ 342 USD), con precios teóricos del feed y no bid/ask.
- [x] **AC-03 — Arreglos de la revisión interna** con tests (`test_market_watch.py`, `test_space.py`).
- [ ] **AC-04 — Cierre:** vos.
