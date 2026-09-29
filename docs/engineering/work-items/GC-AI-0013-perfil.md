---
id: GC-AI-0013
title: Tu perfil (base del harness, entrega 2)
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0013 — Tu perfil

Roadmap §4, Parte 1, entrega 2 (owner, 28/09 noche). Depende de GC-AI-0012 (las fuentes preferidas se validan contra
su registro).

## Acuerdo breve

- **Para qué:** que tus objetivos, capital de referencia, horizonte, límites de riesgo, fuentes preferidas y formato de
  entrega vivan en el producto, versionados, y no en la memoria de desarrollo del asistente ni repetidos en cada pedido.
- **Capacidad que agrega:** un perfil versionado en `knowledge/` que cualquier capacidad lee al empezar y cita al guardar
  su resultado, de modo que se sabe qué versión del perfil se usó. Es insumo de las entregas 3–6.
- **Qué vas a poder pedir:** «Mis objetivos son…» · «Mi capital de referencia es…» · «Los informes, tablas y gráficos
  primero» · «¿Qué perfil tengo?».
- **Cómo veremos que sirve:** desde una sesión nueva, una investigación de contexto aplica el perfil sin que lo repitas
  (capital, formato) y su registro cita `profile:vN`; tras cambiar el perfil, la corrida siguiente cita la versión nueva.
- **Comparado con hoy:** el host ya recuerda algunas preferencias en su memoria privada (formato, capital 10.000 USD de
  GC-AI-0010), pero no es del producto, no tiene versión y ningún resultado dice con qué preferencias se hizo.

## Reutiliza (existe)

- `ResearchRevision.resolved_refs` (`contracts/research.py`): cada referencia citada queda guardada con su hash. Con
  `profile:` como tipo de referencia, `research` y `context_research` registran la versión del perfil **sin cambiar
  contratos ni hashes existentes**.
- Patrón create-only e integridad de `adapters/strategy_store.py` para las versiones del perfil.
- Registro de fuentes de GC-AI-0012 (`config/sources.yaml`) para validar las fuentes preferidas.
- Valores ya decididos por el owner, para sembrar la versión 1: capital de referencia 10.000 USD (28/09, GC-AI-0010);
  informes con tablas y gráficos primero y texto mínimo; español. Faltan (roadmap §6, decisión abierta): objetivos de
  retorno, drawdown aceptable, horizonte y límites de riesgo — la v1 los declara faltantes, no los inventa.

**Camino más simple que el roadmap:** el roadmap nombra `ConventionResolver` como reutilizable. No se conecta: sus claves
son convenciones que consume el código (zona horaria, moneda, umbrales) y ningún campo del perfil tiene hoy un consumidor
en código; cablearlo sería plomería sin uso. Se conecta cuando una capacidad necesite una convención que el perfil pise.

## Non-goals

- Ejecución común con registro uniforme de resultado + versión de capacidad + versión de perfil (entrega 4); acá sólo lo
  cita lo que ya guarda referencias (`research`, `context_research`).
- Registro del perfil en el seguimiento recurrente (`followup`): corre sin sesión y hoy no usa preferencias de formato.
- Multiusuario, cuenta de bróker, cálculo de sizing o riesgo con el perfil (lo hace GaleCore cuando corresponda).

## Acceptance criteria

- [x] **AC-01 — Perfil versionado:** contrato del perfil (objetivos, capital de referencia con moneda, horizonte, límites
  de riesgo, fuentes preferidas validadas contra el registro de fuentes, formato de entrega, idioma); cada campo puede
  quedar declarado faltante; versiones create-only en `knowledge/profile/` con nota de qué cambió, pedido que lo originó y
  hash; nunca credenciales.
- [x] **AC-02 — Ver y cambiar desde el chat:** `profile show` (versión vigente y faltantes), `profile set` (cambios
  parciales → versión nueva; sin cambios reales, no crea versión), `profile history`.
