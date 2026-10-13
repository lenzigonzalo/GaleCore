# GC-0030 — Macro M0/M1 · frontend

Estado: IN_PROGRESS. Flag: `frontend`. Contrato/aceptación: workspace WS-0030.
Sólo nueva API Macro y página Macro; sin cambios al harness de Claude ni a producción.
Retención local: snapshots inmutables hasta 100 archivos / 2 MiB cada uno; sin borrado automático.
Config opt-in `Macro__SnapshotDirectory` en entorno local; sin config devuelve 503.
Referencias: ID serie:fecha; hash SHA-256 sobre alcance, corte, entradas, métricas, eventos y estados.
Cada snapshot lleva todas las definiciones, fechas reales, fuentes y método versionado.
Null/publicación desconocida permanecen explícitos. Historia revisada a hoy, no point-in-time.
Rollback: revert de commits propios. Pendiente revisión independiente y aceptación owner, sin cierre.
