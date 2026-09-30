---
id: GC-AI-0016
title: Tu feedback atado al resultado y a la versión siguiente de la capacidad (base del harness, entrega 4)
status: DRAFT
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0016 — Tu feedback atado al resultado y a la versión siguiente

Roadmap §4, Parte 1, entrega 4 («Secuencia autorizada», owner 29/09). Mismo caso que la entrega 3: «¿Qué merece mi
atención hoy?» (`daily_attention`). Rama desde `feature/GC-AI-0015` (entrega 3 en revisión de Codex); si esa revisión
cambia algo, se trae con un merge antes de revisar esta.

## Acuerdo breve

- **Para qué:** que lo que corregís de un resultado no se pierda. Hoy lo decís en el chat y la próxima corrida no se
  entera, salvo que alguien edite la skill a mano sin dejar rastro de por qué.
- **Capacidad que agrega:** tu comentario queda guardado, atado al resultado exacto (revisión y versión de la capacidad)
  y clasificado según qué cambia:
  - **del caso:** el dato o la lectura de ese resultado estaban mal → se corrige ese resultado;
  - **preferencia tuya:** cómo querés las cosas (formato, límites, fuentes) → nueva versión del perfil;
  - **del método:** lo que la capacidad debería hacer siempre → nueva versión de la capacidad.
  Cada una de esas correcciones cita el feedback que la originó, y se puede ver qué feedback sigue sin aplicar.
- **Qué vas a poder pedir:** «Corré la atención diaria» · «Le faltó el calendario de la Fed» · «¿Qué feedback quedó
  pendiente?».
- **Cómo veremos que sirve:** das un comentario real sobre un resultado real; queda la versión 2 de la capacidad citándolo;
  una sesión nueva corre la versión 2 y el resultado muestra que se aplicó, sin que repitas la instrucción.
- **Comparado con hoy:** el host puede corregir la skill si se lo pedís, pero no queda qué comentario lo motivó, ni sobre
  qué resultado, ni si ya se aplicó; y un comentario del caso se puede confundir con un cambio general del método.

## Reutiliza (existe)

- **Resultado guardado con versiones:** cada revisión de una investigación ya guarda el resultado, la evidencia citada con
  hash, la versión y el hash de la skill que la produjo y el perfil citado (`application/knowledge.py`, `_revision`;
  cita obligatoria del perfil desde GC-AI-0013). Cubre `research`, `context_research`, `strategy_followup` y
  `daily_attention`. No se construye otra «ejecución común»: la que falta es la del feedback.
- **Corregir el caso:** `research revise --reason correction` (existe).
- **Preferencias:** `profile set` versionado con nota (GC-AI-0013).
- **Registro inmutable con hash:** patrón de `evidence` (GC-AI-0007) para el registro de feedback.
- **Molde y validación:** `catalog --check` y la guía `capability_builder` (GC-AI-0015).
- **Veredicto humano del régimen:** `record review` ya ata un veredicto a una entrada de régimen; no se duplica.

## Qué falta, con código

- Registro `feedback:<id>` en `knowledge/feedback/`: tus palabras textuales, el resultado exacto al que se refiere
  (investigación y revisión), la capacidad y versión que lo produjo (las pone el código leyendo esa revisión, no el host)
  y la clasificación (caso, preferencia, método). Se escribe una vez, con hash.
- Una skill cuya versión cambia por feedback lo cita en su historial de versiones; `catalog --check` rechaza una versión
  nueva sin historial.
- `feedback list`: cada feedback con su estado, aplicado o pendiente, según lo cite una revisión del resultado, una versión
  del perfil o el historial de la skill.
- La guía `capability_builder` suma el recorrido «corregir una capacidad desde tu feedback».

## Primera demostración

1. Una sesión nueva corre `daily_attention` con datos reales (GaleCore Dev arriba) y guarda una revisión.
2. **Vos das un comentario real sobre ese resultado.** No se inventa: si no hay comentario, no hay demo.
3. Se guarda el feedback, se clasifica y se aplica: versión 2 de la capacidad (o del perfil, o corrección del caso)
   citándolo.
4. Otra sesión nueva corre la versión 2; su resultado está sellado con la versión nueva y muestra el cambio pedido.
   `feedback list` lo da por aplicado.

## Non-goals

- Programar capacidades (entrega 5), pedirlas sin nombrarlas (entrega 6).
- Feedback sobre resultados que no se guardan como investigación (GEX al vuelo) o que ya tienen su propio veredicto
  (registro de régimen, `record review`).
- Aplicar el feedback automáticamente: lo aplica el host con tu pedido; el código registra, vincula y controla.
- Medir si el método mejoró en general: se prueba que la corrección llegó a la corrida siguiente, no su calidad.
- Cuenta real, capital disponible, alertas de posiciones. Órdenes reales: fuera del alcance actual.

## Acceptance criteria

- [ ] **AC-01 — Registro de feedback:** `feedback add` guarda tus palabras, el resultado exacto (investigación y
  revisión) y la clasificación; la capacidad y su versión salen de esa revisión; rechaza un resultado inexistente o una
  revisión que no existe; se escribe una vez, con hash, y `kb search --kind feedback` / `kb show feedback:<id>` lo encuentran.
- [ ] **AC-02 — Vínculo con la corrección:** una revisión del resultado, una versión del perfil o el historial de la skill
  pueden citar `feedback:<id>`; la cita se resuelve y se verifica.
- [ ] **AC-03 — Versión nueva de la capacidad:** el historial de la skill dice qué cambió en cada versión y qué feedback
  lo originó; `catalog --check` rechaza una skill sin historial para su versión vigente.
- [ ] **AC-04 — Pendientes:** `feedback list` muestra aplicado o pendiente, y dónde se aplicó.
- [ ] **AC-05 — Guía:** `capability_builder` lleva de tu comentario a la clasificación y a la corrección que corresponde.
- [ ] **AC-06 — Demostración:** el recorrido de «Primera demostración» con un comentario tuyo real; transcripciones
  archivadas.
- [ ] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | PENDING | PENDING | PENDING | PENDING |
| AC-06 | — | — | PENDING | PENDING |
| AC-07 | — | — | — | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
