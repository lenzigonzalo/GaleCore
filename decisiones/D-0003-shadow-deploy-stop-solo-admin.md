---
id: D-0003
title: Deploy y Stop del runtime SHADOW exigen admin, igual que el switch
date: 2026-09-25
status: vigente
scope: galecore
---
**Contexto.** En GC-0004 (I3) el runtime SHADOW ganó `POST /App/Runtime/Deploy` y
`POST /App/Runtime/Instances/{id}/Stop`. Los dos exigen sólo un usuario autenticado, mientras que el
switch del runtime (`/App/GaleCore/Services/runtime/Switch`) exige admin (`CanManagePlatformAsync`):
cualquier operador logueado podía desplegar o parar el runtime global, aunque no pudiera pausarlo.
Lo marcó la revisión interna R2 (m3) y Codex lo dejó como decisión del owner (C4–C6).

**Decisión (owner, 2026-09-25).** Deploy y Stop exigen admin, con la misma autoridad que el switch
(`AppController.CanManagePlatformAsync`, sin una segunda copia de la regla). No amplía I3: se
implementa y se verifica **antes de habilitar SHADOW en producción**, como paso del plan de paso a
producción de GC-0004.

**Consecuencias.** Un no-admin recibe 403 en Deploy y Stop; la verificación incluye el caso admin
(200) y el no-admin (403). Hasta implementarlo, el runtime sólo corre en GaleCore Dev con el usuario
de prueba `demo`, que es admin.

**Evidencia.** `docs/engineering/work-items/GC-0004-shadow-durable-visible.md` (R2-m3, recheck
Codex C6 `docs/engineering/reviews/GC-0004-20260925T165744Z.md`).
