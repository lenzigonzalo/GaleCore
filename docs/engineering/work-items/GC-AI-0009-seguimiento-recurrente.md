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
  estrategia, versión, hash, método, commit y fuentes. Incluir una automática posterior al fix de procedencia y otra
  desde el checkout estable después del traslado auditable con `task rebind`, conservando identidad e historial.
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
| AC-02 | `application/tasks.py` (`WindowsScheduler`, `run(invoked_by=)`), `tools/task_runner.py` | `test_run_records_a_followup_tied_to_the_task`, `test_manual_and_scheduled_runs_are_told_apart` | `scheduler-20260928-post-fix.txt`: automática por horario 28/09 18:05 (`invoked_by=scheduler`, ERROR por API caída) y a demanda por el Programador desde worktree (OK) y desde main (OK, 18:23). **Falta:** automática por horario desde main (29/09 17:05 NY) | Parcial |
| AC-03 | `contracts/task.py`, `tasks.events/status/runs`, `followup.history` | `test_an_edited_event_log_is_detected` | Registros `20260928T210502Z`/`210847Z`/`212308Z` + eventos encadenados; `task status/history` en sesión | Verificado local |
| AC-04 | `tasks.set_frequency/pause/resume/cancel`, CLI `task` | `test_paused_or_cancelled_tasks_do_not_run`, `test_changing_frequency_recreates_the_schedule_and_keeps_pause`, `test_a_paused_rebind_that_cannot_disable_again_stays_consistent` | `scheduler-20260928-controles.txt`: pausa → Disabled/N/A; reanudar → Ready; frecuencia → Weekly L–V 18:10 y vuelta a Daily 18:05; cancelar → la tarea ya no existe y `task run` → SKIPPED | Verificado en el Programador |
| AC-05 | lock exclusivo, `run_failed`, `local_time_for` + resync | `test_overlapping_runs_are_skipped_and_stale_locks_broken`, `test_a_failed_run_is_recorded_not_raised`, `test_timezone_is_converted_to_this_pc` | ERROR real del 28/09 18:05 registrado y visible en `task status` | Verificado local |
| AC-06 | `TaskDefinition.kind` sólo `strategy_followup`; el runner sólo llama `run_followup` | `test_a_followup_never_writes_strategy_versions_or_approvals` | — | Implementado |
| AC-07 | — | — | — | Pendiente |

## Required validation

Orden para completar A (alineación con roadmap, 28/09): capturar automática post-fix y evaluación real de 1.0.3
(AC-06 de 0008); trasladar con `task rebind` ya implementado; capturar automática desde main; enlazar toda la evidencia
aquí; ejecutar un recheck final acotado sobre fixes y hallazgos abiertos de 0008/0009. No repetir revisión completa ni
ampliar scheduler. Handoff vigente: `GaleCore-AI/docs/architecture/SESSION_HANDOFF.md` del workspace.

### Referencias operativas para los pasos 1–3 del roadmap

- Tarea: `seguimiento-spy-prima-varianza`; corrida prevista 28/09 17:05 NY. Leer
  `knowledge/tasks/seguimiento-spy-prima-varianza/events.jsonl` del workspace: inicio con `invoked_by=scheduler` y
  `scheduler_seen`, fin y seguimiento con versión/hash de 1.0.3. Si no está, registrar el faltante, no darla por ocurrida.
- Captura del Programador: `schtasks /query /tn "GaleCore-AI\seguimiento-spy-prima-varianza" /fo LIST /v`, guardando
  comando, salida sanitizada y exit code; contrastar con `task status seguimiento-spy-prima-varianza` y su frescura.
- Evaluación de 0008: desde workspace, `python GaleCore/dev/galecore_dev.py runtime-report --spec spy_prima_varianza_30_45d`.
- Traslado con la CLI `task rebind seguimiento-spy-prima-varianza --code-path <workspace>/GaleCore-AI --prompt "..."`;
  comprobar identidad/historial y automática posterior desde el destino, como exige AC-02.
