---
id: GC-AI-0016
title: Tu feedback atado al resultado y a la versión siguiente de la capacidad (base del harness, entrega 4)
status: READY_FOR_REVIEW
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
2. **Vos das un comentario real sobre ese resultado.** No se inventa: si no hay comentario, no hay demo. Ya está: ver
   «Comentario del owner para la demostración».
3. Se guarda el feedback, se clasifica y se aplica: versión 2 de la capacidad (o del perfil, o corrección del caso)
   citándolo.
4. Otra sesión nueva corre la versión 2; su resultado está sellado con la versión nueva y muestra el cambio pedido.
   `feedback list` lo da por aplicado.

## Comentario del owner para la demostración (29/09/2026)

Sobre el informe `research:2026-09-29-atencion-diaria-spy-prima-varianza-30-45d` (r1, `daily_attention` 0.1.0).
Palabras textuales del owner en el chat:

> «el briefing capaz era tambien relacionado a che hoy me levanto como trader, tengo una cartera, tengo estrategias
> activas, sucedió algo o algo va a suceder, un brief rápido de todo estaba buena»

Formulación propuesta por el asistente y **aceptada por el owner como su comentario** («Si tomalo como comentario»):
«quiero que me diga qué evento macro viene y cómo afecta mis posiciones» (ejemplo: «hay un NFP en 3 días y tu PCS vence
después»).

Clasificación a registrar: **método** (lo que el briefing debe hacer siempre). Se guarda con `feedback add` cuando exista
y origina `daily_attention` 0.2.0. Lo que no cubre este item: la cartera real (paso «Cuenta real»), el calendario de la
Fed sin fuente registrada (se sigue declarando faltante), y mostrarlo en la interfaz de GaleCore (lado GaleCore, BL-005).
Antecedente: la sesión que miraba FRED lo propuso como opción (a) «pendiente para la entrega que sigue»; el owner la
eligió y la derivó a este item (29/09).

## Alcance agregado el 30/09 (aprobado por el owner)

Calendario de publicaciones macro desde FRED. Pregunta del 30/09: «¿Lo sumo dentro de GC-AI-0016?». Respuesta del
owner: «Sí, sumar FRED». Sin eso, la versión 2 sólo podía declarar el calendario como faltante. Queda: cobertura
`macro_calendar` en `config/sources.yaml` (con límites: no trae la reunión del FOMC, fechas que pueden moverse) y
`tools/fred_query.py --releases` (paginado, extracto por publicación). La fecha del FOMC sigue sin fuente.

## Non-goals

- Programar capacidades (entrega 5), pedirlas sin nombrarlas (entrega 6).
- Feedback sobre resultados que no se guardan como investigación (GEX al vuelo) o que ya tienen su propio veredicto
  (registro de régimen, `record review`).
- Aplicar el feedback automáticamente: lo aplica el host con tu pedido; el código registra, vincula y controla.
- Medir si el método mejoró en general: se prueba que la corrección llegó a la corrida siguiente, no su calidad.
- Cuenta real, capital disponible, alertas de posiciones. Órdenes reales: fuera del alcance actual.

## Acceptance criteria

- [x] **AC-01 — Registro de feedback:** `feedback add` guarda tus palabras, el resultado exacto (investigación y
  revisión) y la clasificación; la capacidad y su versión salen de esa revisión; rechaza un resultado inexistente o una
  revisión que no existe; se escribe una vez, con hash, y `kb search --kind feedback` / `kb show feedback:<id>` lo encuentran.
- [x] **AC-02 — Vínculo con la corrección:** una revisión del resultado, una versión del perfil o el historial de la skill
  pueden citar `feedback:<id>`; la cita se resuelve y se verifica.
- [x] **AC-03 — Versión nueva de la capacidad:** el historial de la skill dice qué cambió en cada versión y qué feedback
  lo originó; `catalog --check` rechaza una skill sin historial para su versión vigente.
- [x] **AC-04 — Pendientes:** `feedback list` muestra aplicado o pendiente, y dónde se aplicó.
- [x] **AC-05 — Guía:** `capability_builder` lleva de tu comentario a la clasificación y a la corrección que corresponde.
- [x] **AC-06 — Demostración:** el recorrido de «Primera demostración» con un comentario tuyo real; transcripciones
  archivadas.
