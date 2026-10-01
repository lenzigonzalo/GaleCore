---
id: GC-AI-0017
title: Programar cualquier capacidad de sólo lectura — el briefing te llega solo (base del harness, entrega 5)
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0017 — Programar cualquier capacidad de sólo lectura

Roadmap §4, Parte 1, entrega 5 («Secuencia autorizada», owner 29/09). Mismo caso que las entregas 3 y 4: «¿Qué merece
mi atención hoy?» (`daily_attention`). Rama desde `feature/GC-AI-0016` (entrega 4 en espera de Codex); si esa revisión
cambia algo, se trae con un merge antes de revisar esta. **Aprobado por el owner el 30/09** («dale con la entrega 5»); se
empieza por AC-01.

## Acuerdo breve

- **Para qué:** que el briefing te llegue solo cada mañana, sin abrir una sesión ni pedirlo. Y que sirva igual para
  cualquier otra capacidad de sólo lectura que armes con el molde (entrega 3).
- **Capacidad que agrega:** una tarea programada puede correr cualquier capacidad del catálogo declarada
  *programable*. Hoy sólo puede correr el seguimiento de estrategias (`contracts/task.py`, `KINDS`).
- **Qué vas a poder pedir:** «Mandame la atención diaria de lunes a viernes a las 10» · «Pausala» · «¿Corrió hoy?» ·
  «Cancelala».
- **Cómo veremos que sirve:** una mañana, sin sesión abierta, aparece el briefing del día guardado, con la versión de la
  capacidad y del perfil y su evidencia. Le das feedback como a cualquier resultado (entrega 4).
- **Comparado con hoy:** el seguimiento de 0009 ya corre solo, pero es código sin modelo: junta datos y los guarda. El
  briefing necesita al modelo para leer, cruzar y escribir. Eso hoy sólo pasa si abrís una sesión.

## Decisión de arquitectura a aprobar: cómo corre el modelo sin sesión

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A (recomendada)** | El Programador de Windows lanza `tools/task_runner.py`. Para una capacidad con modelo, el runner llama a Claude Code sin sesión (`claude -p`) con la skill, las herramientas permitidas limitadas a los comandos de lectura del CLI (`--allowedTools`), un tope de turnos por corrida (`--max-turns`) y salida JSON con el esquema del contrato (`--json-schema`). GaleCore-AI valida y guarda el resultado con el mismo camino que una sesión (`research revise`), marcado `invoked_by=scheduler` | Usa el mismo host, las mismas skills y controles que ya probamos; sin clave nueva ni gasto aparte (usa el cupo del plan) | Depende de que Claude Code corra desde el Programador sin tu sesión de Windows abierta en pantalla (se prueba primero, AC-01); consume cupo del plan de Claude |
| B | El runner llama directo a la API de Anthropic (Messages) con una clave propia | No depende del CLI | Clave y facturación aparte (se reevalúa en producción); hay que reescribir el uso de herramientas que hoy hace el host; dos caminos distintos para lo mismo |
| C | Sin modelo: la tarea junta y guarda los datos a la mañana, y la lectura la hace el modelo cuando abrís una sesión | Costo cero; ya existe casi entero (0009) | No cumple «que te llegue solo»: el briefing sigue esperando que abras el chat |
| D | Rutina en la nube (`/schedule`) | Corre con la PC apagada | No llega a la API de GaleCore Dev (`localhost:7001`) ni a `knowledge/`, que son locales: descartada |

Recomiendo **A**, con **C como respaldo automático**: si el modelo falla o se pasa del tope de turnos, la corrida guarda igual los
datos del día y un resultado `INCOMPLETE` que dice qué faltó. Nunca un briefing inventado.

## Reutiliza (existe)

- **Programador completo** (0009): crear, frecuencia, pausa, reanudación, cancelación, traslado, frescura, bloqueo de
  solapamientos, eventos en `knowledge/tasks/<id>/events.jsonl`, runner (`application/tasks.py`, `tools/task_runner.py`).
