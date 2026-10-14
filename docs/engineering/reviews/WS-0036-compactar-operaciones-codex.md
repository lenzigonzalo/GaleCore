# Revisión independiente — WS-0036 compactar Operaciones y Diseño

- Fecha: 2026-10-14.
- Reviewer: Codex, una pasada independiente sobre el diff y la evidencia existente.
- Rama y worktree: `feature/GC-0036-panel` en `C:\Users\lenzi\GaleCore-Panel-GC-0036`.
- Base y `HEAD` observado: `bc1f9d193bd7ec5cd5a92cb2122d5b04fe3fc213`; el cambio revisado está sin commit.
- Estado del árbol antes de este informe: **dirty**, con nueve archivos versionados modificados y dos componentes de Diseño sin trackear.
- Alcance: `PerformancePanel`, `StrategyDesign`, `CompactStrategyDesign`, `TradeLog`, `StrikeLadder`, `PositionCard`, CSS y tests asociados; `LabStrategySheet.tsx` se leyó como fuente de los tipos `StrategyView` y no fue modificado.
- Fuera de alcance: backend, producción, push/PR, capturas y la nueva iteración visual de Diseño pedida por el owner después de este diff (cuadro de Hipótesis/Objetivo y representación determinística de concepto/umbral).

## Resultado

**APPROVE sobre el handoff original.** No encontré hallazgos abiertos de comportamiento, integración o riesgo en el alcance revisado.

Este resultado revisa un árbol sin commit y no marca WS-0036 como `VALIDATED` ni `CLOSED`. La iteración visual posterior del owner necesita implementación y revisión propias antes de atribuirle este resultado.

## Comprobaciones

- El panel mantiene los datos API-first: no calcula métricas de estrategia. Hipótesis y objetivo salen de `StrategyView`, se piden al abrir la página en paralelo al panel y un fallo o demora del Lab no bloquea las métricas.
- Se retiró el filtro de período; el selector de versión sólo aparece con más de una versión.
- Operaciones usa una sola tabla de diez columnas y escalera compacta. Entrada, salida, versión, estructura, patas, crédito, débito, subyacente, riesgo y porcentaje sobre riesgo quedan en el `title` de cada fila. CSV y JSON siguen exportando los objetos crudos recibidos de la API.
- Diseño es una vista propia de dos columnas y sólo lectura. Muestra gates, gestión, parámetros y texto de reglas sin los IDs visibles ni los bloques de fuentes/cálculos, crítica, gobierno, fallos o procedencia del Lab; `LabStrategySheet` permanece intacto.
- Los muros GEX son opcionales en `StrikeLadder` y `PositionCard` sólo los pasa desde `gexData` en Operativa. Los otros consumidores no suministran muros.
- La evidencia DOM de Dev registra encabezado, una única solicitud del diseño compartido, diez columnas, filas de 37 px, Diseño en dos columnas, runtime plegado y muros `PUT WALL 750` / `CALL WALL 800`.

## Verificación

- `git diff --check bc1f9d1`: exit 0.
- Evidencia existente: `dev/.local/check-operations.log`; 37 tests focales verdes en `dev/.local/tests-operations-focused.log`; 34 suites y 147 tests verdes en `dev/.local/tests-operations-final.log`; build verde en `dev/.local/build-operations.log`.
- Sobre el árbol final repetí los 37 tests focales: 3 suites, 37 tests, exit 0. Jest conserva un aviso no bloqueante de `act(...)` del fallback asíncrono de cotizaciones.
- Sobre el árbol final repetí `CI=true npm run build`: compiló correctamente, exit 0; sólo informó que la base de Browserslist está desactualizada.
