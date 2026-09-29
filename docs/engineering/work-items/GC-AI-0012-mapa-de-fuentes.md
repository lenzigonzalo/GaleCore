---
id: GC-AI-0012
title: Mapa de fuentes de datos (base del harness, entrega 1)
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0012 — Mapa de fuentes de datos

Roadmap §4, Parte 1, entrega 1 (owner, 28/09 noche).

## Acuerdo breve

- **Para qué:** que el harness sepa qué datos tiene a disposición y cómo conseguirlos de la forma más barata y rápida,
  en vez de decidirlo en cada conversación y redescubrir restricciones ya encontradas.
- **Capacidad que agrega:** un registro compartido de fuentes (qué cubre cada una, costo, límites y estado de acceso
  comprobado con fecha) que cualquier capacidad consulta antes de pedir datos. Es la base de las entregas 3–6.
- **Qué vas a poder pedir:** «¿Qué datos tengo?» · «¿De dónde saco la curva de tasas / la cadena de SPY?».
- **Cómo veremos que sirve:** desde una sesión nueva, esas preguntas se responden desde el registro, con la fuente
  elegida y por qué, las restricciones conocidas con su fecha y sin volver a probar todo.

## Reutiliza (existe)

- Regla de elección de fuentes de `config/skills/context-research/skill.yaml` (regla 4: GaleCore primero, probar acceso
  con una llamada mínima, una negación es un hallazgo). Hoy vive sólo en esa skill.
- `access_notes` de la evidencia (`src/galecore_ai/contracts/evidence.py`) y la evidencia ya guardada en `knowledge/evidence/`.
- Capabilities de GaleCore con procedencia y frescura (catálogo, `galecore_capabilities`).
- `tools/fred_query.py` (FRED por `FRED_API_KEY`, sin exponer la clave).

**Restricciones ya encontradas** (semilla del registro, cada una con su evidencia):

| Fuente | Restricción | Evidencia |
|---|---|---|
| Alpha Vantage | Clave gratuita: 1 consulta/s y 25/día; en paralelo falla por límite | `2026-09-27-spy-ctx-av-effr-preview` |
| FMP | `economics-calendar` y `etfAndMutualFunds information` denegados por plan; `treasury-rates` sí responde | `2026-09-27-spy-ctx-fmp-economics-calendar-denied` |
| FMP | `quote`/`batch-quote` denegados por plan (Premium), 28/09 | `2026-09-28-cartera-ctx-fmp-spy-eod` |
| FMP | Calendario de earnings: respuestas de 8 y 50 filas, posible recorte del endpoint sin verificar | `2026-09-27-spy-ctx-fmp-earnings-calendar-oct13-16`, `2026-09-28-cartera-ctx-fmp-earnings-oct19-nov6` |
| FRED | Acceso por `FRED_API_KEY` en el entorno del usuario | `2026-09-27-spy-hipotesis-fred-dtb3` |

## Non-goals

- Descargar, cachear o armar datasets; sumar fuentes pagas; datos históricos de opciones.
- Elegir automáticamente la capacidad para un pedido (entrega 6) o el perfil del usuario (entrega 2).
- Sondear conectores del host desde código: el código no puede llamar a los MCP del host; el host registra lo que observa.

## Acceptance criteria

- [x] **AC-01 — Registro declarativo:** archivo versionado de fuentes (GaleCore, FRED, Alpha Vantage, FMP) con tipo de acceso
  (API de GaleCore, API con clave, conector del host), qué datos cubre por categoría, costo y límites conocidos, preferencia
  y sonda mínima; contrato que lo valida y rechaza entradas incompletas.
- [x] **AC-02 — Estado de acceso con historia:** el estado observado (disponible, denegado, límite, caído) se guarda en
  `knowledge/` con fecha, fuente de la observación y referencia a evidencia; nunca claves. Sembrado con las restricciones
  de la tabla de arriba, cada una citando su evidencia.
- [x] **AC-03 — Comprobar:** un comando comprueba con la llamada mínima lo que el código puede probar (GaleCore, FRED) y
  registra el resultado; otro permite al host registrar lo que observó en un conector (`HOST_DECLARED`).
- [x] **AC-04 — Consultar:** «¿de dónde saco X?» devuelve las fuentes que lo cubren, ordenadas (GaleCore primero, después
  costo), con su último estado y restricciones; «¿qué datos tengo?» resume por categoría. Un dato sin fuente se declara faltante.