- **Ejecución y registro común** (entrega 4): revisión de investigación con versión y hash de la skill, perfil citado,
  evidencia con hash; feedback atado al resultado.
- **Molde y catálogo** (entrega 3): `catalog --check` valida cada entrada; el mapa de fuentes dice el costo y los límites
  de cada dato.

## Qué falta, con código

- **Programable por declaración:** campo `schedulable` en la entrada del catálogo, sólo para capacidades de lectura (sin
  `strategy save|approve|deploy`, sin escribir el perfil). `catalog --check` rechaza una capacidad programable cuyo flujo
  tenga un comando que escribe algo distinto de su propio resultado.
- **`KINDS` abierto a esas capacidades:** una tarea nombra la capacidad; `task create` rechaza una no programable.
- **Runner con modelo (opción A):** arma el pedido desde la skill, limita herramientas y turnos, valida contra el contrato
  y guarda por el camino común. Registra en `events.jsonl` la duración y el resultado (`OK`, `INCOMPLETE`,
  `FAILED` con motivo).
- **Destino del resultado:** la revisión guardada + `LATEST.md` legible por capacidad (como 0009). Avisos, mail u otro
  canal: fuera de esta entrega.

## Primera demostración

1. En una sesión: «Mandame la atención diaria de lunes a viernes a las 10». Queda la tarea.
2. Sin sesión abierta, al día hábil siguiente: aparece la revisión del día (`invoked_by=scheduler`), `LATEST.md`
   actualizado y la corrida en `task status`.
3. En una sesión nueva: «¿Corrió hoy?» → estado y frescura; «Pausala» → no corre al día siguiente;
   «Reanudala» → vuelve.
4. Prueba de falla: con la API de GaleCore Dev apagada, la corrida guarda `INCOMPLETE` con el motivo, no un briefing.

## Non-goals

- Capacidades que escriben estrategias, aprobaciones, despliegues o perfil; órdenes; cualquier acción que requiera
  tu aprobación.
- Canales de entrega externos (mail, Slack, teléfono): se evalúan después con el uso.
- Correr con la PC apagada (opción D).
- Entrada única sin nombrar capacidades (entrega 6).

## Acceptance criteria

- [ ] **AC-01 — Acceso sin sesión probado primero:** desde el Programador, con la sesión de Windows bloqueada, `claude -p`
  corre con herramientas limitadas y tope de turnos y devuelve JSON válido. Si no se puede, se frena y se vuelve a
  decidir la arquitectura (antes de escribir el resto).
  **Evidencia 30/09 (parcial):** `docs/evidence/gc-ai-0017/probe_headless.py` + `probe_runs.jsonl`. Lanzado por el
  Programador (tarea de una vez, mismo tipo de inicio que la de 0009), `claude -p` con una sola herramienta permitida
  (`catalog`), `--max-turns 8` y esquema JSON: `OK`, 5 turnos, 20 s, salida validada (11 capacidades). Aprendido: con
  tope 4 falla (un turno se va en un intento con PowerShell no permitido y otro en entregar el JSON). **Falta:** la
  misma corrida con la pantalla bloqueada; se verifica con la primera corrida real de las 10:00.
- [x] **AC-02 — Programable por declaración:** `schedulable` en el catálogo; `catalog --check` rechaza una capacidad
  programable que escribe fuera de su resultado; `task create` rechaza una no programable.
  **Evidencia 30/09:** `harness/catalog.py` (`Schedulable`: `runs: code|model`, `max_turns`, `timeout_minutes` ≤ 25),
  `application/catalog_check.py` (`_schedule_problems`: sólo lecturas + su propio resultado; `research save|revise`
  con `--capability <id>`; scripts de lectura listados). Declaradas: `strategy_followup` (código) y
  `daily_attention` (modelo, 40 turnos, 20 min). `task create --capability` rechaza una no programable o inexistente,
  y la corrida lo vuelve a chequear. Tests: `tests/unit/test_catalog_check.py` (programables),
  `tests/unit/test_model_tasks.py`.
