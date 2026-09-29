---
id: GC-AI-0013
title: Tu perfil (base del harness, entrega 2)
status: DRAFT
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

- [ ] **AC-01 — Perfil versionado:** contrato del perfil (objetivos, capital de referencia con moneda, horizonte, límites
  de riesgo, fuentes preferidas validadas contra el registro de fuentes, formato de entrega, idioma); cada campo puede
  quedar declarado faltante; versiones create-only en `knowledge/profile/` con nota de qué cambió, pedido que lo originó y
  hash; nunca credenciales.
- [ ] **AC-02 — Ver y cambiar desde el chat:** `profile show` (versión vigente y faltantes), `profile set` (cambios
  parciales → versión nueva; sin cambios reales, no crea versión), `profile history`.
- [ ] **AC-03 — Citable:** `profile:vN` resuelve con integridad en `resolve_ref`, `kb show` y `kb search`.
- [ ] **AC-04 — Uso por las capacidades:** entrada en el catálogo; `research` y `context_research` leen el perfil al
  empezar, lo aplican y citan `profile:vN` en lo que guardan; lo faltante del perfil se declara en el resultado.
- [ ] **AC-05 — Demostración:** sesión nueva: investigación de contexto aplica el perfil sin repetirlo y cita `profile:v1`;
  cambio de perfil → la corrida siguiente cita `profile:v2`.
- [ ] **AC-06 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Requirement-to-evidence matrix

| Criterio | Implementación | Verificación automática | Artefacto | Estado |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | — | — | PENDING | PENDING |
| AC-06 | — | — | — | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