- [x] **AC-05 — Uso por las capacidades:** entrada en el catálogo; la regla 4 de `context-research` pasa a consultar el
  registro y a registrar hallazgos de acceso en vez de decidir por su cuenta.
- [x] **AC-06 — Demostración:** desde una sesión nueva, las dos preguntas del acuerdo se responden desde el registro.
- [x] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `contracts/sources.py` (`DataSource`, `SourceRegistry`, `AccessType`); `config/sources.yaml` (galecore, fred, alpha_vantage, fmp — `covers` limitado a lo que `KNOWN_CAPABILITIES` puede servir, con SPY/VIX/VVIX nombrados explícitamente para GaleCore); `adapters/source_registry_store.py` | `tests/unit/test_sources.py::TestDataSourceContract`, `test_config_sources_yaml_loads_and_validates`, `test_config_sources_yaml_finds_symbols_it_actually_serves` | — | DONE |
| AC-02 | `contracts/source_status.py` (`SourceStatusObservation` con `category` opcional; estados available/denied/limited/down; origin code_probe/host_declared; `SourceStatusDocument.latest` por `observed_at` máximo, no por orden de anexado); `adapters/source_status_store.py` (append-only, `<knowledge>/sources/<id>.md`) | `tests/unit/test_sources.py::TestSourceStatusObservation`, `TestFileSourceStatusStore` (incluye `test_latest_is_by_observed_at_not_append_order`), `test_status_shown_is_specific_to_the_matched_category`, `test_integrity_failed_status_is_reported_not_raised` | `knowledge/sources/{galecore,fred,alpha_vantage,fmp}.md` (resembrado 2026-09-29 dos veces: tras el BLOCKER de `observed_at` de la revisión interna y de nuevo tras los MAJOR de Codex, con la calificación "retrieved_at es cota superior" preservada en cada nota) | DONE |
| AC-03 | `application/source_probe.py` (`probe_galecore`, `probe_fred`, FRED clasifica HTTP 400 como `denied`); CLI `sources check` / `sources declare --observed-at --category` (`adapters/cli.py`, sin filtrar la credencial rechazada al error) | `tests/unit/test_sources.py::TestProbeFred`, `test_cli_sources_check_galecore_reports_down_without_a_server`, `test_cli_sources_declare_needs_a_host_connector_and_a_resolvable_evidence`, `test_cli_sources_declare_rejects_a_credential_without_echoing_it` | `docs/evidence/gc-ai-0012/ac03-ac04-ac06-evidence-2026-09-29.md` (comando y salida completos de `sources check` para GaleCore y FRED, con el setup de `PYTHONPATH=src` del worktree) | DONE |
| AC-04 | `application/source_query.py` (`query_sources`: todas las palabras del pedido, sin acentos, dentro de la misma cobertura; `catalog_summary`; estado específico por categoría vía `_relevant_observation`) | `tests/unit/test_sources.py::TestQuery` (incluye los casos reproducidos por ambas revisiones) | `docs/evidence/gc-ai-0012/ac03-ac04-ac06-evidence-2026-09-29.md` | DONE |
| AC-05 | `config/catalog.yaml` (entrada `data_sources`); `config/skills/data-sources/skill.yaml`; `config/skills/context-research/skill.yaml` regla 4 reescrita (consulta el registro, ya no decide ni lista fuentes hardcodeadas) | `cli catalog` reporta `data_sources.available == true` | — | DONE |
| AC-06 | — (demostración, no código) | — | `docs/evidence/gc-ai-0012/ac03-ac04-ac06-evidence-2026-09-29.md`: las dos preguntas del acuerdo más los casos de la revisión de Codex, procesos `python -B` nuevos e independientes, contestadas desde el registro con estado real y específico por categoría; "cadena de opciones de SPY" da `missing: true` (hallazgo honesto: ninguna capability registrada la sirve hoy); "cotizaciones de SPY" y "VIX" sí resuelven a GaleCore | DONE |
| AC-07 | — | — | — | PENDING (revisión interna 1 y Codex 1, ambas CHANGES_REQUESTED → corregidas; falta la del owner) |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff — Increment 1 (2026-09-29, worktree `.worktrees/galecore-ai/GC-AI-0012`, base `0cb6df3`, uncommitted)

