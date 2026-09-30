---
id: GC-AI-0015
title: Molde de capacidad y guía para crearla (base del harness, entrega 3)
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0015 — Molde de capacidad y guía para crearla

Roadmap §4, Parte 1, entrega 3 («Secuencia autorizada», owner 29/09). Primer caso: «¿Qué merece mi atención hoy?» sobre
la exposición SHADOW. Avanza mientras GC-AI-0008/0009 esperan evidencia externa.

## Acuerdo breve

- **Para qué:** que una capacidad nueva se cree con un formato único y validado, en vez de armarse a mano y a su manera
  como las 9 actuales, y que lo que no se pudo completar (una fuente sin acceso, un dato sin fuente) quede declarado.
- **Capacidad que agrega:** un molde (qué pedido atiende, qué datos necesita y de qué fuentes del mapa salen, salida,
  controles, dónde se guarda, versión), una validación que rechaza una capacidad incompleta, y una guía que lleva de un
  pedido tuyo a la entrada de catálogo y su método.
- **Qué vas a poder pedir:** «Quiero una capacidad que me diga qué merece mi atención hoy».
- **Cómo veremos que sirve:** la capacidad «atención diaria» se crea con la guía, pasa la validación, queda listada en el
  catálogo, y una sesión nueva la corre con datos reales, tu perfil y las fuentes del mapa, declarando lo que falta.
- **Comparado con hoy:** el host puede contestar esa pregunta a mano (lo hizo en las demos de GC-AI-0013), pero cada vez
  decide qué mirar; nada garantiza que la próxima corrida mire lo mismo ni que se note lo que faltó.

## Reutiliza (existe)

- Catálogo y su validación (`harness/catalog.py`, `config/catalog.yaml`), skills (`skill_loader`), contratos, evidencia.
- Registro de fuentes con orden por tipo de uso (GC-AI-0012/0014) y perfil versionado con cita obligatoria (GC-AI-0013).
- Seguimiento de la estrategia SHADOW (`followup run`, GC-AI-0008/0009): exposición, evaluaciones, posiciones y reglas.
- Contexto de una idea (`context_research`, GC-AI-0007) y material de GC-AI-0010 (cartera y macro), sin reabrir su informe.

## Fuentes: qué falla hoy y si bloquea el primer caso (0b, owner 29/09)

Consultas reales contra el registro de `main` (29/09), con los datos que usaron las demos del primer caso:

| Necesidad del caso | Resultado del registro | ¿Bloquea? |
|---|---|---|
| Posiciones, evaluaciones y métricas SHADOW | Faltante | **Sí, para la validación del molde:** el dato existe y se lee con `followup run` (API `App/Runtime/*`), pero el mapa no lo declara |
| Tasa real, spread de crédito high yield | Faltante | **Sí, degrada:** FRED las sirve (las demos usaron `DFII10` y `BAMLH0A0HYM2`), pero la descripción de FRED no las nombra y una sesión que sigue la regla las declararía faltantes |
| Volatilidad implícita y realizada, velas de SPY | Faltante | No: GaleCore las tiene por rutas que el código no llama; el caso usa lo guardado y lo declara faltante si no está fresco |
| Calendario económico, fecha del FOMC | Faltante | No: faltante real (el calendario de FMP está denegado por plan); se declara, como hicieron las demos |
| Cotizaciones, VIX, VVIX, GEX, skew, curva, inflación, earnings | Resuelven | — |

Sólo entran en este item las dos primeras filas. No se abre una ampliación general del registro.

## Non-goals

- Ampliación general de fuentes; registrar nuevas rutas de GaleCore en el código.
- Correr y guardar cualquier capacidad de forma uniforme con feedback (entrega 4), programarla (entrega 5), pedirla sin
  nombrarla (entrega 6).
- Cuenta real, análisis de capital disponible y alertas de posiciones (pasos posteriores). Órdenes reales: fuera del
  alcance actual.

## Acceptance criteria

- [x] **AC-01 — Molde:** cada entrada del catálogo declara sus necesidades de datos, cada una resuelta contra el registro
  de fuentes o marcada faltante con motivo; las entradas existentes quedan declaradas con el mismo formato.
- [x] **AC-02 — Validación:** `catalog --check` rechaza una capacidad incompleta (skill o contrato ausentes, flujo con
  comandos que la CLI no tiene, una necesidad que no resuelve ni está declarada faltante, controles sin decir qué no se
  verifica) y lista qué falta.
- [x] **AC-03 — Guía:** skill que lleva de un pedido a la entrada de catálogo y su skill, consultando el registro y el
  perfil, y termina con `catalog check` en verde o con lo pendiente declarado.
