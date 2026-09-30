---
id: GC-0005
title: SHADOW — espaciado mínimo entre entradas de una instancia (escalera de posiciones)
status: READY_FOR_REVIEW
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-0005 — Espaciado entre entradas en SHADOW

Acordado con el owner el 2026-09-30 (bloque «Retomar» del `SESSION_HANDOFF` de GaleCore-AI, paso 2).
Base: `85f1c2c`, punta de `feature/GC-AI-0008-estrategia-shadow` tal como se traspasó el 28/09 (esa rama no
se modifica). Rama local `feature/GC-0005-shadow-espaciado`. Sin push ni PR; se entrega como paquete
incremental (`git bundle create <archivo> 85f1c2c..feature/GC-0005-shadow-espaciado`).

## Objective

Que una estrategia en SHADOW pueda operar **muchas posiciones escalonadas en el tiempo** en vez de una
sola: hoy, con `max_concurrent_positions = 1`, la instancia abre una y saltea todas las evaluaciones
siguientes hasta que cierra (264 evaluaciones salteadas al 30/09). Subir el máximo sin espaciado abriría
todas el mismo día; con un mínimo de minutos entre entradas se forma una escalera (p. ej. una por día).

## Qué cambia

- Campo opcional de spec `risk_limits.min_minutes_between_entries` (entero positivo; `null` o ausente =
  comportamiento anterior). No cambia el hash de ninguna spec existente (el hash se calcula sobre el texto).
- `StrategySpecValidator`: el campo, si está, debe ser positivo.
- `ShadowRuntimeStore.LastEntryAt(instanceId)`: hora de la última entrada de la instancia, abierta o
  cerrada (sale de las posiciones, que ya se persisten y se recuperan al reiniciar).
- `ShadowRuntimeEngine.EvaluateEntryAsync`: después del chequeo de máximo de posiciones y antes de pedir la
  cadena, si la última entrada fue hace menos de N minutos → evento `ENTRY_SKIPPED` con `reason`,
  `last_entry_at` y `next_entry_allowed_at`; resultado `TOO_SOON`. Cuenta también posiciones cerradas: un
  cierre rápido no habilita otra entrada el mismo día. Sólo cuentan las entradas de la propia instancia.

## Non-goals

- Roll de posiciones (queda para después, con data de la escalera y una definición del owner).
- Cambiar gates, umbrales, sizing o el cálculo de riesgo.
- Cambiar la spec `spy_prima_varianza_30_45d.json` del repo: la versión 1.0.4 la prepara GaleCore-AI y se
  despliega sólo con la aprobación del owner por hash.

## Acceptance criteria

- [x] **AC-01 — Campo y validación:** el campo carga desde JSON snake_case y un valor ≤ 0 se rechaza.
  Evidencia: `StrategySpecValidatorTests.MinMinutesBetweenEntries_LoadsFromSnakeCaseJson_AndPasses`,
  `NonPositiveMinMinutesBetweenEntries_Fails`.
- [x] **AC-02 — Espaciado en el motor:** una segunda entrada antes de N minutos se saltea con motivo y
  próxima hora permitida, sin pedir la cadena; a los N minutos exactos entra; tres días seguidos forman
  tres posiciones. Evidencia: `ShadowRuntimeEngineTests.Spacing_*` (7 tests).
- [x] **AC-03 — Sin el campo, igual que antes:** `Spacing_WithoutTheField_BehavesAsBefore` y la suite
  completa sin cambios en los tests existentes.
- [x] **AC-04 — Reinicio:** la entrada recuperada de la base cuenta para el espaciado.
  Evidencia: `ShadowRuntimePersistenceTests.AfterRestart_SpacingCountsTheRecoveredEntry`.
- [ ] **AC-05 — Revisión:** Codex (una vez, al cierre) y cierre del owner.

## Evidencia

`dotnet test DataFeed.sln` en el worktree `.worktrees/galecore/GC-0005` (30/09): **447 passed, 0 failed,
6 skipped** (los 6 de `EfShadowRuntimeRepositoryTests` requieren base; igual que en la base `85f1c2c`).

## Handoff

- Para quien lleva GaleCore: addendum «Cambios posteriores al traspaso» en
  `docs/engineering/HANDOFF-GALECORE-SHADOW.md` del workspace. Si tocó `ShadowRuntimeEngine.cs` después del
  28/09, el conflicto posible está en el bloque «3b. Espaciado entre entradas».
- Orden de despliegue: primero GaleCore con este cambio corriendo; recién después la spec 1.0.4. Un runtime
  sin GC-0005 ignoraría el campo en silencio y abriría hasta 10 posiciones el mismo día.
