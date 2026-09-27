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
| AC-02 | `contracts/evidence.py`, `adapters/evidence_store.py`, ref `evidence:` (`knowledge_base.py`), `evidence add` (`cli.py`), `tools/fred_query.py` | `tests/unit/test_evidence.py` (20 casos: HOST_DECLARED, credenciales en payload, no sobrescribe, credenciales, extracto, futuro, integridad, cita y backlink, búsqueda, CLI) | 22 items `knowledge/evidence/2026-09-27-spy-ctx-*.json` | Implementado; verificado local y en el recorrido real |
| AC-03 | — | — | [README §Fuentes](../../evidence/gc-ai-0007/README.md); hallazgos abajo; evidencia de la denegación FMP | Hecho con acceso real (GaleCore, FMP, Alpha Vantage, FRED) |
| AC-04 | — | `recompute.py` reproduce los cálculos propios desde la evidencia | `research:2026-09-27-spy-contexto-prima-30-60d` r1; README §Análisis | Entregado; utilidad: evalúa el owner |
| AC-05 | — | `kb search --status unfinished` la encuentra; `kb show` muestra r1→r3 y `cited_by` | r2 (corrección CPI), r3 (resultado FRED) | Guardar/encontrar/revisar: hecho. **Continuidad desde sesión nueva: NO probada** (bloqueada por permisos del host) |
| AC-06 | — | — | README §Guion, §Aporte, §No demostrado | Entregado |
| AC-07 | — | — | pendiente | — |

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

**State:** entrega implementada y ejecutada; revisión pendiente.

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

- `PYTHONPATH=src python -B -m pytest -q -p no:cacheprovider` → 716 passed (incluye los casos nuevos de test_evidence.py).
- `python -B -m ruff check --no-cache .` → All checks passed. `python tools/engineering_gate.py` → PASS.
- `python docs/evidence/gc-ai-0007/recompute.py` → reproduce RV20 10,76 %, IV30/RV20 1,39, 2–10 25→36 pb,
  CPI 3,40 % (AV) / 3,35 % (FRED SA), DFII10 2,63→2,85, T10YIE 2,33→2,33.

### Gaps y riesgos conocidos

- Continuidad desde sesión nueva no probada (arriba). r2 y r3 las escribió la misma sesión.
- La skill se editó (línea de FRED) después de r1: r1 tiene otro hash que r2/r3 con la misma versión 0.1.0.
- `recompute.py` ubica `knowledge/` por la estructura de worktree (`parents[6]`).
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
