---
id: GC-AI-0021
title: El espacio del trader en GaleCore, usado por GaleCore-AI (Producto 1, fase 3b)
status: CLOSED
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
---

# GC-AI-0021 — El espacio del trader, del lado de GaleCore-AI

Roadmap §4, Producto 1, fase 3 (owner, 03/10: el espacio vive **en GaleCore, por usuario**; «dale, seguí con la 3b»).
La tabla y los endpoints son de GaleCore GC-0007 (3a). La pestaña «Mi espacio» es la 3c.

## Para qué

Que GaleCore-AI sepa quién es el trader al empezar cada sesión (perfil, objetivos, convenciones, agentes, memoria,
skills propias y compartidas) y responda según sus objetivos sin que los repita, guardando lo que el trader pide
conservar en su espacio, que después ve y edita en el monitor.

## Qué se hizo

| Pieza | Cómo |
|---|---|
| Cliente | `adapters/galecore_space.py`: entra como el trader (`GALECORE_USERNAME`/`GALECORE_PASSWORD`; en Dev, el usuario demo de `GaleCore/dev/.local/env.json`), lee, guarda y borra piezas. No guarda credenciales |
| Importar lo local | `space import`: perfil vigente, cada objetivo, convenciones (compartidas), agentes activos o pausados, skills del catálogo (compartidas). Escribe sólo lo que cambió |
| Al iniciar sesión | `space context` (resumen de pocas líneas) desde el hook `SessionStart` del workspace; si GaleCore no responde, una línea y sigue |
| Capacidad | `trader_space` en el catálogo, con skill 0.1.0: qué se guarda, cuándo, y que lo compartido de otros es contexto |

## Acceptance criteria

- [x] **AC-01 — Cliente y reglas:** login como el trader, lectura de lo propio y lo compartido, escritura de lo propio;
  un login fallido no expone la contraseña. Tests: `tests/unit/test_space.py` (GaleCore simulado).
- [x] **AC-02 — Importar sin duplicar versiones:** una segunda importación sin cambios no escribe; un cambio sube la versión.
- [x] **AC-03 — Resumen al iniciar:** `space context` dice perfil, objetivos, agentes y lo compartido; el hook no corta
  la sesión si GaleCore no responde.
- [x] **AC-04 — Prueba real en GaleCore Dev:** `space import` y `space context` contra la API Dev con GC-0007.
  **Evidencia 03/10 (API Dev desde `local/integracion`):** `space import` como `demo` → 20 piezas creadas (perfil v5,
  1 objetivo, 1 convención, 3 agentes, 14 skills); segunda corrida → 0 escritas, 20 sin cambios. `space context` da
  perfil (capital 10.000 USD, horizonte, límites), objetivos, convenciones, agentes y skills. Arreglados en la prueba:
  el usuario se informaba antes del login; la consola de Windows no imprimía «−».
- [x] **AC-05 — Revisión:** interna; utilidad y cierre, vos.

## Cierre

**CLOSED por el owner el 04/10/2026** («ok, cerrá GC-AI-0024 y el lote pendiente»), en lote con GC-AI-0019…0024.
Revisión: interna (con sus arreglos registrados arriba); sin Codex. Demos reemplazadas por ejemplos internos y corridas
reales (regla del 03/10).
