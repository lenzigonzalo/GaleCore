# WS-0036 — Operaciones, Diseño y muros GEX

Rama `feature/GC-0036-panel`, base `bc1f9d1`; commits locales, sin push. Primera iteración `03f29d1`: log compacto, lectura del Lab paralela al panel, selector de período retirado y versión sólo cuando hay más de una, Diseño propio, muros GEX de Operativa restaurados. Revisión independiente [APPROVE](../../reviews/WS-0036-compactar-operaciones-codex.md) sobre ese alcance.

Corrección posterior pedida por el owner: recuperar el cuadro completo de Hipótesis/Objetivo y presentar el diseño como condiciones determinísticas, en lugar de dos renglones y listas narrativas. `StrategyOverview` reproduce el orden y la disposición de la vista anterior, con hechos de la estrategia al lado. `CompactStrategyDesign` lee `StrategyView.current.spec`: Entrada, Construcción, Gestión y Salida con concepto, condición, umbral y acción. Preserva valores literales del JSON, incluidos cero y precisión; no calcula métricas ni interpreta umbrales desde texto. Reglas narrativas fuera del JSON ejecutable quedan separadas con el umbral declarado o «—».

El JSON real de SPY contiene `exits.deterministic`: 50 % de ganancia sobre crédito, 200 % de pérdida sobre crédito y 21 DTE. `management[]` está vacío; la primera vista los omitía por leer sólo ese campo. La semántica de salidas se contrastó por lectura con `ShadowFillSimulator.EvaluateExit`; backend sin cambios. Edad de cotización se muestra como valor configurado (15 segundos), sin calcular la tolerancia efectiva del runtime. El Lab no se modificó.

Operaciones mantiene diez columnas, detalle en title, escalera en una línea y CSV/JSON crudos como íconos. Salidas muestra cada grupo entregado por `byExitRule`, sin sumar motivos ni inventar grupos vacíos. Régimen y versión lado a lado; Runtime plegado. Muros opcionales sólo desde `PositionCard.gexData` en Operativa.

Verificación final: `CI=true npm run build`, exit 0; `CI=true npm test -- --watchAll=false --runInBand`, exit 0, **35 suites / 150 tests**. `git diff --check`, limpio. Salidas en build.txt/tests.txt.

Recorrido real Dev :3039, sin capturas: cuadro de hipótesis/objetivo; una lectura compartida del diseño; tabla con dos filas de 37 px; Diseño en dos columnas con 50 %, 200 % y 21 DTE del JSON real; Operativa con `PUT WALL 750` y `CALL WALL 800`. Evidencia DOM en dev.txt. Se usaron datos reales, sin mocks en la app. La revisión independiente citada no cubre la corrección posterior del owner: ésta tiene tests y comprobación en Dev, pero revisión independiente y aceptación visual pendientes. No VALIDATED/CLOSED.
