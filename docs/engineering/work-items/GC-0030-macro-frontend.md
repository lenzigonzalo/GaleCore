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
API aislada 7002 / monitor habitual 3039 (pedido posterior del owner); 5173 cerrado.
Contratos y codigo en commits 4e59631, a9afff4, c32415b y evidencia posterior.
Al retomar: abrir Macro desde Monitor y probar detalle/horizonte/enlace; owner evalua utilidad.
M2-M5 no activados. WS-0029 permanece intacto; no mover sus pendientes aqui.

## Feedback visual — 13/10/2026

Barra global/lupa Ctrl+K/toggle lateral, Macro clara sin títulos duplicados ni copiar enlace, gráficos ampliados,
tabla compacta, detalles explicativos y calendario mensual/global. Commits af0b64d / 4f7255c.
Evidencia: ../evidence/GC-0030/visual-feedback/README.md. 17 tests / build CI pasan.
Review: ../reviews/GC-0030-visual-feedback.md. CHANGES_REQUESTED en rango revisado; correcciones posteriores
documentadas, sin recheck ni APPROVE. QA navegador con datos reales guardados y sesión sintética, declarada.
Login Dev real rechazado con la credencial guardada: no se reseteó contraseña. Pendiente repetir ese recorrido.
Para retomar: recargar 3039, Macro, Ctrl K, calendario junto a watchlist y detalle de un indicador.
