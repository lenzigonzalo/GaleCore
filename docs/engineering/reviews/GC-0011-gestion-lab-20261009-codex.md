# GC-0011 — revisión independiente Gestión / Lab

09/10/2026. Reviewer separado review_spaces, gpt-5.6-sol, esfuerzo alto. Una pasada, sólo lectura del diff no commiteado sobre d3a6300, incluido ShadowOverview.tsx/test no rastreados.

Dictamen del reviewer: CHANGES_REQUESTED — 0 blocker, 2 major.

1. WorkspaceHeader.tsx: Agentes pertenece a Trabajo y monta SupervisorAlerts, pero queda fuera de strategySection; el encabezado muestra allí el saldo real. Mezcla capital real con publicaciones/avisos SHADOW. Separar la condición que oculta la cuenta de la que muestra la subnavegación del Lab e incluir agentes en la primera.
2. index.css: las etiquetas Gestión/Trabajo/Compartido sólo se ocultan con .collapsed. A ≤700 px la barra se fuerza a 72 px sin esa clase: las etiquetas quedan visibles y se envuelven dentro de la barra angosta.

El resto del alcance revisado resulta consistente: Main no consulta ni muestra SHADOW; Lab usa fuentes existentes; pérdidas, nulos y hora de lectura ET se conservan; conversación mantiene sesión; no aparecen órdenes ni LIVE.

Evidencia de 14 tests/5 suites y build verde reportada por implementer. Sin QA visual, recheck ni edición del reviewer. Hallazgos y correcciones del implementer se registran en el work item, no modifican este dictamen.
