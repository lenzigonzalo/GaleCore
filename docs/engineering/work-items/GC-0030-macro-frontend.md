# GC-0030 — Macro M0/M1 · frontend

Estado: READY_FOR_REVIEW. Flag: `frontend`. Contrato/aceptación: workspace WS-0030.
Sólo nueva API Macro y página Macro; sin cambios al harness de Claude ni a producción.
Retención local: snapshots inmutables hasta 100 archivos / 2 MiB cada uno; sin borrado automático.
Config opt-in `Macro__SnapshotDirectory` en entorno local; sin config devuelve 503.
Referencias: ID serie:fecha; hash SHA-256 sobre alcance, corte, entradas, métricas, eventos y estados.
Cada snapshot lleva todas las definiciones, fechas reales, fuentes y método versionado.
Null/publicación desconocida permanecen explícitos. Historia revisada a hoy, no point-in-time.
Rollback: revert de commits propios. Pendiente revisión independiente y aceptación owner, sin cierre.

## Evidencia y retoma

Contrato: ../MACRO-M0-CONTRACT.md. Evidencia: ../evidence/GC-0030/README.md.
Review independiente: ../reviews/GC-0030-independent.md, CHANGES_REQUESTED en f85d749..a9afff4.
Cuatro hallazgos corregidos con pruebas posteriores; no recheck ni APPROVE, no VALIDATED/CLOSED.
602 backend pass/8 skip; 12 frontend del area pass; build CI pass; recorrido Chromium real pass.
Suite frontend global roja en Lab/LabShadow ajenos: se documenta, no se modifica trabajo de Claude.
Preview aislada API7002/monitor5173. Contratos y codigo en commits 4e59631, a9afff4, c32415b y evidencia posterior.
Al retomar: abrir Macro desde Monitor y probar detalle/horizonte/enlace; owner evalua utilidad.
M2-M5 no activados. WS-0029 permanece intacto; no mover sus pendientes aqui.
