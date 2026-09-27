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
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | — | PENDING | PENDING |
| AC-04 | — | — | PENDING | PENDING |
| AC-05 | — | — | PENDING | PENDING |
| AC-06 | — | — | PENDING | PENDING |
| AC-07 | — | — | PENDING | PENDING |

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

## Implementer handoff

**State:** PENDING
