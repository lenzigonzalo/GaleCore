# Revisión independiente — WS-0036 panel SHADOW v2

- Fecha: 2026-10-14.
- Reviewer: Codex, pasada independiente de sólo lectura sobre el código.
- Rama revisada: `feature/GC-0036-panel`, worktree `C:\Users\lenzi\GaleCore-Panel-GC-0036`.
- Baseline: `43805b8480d4b21f2544c00304d5379641500095` (`feat(shadow): add daily P&L, open positions and closed trades to performance panel`).
- HEAD: `9910141726155e474377805c1a9c72478bb27b88` (`feat(shadow): separate strategy list and reorder performance detail`).
- Árbol observado al cerrar la revisión: sin cambios de código; sólo `docs/engineering/evidence/gc-0036-panel-v2/` sin trackear. La evidencia no forma parte del rango commiteado.
- Alcance: `43805b8..9910141`, limitado a `source/galecore-monitor/src/api/space.ts`, su test, `components/shadow/*`, `pages/Shadow.tsx` y su test, y `types/shadow.ts`.
- Fuera de alcance: cambios al backend. `43805b8` ya estaba integrado y se tomó como baseline; el rango no modifica `source/galecore-datafeed/`. Se leyó su contrato únicamente para comprobar la integración del front.
- Restricciones comprobadas: el rango no cambia `WorkspaceNav.tsx`, `App.tsx` ni `LabShadow.tsx`.

## Resultado

**APPROVE.** No encontré hallazgos bloqueantes ni hallazgos menores de comportamiento o integración en el alcance revisado.

Este `APPROVE` es un insumo técnico. No marca WS-0036 como `VALIDATED` ni `CLOSED`; la aprobación del owner y cualquier cambio de estado quedan pendientes.

## Comprobaciones concretas

- La vista inicial obtiene los `specName` de `fetchShadowMetrics`, los deduplica y hace un pedido de `Performance/Panel` por spec para llenar realizado, abierto, cerradas/abiertas y acierto. No suma ni promedia esas cifras en el front. Al entrar, desmonta la lista y muestra sólo la estrategia elegida.
- El contenido anterior de runtime quedó al final, plegado. Sus consultas de evaluaciones, descartes y posiciones se disparan recién al abrirlo y se limitan a las instancias de la spec elegida; las métricas del runtime también se filtran por esa spec.
- El detalle respeta el orden aprobado: cinco cifras, curva y caída, calendario, posiciones abiertas, salidas, calidad/riesgo, régimen/versión y `Qué falta`. Se retiraron la tabla de datos de curva, `regime.edges`, la fila visible de fuente y los textos explicativos pedidos; la fuente quedó como tooltip del chip SHADOW.
- `daily[]` se representa por la fecha ET entregada por la API y sólo se deriva intensidad visual. `openPositions[]` se muestra aunque haya filtro de período, tal como define el contrato; `closedTrades[]` sigue el período. `legs` se consume como texto y no se reconstruye en el front.
- Los `Metric.value === null` se muestran como `n/d`; los motivos se reúnen al final con `Set`, incluidos referencias, límites, hipótesis, ejecución, régimen y problemas de valuación. Los escalares nullable de abiertas y cerradas también se muestran como `n/d`.
- El perfil aporta únicamente `reference_capital.amount` cuando es numérico, finito, propio y USD. Un perfil ausente, inválido o en otra moneda deja el parámetro fuera. No se parsea `risk_limits`, no se mandan tasas ni límites y no se agregan defaults.
- La evidencia real `strategy-dev.png` (1536 × 4296) y `panel-dev.json` son coherentes: 2 cerradas, 4 abiertas, +$45 diario realizado, cuatro filas abiertas con legs textuales, dos salidas `TAKE_PROFIT` y $1.822 de riesgo máximo abierto visible. La captura conserva Runtime cerrado.

## Verificación

- `git diff --check 43805b8..9910141`: exit 0.
- Tests focalizados independientes: `CI=true npm test -- --runInBand --watchAll=false src/api/space.test.ts src/components/shadow/PerformancePanel.test.tsx src/pages/Shadow.test.tsx`: 3 suites y 26 tests verdes, exit 0.
- La ejecución final informada por el implementer quedó en 31 suites / 118 tests y build CI verdes; no repetí esa corrida amplia después del pase focalizado.
- Limitación: revisé el recorrido real mediante la captura, el request y la respuesta Dev guardados; no repetí la navegación E2E en un navegador interactivo.