- [ ] **AC-03 — Corrida con modelo:** una tarea de `daily_attention` corre por horario desde `main`, sin sesión, y guarda
  una revisión válida con versión de skill y perfil, evidencia y `invoked_by=scheduler`.
  **Avance 30/09:** tarea `atencion-diaria-spy` creada (L–V 10:00 America/Argentina/Buenos_Aires, desde el worktree;
  se mueve a `main` con `task rebind` al mergear). Corrida manual 5: revisión 5 guardada con skill, perfil y 3
  evidencias (`docs/evidence/gc-ai-0017/manual_runs_2026-09-30.md`). **Falta:** la corrida por horario (1/10 10:00).
- [ ] **AC-04 — Tope:** cada corrida respeta su tope de turnos y registra la duración; `task status` la muestra.
  **Avance 30/09:** `--max-turns` y tope de tiempo del catálogo; la ronda de corrección cuenta dentro del tope;
  `run_finished` guarda `turns`, `max_turns`, `duration_s`; `task status` → `last_run`. Tests en `test_model_tasks.py`.
- [x] **AC-05 — Fallas:** sin datos o sin modelo → `INCOMPLETE`/`FAILED` con motivo, sin resultado inventado; `LATEST.md`
  dice que no se pudo.
  **Avance 30/09:** corridas manuales 1–4 reales: sin resultado válido del modelo quedaron `INCOMPLETE` con motivo y
  los datos del día; tests de `FAILED` (sin modelo ni datos) y de salida rechazada. Con la API de Dev **apagada**
  (corrida 6, 23:50 UTC): `INCOMPLETE` con el motivo y sin valores del runtime; `LATEST.md` lo dice.
- [x] **AC-06 — Pausa, reanudación y cancelación desde el chat**, con efecto en la corrida siguiente.
  **Evidencia 30/09:** pausa → Programador deshabilitado y corrida `SKIPPED`; reanudación → `Ready` para el 01/10
  10:00; cancelación (tarea descartable) → borrada del Programador y corrida `SKIPPED`
  (`docs/evidence/gc-ai-0017/manual_runs_2026-09-30.md`, horas de `events.jsonl`).
- [ ] **AC-07 — Demostración** del recorrido de arriba con tu briefing real.
- [ ] **AC-08 — Revisión:** interna y Codex (toca controles); utilidad y cierre, vos.

## Decisiones tuyas antes del código

| # | Pregunta | Estado |
|---|---|---|
| 1 | Cómo corre el modelo sin sesión | **Decidido (30/09):** con el plan de Claude Code actual (`claude -p`). No es gasto aparte: consume del mismo cupo que el chat. La API de Anthropic se decide al pasar a producción, sólo para las capacidades que necesitan modelo |
| 2 | ¿Te llega ya leído por el modelo o sólo los datos? | **Decidido (30/09):** leído por el modelo. El host es local: cada uno lo corre en su PC con su propio plan |
| 3 | Horario | **Decidido (30/09):** lunes a viernes a las 10:00 hora local (9:00 en Nueva York, antes de la apertura). PC y API de Dev prendidas |

**Alcance general (30/09):** lo decidido vale para cualquier capacidad de sólo lectura declarada programable, no sólo
el briefing: régimen diario, seguimiento de estrategias, investigaciones de contexto, un reporte macro creado con el
molde y, más adelante, el briefing con la cuenta real. Quedan afuera las que escriben estrategias, aprobaciones,
despliegues o perfil, y las órdenes.

**Recorte para no descartar trabajo en producción (30/09):** se reusa el Programador de Windows de 0009 tal cual (en el
VPS será un cron); la llamada al modelo queda en un solo punto intercambiable; fuera el aviso de Windows y la estimación
de costo. El tope por corrida queda sólo como protección del cupo (`--max-turns`), no como presupuesto en dólares.

