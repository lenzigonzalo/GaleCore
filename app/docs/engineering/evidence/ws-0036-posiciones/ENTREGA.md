# WS-0036 — filas de posiciones

Rama `feature/GC-0036-panel`, worktree `C:/Users/lenzi/GaleCore-Panel-GC-0036`. Backend `2326eb9` integrado por merge `eac29dc`; front `c58bc9d`. Commits locales, sin push.

`PositionRow` y `StrikeLadder` compartidos: estructura, vencimiento y DTE, patas ordenadas, venta azul / compra ámbar, rango y marcador del subyacente (rojo fuera del rango). SHADOW abiertas como tarjetas, log con escalera compacta sin spot, Monitor Resumen reemplaza la tabla y Operativa reutiliza el encabezado y la escalera. Alertas, reglas y cálculos existentes de Operativa conservados.

Fallback una vez por símbolo: `fetchQuote` entrega `data[]` con `midPrice` calculado por el backend; se corrigió su tipo frontend. El stream tiene prioridad. Sin precio válido no aparece marcador. No se agregaron cálculos de métricas ni mocks.

`CI=true npm run build`: exit 0. `CI=true npm test -- --watchAll=false --runInBand`: exit 0, **33 suites / 144 tests**. `git diff --check`: limpio. Salidas reales en [build.txt](build.txt), [tests.txt](tests.txt), [checks.json](checks.json). Tests incluyen orden, colores por lado, rangos de condor/spreads, spot dentro/fuera/ausente, quote único y prioridad del stream.

Capturas reales de Dev :3039 contra API :7001, revisadas visualmente: [SHADOW IWM](shadow-iwm-dev.png), tres iron condors con cuatro patas; [Monitor Resumen](monitor-resumen-dev.png), posición real de SPY. Respuesta SHADOW en `shadow-dev.json`; script reproducible sin credenciales en `capture.py`.

En Monitor se preservan P&L y porcentaje existentes. Crédito neto, valor neto actual y riesgo no están expuestos por la API de cuenta: se muestran sin valor, sin derivarlos. El backend y la navegación no se modificaron. QA visual de Operativa y revisión independiente quedan pendientes; el agente de revisión v3 alcanzó su límite de uso. Aceptación del owner pendiente, sin VALIDATED/CLOSED.
