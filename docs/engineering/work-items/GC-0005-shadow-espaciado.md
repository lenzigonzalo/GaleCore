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

Acordado el 2026-09-30 (bloque «Retomar» del `SESSION_HANDOFF` de GaleCore-AI, paso 2).
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

- Roll de posiciones (queda para después, con data de la escalera y una definición de cuándo y a qué se rolea).
- Cambiar gates, umbrales, sizing o el cálculo de riesgo.
- Desplegar la spec 1.0.5: el archivo viaja en esta rama, pero se despliega sólo con su aprobación registrada
  por hash (`strategy approve` → `strategy deploy-check` en GaleCore-AI) y después de integrar este cambio.

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
  Evidencia: `ShadowRuntimePersistenceTests.AfterRestart_SpacingCountsTheRecoveredEntry` (repositorio en memoria) y
  `EfShadowRuntimeRepositoryTests.AfterRestart_TheEntrySavedInPostgres_CountsForSpacing` (Postgres real: la hora vuelve
  en UTC; a 1439 min se saltea, a 1440 entra).
- [ ] **AC-05 — Revisión:** Codex (una vez, al cierre) y cierre.

- [x] **AC-06 — Spec 1.0.5:** `spy_prima_varianza_30_45d.json` pasa a 1.0.5: `max_concurrent_positions` 10,
  `min_minutes_between_entries` 1440, `parent_version_hash` = hash de 1.0.3, `identity.created_at` 2026-09-30 y
  `metadata.notes` apuntando a la propuesta 1.0.5; nada más cambia. GaleCore la carga, la valida y su hash es
  `sha256:01cdc4d76af8bb1a4ba16d02abcec09d500019e05e10094c9750735925be0475`, igual al que calcula GaleCore-AI.
  (La 1.0.4 quedó guardada sin aprobar: la revisión interna encontró que sus notas remitían a 1.0.3.) Evidencia: `StrategySpecVersionTests.LoadsValidatesAndHashesAsSubmitted`.

## Evidencia

`dotnet test DataFeed.sln` en el worktree `.worktrees/galecore/GC-0005` (30/09): **447 passed, 0 failed,
7 skipped** (los 7 de `EfShadowRuntimeRepositoryTests` requieren base). Con base
(`python dev/galecore_dev.py test`, base de test de GaleCore Dev): **454 passed, 0 failed, 0 skipped**.

## Handoff

- Para quien lleva GaleCore: addendum «Cambios posteriores al traspaso» en
  `docs/engineering/HANDOFF-GALECORE-SHADOW.md` del workspace. Si tocó `ShadowRuntimeEngine.cs` después del
  28/09, el conflicto posible está en el bloque «3b. Espaciado entre entradas».
- Orden de despliegue: primero GaleCore con este cambio corriendo; recién después la spec 1.0.5. Un runtime
  sin GC-0005 ignoraría el campo en silencio y abriría hasta 10 posiciones el mismo día.
