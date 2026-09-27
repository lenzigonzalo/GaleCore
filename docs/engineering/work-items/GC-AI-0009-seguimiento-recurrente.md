---
id: GC-AI-0009
title: Seguimiento recurrente de la estrategia, creado y gestionado desde el chat
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0009 — Seguimiento recurrente acotado (roadmap §4, entrega 2)

Origen: owner, 27/09/2026 (repriorización). Caso conductor: `spy_prima_varianza_30_45d` (GC-AI-0008). Acepta la
dependencia de la PC encendida y los servicios locales; reutilizar el Programador de tareas de Windows; no construir un
gestor universal de agentes. La tarea no modifica la estrategia aprobada ni opera dinero.

## Acuerdo breve

- **Problema:** el seguimiento de GC-AI-0008 sólo corre cuando alguien lo pide en una sesión.
- **Qué vas a poder hacer:** «Hacé este seguimiento diariamente y guardalo» · «Mostrame el último resultado y el historial»
  · «Cambiá la frecuencia» · «Pausalo» · «Cancelalo», y encontrar el resultado desde otra sesión o en Obsidian.
- **Primera demostración:** ejecuciones automáticas reales guardadas, estado y errores visibles, pausa/cambio/cancelación
  efectivos, historial leído desde otra sesión.
- **Mecanismo verificado antes (27/09 18:38):** una tarea de prueba de `schtasks` corrió sola como el usuario, con su
  entorno (FRED_API_KEY presente) y alcanzó la API de GaleCore Dev; arranca en `system32` (rutas absolutas).
- **Fuera:** gestor general de agentes, host propio, ejecución en la nube, cualquier acción sobre la estrategia o dinero.

## Acceptance criteria

- [ ] **AC-01 — Descubrible y guiado:** entrada `recurring_followup` con su skill (define objetivo, frecuencia, zona
  horaria, fuentes, resultado; propone la recurrencia cuando aporta valor).
- [ ] **AC-02 — Ejecución real:** ejecuciones automáticas del Programador de tareas, sin sesión de Claude, cada una con
  estrategia, versión, hash, método, commit y fuentes.
- [ ] **AC-03 — Persistencia e historial:** cada resultado queda (registro de seguimiento con hash + evidencia +
  eventos encadenados) y se consulta desde otra sesión (`task status/history`, `LATEST.md`).
- [ ] **AC-04 — Control:** cambiar frecuencia, pausar, reanudar y cancelar desde el chat, con efecto verificado en el
  Programador; una tarea pausada o cancelada no corre.
- [ ] **AC-05 — Robustez:** sin ejecuciones solapadas; errores registrados y visibles; zona horaria convertida.
- [ ] **AC-06 — Límites:** la tarea sólo corre el seguimiento de sólo lectura.
- [ ] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `config/catalog.yaml` (`recurring_followup`), `config/skills/recurring-followup/skill.yaml`; `strategy_followup` 0.3.0 propone la recurrencia | catálogo en `test_knowledge.py` | — | Implementado |
| AC-02 | `application/tasks.py` (`WindowsScheduler`, `run`), `tools/task_runner.py` | `test_run_records_a_followup_tied_to_the_task` | PENDING (demo real) | Implementado |
| AC-03 | `contracts/task.py`, `tasks.events/status/runs`, `followup.history` | `test_an_edited_event_log_is_detected` | PENDING | Implementado |
| AC-04 | `tasks.set_frequency/pause/resume/cancel`, CLI `task` | `test_paused_or_cancelled_tasks_do_not_run`, `test_changing_frequency_recreates_the_schedule_and_keeps_pause` | PENDING | Implementado |
| AC-05 | lock exclusivo, `run_failed`, `local_time_for` + resync | `test_overlapping_runs_are_skipped_and_stale_locks_broken`, `test_a_failed_run_is_recorded_not_raised`, `test_timezone_is_converted_to_this_pc` | PENDING | Implementado |
| AC-06 | `TaskDefinition.kind` sólo `strategy_followup`; el runner sólo llama `run_followup` | `test_a_followup_never_writes_strategy_versions_or_approvals` | — | Implementado |
| AC-07 | — | — | — | Pendiente |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Límites declarados

- Corre sólo con la PC encendida y **el usuario con sesión de Windows iniciada** (modo «Interactive only», sin guardar
  contraseña); no hace falta una sesión de Claude. Necesita la API de GaleCore Dev levantada y sus credenciales de
  desarrollo; si falta, la ejecución queda registrada como ERROR.