**Qué se hizo:** el registro declarativo de fuentes y su historia de acceso observado, la
consulta por necesidad, la comprobación mínima que el código puede correr (GaleCore, FRED) y
la declaración de lo que el host observó en un conector, más el uso de todo esto desde el
catálogo y desde `context-research`.

**Archivos:**
- `config/sources.yaml` (AC-01): registro con las 4 fuentes ya conocidas (GaleCore, FRED,
  Alpha Vantage, FMP), cada una con `access_type`, `covers` por categoría, `cost`, `limits`,
  `preference` y `probe` (comando corrible sólo para GaleCore/FRED; `null` en los conectores
  del host).
- `src/galecore_ai/contracts/sources.py` (AC-01): `DataSource`/`SourceRegistry` — rechaza una
  fuente sin cobertura, sin comando corrible cuando el tipo de acceso lo exige, o con un
  comando cuando es `host_connector`; ids duplicados; también los tipos de salida de
  `list`/`query` (`SourceQueryResult`, `SourceCatalogSummary`).
- `src/galecore_ai/adapters/source_registry_store.py` (AC-01): carga y valida `config/sources.yaml`
  (mismo patrón que `harness/catalog.py`).
- `src/galecore_ai/contracts/source_status.py` (AC-02): `SourceStatusObservation` — cuatro
  estados (available/denied/limited/down), origen `code_probe` (sin host) o `host_declared`
  (con host obligatorio), nota sin credenciales (mismo regex que `evidence.py`), timestamp con
  tz.
- `src/galecore_ai/adapters/source_status_store.py` (AC-02): un archivo Markdown por fuente
  (`<knowledge>/sources/<id>.md`), frontmatter autoritativo, sólo permite anexar (una escritura
  que no empieza con las observaciones ya existentes, en el mismo orden, se rechaza), cuerpo
  derivado y comparado en cada lectura (mismo patrón que `record_store.py`).
- `src/galecore_ai/application/source_probe.py` (AC-03): `probe_galecore` (GET
  `market_data.trade` de SPY vía `CapabilityDispatcher`) y `probe_fred` (GET liviano a
  `fred/series` con `FRED_API_KEY`; sin clave configurada es `denied`, nunca imprime la clave).
- `src/galecore_ai/application/source_query.py` (AC-04): `query_sources` (coincidencia por
  palabra, ≥4 letras, para que "la cadena de SPY" encuentre "cadenas de opciones" sin
  convertirse en búsqueda difusa sobre todo el registro) y `catalog_summary` (agrupado por
  categoría).
- `src/galecore_ai/adapters/cli.py`: subcomando `sources` (`list`, `query --need`,
  `check [--source galecore|fred]`, `declare --source --state --note [--evidence] --host-model`).
  `declare` exige un `access_type: host_connector` (si no, sugiere `sources check`) y, si se
  cita evidencia, la resuelve con `application.knowledge.resolve_ref` antes de guardar.
- `config/catalog.yaml` (AC-05): entrada `data_sources` (`kind: harness`), con su skill,
  flujo y controles.
- `config/skills/data-sources/skill.yaml` (AC-05): skill nueva, mínima, que sólo indica cómo
  usar `sources list|query|check|declare` — no hace cálculos propios.
- `config/skills/context-research/skill.yaml` (AC-05, versión 0.1.1 → 0.2.0): la regla 4
  pasa de decidir la fuente y listar accesos observados el 27/09 (hardcodeado, con fecha
  vencida) a consultar `sources query`/`sources list`, usar `sources check`/`sources declare`
  para refrescar un estado viejo o ausente, y declarar cada hallazgo — nunca en silencio.
- `tests/unit/test_sources.py` (31 tests): contratos, store (append-only e integridad),
  query/catalog_summary, probe de FRED (sin clave), y CLI (`list`, `query` con y sin match,
  `check` contra un puerto cerrado, `declare` con conector inválido y con evidencia
  inexistente/existente).
- `tests/unit/test_knowledge.py`: dos aserciones que enumeraban los ids del catálogo
  (`TestCatalog::test_every_entry_is_available_and_consistent`,
  `TestCli::test_catalog_lists_the_capabilities`) actualizadas con `data_sources` en su lugar
  (después de `regime_interpretation`, antes de `research`, como quedó en `catalog.yaml`).