- [x] **AC-03 — Citable:** `profile:vN` resuelve con integridad en `resolve_ref`, `kb show` y `kb search`.
- [x] **AC-04 — Uso por las capacidades:** entrada en el catálogo; `research` y `context_research` leen el perfil al
  empezar, lo aplican y citan `profile:vN` en lo que guardan; lo faltante del perfil se declara en el resultado.
- [x] **AC-05 — Demostración:** sesión nueva: investigación de contexto aplica el perfil sin repetirlo y cita `profile:v1`;
  cambio de perfil → la corrida siguiente cita `profile:v2`.
- [ ] **AC-06 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `contracts/profile.py` (`ProfileContent` con `missing()`, `ProfileVersion` con hash y guarda de credenciales); `adapters/profile_store.py` (create-only, `knowledge/profile/v<N>.json`, integridad en cada lectura) | `tests/unit/test_profile.py::TestContent`, `TestStore` | `knowledge/profile/v1.json` (commit `072728e` de `knowledge`) | DONE (sin revisar) |
| AC-02 | `application/profile.py` (`show`, `set_profile` con cambios parciales y sin versión si no cambia nada, fuentes validadas contra `config/sources.yaml`, `history`); CLI `profile show/set/history` | `TestSetAndShow`, `test_cli_profile_set_show_history` | — | DONE (sin revisar) |
| AC-03 | `adapters/knowledge_base.py` (`profile:v<N>`); `application/knowledge.py` (`resolve_ref`, `kb show`, `kb search --kind profile`) | `TestCitable` | — | DONE (sin revisar) |
| AC-04 | `config/catalog.yaml` (`user_profile`, `stored_as: profile`); `config/skills/user-profile/skill.yaml`; regla 0 en `research` 1.2.0 y `context-research` 0.3.0 | `test_an_investigation_records_the_profile_version_it_used`; `cli catalog` → `user_profile.available` | — | DONE (sin revisar) |
| AC-05 | — | — | `docs/evidence/gc-ai-0013/ac05-demo-2026-09-29.md` (parte 1: sesión nueva aplica y cita `profile:v1`; parte 2: tras el cambio cita `profile:v2`; parte 3: `context_research` 0.3.0 cita `profile:v3` y rotula lo provisorio; todas verificadas) | DONE (sin revisar) |
| AC-06 | — | — | `docs/engineering/reviews/GC-AI-0013-20260929T192821Z.md` (Codex recheck C2 APPROVE) | PENDING — utilidad y cierre del owner |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff — Increment 1 (2026-09-29, worktree `.worktrees/galecore-ai/GC-AI-0013`)

**Qué se hizo:** perfil versionado create-only (`contracts/profile.py`, `adapters/profile_store.py`,
`application/profile.py`), CLI `profile show|set|history`, referencia `profile:v<N>` (`adapters/knowledge_base.py`,
`application/knowledge.py`: `resolve_ref`, `kb show`, `kb search --kind profile`), catálogo `user_profile`
(`stored_as: profile` en `harness/catalog.py`), skill `user-profile`, regla 0 en `research` 1.2.0 y
`context-research` 0.3.0. `ConventionResolver` no se conectó (ver «Camino más simple»).

**Datos reales escritos en `knowledge/`:** `profile/v1.json` (semilla de decisiones ya registradas), `v2.json`
(provisorios a pedido del owner, con prefijo en el texto), `v3.json` (los mismos, marcados en `provisional`);
`research:2026-09-28-cartera-shadow-contexto-macro` r4 (cita v1) y r5 (cita v2), escritas por sesiones nuevas.

**Comandos (reales):** gate PASS · ruff limpio · `pytest` 883 passed · `git diff --check` limpio.

## Revisión interna 1 (`reviewer`, 2026-09-29) — CHANGES_REQUESTED → corregido

- **MAJOR — `null` fallaba en campos de lista.** Corregido: un validador `before` convierte `null` en `[]`.
  Test parametrizado por campo.
