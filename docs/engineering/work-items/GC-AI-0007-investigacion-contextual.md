---
id: GC-AI-0007
title: Investigación contextual de una idea de trading con fuentes reales y memoria
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0007 — Investigación contextual de una idea de trading

Origen: pedido del owner del 27/09/2026 (entregable al partner) sobre la propuesta de `roadmap/README.md`
§4 «Corrección propuesta para el entregable al partner (26/09/2026)». El owner autorizó priorizarla,
actualizar plan y alcance y crear este item; GC-AI-0006 sigue abierto con sus pendientes (ver su traspaso).

## Acuerdo breve (ENGINEERING §3)

- **Problema:** GaleCore-AI sabía interpretar GEX/régimen e investigar con documentos locales, pero no
  armar el contexto de una idea (tasas, inflación, empleo, beneficios, eventos, opciones) con datos reales
  de varias fuentes, ni conservar esa evidencia de forma durable y citable.
- **Qué podés hacer al terminar:** pedir en lenguaje normal «quiero investigar una estrategia sobre X»;
  el host elige factores según la idea y el horizonte, consulta GaleCore y las fuentes externas que
  correspondan, guarda cada respuesta con su procedencia, separa observación / expectativa implícita /
  consenso / hipótesis, contrasta escenarios y deja la investigación retomable.
- **Primera demostración:** SPY, horizonte de 30–60 días (el de la idea PCS ya investigada), con
  GaleCore + Alpha Vantage + FMP; después una sesión nueva la retoma e incorpora una observación.
- **Qué falta para correrla:** nada bloqueante. FRED no está disponible en esta sesión (ver hallazgos).
- **Fuera:** servidor MCP de GaleCore-AI, host propio, endpoints nuevos en GaleCore, plataforma de
  conectores, backtests, despliegue, estrategias aprobadas, afirmar rentabilidad o mejor análisis.

## Acceptance criteria

- [ ] **AC-01 — Método descubrible:** entrada `context_research` en el catálogo con su skill; aplicable
  desde un pedido normal; reutiliza `research`/`knowledge` y el método piloto de estrategias.
- [ ] **AC-02 — Evidencia durable con procedencia:** cada respuesta usada queda en `knowledge/evidence/`
  (inmutable, con hash) con fuente, herramienta/serie, parámetros no sensibles, unidad, fecha del dato y
  de consulta, frecuencia y notas de revisión/acceso; citable como `evidence:<id>`; nunca marcada como
  verificada por GaleCore; parámetros sensibles rechazados.
- [ ] **AC-03 — Selección de fuentes con acceso comprobado:** qué aporta cada fuente con sus permisos
  reales en esta sesión, incluidas las diferencias (denegaciones, límites, ausencias).
- [ ] **AC-04 — Análisis real de SPY:** factores elegidos con su porqué; tipos de afirmación separados;
  escenarios compatibles e incompatibles; consecuencias para investigar la estrategia; faltantes y cómo
  comprobarlo. Fiscal y geopolítica pendientes si no hay evidencia.
- [ ] **AC-05 — Memoria efectiva:** guardada con `research save`, encontrada con `kb search`, revisada
  con una observación nueva real que dice qué cambia y qué se mantiene; continuidad desde una sesión nueva
  afirmada sólo si se ejecutó.
- [ ] **AC-06 — Guion para el partner** y registro de qué aportó GaleCore-AI y qué no está demostrado.
- [ ] **AC-07 — Revisión:** interna y Codex; la utilidad la evalúa el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | `config/catalog.yaml` (`context_research`), `config/skills/context-research/skill.yaml`, `research save/revise --capability` (`application/knowledge.py`) | `test_catalog_offers_context_research`, `test_revision_records_the_method_followed`, catálogo en `test_knowledge.py` | Revisiones r1–r3 selladas con `context_research` 0.1.0 | Implementado; verificado local |
| AC-02 | `contracts/evidence.py`, `adapters/evidence_store.py`, ref `evidence:` (`knowledge_base.py`), `evidence add` (`cli.py`), `tools/fred_query.py` | `tests/unit/test_evidence.py` (29 casos: HOST_DECLARED también en `host`, credenciales en nombres/valores/payload, creación exclusiva, no sobrescribe, credenciales, extracto, futuro, integridad, cita y backlink, búsqueda, CLI) | 28 items `knowledge/evidence/2026-09-27-spy-ctx-*.json` (incluye metadatos FRED y respuestas de error/denegación) | Implementado; verificado local y en el recorrido real |
| AC-03 | — | — | [README §Fuentes](../../evidence/gc-ai-0007/README.md); hallazgos abajo; evidencia de la denegación FMP | Hecho con acceso real (GaleCore, FMP, Alpha Vantage, FRED) |
| AC-04 | — | `recompute.py` verifica con asserts los 28 valores derivados contra la evidencia (exit 0) | `research:2026-09-27-spy-contexto-prima-30-60d` r1; README §Análisis | Entregado; utilidad: evalúa el owner |
| AC-05 | — | `kb search --status unfinished` la encuentra; `kb show` muestra r1→r3 y `cited_by` | r2 (corrección CPI), r3 (resultado FRED), **r4 (sesión nueva, 27/09)** | Guardar/encontrar/revisar: hecho. **Continuidad desde sesión nueva: ejecutada** el 27/09 (ver abajo); utilidad: evalúa el owner |
| AC-06 | — | — | README §Guion, §Aporte, §No demostrado | Entregado |
| AC-07 | — | — | Interna R1 APPROVE; Codex C1 y C2 CHANGES_REQUESTED → corregidos; **Codex C3 APPROVE** | Revisión: sí. Pendiente: utilidad y cierre (owner) |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Hallazgos del primer recorrido (27/09)

