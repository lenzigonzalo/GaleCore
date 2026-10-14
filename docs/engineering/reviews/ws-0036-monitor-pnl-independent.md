# Revisión independiente — WS-0036 Monitor P&L

- Fecha: 2026-10-14.
- Reviewer: Codex, pasada independiente de sólo lectura sobre el código.
- Rama y worktree: `feature/WS-0036-monitor-pnl` en `C:\Users\lenzi\GaleCore-Monitor-WS-0036`.
- Base y `HEAD` observado: `cd49bd41308edab11c02331adf116ba8069265bb` (`perf(shadow): load panel inputs for one spec and aggregate evaluations in one query`).
- Estado del árbol al cerrar la revisión: **dirty**, sin commits por encima de la base. Hay 11 archivos de implementación/tests modificados y ocho rutas sin trackear: el test nuevo de `PositionMonitor`, seis artefactos de QA en `docs/engineering/evidence/ws-0036-monitor-pnl/` y este informe.
- Alcance de código: `AccountSummary.tsx`, `PositionMonitor.tsx` y su test nuevo, `Resumen.tsx`, `Resumen.css`, `Resumen.test.tsx`, `portfolioSummary.ts` y su test, `useMarketStore.ts`, `market.ts`, `index.css` y `Lab.css`.
- Fuera de alcance: backend, órdenes, producción, push/PR y validación visual independiente de las capturas.

## Resultado

**APPROVE.** No quedan hallazgos abiertos de comportamiento, integración o riesgo en el alcance revisado.

Este `APPROVE` es un insumo técnico sobre un árbol sin commit. No marca WS-0036 como `VALIDATED` ni `CLOSED`; la aprobación final del owner y cualquier cambio de estado siguen pendientes.

## Comprobaciones concretas

- El P&L ya no usa `closePrice`: exige bid y ask válidos, no cruzados y recibidos en los últimos 60 segundos para todas las patas. Si falta una cotización muestra `Sin cotización`; si caducó, `Cotización anterior`; una entrada inválida no se presenta como cero.
- Para el PCS real de SPY del 14/10 (short 730 a 3,8; long 710 a 2,4; cantidad 1; multiplicador 100), los mids 3,935 y 2,485 producen `-$5,00` y `-3,5714 %`, en lugar del cero derivado de los cierres 3,8/2,4.
- `lastQuoteReceivedAt` se actualiza sólo al recibir una quote y `Resumen` reevalúa la caducidad cada 10 segundos. La concentración se oculta como incompleta si alguna posición no tiene valoración vigente, en vez de completar con cero.
- `PositionMonitor`, que permanece montado mientras se navega por Monitor/Operativa/Lab, suscribe todas las patas OCC de posiciones no nulas y todos sus subyacentes, incluso opciones sueltas, estructuras ambiguas y acciones fuera del universo. Al perder conexión limpia su cache local y vuelve a pedir las suscripciones al reconectar.
- Los tres textos grises indicados se retiraron sin perder el significado financiero principal: los encabezados explicitan `P&L abierto · USD`, la base porcentual queda en el tooltip y la concentración se llama `Concentración por valor bruto`. El contexto de cuenta real y la cobertura/fuente del calendario permanecen visibles.
- La unificación visual reutiliza tokens comunes de tipografía, padding, radio, superficie y borde en Resumen, Operativa y Lab. El cambio no introduce lógica financiera en CSS ni modifica navegación, backend u órdenes.

## Hallazgos resueltos durante esta pasada

1. **Cobertura de cotizaciones.** La primera versión derivaba suscripciones de `buildLiveSpreads`, por lo que opciones sueltas, estructuras ambiguas y acciones fuera del universo podían quedar indefinidamente en `Sin cotización`. Se corrigió derivando patas y subyacentes de todas las posiciones no nulas y se agregó una prueba de reconexión.
2. **Contexto visual no trazado.** Una versión intermedia quitaba también la fuente/cobertura del calendario y el contexto de cuenta real. Se restauraron como texto legible y se hizo explícito el valor bruto en el título de concentración.

## Verificación independiente

- `git diff --check cd49bd4`: exit 0.
- `CI=true npm test -- --runInBand --watchAll=false src/utils/portfolioSummary.test.ts src/pages/Resumen.test.tsx src/components/positions/PositionMonitor.test.tsx`: 3 suites y 10 tests verdes, exit 0.
- Leí el diff completo y el test sin trackear; comprobé el cálculo del caso Dev, los estados ausente/viejo/cruzado, la caducidad por reloj, la cobertura de suscripciones y la reconexión.
- Limitación: no repetí el build, la suite completa ni la navegación en navegador. Los artefactos visuales y de QA existentes pertenecen a la verificación del implementer y no los evalué como parte de esta revisión de código.