- **MAJOR — `main` ve INTEGRITY_FAILED la investigación que cita `profile:`.** El código de `main` no conoce el tipo
  y el cuerpo guardado no coincide con su render. Se probó adelantar a `main` sólo el reconocimiento de `profile:vN`
  (aditivo, arreglaba la lectura: verificado); el commit directo a `main` fue denegado por permisos y se revirtió.
  **Decisión del owner:** adelantar ese cambio a `main` ahora, o esperar al merge de este item. Mientras tanto,
  sesiones desde `main` no leen esa investigación.
- **MAJOR — v2 tenía límites puestos por el asistente aplicados como del owner.** Corregido con marca estructurada:
  `ProfileContent.provisional` (nombres de campos con valores provisorios). `profile show` la informa, las skills
  (regla 0) rotulan como provisorio lo que depende de ellos, y un valor real del usuario saca el campo de la lista.
  v3 en la base real los marca así. El owner pidió esos valores («pone cualquiera que sea razonable…»).
- **MAJOR — `context_research` no se ejercitó.** Demo desde sesión nueva con `context_research` y perfil v3: ver
  evidencia.
- **MINOR corregidos:** filtro de credenciales con etiquetas en español y prefijos de claves (con dígito
  obligatorio, para no confundir «la clave del método es…»), y el control del catálogo pasa a decir «heurístico»;
  error de lectura sin eco del valor (`exc.errors()`); `amount` estricto y finito; texto con `strip` y fuentes
  sin repetir; la CLI informa `INTEGRITY_FAILED`; filas de evidencia corregidas (backlink fechado, formato como
  declarado por el host); handoff agregado.

## Independent review 1 (Codex, `--base main`, effort high, 2026-09-29T19:09:01Z) — `docs/engineering/reviews/GC-AI-0013-20260929T190901Z.md` — CHANGES_REQUESTED → corregido

- **MAJOR — el validador de `provisional` repetía el valor rechazado.** Corregido: mensajes sin valor; en
  `application/profile.py` sólo se repiten nombres con forma de identificador (`_safe`) en `loc`, campos
  desconocidos y fuentes; el chequeo de credenciales corre antes del de fuentes. Test
  `test_no_rejection_path_echoes_the_value` (provisional, campo desconocido, fuente, clave extra anidada).
- **MAJOR — citar el perfil no era un control.** Corregido: mientras exista un perfil, `research save/revise`
  (ambas capacidades) rechaza guardar si ningún antecedente cita la versión vigente, y dice cuál citó si es vieja; un
  perfil que falla la integridad también bloquea. Tests `TestCitationIsEnforced`. Catálogo y skill dicen ahora
  quiénes lo usan (sólo `research` y `context_research`).
- **MAJOR — AC-05 narrado, sin transcripción.** Corregido: `docs/evidence/gc-ai-0013/transcripts/` con las tres
  sesiones (pedido inicial, cada comando con salida y marca de error, respuesta final), extraídas de los logs de los
  subagentes con `extract_transcripts.py` y saneadas con los filtros de credenciales (ninguna coincidencia).
- **MINOR corregidos:** descripción de la skill `user-profile` acotada a los consumidores reales; `CLAUDE.md` con
  `user_profile`, `data_sources`, `profile:vN` y `--kind profile`; bloque «Retomar acá» del handoff al día.

## Independent review 2 (Codex, `--recheck`, effort medium, 2026-09-29T19:28:21Z) — `docs/engineering/reviews/GC-AI-0013-20260929T192821Z.md` — APPROVE

Rango `cf73c38..fe84c75`. Los tres MAJOR y los tres MINOR de C1, resueltos; sin hallazgos nuevos. Queda como decisión
del owner (no bloquea): adelantar a `main` el reconocimiento de `profile:vN` o esperar el merge. Límite declarado: los
logs crudos de los subagentes no se commitean; la verificación usó las transcripciones saneadas y los commits de
`knowledge`.