- Con evidencia completa: desde workspace,
  `python .worktrees/galecore-ai/GC-AI-0009/docs/evidence/gc-ai-0009/codex_review.py --recheck docs/engineering/reviews/GC-AI-0009-20260928T155533Z.md --base 5103d50 --model gpt-5.6-sol`.
  Incluir fixes de `every_minutes`/`rebind`, evidencia de ambos checkouts y resolución referenciada del C3 de 0008.

La primera lectura útil se muestra antes de terminar ese recheck; presentar cierre requiere la evidencia completa.

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
  borra, la tarea falla (visible en `%LOCALAPPDATA%\GaleCore-AI\task_runner.log`). Se traslada a `main` con `task rebind`
  y se prueba la ejecución automática desde ahí antes del recheck final y del cierre. No borrar el worktree durante el traspaso.
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

## Revisión Codex C4 (28/09, `76e9958..78c8541`) — CHANGES_REQUESTED

Review: `docs/engineering/reviews/GC-AI-0009-20260928T145832Z.md` (797 tests, gate/ruff OK en su rerun).

| # | Sev. | Hallazgo | Triage |
|---|---|---|---|
| C4-B1 | BLOCKER | «Aprobación y despliegue de 1.0.3 afirmados sin autorización del owner» | **Rechazado en lo sustancial:** el prompt del driver (`codex_review.py`) seguía diciendo «approval pending», escrito antes de la decisión del owner del 27/09 20:20 (citada en GC-AI-0008). **Válido lo accesorio:** la matriz de GC-AI-0008 (AC-05/AC-06) y el roadmap no se habían actualizado → corregidos; prompt del driver corregido |
| C4-M1 | MAJOR | Toda corrida (manual o del Programador) se sella `windows-task-scheduler` | Corregido: `run(invoked_by=)`; sólo `tools/task_runner.py` pasa `scheduler` (host `windows-task-scheduler`), la CLI `task run` queda `manual-cli`; `run_started` guarda `invoked_by` y, si es del Programador, `scheduler_seen` (Last Run Time/Result, estado, próxima). Test `test_manual_and_scheduled_runs_are_told_apart` |
| C4-M2 | MAJOR | Las corridas automáticas del 27/09 sólo están en prosa | **Aceptado:** esas dos corridas quedan como no demostradas de forma reproducible. AC-02 vuelve a PENDING hasta la corrida del 28/09 17:05 NY con `invoked_by=scheduler` + `scheduler_seen` + consulta `schtasks` guardada como evidencia |
| C4-M3 | MAJOR | Cambio de frecuencia en pausa: si falla re-deshabilitar, estado y Programador divergen | Corregido: el estado guarda el horario ya registrado, sigue `paused` (el runner saltea), evento `frequency_changed` con `scheduler_left_enabled`, y se levanta el error pidiendo repetir `task pause`. Test `test_a_paused_frequency_change_that_cannot_disable_again_stays_consistent` |
| C4-M4 | MAJOR | Roadmap incoherente (activo, aprobación) | Corregido en `roadmap/README.md` (activo GC-AI-0009; 1.0.3 aprobada y desplegada; filas 1–3 al 28/09) |

Checks tras las correcciones: `engineering_gate` PASS, ruff OK, **799 passed**. Pendiente: evidencia de la corrida automática
de hoy y recheck acotado de Codex.

## Recheck Codex C4 (28/09, `78c8541..5103d50`) — CHANGES_REQUESTED

Review: `docs/engineering/reviews/GC-AI-0009-20260928T155533Z.md` (802 passed en su rerun).

| # | Estado según Codex | Triage |
|---|---|---|
| C4-B1 | DISPUTED/resuelto: la aprobación del owner está transcripta y corroborada | Sin cambios |
| C4-M1, C4-M3, C4-M4 | RESOLVED | — |
| C4-M2 | STILL OPEN: falta la corrida automática posterior al arreglo | Se captura tras la corrida del 28/09 17:05 NY (evento con `invoked_by`/`scheduler_seen` + `schtasks /query` con comando, salida y exit code) |
| R-N1 | NEW MAJOR: en `every_minutes`, `due = now − período` dejaba una omisión en `DUE_NOW` para siempre | Corregido: ancla = último inicio del Programador (o cuándo se fijó el horario) + un período. Test `test_a_prolonged_omission_of_a_minutes_task_becomes_missed` |