**Invariantes que se mantienen:** el mismo patrón de `record_store`/`evidence_store` para
append-only e integridad; el guardrail de credenciales de `evidence.py` reutilizado tal cual
en `source_status.py`; el código nunca llama un conector del host (regla ya vigente,
`context-research` non-goal) — `sources check` sólo cubre GaleCore y FRED, todo lo demás pasa
por `sources declare` con `HOST_DECLARED`.

**Comandos corridos (reales, no simulados):**
```
python tools/engineering_gate.py            → PASS (DRAFT, 7 AC listados como pendientes en el gate; el gate no lee el estado de los checkboxes de este archivo)
python -B -m ruff check --no-cache .        → All checks passed!
python -B -m pytest -q -p no:cacheprovider  → 837 passed (806 previos + 31 nuevos), 0 failed
git diff --check                            → sin salida (sin conflictos de espacio en blanco)
```

**Caso manual (AC-06), en `docs/evidence/gc-ai-0012/ac06-demo-2026-09-29.md`:**
- `sources list` (proceso nuevo): resume las 4 fuentes por categoría.
- `sources query --need "cadena de opciones de SPY"` → GaleCore (única que cubre `market_data`
  con esa descripción), con su último estado real: `down` porque la API de GaleCore Dev no
  estaba levantada al momento de correr `sources check --source galecore` (falla de conexión
  real, no simulada).
- `sources query --need "curva de tasas"` → FRED, estado `available` (comprobado en vivo con
  `sources check --source fred`, usando el `FRED_API_KEY` real del entorno del usuario).

**`knowledge/sources/` sembrado (AC-02), con las 4 restricciones de la tabla del acuerdo:**
- `fred.md`: dos observaciones `code_probe` (`available`) de correr `sources check` en esta
  sesión — no hay una fila de "restricción" per se para FRED en la tabla (su fila describe el
  método de acceso, ya capturado en `cost` del registro), así que no se declaró como hallazgo.
- `alpha_vantage.md`: `limited`, `host_declared`, cita `evidence:2026-09-27-spy-ctx-av-effr-preview`.
- `fmp.md`: dos `denied` (`evidence:2026-09-27-spy-ctx-fmp-economics-calendar-denied`,
  `evidence:2026-09-28-cartera-ctx-fmp-spy-eod`) y un `limited`
  (`evidence:2026-09-27-spy-ctx-fmp-earnings-calendar-oct13-16`).
- `galecore.md`: un `code_probe` `down` (API Dev no estaba arriba en el momento de probar).
- Estos 4 archivos están en el repo separado `knowledge/` (git propio, sin push), pendientes
  de commitear ahí junto con el resto de esta sesión.

**Decisiones tomadas dentro del alcance:**
- `access_type` fija qué fuentes pueden tener `probe.command` (`galecore_api`/`api_key`: sí;
  `host_connector`: no) — el contrato lo exige en ambos sentidos, así una fuente nueva no
  puede quedar mal declarada.
- La igualación de `query_sources` es por palabra (≥4 letras) contra `category`/`description`
  en minúsculas, no un motor de búsqueda: si una fuente no dice "cadena" en su propia
  descripción, no aparece para "la cadena de SPY" — hay que describir la cobertura en el
  vocabulario que alguien realmente usaría para pedirla.
- `data_sources` es `kind: harness` en el catálogo (no `investigation` ni `interpretation`):
  no guarda nada nuevo (`stored_as: none`); sólo lee el registro y la historia de estado.

**No se tocó:** `GaleCore-AI` `main`; nada bajo `GaleCore/`; ninguna otra skill además de
`context-research` (rule 4) y la nueva `data-sources`.

## Revisión interna 1 (Claude `reviewer` subagent, Opus, 2026-09-29 ~00:15 UTC) — CHANGES_REQUESTED → corregido

Encontró 1 BLOCKER, 4 MAJOR y varios MINOR, todos reales (re-corrió gate/ruff/pytest y reprodujo
cada caso contra el registro real). Resumen y qué se hizo:

- **BLOCKER — `observed_at` fabricado en `declare`:** usaba `datetime.now(UTC)` en vez del momento
  real de la observación; el sembrado de Alpha Vantage/FMP quedó con la hora de haber corrido el
  comando, no la de la evidencia citada (27–28/09). **Corregido:** `sources declare` exige
  `--observed-at` (rechaza si falta o no es un timestamp con tz); se borraron los 4 archivos de
  `knowledge/sources/` (sólo estaban `staged`, nunca commiteados) y se resembraron con el
  `retrieved_at` real de cada evidencia citada.
