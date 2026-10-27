---
id: GC-AI-0023
title: Agentes en el monitor (estado, hallazgos y prender/apagar)
status: CLOSED
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
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
  antes de volver a publicar. Se rechaza, con el motivo en `request_error` (queda hasta el próximo pedido): un pedido
  sin hora, uno anterior al último cambio del agente (el owner decidió algo después), una pieza cuyo id no es el agente
  de su clave, y un agente cancelado (la pieza se publica como cancelada). Una pieza que el monitor cambió mientras se
  publicaba no se pisa: queda para la pasada siguiente.
  `publish_agents` = aplicar pedidos + publicar sólo lo que cambió. `space import` también aplica los pedidos antes de
  escribir (si no, los pisaría).
- `space agents [--install]` y `tools/space_sync.py`: la tarea `GaleCore-AI\espacio-agentes` lo hace cada 5 minutos
  (código, sin modelo; si falla, `%LOCALAPPDATA%\GaleCore-AI\space_sync.log`).

## Acceptance criteria

- [x] **AC-01 — Estado publicado:** test `test_an_agent_is_published_with_its_last_run_and_findings`; en vivo (04/10)
  `space agents` publicó los 3 agentes del usuario demo en GaleCore Dev (atencion-diaria-spy MISSED, seguimiento
  CURRENT, oportunidades PAUSED) y GC-0009 los muestra.
- [x] **AC-02 — Prender/apagar desde el monitor:** tests `test_the_monitor_turns_an_agent_off_and_on`,
  `test_a_request_that_cannot_be_applied_says_why` (mira la fila en GaleCore), `test_an_old_request_does_not_undo_a_later_decision`
  y `test_a_piece_whose_id_is_not_its_agent_is_refused`. Sin prueba en vivo sobre agentes reales (no se cambió ninguno).
- [x] **AC-03 — Tarea cada 5 minutos:** `test_the_sync_task_runs_every_five_minutes`. Se instala desde `main` con
  `space agents --install` al integrar.
- [x] **AC-04 — Suite:** `pytest tests/unit` y `ruff check src tests tools` limpios.
- [x] **AC-05 — Cierre:** owner, 04/10 (ver «Cierre»).

## Límites

- El cambio tarda hasta 5 minutos y necesita la PC prendida con sesión iniciada, como cualquier agente.
- El monitor escribe la pieza entera desde lo que leyó (≤ 60 s antes): puede tapar una publicación más nueva hasta la
  pasada siguiente.
- `findings`, `reason` y `error` salen de la PC a GaleCore sin el filtro de secretos de `evidence` (hoy ningún camino
  conocido mete una clave ahí).

## Revisión interna (04/10)

CHANGES_REQUESTED (1 BLOCKER, 2 MAJOR, MINOR): agente cancelado que seguía «prendido» y sin `request_error`; pedido
viejo que deshacía una decisión posterior; pantalla que mostraba «Al día» con la PC apagada (arreglado en GC-0009:
«Sin noticias de tu PC» y fecha de publicación); id sin validar; pedido pisado durante la publicación; `request_error`
efímero; puntero `ACTIVE_WORK_ITEM` en 0019; sangría en el `claude.md` de GaleCore. Todos arreglados salvo el filtro de
secretos (límite declarado). Suite: `pytest tests/unit` 1060+ y ruff limpios (se repite al integrar).

Recheck interno 04/10: **APPROVE**. De sus MINOR se arreglaron: `space import` publica los agentes con `publish_agents`
(no pierde pedidos ni `request_error`); una pieza `agent` con contenido roto ya no queda postergada para siempre; un
pedido con hora futura (reloj adelantado) se rechaza; tests de la postergación y de la pieza rota. Queda: la fecha de
publicación que muestra el monitor también cambia con el clic del propio usuario (MINOR, GC-0009).

## Cierre

**CLOSED por el owner el 04/10/2026** («ok, cerrá GC-AI-0024 y el lote pendiente»), en lote con GC-AI-0019…0024.
Revisión: interna (con sus arreglos registrados arriba); sin Codex. Demos reemplazadas por ejemplos internos y corridas
reales (regla del 03/10).