## Paso 1 del roadmap (28/09, 18:05 local) — corrida automática post-fix y evaluación real de 1.0.3

Evidencia: `docs/evidence/gc-ai-0009/scheduler-20260928-post-fix.txt` (`schtasks /query` con comando, salida y exit code;
eventos del 28/09 de `knowledge/tasks/seguimiento-spy-prima-varianza/events.jsonl`).

- **18:05:01 automática por horario** (`invoked_by=scheduler`, `scheduler_seen`, PID 12752) → `ERROR`: la API de GaleCore
  Dev estaba caída (último evento del runtime 20:00 UTC, última valuación 20:34 UTC). El fallo quedó registrado y visible
  (AC-05), no se omitió. Causa de la caída sin determinar; la API dependía de un proceso de sesión.
- 18:08 API levantada (`galecore_dev.py api`, persistencia recuperó 499 evaluaciones y 2 posiciones abiertas) y **la misma
  tarea lanzada a demanda en el Programador** (`Start-ScheduledTask`, no el horario) → `OK`, `invoked_by=scheduler`, PID 15540,
  `Last Result 0`. Prueba el camino Programador → runner → registro con la API arriba; la automática **por horario** con
  resultado OK queda para el 29/09 17:05 NY (o desde main, paso 2).
- **Evaluación real de 1.0.3 (28/09, `runtime-report`):** 286 evaluaciones 10:59–15:59 ET, todas con VIX ≈ 15,8 < 30 (PASS).
  La primera abrió un put credit spread SPY 722/717 (vence 06/11, 39 DTE, delta corta −0,16), crédito 0,44, riesgo máx. 456
  USD; las 285 siguientes: `ENTRY_SKIPPED` «máximo de posiciones abiertas alcanzado (1/1)». Al cierre: valor 0,405, P&L
  simulado +3,5 USD. La posición de la v2 (731/726P) sigue valuándose aparte (−11 USD). El único gate evaluado es VIX < 30.
- **Defecto encontrado y corregido:** tras un `ERROR`, el siguiente seguimiento tomaba como «desde» la corrida fallida y
  omitía lo ocurrido antes (el OK de 18:08 informó «eventos: ninguno» pese a la entrada del día). `run_followup` ahora ancla
  en la última corrida que leyó GaleCore. Test `test_after_an_error_the_window_starts_at_the_last_run_that_read_galecore`;
  805 passed, ruff OK. El registro 20260928T210847Z queda como está (hash); este párrafo lo explica.

## Recheck Codex (28/09, `5103d50..1c52c39`) — CHANGES_REQUESTED

Review: `docs/engineering/reviews/GC-AI-0009-20260928T221056Z.md`.

| # | Estado según Codex | Triage |
|---|---|---|
| C4-B1 | DISPUTED: la aprobación está transcripta | Sin cambios |
| C4-M2 | STILL OPEN: faltaba evidencia real de pausa, reanudación, frecuencia y cancelación | Corregido: `docs/evidence/gc-ai-0009/scheduler-20260928-controles.txt` (comando, estado y exit code de cada paso contra el Programador). Un primer intento del script de captura aplicó la pausa y falló antes de guardar la salida; se reanudó y se repitió la secuencia entera |
| NEW MAJOR | La automática desde el checkout estable fue lanzada a demanda | Aceptado: se captura la automática por horario del 29/09 17:05 NY desde main |
| NEW MAJOR | `rebind` de una tarea pausada: si volver a deshabilitar falla, estado y Programador divergen | Corregido como en `set_frequency`: guarda el nuevo `code_path`, sigue `paused` (sus corridas se saltean), evento `code_path_changed` con `scheduler_left_enabled` y error pidiendo repetir `task pause`. Test `test_a_paused_rebind_that_cannot_disable_again_stays_consistent` |
