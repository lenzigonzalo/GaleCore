---
id: GC-AI-0023
title: Agentes en el monitor (estado, hallazgos y prender/apagar)
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0023 — Agentes en el monitor

Producto 1, siguiente entrega del handoff del 03/10 (owner 04/10: «dale»). Par en GaleCore: GC-0009 (pantalla Agentes).
Rama `feature/GC-AI-0023` desde `main` (`ee7ab5c`).

## Para qué

Que la pantalla Agentes del monitor muestre de cada agente si está prendido, si su último resultado está al día, la
última y la próxima corrida y lo que encontró, y que prenderlo o apagarlo desde ahí se aplique en la PC donde corre.

## Qué se hizo

- `application/space.py`: `agent_state` (definición + `freshness` + última corrida + hallazgos: el `LATEST.md` del
  seguimiento o, para las capacidades con modelo, la investigación resumida en markdown; tope 12 000 caracteres).
  La pieza `agent` del espacio lleva eso además de lo que ya tenía.
- Prender/apagar: el monitor no llega a esta PC, así que escribe `request: {status, at}` en la pieza.
  `apply_requests` lo aplica con `task pause|resume` (Programador + evento «Pedido desde el monitor por <usuario>»)
  antes de volver a publicar; un pedido imposible (agente cancelado) se publica como `request_error`.
  `publish_agents` = aplicar pedidos + publicar sólo lo que cambió. `space import` también aplica los pedidos antes de
  escribir (si no, los pisaría).
- `space agents [--install]` y `tools/space_sync.py`: la tarea `GaleCore-AI\espacio-agentes` lo hace cada 5 minutos
  (código, sin modelo; si falla, `%LOCALAPPDATA%\GaleCore-AI\space_sync.log`).

## Acceptance criteria

- [x] **AC-01 — Estado publicado:** test `test_an_agent_is_published_with_its_last_run_and_findings`; en vivo (04/10)
  `space agents` publicó los 3 agentes del usuario demo en GaleCore Dev (atencion-diaria-spy MISSED, seguimiento
  CURRENT, oportunidades PAUSED) y GC-0009 los muestra.
- [x] **AC-02 — Prender/apagar desde el monitor:** tests `test_the_monitor_turns_an_agent_off_and_on` y
  `test_a_request_that_cannot_be_applied_says_why`. Sin prueba en vivo sobre agentes reales (no se cambió ninguno).
- [x] **AC-03 — Tarea cada 5 minutos:** `test_the_sync_task_runs_every_five_minutes`. Se instala desde `main` con
  `space agents --install` al integrar.
- [x] **AC-04 — Suite:** `pytest tests/unit` y `ruff check src tests tools` limpios.
- [ ] **AC-05 — Cierre:** owner.

## Límites

- El cambio tarda hasta 5 minutos y necesita la PC prendida con sesión iniciada, como cualquier agente.
- El monitor escribe la pieza entera (el `PUT` reemplaza): si GaleCore-AI publica en el mismo instante, gana el último;
  el pedido perdido se ve porque el botón vuelve a su estado y se puede repetir.