- **MAJOR — `query_sources` con falsos positivos/negativos, reproducidos:** `"datos de inflación"`
  traía GaleCore primero (por la palabra suelta "datos"); `"IV"` matcheaba dentro de
  "activ**i**ty_employment" (substring sin límite de palabra); `--need ""` devolvía las 4 fuentes
  (`missing=false`); `"VIX"` y `"precio de cierre EOD de SPY"` daban `missing=true` aunque había
  evidencia real. **Corregido:** el algoritmo ahora exige que **todas** las palabras del pedido
  (folded sin acentos, con una lista de descarte de puro andamiaje de la pregunta — "datos",
  "tengo", "saco", "qué"…) aparezcan, cada una como palabra completa o prefijo de una, dentro de
  la MISMA entrada de cobertura — en vez de que alcance con una sola coincidir en cualquier lado.
  Un pedido vacío o sólo de palabras de descarte no matchea nada. `tests/unit/test_sources.py`
  suma casos que fijan cada reproducción de arriba.
- **MAJOR — el estado mostrado era el de toda la fuente, no el del endpoint que matcheó:**
  con FMP (denegaciones por endpoint), declarar un hallazgo sobre `earnings_valuation` tapaba el
  estado mostrado para `rates_curve`. **Corregido:** `SourceStatusObservation` suma `category`
  (opcional; `None` = toda la fuente); `sources declare` valida que la categoría sea una de las
  que la fuente cubre; `source_query._to_match` muestra la observación más reciente que aplica a
  la cobertura que matcheó (con esa categoría, o sin categoría), nunca un hallazgo ajeno.
- **MAJOR — `config/sources.yaml` con datos no respaldados o restricciones perdidas:** el costo de
  FMP no coincidía con la evidencia citada (decía "Premium parcial", la evidencia dice que hace
  falta Starter/Premium/Ultimate/Enterprise); GaleCore declaraba "cadenas de opciones" e "IV
  rank/implied volatility" que no están en `KNOWN_CAPABILITIES` (`capabilities/contracts.py`) — el
  dispatcher las rechazaría; Alpha Vantage declaraba `REALTIME_OPTIONS` sin evidencia; se habían
  perdido restricciones que sí existían en la regla 4 vieja (series diarias de Alpha Vantage con
  vista previa de 2 puntos, el hueco de VIX/VVIX de GaleCore). **Corregido:** `covers` de GaleCore
  ahora sólo lista lo que una capability registrada puede alcanzar (quote/trade, GEX, put skew);
  el hueco de opciones/IV/VIX quedó en `limits`, explícito, con el puntero al piloto que sí las
  alcanzaba por otro camino; el costo de FMP cita la evidencia; se agregaron `covers` con evidencia
  real para FMP (`rates_curve` vía treasury-rates, `market_data` vía chart EOD, `quotes`) usando
  evidencia que ya estaba en `knowledge/evidence/` y no se había citado
  (`2026-09-27-spy-ctx-fmp-treasury-rates`, `2026-09-27-spy-ctx-fmp-spy-quote`); Alpha Vantage
  perdió el claim de `REALTIME_OPTIONS` (pasó a `limits`, sin verificar).
- **MAJOR — un archivo de estado alterado tiraba abajo toda la CLI con un traceback:**
  `SourceStatusIntegrityError` no la atrapaba nada en `list`/`query`/`check`/`declare`.
  **Corregido:** `source_query._to_match` atrapa la excepción y reporta `state: "integrity_failed"`
  con el detalle en `note`, en vez de propagar la excepción.
- **MINOR corregidos:** el regex de credenciales de `source_status.py` ahora se importa de
  `evidence.py` en vez de estar copiado; `probe.command` en blanco se rechaza; una entrada de
  `limits` en blanco se rechaza; FRED clasifica HTTP 400 (clave inválida) como `denied`, no `down`;
  la entrada de catálogo documenta que `sources list` devuelve `SourceCatalogSummary` aunque
  `output_contract` nombra `SourceQueryResult` (la forma de `sources query`, la salida primaria);
  se corrigió la referencia colgante a una regla `ACCESS_CONTROL` inexistente en el docstring de
  `source_probe.py`; se citó la segunda evidencia de earnings de FMP que había quedado afuera del
  sembrado.