- [x] **AC-04 — Fuentes del primer caso:** el registro declara el runtime SHADOW de GaleCore (vía `followup run`) y las
  tasas reales y spreads de crédito de FRED; nada más.
- [x] **AC-05 — Primer caso:** capacidad `daily_attention` («¿Qué merece mi atención hoy?») creada con la guía: exposición
  SHADOW, reglas de la estrategia, cambios desde la última revisión, contexto y faltantes; perfil citado.
- [x] **AC-06 — Demostración:** sesión nueva corre la capacidad con datos reales (GaleCore Dev arriba) y guarda el
  resultado; transcripción archivada.
- [ ] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `harness/catalog.py` (`DataNeed`, `CatalogEntry.data_needs` obligatorio); `config/catalog.yaml` (las 9 entradas previas declaradas) | `test_data_needs_must_be_declared`, `test_the_real_catalog_is_complete` | `catalog --check` → complete | DONE (sin revisar) |
| AC-02 | `application/catalog_check.py` (skill/contrato, flujo contra los comandos reales de la CLI vía `build_parser`, necesidades contra el registro, «Not checked»); CLI `catalog --check` | `test_an_incomplete_entry_is_rejected_with_the_reason` (7 casos), `test_a_need_without_source_passes_when_its_absence_is_declared`, `test_cli_commands_know_nested_subcommands` | — | DONE (sin revisar) |
| AC-03 | `config/skills/capability-builder/skill.yaml`; entrada `capability_builder` | `test_the_real_catalog_is_complete` | `docs/evidence/gc-ai-0015/transcripts/ac05-crea-daily-attention.md` | DONE (sin revisar) |
| AC-04 | `config/sources.yaml`: GaleCore `shadow_runtime`; FRED tasas reales y `credit`; límite de las dos vías a GaleCore (:5000 vs Dev :7001) | consultas reales: posiciones/evaluaciones/métricas SHADOW → galecore; tasa real, spread de crédito → fred | — | DONE (sin revisar) |
| AC-05 | `config/skills/daily-attention/skill.yaml` + entrada `daily_attention`, escritas por una sesión nueva siguiendo la guía (no por el implementador) | `catalog --check` → daily_attention complete | transcripción `ac05-crea-daily-attention.md` | DONE (sin revisar) |
| AC-06 | — | — | `docs/evidence/gc-ai-0015/transcripts/ac06-corre-daily-attention.md`; `research:2026-09-29-atencion-diaria-spy-prima-varianza-30-45d` r1 (skill `daily_attention` 0.1.0, cita `profile:v3` con hash igual al archivo), seguimiento `20260929T232040Z`, evidencia FMP earnings (commit `e8e9e2d` de `knowledge`). **Recorrida con 0.1.2 (Codex C1):** `docs/evidence/gc-ai-0015/transcripts/ac06-r2-corre-daily-attention-0.1.2.md`; misma investigación r2 (`daily_attention` 0.1.2, cita `profile:v3`), seguimientos `20260930T132258Z` y `20260930T133423Z` con su evidencia; faltantes por posición declarados (v2 sin valor ni hora); un cálculo propio tipado como hecho → control nuevo en `check_content` (test en `test_knowledge.py`) | DONE (sin revisar) |
| AC-07 | — | — | — | PENDING |

## Implementer handoff — Increment 1 (2026-09-29)

**Hecho:** molde (`data_needs`), validación `catalog --check`, guía `capability_builder`, fuentes que bloqueaban el caso,
y la capacidad `daily_attention` creada por una sesión nueva con sólo el pedido del owner. 905 tests, gate PASS.

**Fuera de lo pedido, pero necesario (trazable):** `strategy_followup` 0.4.0 suma la regla del perfil — desde GC-AI-0013,
guardar una revisión exige citar el perfil vigente y esa skill no lo decía (una sesión que la siguiera sería rechazada).

**Hallazgo:** `sources check --source galecore`, `prepare` y las capabilities usan `GALECORE_BASE_URL` (por defecto
:5000); GaleCore Dev corre en :7001 y `followup run` la alcanza por `galecore_dev.py`. El probe registró `down`
(29/09 23:10Z) mientras Dev respondía. Declarado como límite en el registro; no se cambió la dirección por defecto.
La tarea `GaleCore-AI\galecore-dev-api` nunca corrió (arranca al iniciar sesión); una instancia de la API del 28/09
seguía viva en :7001.