- El Programador ejecuta el código del checkout registrado en la tarea (`code_path`); hoy es este worktree. Si se mueve o
  borra, la tarea falla (visible en `%LOCALAPPDATA%\GaleCore-AI\task_runner.log`). Pasa a `main` al cerrar.
- Zona horaria: el horario del owner se convierte a la hora local de esta PC al crear, y se re-sincroniza en cada
  ejecución si el desfase cambió (horario de verano de EE. UU.).

## Revisión interna R1 (agente `reviewer`, Sonnet, `5f49b53..274b23d`) — CHANGES_REQUESTED

Gate PASS, ruff, 792 tests, `diff --check`; sin secretos en la evidencia; commits del runner sólo sobre sus paths.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| R1-M1 | MAJOR | Carrera: `run()` podía guardar un `task.json` viejo encima de una pausa hecha en el medio | Corregido: lock de estado (`state.lock`) en toda lectura-modificación de `task.json` y eventos; `run()` relee la tarea bajo el lock antes de re-sincronizar (+test de pausa durante una ejecución) |
| R1-M2 | MAJOR | La cadena de eventos podía romperse con dos escritores simultáneos | Corregido: todo `append` va bajo el mismo lock (+test de lock ocupado) |
| R1-M3 | MAJOR | `set_frequency` borraba y recreaba: si fallaba la creación, la tarea quedaba sin registrar y sin rastro | Corregido: `schtasks /create /f` reemplaza en el lugar (si falla, queda la anterior) y el error se registra como `scheduler_error` (+test) |
| R1-M4 | MAJOR | Días hábiles que cruzan medianoche al convertir la zona horaria disparaban en días equivocados | Corregido: se rechaza ese caso con un mensaje claro (+test) |
| R1-m1 | MINOR | Condición redundante en `followup.analyse` | Corregido |
| R1-m2 | MINOR | Un commit fallido del runner no dejaba rastro durable | Corregido: evento `commit_failed` |
| — | Obs. | «La única ejecución fue manual; `schtasks` muestra 1999 como última» | **Disputado con evidencia:** el reviewer miró después de que `set-frequency` recreara la tarea. Antes, `schtasks /query` mostró «Last Run Time 27/09/2026 6:49:00 PM, Last Result 0» y el evento `run_started` tiene el PID 25440 (no esta sesión); la segunda automática (19:04, PID 2736) quedó en el Programador como «Last Run Time 7:04:01 PM, Last Result 0» |

## Demostración real (27/09, en curso)

- 18:45 «Hacé este seguimiento diariamente y guardalo» → `task create` diaria 17:49 America/New_York (18:49 local).
- **18:49:01 ejecución automática** (PID 25440) → `followup spy_prima_varianza_30_45d/20260927T214901Z`, commit del runner `8419ba7` en knowledge.
- 18:49 «Cambiá la frecuencia» → cada 15 min (prueba supervisada). **19:04:02 ejecución automática** (PID 2736).
- 19:04 «Pausalo» → Programador `Disabled`, próxima «N/A».
- 19:10 «Cancelalo» sobre `prueba-cancelacion`: registrada → cancelada → `schtasks` ya no la encuentra; `task run` posterior → SKIPPED.
- 19:21: pasadas las 19:19 la tarea pausada **no corrió** (última ejecución sigue 19:04). «Reanudalo» → `Ready`;
  «Cambiá la frecuencia: diario, después del cierre» → diaria 17:05 America/New_York (18:05 local), próxima 28/09.
- 19:2x: **recuperación desde una sesión limpia** (agente Haiku sin contexto, sólo comandos de lectura): encontró por el
  catálogo la estrategia 1.0.3 (no aprobada), la tarea diaria, el último resultado (22:04 UTC, DEGRADED), el historial y
  los puntos de atención. **Destapó una regresión:** las versiones históricas 1.0.1 y 1.0.2 figuraban INTEGRITY_FAILED
  porque el control de versiones de Codex C3 estaba en el contrato de lectura. Corregido: el control se aplica al guardar
  (`check_proposal`); lo guardado antes queda legible (+test). `kb search`: 0 fallas de integridad.

## Revisión Codex — NO CORRIÓ (27/09 ~19:13)

`codex_review.py --base 76e9958` (cubre la corrección C3 de 0008, el seguimiento y 0009): Codex respondió «usage limit…
try again at 10:51 PM». Sin revisión independiente de este rango todavía.