- **MINOR no corregidos, documentados:** el regex de credenciales (heredado de `evidence.py`) sólo
  detecta el patrón `clave[=:]valor`, no una clave mencionada en prosa sin ese separador — es una
  limitación ya aceptada en GC-AI-0007, no específica de este item; no hay lock contra una
  condición de carrera entre `load` y `atomic_write` en el store (cooperativo, como
  `record_store`); `sources check` sólo está atado a `galecore`/`fred` por los `choices` del CLI —
  una fuente `api_key` nueva no tendría comando ejecutable automáticamente sin tocar `cli.py`;
  `preference` admite negativos/duplicados sin que el contrato lo impida; el desempate "después
  costo" de `query_sources` no tiene un test que lo ejerza con más de un resultado (los tres casos
  reales de la demo devuelven las fuentes ya ordenadas por `preference`, que es la señal principal).

**Reverificado tras las correcciones (todos comandos reales, no simulados):**
```
python tools/engineering_gate.py                                          → PASS (READY_FOR_REVIEW, 1 AC pendiente: AC-07)
python -B -m ruff check --no-cache .                                      → All checks passed!
python -B -m pytest -q -p no:cacheprovider tests/unit/test_sources.py tests/unit/test_knowledge.py → 86 passed
python -B -m pytest -q -p no:cacheprovider (suite completa)               → 842 passed, 0 failed
git diff --check                                                          → exit 0 (sólo aviso informativo LF→CRLF de este archivo)
```

Casos de la tabla del reviewer interno, reproducidos de nuevo contra el registro real después del
fix (ver `docs/evidence/gc-ai-0012/ac06-demo-2026-09-29.md` para la corrida completa):
- `"datos de inflación"` → sólo `fred`, `alpha_vantage` (ya no `galecore`)
- `"IV"`, `--need ""` → `missing: true` (antes traían fuentes de más)
- `"precio de cierre EOD de SPY"` → `fmp` (antes: `missing: true`)
- `"curva de tasas"` → `fred`, `alpha_vantage`, `fmp` con el estado de cada uno por su propia
  categoría (FMP: `available` para `rates_curve`, aunque su último hallazgo global fue sobre
  `earnings_valuation`)
- `"cadena de opciones de SPY"` → `missing: true` — ninguna capability registrada la sirve hoy
  (`market_data.option_chains` no está en `KNOWN_CAPABILITIES`); queda para el owner decidir si
  vale la pena habilitarla.
- `"VIX"` en este momento (antes de la revisión de Codex) también daba `missing: true`, porque el
  registro excluía VIX/VVIX de la cobertura de GaleCore por error — ver revisión de Codex abajo.

## Independent review 1 (Codex, `--uncommitted`, effort high, 2026-09-29T00:38:07Z) — `docs/engineering/reviews/GC-AI-0012-20260929T003807Z.md` — CHANGES_REQUESTED → corregido

0 BLOCKER, 4 MAJOR, 3 MINOR. El runner reejecutó gate/ruff/pytest completo (842 passed) y reprodujo
cada hallazgo contra este worktree (usó un driver nuevo,
`docs/evidence/gc-ai-0012/codex_review.py`, porque `run_review.py` apunta por defecto al checkout
principal — necesario para revisar un work item en worktree; sigue el patrón de
`docs/evidence/gc-ai-0006..0009/codex_review.py`).

- **MAJOR — nota rechazada por credencial se filtraba en el JSON de error** (`cli.py`, `declare`):
  `str(ValidationError)` de Pydantic incluye `input_value=...`, así que un `--note "api_key=..."`
  rechazado devolvía la credencial completa en `stdout`. **Corregido:** se captura
  `pydantic.ValidationError` en `declare` y se arma el mensaje sólo con `.errors()[]['msg']`, sin
  `input_value`. Test: `test_cli_sources_declare_rejects_a_credential_without_echoing_it` (verifica
  que el secreto no aparece ni en `stdout` ni en `stderr`).