- **FRED no está disponible:** no aparece como tool en la sesión. `~/fred-mcp-server` está compilado pero
  no registrado en Claude Code (`claude mcp list`), y no hay `FRED_API_KEY` en el entorno ni en GaleCore
  (`FredApi:Key` vacía; user-secrets sin esa clave). Afecta tasas reales y breakevens.
- **FMP (plan actual):** `treasury-rates`, `quote`, `chart` (EOD) y `calendar` (resultados con consenso
  de EPS) responden. `economics-calendar` y `etfAndMutualFunds` → ACCESS DENIED por plan; el mensaje pide
  no reintentar el tool `economics`, así que `economics-indicators` no se probó.
- **Alpha Vantage (clave gratuita):** 1 consulta/s y 25/día; tres consultas en paralelo fallaron por
  límite. Las mensuales devuelven toda la historia sin filtro de fechas; las diarias grandes se truncan
  a 2 puntos. `CPI` y `UNEMPLOYMENT` traen `.` en 2025-10 (dato faltante en la fuente).
- **GaleCore:** 7 GET de sólo lectura con el script del piloto; sin historia ni vol realizada (ya
  registrado en GC-AI-0006).

- **FRED (actualización 27/09, tarde):** el owner pasó una clave en la conversación y autorizó usarla para la
  prueba (la va a rotar). Se usa sólo por variable de entorno con `tools/fred_query.py`; no está en ningún
  archivo, evidencia ni commit. El MCP de FRED sigue sin registrar.
- **Sesión nueva bloqueada:** lanzar `claude -p` desde esta sesión para probar la continuidad fue denegado
  por el clasificador de permisos del host. No se buscó otra vía. La prueba queda para el owner.

## Implementer handoff

**State:** READY_FOR_REVIEW del owner — implementada, ejecutada, revisión interna y Codex APPROVE; continuidad en sesión nueva ejecutada el 27/09 (r4). Falta: evaluación de utilidad y cierre (owner).

### Qué se hizo

- Capacidad `context_research` (skill 0.1.0 + catálogo); `evidence` como tipo nuevo de `knowledge/`
  (create-only, hash, `HOST_DECLARED`, citable, buscable); `research save/revise --capability` sella la
  revisión con la skill seguida; `tools/fred_query.py` (sólo lectura, clave por entorno).
- Recorrido real: 22 evidencias (GaleCore 7; FMP 5: treasury-rates, quote, chart, earnings-calendar y la
  denegación del calendario macro; Alpha Vantage 6; FRED 4) y la investigación
  con 3 revisiones. Presupuesto consumido: GaleCore 7 GET; FMP 6 llamadas (2 denegadas); Alpha Vantage 9
  llamadas (3 rechazadas por límite); FRED 8 GET.
- Correcciones fuera del alcance mínimo pero necesarias para el gate: lint de `galecore_query.py` (GC-AI-0006).

### Comandos y resultados

- `python -B -m pytest -q -p no:cacheprovider` (comando exacto; `tests/conftest.py` usa el `src` de este checkout) → 728 passed, 1 warning.
- `python -B -m ruff check --no-cache .` → All checks passed. `python tools/engineering_gate.py` → PASS.
- `python docs/evidence/gc-ai-0007/recompute.py` → 28 OK, «Todos los valores coinciden», exit 0.

### Gaps y riesgos conocidos

- Continuidad desde sesión nueva no probada (arriba). r2 y r3 las escribió la misma sesión.
- La skill se editó (línea de FRED) después de r1: r1 tiene otro hash que r2/r3 con la misma versión 0.1.0.
- `recompute.py` ubica `knowledge/` por la estructura de worktree (`parents[6]`) salvo `GALECORE_KNOWLEDGE_DIR`.
- Referencia `file:` al recorrido del 26/09 apunta al worktree GC-AI-0007; si se borra, queda sólo su hash.
- Las payloads de conectores las transcribió el host; horas de consulta son cotas superiores.

## Revisión interna R1 (agente `reviewer`, Sonnet, `e7dd338..a5170c6`) — APPROVE