- [ ] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `contracts/feedback.py`, `adapters/feedback_store.py`, `knowledge.save_feedback`, `feedback:` en `knowledge_base.py`, `cli feedback add` | `tests/unit/test_feedback.py` (TestRecord, CLI) | `feedback:2026-09-30-briefing-eventos-macro-vs-posiciones` (commit `5597222` de `knowledge`) | DONE (sin revisar) |
| AC-02 | `resolve_ref` de `feedback:`; `ProfileVersion.feedback` + `profile set --feedback`; `history.yaml` | TestApplied, TestReviewR1, `test_cli_profile_set_cites_only_preference_feedback` | — | DONE (sin revisar) |
| AC-03 | `harness/skill_history.py`, `catalog_check._history_problems`, `check_feedback_citations` (método, misma skill, versión posterior); `history.yaml` en las 11 skills | TestSkillHistory, TestReviewR1, `test_catalog_check.py` | `catalog --check` completo | DONE (sin revisar) |
| AC-04 | `knowledge.feedback_status`, `cli feedback list [--status]` | TestApplied, `test_cli_feedback_add_and_list` | `feedback list`: 1 aplicado en `daily_attention` 0.2.0 | DONE (sin revisar) |
| AC-05 | `capability_builder` 0.2.0 (reglas 9–13), entrada del catálogo | usada por la sesión del paso 3 | `transcripts/ac06-paso3-aplica-feedback.md` | DONE (sin revisar) |
| AC-06 | — | — | paso 1: r1 del 29/09 (GC-AI-0015); paso 3: `transcripts/ac06-paso3-aplica-feedback.md` (sesión nueva: feedback guardado, `daily_attention` 0.2.0 con historial que lo cita); paso 4: `transcripts/ac06-paso4-corre-0.2.0.md`, `research:2026-09-29-atencion-diaria-spy-prima-varianza-30-45d` r3 sellada con 0.2.0, tabla eventos × posiciones con `evidence:2026-09-30-atencion-fred-releases-sep30-nov06` y «hay un NFP en 2 días y tu PCS 1.0.3 sigue abierta después» | DONE (sin revisar) |
| AC-07 | — | — | — | PENDING |

## Implementer handoff — Increment 1 (2026-09-30)

**Qué se hizo.** Registro de feedback (`feedback add|list`, `feedback:<id>` citable y buscable). Cada clase se aplica
en su lugar y citándolo: caso → revisión del mismo resultado; preferencia → `profile set --feedback`; método →
`history.yaml` de la skill. `catalog --check` exige historial para la versión vigente y verifica el feedback citado. A
eso se suman el calendario FRED y `capability_builder` 0.2.0. Commits: `4f63fde`, `55c1ead`, `15e3549` y las
correcciones de R1.

**Demo (AC-06).** Paso 3: una sesión nueva recibió sólo el comentario del owner y siguió `capability_builder`. Guardó
el feedback (método, sobre r1 / 0.1.0), escribió `daily_attention` 0.2.0, su historial y la entrada del catálogo, con
`catalog --check` completo. Paso 4: otra sesión nueva recibió el pedido de siempre y corrió 0.2.0. Resultado: r3 con el
brief de todo y la tabla eventos × posiciones (NFP 02/10 y 06/11, CPI 14/10, PPI y ventas 15/10, PIB 29/10), el cálculo
propio como interpretación y el FOMC como faltante.

**Transparencia sobre las palabras del owner.** El comentario (29/09) y «Si tomalo como comentario» son textuales. El
pedido del paso 3 («Guardá mi comentario y aplicalo a la capacidad, así la próxima vez ya lo hace sin que te lo
repita») lo **redactó el implementador** para la demo, no lo dijo el owner, y quedó como `prompt` del feedback. El
registro es inmutable: la aclaración vive acá.

**Límites.** `prepare --skill regime` sigue sin clave de Dev (401), así que GEX, skew y VVIX faltan. Calendario de
resultados de empresas: se usaron los guardados (los conectores FMP y Alpha Vantage no estaban en la sesión). La tabla
de eventos la arma el host: no se verifica que esté completa (control «Not checked» del catálogo).

## Revisión interna 1 (`reviewer`, 30/09) — CHANGES_REQUESTED → corregido

| Hallazgo | Resolución |
|---|---|
| BLOCKER — `test_the_real_catalog_is_complete` rojo: la 0.2.0 cita feedback y sin base de conocimiento falla | Corregido: el test pasa un `feedback_check` neutro (la resolución real se prueba en `test_feedback.py`) |
| MAJOR — «versión anterior» sólo rechazaba la misma versión; `feedback list` no miraba la versión | Corregido: comparación MAJOR.MINOR.PATCH en `check_feedback_citations` y en `feedback_status` (tests) |
| MAJOR — el pedido del paso 3 se atribuye al owner | Registrado arriba («Transparencia…»); el `prompt` del feedback no se reescribe |
| MAJOR — FRED amplía el alcance sin registro en el item | Registrado en «Alcance agregado el 30/09» con las palabras del owner |
| MINOR — historial roto oculto en `feedback list` | Corregido: se reporta en `integrity_failed` (test) |
| MINOR — `profile set --feedback` sin cambio quedaba pendiente para siempre | Corregido: con feedback se escribe la versión que lo cita (test) |
| MINOR — tests faltantes (CLI `profile set --feedback`, clave en respuesta de FRED) | Agregados. El closure de `_cmd_catalog` se ejerce por `catalog --check` real (completo) |
| MINOR — ruta de `fred_query.py` distinta en skill (desde el checkout) y flujo (desde el workspace) | Registrado: el flujo del catálogo se valida desde la raíz del workspace; la skill habla desde el checkout. Se unifica en la próxima versión de la skill, no en medio de la demo |
| MINOR — «mojibake» en la transcripción | No es mojibake: es el error de codificación de consola que vio la sesión, conservado tal cual |

## Revisión independiente (Codex) — pendiente

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
