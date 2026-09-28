---
id: GC-AI-0012
title: Mapa de fuentes de datos (base del harness, entrega 1)
status: DRAFT
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

- [ ] **AC-01 — Registro declarativo:** archivo versionado de fuentes (GaleCore, FRED, Alpha Vantage, FMP) con tipo de acceso
  (API de GaleCore, API con clave, conector del host), qué datos cubre por categoría, costo y límites conocidos, preferencia
  y sonda mínima; contrato que lo valida y rechaza entradas incompletas.
- [ ] **AC-02 — Estado de acceso con historia:** el estado observado (disponible, denegado, límite, caído) se guarda en
  `knowledge/` con fecha, fuente de la observación y referencia a evidencia; nunca claves. Sembrado con las restricciones
  de la tabla de arriba, cada una citando su evidencia.
- [ ] **AC-03 — Comprobar:** un comando comprueba con la llamada mínima lo que el código puede probar (GaleCore, FRED) y
  registra el resultado; otro permite al host registrar lo que observó en un conector (`HOST_DECLARED`).
- [ ] **AC-04 — Consultar:** «¿de dónde saco X?» devuelve las fuentes que lo cubren, ordenadas (GaleCore primero, después
  costo), con su último estado y restricciones; «¿qué datos tengo?» resume por categoría. Un dato sin fuente se declara faltante.
- [ ] **AC-05 — Uso por las capacidades:** entrada en el catálogo; la regla 4 de `context-research` pasa a consultar el
  registro y a registrar hallazgos de acceso en vez de decidir por su cuenta.
- [ ] **AC-06 — Demostración:** desde una sesión nueva, las dos preguntas del acuerdo se responden desde el registro.
- [ ] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | PENDING | PENDING | PENDING | PENDING |
| AC-06 | PENDING | PENDING | PENDING | PENDING |
| AC-07 | — | — | — | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