## Cómo quedó la corrida con modelo (implementación, 30/09)

- **El modelo sólo lee.** `application/model_run.py`: Claude Code (`claude.exe`) con `--restricted
  --strict-mcp-config --tools Bash,Read` (sin la configuración del usuario ni conectores) y `--allowedTools` = los
  prefijos de los comandos de lectura del flujo y los scripts de lectura, que sólo escriben en el directorio de la
  corrida. El seguimiento del día lo corre el runner antes del modelo. No puede correr `evidence add` ni
  `research save|revise`: devuelve el contenido y la evidencia como JSON y **el runner valida y guarda** por las mismas
  funciones de una sesión (`save_evidence`, `revise_research`), con host `windows-task-scheduler+claude-code` y el
  modelo real. Prueba de aislamiento: `docs/evidence/gc-ai-0017/isolation_probe.md`.
- **Un solo punto intercambiable:** `ModelClient` (hoy `ClaudeCodeClient`; en producción, la API).
- **Fallas:** si el modelo no responde, se pasa del tope o su salida no valida, la corrida guarda igual los datos
  del día (`followup run` por código) y queda `INCOMPLETE` con el motivo; `FAILED` si tampoco hay datos. Nunca
  guarda un briefing que no pasó los validadores. `LATEST.md` de la tarea dice qué pasó.
- El pedido va por stdin: `claude` es un `.CMD` (límite de 8191 caracteres); lo encontró la primera corrida
  manual, que quedó `INCOMPLETE` con los datos del día guardados (prueba de falla real, 30/09 21:55 UTC).

## Cambio de alcance (30/09, aprobado en el chat): posiciones fuera de la versión seguida

La corrida 7 del briefing informó exposición 0 USD con dos spreads abiertos: el seguimiento (`application/followup.py`,
de GC-AI-0009) sólo leía la instancia de la versión aprobada más reciente. Ahora también lista, y marca como atención,
las posiciones abiertas de versiones anteriores de la estrategia y de otras specs con instancias (pide su reporte,
sólo lectura, y lo guarda como evidencia). Si un reporte no se puede leer, lo dice, sin asumir que la posición cerró.
`daily_attention` 0.2.3 las suma a la exposición. Verificado contra GaleCore Dev el 01/10 00:15 UTC: aparecen la 1.0.3
(d533f033) y la v2 (0bbd904a). Tests: `tests/unit/test_followup.py` (las dos últimas).

## Revisión interna (30/09, CHANGES_REQUESTED) y arreglos

| Hallazgo | Arreglo | Verificación |
|---|---|---|
| MAJOR 1: los scripts escribían en cualquier `<dir>` | El runner pasa `GALECORE_AI_RUN_DIR`; `fred_query.py` y `fed_calendar.py` rechazan un directorio que, ya resuelto, quede fuera (también con `..`) | `test_fed_calendar.py::test_under_a_scheduled_run_the_scripts_write_only_in_its_directory`; `isolation_probe.py` |
| MAJOR 2: el tope de tiempo no cortaba en Windows | Se llama directo a `claude.exe` (no al `.CMD`); `Popen` + `taskkill /T /F` al vencer; `timeout_minutes` ≤ 20 y corrección ≤ 240 s, por debajo del lock de 30 min | `test_a_timed_out_model_is_stopped_with_its_children`, `test_the_cmd_shim_is_replaced_by_the_real_executable` |
| MAJOR 3: `task list` desde `main` falla mientras exista una tarea de modelo | **Limitación transitoria hasta el merge** (ver abajo); la corrida de 0009 desde `main` no se afecta (lee sólo su `task.json`) | Verificado por la revisión |
| MAJOR 4: una excepción dejaba la corrida sin registrar | `run()` envuelve la corrida con modelo: cualquier excepción es `run_failed` con el motivo y `LATEST.md` lo dice | `test_an_unexpected_error_is_still_a_recorded_failure` |
| MINOR: el modelo podía correr `followup run` con otra tarea o estrategia | El runner corre el seguimiento **antes** del modelo y le pasa el registro; `followup run` sale de sus herramientas | `test_the_runner_runs_the_followup_and_commits_it_with_the_run`; `isolation_probe.py` |
| MINOR: evidencia huérfana por `retrieved_at` futuro; evidencia no citada se guardaba | Chequeo previo de la hora; sólo se guarda la evidencia citada | `test_evidence_from_the_future_is_refused_before_anything_is_saved`, `test_evidence_returned_but_not_cited_is_not_kept` |
| MINOR: prueba de aislamiento no reproducible | `isolation_probe.py` + `isolation_probe_runs.jsonl` con comprobaciones del sistema de archivos | Corrida del 01/10 |
| MINOR: lectura auto-aprobada fuera del checkout | Texto del pedido corregido; límite documentado en `isolation_probe.md` (no cerrado) | — |
| MINOR: horas de AC-06, matriz vacía, `ACTIVE_WORK_ITEM` en 0016 | Corregidos | este archivo |
| NIT: `--capability` por subcadena; scratch sin `LOCALAPPDATA`; catálogo cargado dos veces; `git add` del directorio de seguimientos | Argumento exacto; `tempfile`; una carga; rutas exactas | `test_the_own_capability_is_an_exact_argument` |

