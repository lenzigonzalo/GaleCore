---
id: GC-0002
title: SHADOW con datos reales — el runtime sin ningún camino ficticio (I2)
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-0002 — SHADOW con datos reales (I2 del plan)

Incremento I2 de [`roadmap/README.md`](../../../../roadmap/README.md), decidido por el owner el
2026-09-24 ("Opción A"). Base: checkpoint `5fa6615` (runtime tal como estaba, con caminos
ficticios) en `feature/pcs-spy-shadow-runtime`; trabajo en `feature/GC-0002-shadow-datos-reales`.
Inventario y gaps de partida: WS-0001 `SHADOW-VALIDATION-DRAFT.md` (G-1, G-2, G-3).

## Objective

Que el runtime SHADOW de GaleCore evalúe, descarte, abra y valúe posiciones **sólo con datos
reales**: si un dato falta, la evaluación se bloquea y queda registrado por qué; nunca se inventa
una métrica, un candidato ni un precio. SHADOW simula la *orden* (no hay broker), nunca el *dato*.

## Decisiones que aplica

- **W-1** (owner, 20/09) y **regla general del 24/09:** datos siempre reales, en todo el ecosistema.
- **W-2** (owner, 20/09): se valida en memoria; reinicio y persistencia son no-goals.
- **Switch OFF** (owner, 24/09): pausa entradas nuevas y sigue monitoreando lo abierto; no borra.
- La spec actual es **de prueba**, no una estrategia (owner, 24/09): se renombra.

## Non-goals

- Persistencia y reinicio (W-2; es I3). Front (I3). Backtest y calidad económica. PAPER/LIVE.
- Estrategias nuevas o elegir una estrategia para SHADOW (I4). Cambiar gates o umbrales de la spec.
- Check de riesgo por % de net liq (necesita datos de cuenta; queda declarado).
- GaleCore-AI: nada del runtime depende de él.

## Acceptance criteria

- [ ] **AC-01 — Sin métricas inventadas:** si el resolver de métricas falla o no devuelve valor, la
  métrica es `NO_DATA`, el gate aplica su `on_no_data` (`BLOCK` en la spec) y no se construye
  candidato. Se elimina `BuildStubMetrics`.
- [ ] **AC-02 — Sin candidato inventado:** si el constructor no produce un candidato real, no hay
  posición y queda un evento de descarte con la razón. Se elimina `BuildStubCandidate`.
- [ ] **AC-03 — Valuación real de posiciones:** el monitor valúa cada posición con el mid real de
  sus patas y el DTE real de su vencimiento; si falta un precio, no evalúa salidas y registra
  `NO_DATA`. Se elimina el decaimiento lineal.
- [ ] **AC-04 — Apagar pausa, no borra:** con el switch OFF no se abren posiciones, las abiertas
  siguen monitoreándose y todo el estado sigue consultable. Se elimina el borrado al apagar.
- [ ] **AC-05 — Trazabilidad:** cada evaluación queda consultable (serie acotada en memoria, no sólo
  la última), con valores por gate; hay eventos para gates que no pasan, `NO_DATA`, candidato no
  viable (con razón) y salida no evaluada por falta de precio.
- [ ] **AC-06 — Spec de prueba con nombre honesto:** la spec se renombra para decir que es una spec
  de prueba del runtime, no una estrategia; su hash cambia y queda registrado.
- [ ] **AC-07 — Sin IA y sin órdenes:** un test impide que el runtime referencie GaleCore-AI o un
  cliente de órdenes del broker.
- [ ] **AC-08 — Demostración en un día hábil real:** con la API local y datos reales: evaluaciones
  con métricas reales, al menos un descarte o entrada explicados, un caso `NO_DATA` forzado que no
  abre posición, valuación real si hay posición, switch OFF que conserva el estado. Evidencia
  sanitizada.
- [ ] **AC-09 — Repositorio:** `dotnet test` pasa (base: 331); tests nuevos para AC-01..AC-05 y AC-07.
- [ ] **AC-10 — Review:** reviewer interno y Codex sobre el diff contra `5fa6615`.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | PENDING | PENDING | PENDING | PENDING |
| AC-06 | PENDING | PENDING | PENDING | PENDING |
| AC-07 | PENDING | PENDING | PENDING | PENDING |
| AC-08 | PENDING | PENDING | PENDING | PENDING |
| AC-09 | PENDING | PENDING | PENDING | PENDING |
| AC-10 | PENDING | PENDING | PENDING | PENDING |

## Implementer handoff

**State:** PENDING
