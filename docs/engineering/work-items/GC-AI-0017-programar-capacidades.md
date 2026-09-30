---
id: GC-AI-0017
title: Programar cualquier capacidad de sólo lectura — el briefing te llega solo (base del harness, entrega 5)
status: DRAFT
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
cambia algo, se trae con un merge antes de revisar esta. **Borrador para aprobar antes de escribir código.**

## Acuerdo breve

- **Para qué:** que el briefing te llegue solo cada mañana, sin abrir una sesión ni pedirlo. Y que sirva igual para
  cualquier otra capacidad de sólo lectura que armes con el molde (entrega 3).
- **Capacidad que agrega:** una tarea programada puede correr cualquier capacidad del catálogo declarada
  *programable*. Hoy sólo puede correr el seguimiento de estrategias (`contracts/task.py`, `KINDS`).
- **Qué vas a poder pedir:** «Mandame la atención diaria de lunes a viernes a las 9:45» · «Pausala» · «¿Corrió hoy?» ·
  «Cancelala».
- **Cómo veremos que sirve:** una mañana, sin sesión abierta, aparece el briefing del día guardado, con la versión de la
  capacidad y del perfil, su evidencia y lo que costó. Le das feedback como a cualquier resultado (entrega 4).
- **Comparado con hoy:** el seguimiento de 0009 ya corre solo, pero es código sin modelo: junta datos y los guarda. El
  briefing necesita al modelo para leer, cruzar y escribir. Eso hoy sólo pasa si abrís una sesión.

## Decisión de arquitectura a aprobar: cómo corre el modelo sin sesión

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A (recomendada)** | El Programador de Windows lanza `tools/task_runner.py`. Para una capacidad con modelo, el runner llama a Claude Code sin sesión (`claude -p`) con la skill, las herramientas permitidas limitadas a los comandos de lectura del CLI (`--allowedTools`), un tope de gasto por corrida (`--max-budget-usd`) y salida JSON con el esquema del contrato (`--json-schema`). GaleCore-AI valida y guarda el resultado con el mismo camino que una sesión (`research revise`), marcado `invoked_by=scheduler` | Usa el mismo host, las mismas skills y controles que ya probamos; sin clave nueva; el tope de gasto lo aplica el host | Depende de que Claude Code corra desde el Programador sin tu sesión de Windows abierta en pantalla (se prueba primero, AC-01); el gasto sale de tu cuenta de Claude |
| B | El runner llama directo a la API de Anthropic (Messages) con una clave propia | No depende del CLI | Clave y facturación aparte; hay que reescribir el uso de herramientas que hoy hace el host; dos caminos distintos para lo mismo |
| C | Sin modelo: la tarea junta y guarda los datos a la mañana, y la lectura la hace el modelo cuando abrís una sesión | Costo cero; ya existe casi entero (0009) | No cumple «que te llegue solo»: el briefing sigue esperando que abras el chat |
| D | Rutina en la nube (`/schedule`) | Corre con la PC apagada | No llega a la API de GaleCore Dev (`localhost:7001`) ni a `knowledge/`, que son locales: descartada |

Recomiendo **A**, con **C como respaldo automático**: si el modelo falla o se pasa del tope, la corrida guarda igual los
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
- **Runner con modelo (opción A):** arma el pedido desde la skill, limita herramientas y gasto, valida contra el contrato
  y guarda por el camino común. Registra en `events.jsonl` el costo, la duración y el resultado (`OK`, `INCOMPLETE`,
  `FAILED` con motivo).
- **Frecuencia guiada por el costo:** al crear la tarea, el host muestra el costo estimado por corrida y por mes según las
  fuentes del mapa y el tope; frecuencias por debajo de la frescura de sus datos se rechazan con motivo.
- **Destino del resultado:** la revisión guardada + `LATEST.md` legible por capacidad (como 0009) + un aviso de Windows
  («Tu atención diaria está lista» o «no se pudo: <motivo>»). Mail u otro canal: fuera de esta entrega (ver decisiones).

## Primera demostración

1. En una sesión: «Mandame la atención diaria de lunes a viernes a las 9:45». El host muestra costo estimado y pide
   confirmación; queda la tarea.
2. Sin sesión abierta, al día hábil siguiente: aparece la revisión del día (`invoked_by=scheduler`), `LATEST.md`
   actualizado, el aviso de Windows y el costo en `task status`.
3. En una sesión nueva: «¿Corrió hoy?» → estado, frescura y costo; «Pausala» → no corre al día siguiente;
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
  corre con herramientas limitadas y tope de gasto y devuelve JSON válido. Si no se puede, se frena y se vuelve a
  decidir la arquitectura (antes de escribir el resto).
- [ ] **AC-02 — Programable por declaración:** `schedulable` en el catálogo; `catalog --check` rechaza una capacidad
  programable que escribe fuera de su resultado; `task create` rechaza una no programable.
- [ ] **AC-03 — Corrida con modelo:** una tarea de `daily_attention` corre por horario desde `main`, sin sesión, y guarda
  una revisión válida con versión de skill y perfil, evidencia y `invoked_by=scheduler`.
- [ ] **AC-04 — Gasto:** cada corrida respeta su tope y registra costo y duración; `task status` los muestra.
- [ ] **AC-05 — Fallas:** sin datos o sin modelo → `INCOMPLETE`/`FAILED` con motivo, sin resultado inventado; el aviso
  dice que no se pudo.
- [ ] **AC-06 — Pausa, reanudación y cancelación desde el chat**, con efecto en la corrida siguiente.
- [ ] **AC-07 — Demostración** del recorrido de arriba con tu briefing real.
- [ ] **AC-08 — Revisión:** interna y Codex (toca controles); utilidad y cierre, vos.

## Decisiones tuyas antes del código

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Opción A para correr el modelo sin sesión, con C como respaldo? | Sí |
| 2 | Horario del briefing | Lunes a viernes 9:45 (8:45 en Nueva York, antes de la apertura). La PC y la API de Dev tienen que estar prendidas a esa hora |
| 3 | Tope de gasto por corrida | 1 USD (≈ 20 USD/mes en días hábiles); se ajusta con el costo real de la primera semana |
| 4 | Destino | Revisión guardada + `LATEST.md` + aviso de Windows; mail más adelante si hace falta |

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 … AC-08 | PENDING | PENDING | PENDING | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