**AC-06 (29/09 ~23:20Z), sesión nueva con sólo «¿Qué merece mi atención hoy sobre lo que tengo en SHADOW?»:** leyó
catálogo, perfil y estrategia aprobada; corrió `followup run` contra GaleCore Dev (:7001) y guardó la revisión. Lo que
dejó a la vista, con fuente: el runtime arrancó tarde el 29/09 (primera evaluación 16:38 UTC, ~3 h sin stop) y también el
28/09; peor caso por posición 456 USD contra el límite provisorio de 200 (dentro sólo si el stop se ejecuta); reglas
cumplidas por el runtime; eventos hasta el 16/10. Faltantes declarados: GEX/skew/VVIX de hoy (`prepare` falló: :5000
rechazado y :7001 pide clave — el límite de las dos vías), FOMC, calendario macro, valuación de la v2.
**Correcciones tras la demo:** el primer `research save` falló por un slug con guiones bajos → `daily_attention` 0.1.1 y
`capability_builder` 0.1.1 dicen cómo derivar el slug. La transcripción marcó dos falsos positivos de credencial (código y
texto con acentos escapados `í`); no había secretos.

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Revisión interna 1 (`reviewer`, 2026-09-29) — CHANGES_REQUESTED → corregido

- **MAJOR — `strategy_design` no declaraba lo que su método necesita:** declaraba datos que consume el runtime
  (cotizaciones, GEX) y omitía los históricos point-in-time y la volatilidad implícita, que el registro no sirve; el check
  quedaba verde escondiendo el hueco. **Corregido:** declara históricos y volatilidad implícita como faltantes con motivo
  (y quita GEX). También: `gex_interpretation` pide «GEX» (cualquier símbolo) y `recurring_followup` suma las métricas.
- **MINOR corregidos:** `catalog --check` rechaza flujo vacío, un `python` que no apunta a un `.py` existente, «Not
  checked» sin texto, y el modelo rechaza un `missing` en blanco (tests nuevos); las opciones de cada línea del flujo no se
  verifican y ahora lo declara `capability_builder` en sus controles; la raíz del workspace se busca con `_workspace_root`
  (antes fallaba con `GALECORE_KNOWLEDGE_DIR` apuntando a otro lado); control de consumidores del perfil al día
  (`strategy_followup`, `daily_attention`); el riesgo máximo por posición sí lo trae el registro de seguimiento
  (`maxRisk`) → cobertura `shadow_runtime` lo nombra y `daily_attention` ya no lo declara faltante; `daily_attention`
  0.1.2 pide rotular la comparación con los límites como «Cálculo propio» (interpretación) y no rellenar un valor de otra
  instancia; el límite de `KNOWN_CAPABILITIES` en el registro ya no contradice la cobertura SHADOW; transcripciones
  regeneradas con fin de línea LF y sin espacios finales; docstring del extractor corregido.
- **Registrado, no corregible:** la revisión r1 guardada en la base (append-only) muestra 456 USD para la v2 y a la vez
  lo declara faltante, y trae el cálculo al stop como `fact`; la próxima revisión sigue la skill 0.1.2.
- **Traza de FRED (tasas reales, crédito):** la consume `context_research` (sus `data_needs`), no `daily_attention`;
  entra por AC-01 (declaración honesta de las entradas existentes), no por el caso.

## Revisión independiente (Codex)

**C1 — 30/09, `docs/engineering/reviews/GC-AI-0015-20260930T121330Z.md`**, modo `base`,
`e2630e0..f944256`, esfuerzo high: **CHANGES_REQUESTED**, sin BLOCKER.

| Hallazgo | Resolución |
|---|---|
| MAJOR — AC-06 validado con 0.1.0, no con la 0.1.2 revisada | Corregido: sesión nueva con el mismo pedido corrió 0.1.2 contra GaleCore Dev (30/09 13:22–13:40Z) y agregó r2 (transcripción archivada). Verificado en r2: la v2 sin valor ni hora quedó en `missing`, no se completó con otro día; las fechas macro citadas vienen de evidencia guardada. **Desvío:** el cálculo propio contra los límites quedó como `fact`. Como la regla estaba sólo en la skill, ahora es control: `check_content` rechaza un `fact` que empieza con «Cálculo propio» (vale para toda investigación). r2 queda como está (append-only); la próxima corrida ya no puede guardarlo así. |
| MAJOR — handoff desactualizado | Corregido: `SESSION_HANDOFF.md` con el estado real (C1, correcciones, recheck) tras mergear `main`. |
| MINOR — inventario de `CLAUDE.md` sin `daily_attention` ni `capability_builder` | Corregido: inventario, `catalog --check` y la regla de cita del perfil para toda investigación guardada. |

Dato de operación visto en r2: el 30/09 la 1.0.3 empezó a evaluar a horario (13:30:24 UTC), con la PC prendida; el
arranque tardío del 28 y 29/09 no se repitió. Siguiente: `--recheck` acotado.

Antecedente: 29/09 23:45Z el runner no pudo correr Codex por límite de uso de la cuenta.