**Limitación transitoria (MAJOR 3):** hasta mergear 0016 → 0017 a `main`, una sesión que corre desde `main` no puede
hacer `task list` (rechaza la tarea `atencion-diaria-spy`). `task status <id>` y las corridas de cada tarea funcionan.
Para el chat: usar el CLI del worktree (`PYTHONPATH=src`) o `task status`.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 sin sesión, pantalla bloqueada | Programador → `tools/task_runner.py` → `ClaudeCodeClient` | — | `probe_runs.jsonl` (desde el Programador, sin bloqueo) | Parcial: falta la corrida de las 10:00 con la pantalla bloqueada |
| AC-02 programable por declaración | `harness/catalog.py` `Schedulable`; `catalog_check._schedule_problems`; `tasks.schedulable_entry` | `test_catalog_check.py` (programables), `test_model_tasks.py::test_only_schedulable_capabilities_can_be_scheduled`, `test_a_capability_no_longer_schedulable_does_not_run` | `catalog --check` del catálogo real: completo | Hecho |
| AC-03 corrida con modelo por horario desde `main` | `tasks._run_model`, `model_run.save_output` | `test_an_ok_run_saves_evidence_then_the_research`, `test_the_next_run_revises_the_same_investigation` | Corridas manuales 5 y 7 (rev 5 y 7) | Parcial: falta la corrida por horario y el `rebind` a `main` |
| AC-04 tope de turnos y duración | `--max-turns`, tope de tiempo con corte del árbol, ronda de corrección dentro del tope; `last_run` en `task status` | `test_no_correction_round_beyond_the_turn_cap`, `test_a_timed_out_model_is_stopped_with_its_children` | Eventos de las corridas 2–7 (`turns`, `max_turns`, `duration_s`) | Hecho en código; se confirma en la corrida por horario |
| AC-05 fallas | INCOMPLETE con los datos del día; FAILED con motivo; excepciones registradas | `test_without_a_valid_briefing_*`, `test_no_model_and_no_data_is_failed`, `test_an_unexpected_error_is_still_a_recorded_failure` | Corridas 1–4 y 6 (API apagada) | Hecho |
| AC-06 pausa, reanudación, cancelación | `tasks.pause/resume/cancel` (de 0009) con tareas de modelo | `test_a_paused_model_task_does_not_call_the_model` | `manual_runs_2026-09-30.md` (eventos 23:48) | Hecho |
| AC-07 demostración | — | — | — | Pendiente |
| AC-08 revisión | Interna: CHANGES_REQUESTED → arreglos de arriba | Recheck interno pendiente | — | En curso |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