Re-corrió gate PASS, ruff, pytest 716 y `diff --check`; recalculó a mano cada número de la investigación contra
las 22 evidencias (todos coinciden); buscó el prefijo de la clave FRED en worktree, `knowledge/` y `git log -p`
de ambos repos: cero apariciones. Confirmó que ningún texto afirma la continuidad desde sesión nueva.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| R1-m1 | MINOR | El contrato sólo rechazaba credenciales en `params`, no en el `payload` | Corregido: patrón de credencial en el payload se rechaza (+3 casos); las 22 evidencias existentes siguen válidas |
| R1-m2 | MINOR | Lint en `galecore_query.py` (archivo de GC-AI-0006) | Aceptado: declarado, trivial, necesario para el gate |
| R1-m3 | MINOR | Skill editada entre r1 y r2 sin subir versión | Aceptado como gap declarado; próxima edición sube versión |

## Revisión Codex C1 (`GC-AI-0007-20260927T170318Z.md`, `e7dd338..869e1cf`) — CHANGES_REQUESTED

Todos los valores cuantitativos de r1–r3 coinciden con la evidencia citada; AC-01 y AC-06 PASS.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C1-M1 | MAJOR | Credenciales en valores de `params` y formas como `{"token":"…"}` pasaban | Corregido: se revisan valores y payload con un patrón ampliado (token, cookie, session, X-API-KEY, URL); +8 casos; las evidencias existentes siguen válidas |
| C1-M2 | MAJOR | `host.provenance` podía declarar `GALECORE_VERIFIED` | Corregido: el documento exige `HOST_DECLARED` también en `host`; `save_evidence` lo rechaza como `KnowledgeError` |
| C1-M3 | MAJOR | Metadatos FRED, límite de Alpha Vantage y denegación de ETF de FMP sólo como notas | Corregido: 6 evidencias nuevas con las respuestas exactas (`*-series-meta`, `av-rate-limit-response`, `fmp-etf-information-denied`) |
| C1-M4 | MAJOR | `recompute.py` fallaba en consola Windows y no cubría todos los derivados | Corregido: salida UTF-8 segura; verifica con asserts los 28 valores derivados |
| C1-M5 | MAJOR | El comando exacto de pytest fallaba en el worktree; conteo 716 desactualizado | Corregido: `tests/conftest.py` antepone el `src` del checkout (import y subprocesos); comando exacto → 726 passed |
| C1-m1 | MINOR | Creación no exclusiva (check-then-replace) | Corregido: `open("x")`; una escritura cortada queda INTEGRITY_FAILED, nunca sobrescribe |
| C1-m2 | MINOR | Skill editada sin subir versión | Registrado: regla — toda edición de una skill ya usada sube su versión; el hash de cada revisión identifica la definición exacta |

## Recheck Codex C2 (`--recheck`, `869e1cf..1cdeb5f`) — CHANGES_REQUESTED

C1-M2..M5 y C1-m1 resueltos; AC-03 y AC-04 pasan a PASS. Abiertos y corregidos después:

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C1-M1 | MAJOR | `{"session":"…"}` y `Session: …` todavía pasaban | Corregido: `session` sin sufijo reconocido; +2 casos; las 28 evidencias siguen válidas |
| C1-m2 | MINOR | Versión 0.1.0 con dos definiciones distintas ya selladas | Corregido: skill a 0.1.1. Para las revisiones existentes el hash es la identidad: r1 `sha256:dff3e57d…` = definición del commit `1d7c0be`; r2 y r3 `sha256:258d1ec5…` = commit `2572a5d`. Regla: toda edición de una skill ya usada sube versión |

## Recheck Codex C3 (`GC-AI-0007-20260927T173748Z.md`, `1cdeb5f..00930ab`) — APPROVE

C1-M1 y C1-m2 resueltos; AC-01..AC-04 y AC-06 PASS; AC-05 y AC-07 quedan como decisión del owner (continuidad en
sesión nueva y utilidad). MINOR nuevo (conteos 27/726 desactualizados) corregido: 29 casos, 728 tests.
El APPROVE no cambia `status`, `closure_blocked` ni `approval_result`: cierra el owner.

## Continuidad desde una sesión nueva (27/09, tarde) — sin cambios de código

Pedido del owner, en una sesión sin el contexto anterior: «Retomá la investigación de contexto sobre vender prima en
SPY, incorporá una observación o corrección real y explicá qué cambia y qué se mantiene. Guardalo.»

- **Recuperar:** `catalog` (desde este worktree; el checkout principal está en `feature/GC-AI-0005` y no tiene
  `context_research`) y `kb search --text "vender prima SPY contexto"` → `research:2026-09-27-spy-contexto-prima-30-60d` r3,
  mostrada antes de escribir.
- **Fuentes en esta sesión:** FMP responde. FRED **no**: `FRED_API_KEY` no está en el entorno (la clave anterior se
  usó sólo por variable de aquella sesión); no se pidió por chat. Sin datos de mercado nuevos (domingo, último cierre 25/09).
- **Aporte real → r4 (`correction`):** 3 evidencias FMP `earnings-company` (MSFT 28/10, AAPL 29/10, NVDA 18/11; payload
  transcripto por el host, declarado en `access_notes`) y corrección del diseño del estudio condicional: umbrales ya no
  delegados al owner; eventos no solapados, bootstrap por bloques y suficiencia calculada. El estudio no se corrió (FRED).
- **Qué no prueba:** que el razonamiento sea correcto ni útil; eso lo evalúa el owner. knowledge commit local.