- **MAJOR — "más reciente" era el último anexado, no el de `observed_at` más grande**
  (`source_query.py`, `SourceStatusDocument.latest`): como `declare` acepta `--observed-at`
  retroactivo (a propósito, para sembrar hallazgos pasados), un anexo más viejo después de uno más
  nuevo hacía ver disponible algo que ya estaba caído. **Corregido:** `SourceStatusDocument.latest`
  y `source_query._relevant_observation` eligen por `max(observed_at)`, no por posición en la
  lista (el orden de anexado sigue intacto para la integridad del archivo). Test:
  `test_latest_is_by_observed_at_not_append_order` (reproduce exactamente el caso: anexa un
  hallazgo más nuevo, después uno más viejo, verifica que se sigue mostrando el más nuevo).
  Reproducido en vivo con `sources declare` dos veces con `--observed-at` fuera de orden.
- **MAJOR — VIX/VVIX excluidos de la cobertura de GaleCore por error:** `application/prepare_regime.py`
  ya usa `market_data.trade` (capability registrada) con `symbol=VIX` y `symbol=VVIX` para el
  régimen diario — sí es una vía habilitada, al revés de lo que decía `config/sources.yaml`.
  **Corregido:** `covers` de GaleCore para `market_data` ahora nombra SPY, VIX y VVIX explícitamente
  citando `application/prepare_regime.py`; se borró el límite falso. Test:
  `test_config_sources_yaml_finds_symbols_it_actually_serves`.
- **MAJOR — coincidencia exige el nombre del instrumento en la descripción, incluso cuando la
  fuente lo sirve de forma genérica:** `"cotizaciones de SPY"` no encontraba a GaleCore porque
  "SPY" no estaba escrito en su cobertura. **Corregido:** en vez de inventar una heurística de
  detección de tickers (mayúsculas, largo — evaluado y descartado: rompe términos de dominio como
  "GEX" que también son mayúsculas cortas), se nombraron explícitamente los símbolos que el
  ecosistema usa hoy (SPY, VIX, VVIX) en la descripción de cobertura de GaleCore — la misma
  corrección que resuelve el punto anterior. Sigue siendo una limitación conocida: un símbolo nuevo
  no nombrado ahí (p. ej. "QQQ") no matchea hasta agregarlo al registro; documentado en `covers`.
- **MINOR corregidos:** el artefacto de AC-03/AC-06 no mostraba la comprobación en vivo (comando +
  salida completa) ni el setup de `PYTHONPATH=src` del worktree — nuevo archivo
  `docs/evidence/gc-ai-0012/ac03-ac04-ac06-evidence-2026-09-29.md` con ambos; las notas sembradas
  perdían la calificación "retrieved_at es cota superior" de la evidencia citada — se agregó esa
  frase a cada nota re-sembrada (`knowledge/sources/{fmp,alpha_vantage}.md`, borrados y re-hechos).
- **MINOR no corregido, documentado:** el desempate "después costo" compara la prosa de `cost`
  alfabéticamente en vez de un rango numérico explícito — ya estaba anotado como limitación
  conocida antes de esta revisión; arreglarlo bien requiere un campo nuevo en `DataSource`
  (`cost_rank` o similar), que excede el alcance de esta corrección puntual. Queda para una entrega
  futura si el owner lo pide.

**Reverificado tras estas correcciones (comandos reales):**
```
python tools/engineering_gate.py                                                    → PASS (READY_FOR_REVIEW, 1 AC pendiente: AC-07)
python -B -m ruff check --no-cache .                                                → All checks passed!
python -B -m pytest -q -p no:cacheprovider tests/unit/test_sources.py tests/unit/test_knowledge.py → 89 passed
python -B -m pytest -q -p no:cacheprovider (suite completa)                         → 845 passed, 0 failed
git diff --check                                                                    → exit 0 (mismo aviso informativo de CRLF)
```

**Pendiente para el owner (AC-07):** evaluar utilidad y decidir cierre. Una revisión de Codex más
(`--recheck`) queda a criterio del owner: los 4 MAJOR y las 3 MINOR de la primera pasada están
corregidos o documentados con su porqué; no hay BLOCKER pendiente.

## Aprobación del owner (2026-09-29)

Utilidad confirmada: el registro reemplaza decidir la fuente de datos en cada conversación por
un registro consultable con evidencia y fecha, base de la Parte 1 del roadmap. Sin `--recheck`
adicional de Codex pedido. Falta que el owner mueva el estado a `VALIDATED`/`CLOSED` (regla de
`OPERATING-MODEL.md`: sólo el owner lo hace) y decidir el commit de los 4 archivos de
`knowledge/sources/` (bloqueados por `guard_git.py`, no reconoce el repo `knowledge/`).
