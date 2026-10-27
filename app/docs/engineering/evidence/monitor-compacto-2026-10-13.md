# Monitor compacto — iteración visual del owner (13/10/2026)

Pedido directo del owner: capital y exposición visibles, portfolio en tabla compacta (ticker,
cantidad, estructura, estrategia, P&L total, %, vencimiento), avisos claros, calendario en Macro,
sin botones hacia otras vistas. Esta iteración se registra bajo WS-0029 por instrucción directa;
no cierra ni cambia los criterios del harness. Aplica D-0010.

## Resultado implementado

- Resumen: cuenta real, capital/poder de compra/efectivo y exposición bruta reunidos arriba.
- Portfolio ocupa todo el ancho; filas compactas, texto legible y siete columnas.
- PCS/CCS/IC se infieren sólo para conjuntos completos, cantidades y multiplicadores iguales,
  sentidos y strikes coherentes. Conjuntos ambiguos conservan cada pata.
- P&L abierto: cantidad × multiplicador × variación del precio informado, con sentido Long/Short.
  Porcentaje sobre valor absoluto del débito/crédito neto inicial. No incluye comisiones ni realizado.
- Vencimientos: amarillo ≤7 días; rojo ≤2 días, hoy o vencida; aviso visible encima de la tabla.
  Fechas civiles calculadas en ET. Acciones sin vencimiento.
- Estrategia muestra «—»: la API de cuenta no trae vínculo; no se cruza cuenta real con SHADOW.
- Exposición bruta: suma del valor absoluto de cada pata a precio informado / valor de cuenta.
  No representa riesgo máximo ni exposición delta. Falta de dato produce «—», no cero.
- Macro: grilla mensual, eventos FRED y Fed existentes y rango de cobertura visible (45 días).

## Ejecutado

En `source/galecore-monitor`:
`CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/pages/Resumen.test.tsx src/utils/portfolioSummary.test.ts`
Exit 0: 2 suites, 6 tests. Verifica cuenta real, faltantes/errores, calendario, PCS y P&L,
conservación de patas ambiguas y cantidades distintas, falta de precio y acciones sin vencimiento.

`CI=true npm run build`: exit 0, Compiled successfully. Advertencia existente de Browserslist
por base de navegadores de seis meses; sin errores de TypeScript ni ESLint.

`git diff --check` en GaleCore: exit 0.

## Pendiente y alcance

QA visual y recorrido real pendientes: tres intentos de `cua.getState()` fallaron antes de abrir
una superficie. Último diagnóstico: helper `codex-windows-sandbox-setup.exe` no encontrado.
No se verificó el aspecto ni se consultaron posiciones reales desde navegador.
Review independiente solicitado a `gpt-5.6-sol`: el agente falló por límite de uso sin emitir review.
No hay APPROVE, VALIDATED ni CLOSED. Sólo local; sin push ni PR.

Recorrido para retomar: Monitor → Resumen (capital, exposición, tabla, aviso de vencimientos),
luego Macro (calendario). Revisar escritorio y ancho reducido con datos de la cuenta.


## Corrección de la instancia de desarrollo (13/10, reporte del owner)

El owner vio TS2307 para `portfolioSummary` y TS7006 derivados. El módulo sí existe y está
versionado en `f07e029`. La instancia CRA activa en :3039 se reinició con
`python dev/galecore_dev.py monitor`, sin cambio de código ni configuración.
Resultado real del servidor: `Compiled successfully!` y `webpack compiled successfully`.
Comprobación aparte: `node node_modules/typescript/bin/tsc --noEmit --incremental false`, exit 0.
HTTP GET `http://localhost:3039`: 200. Esto acredita compilación de desarrollo y respuesta HTTP;
no acredita aún el recorrido visual autenticado. Causa compatible con estado obsoleto del watcher;
no se reprodujo TS2307 en compilación limpia. Logs locales (sin versionar):
`dev/.local/monitor-restart.stdout.log` y `dev/.local/monitor-restart.stderr.log`.


## Ajuste del owner: cuenta compacta y concentración (13/10)

Valoración total, poder de compra y efectivo reunidos en un cuadro de hasta 420 px, con el total
como cifra principal y los otros dos en líneas compactas. Exposición reinterpretada por instrucción
del owner: distribución por ticker, ordenada por mayor valor bruto, con peso y monto. El denominador
es el valor bruto de posiciones, no el capital de cuenta. Opciones a valor de prima, explícito en UI;
no se afirma concentración de riesgo ni exposición nominal. Sin lectura completa no muestra pesos.
Prueba nueva: SPY 200 y TLT 50 dan 80%/20% incluso con capital de cuenta de 10.000.
Tests anteriores: 6/6; nueva corrida de Resumen: 4/4 (exit 0).
Build CI: exit 0, `Compiled successfully`. Servidor de desarrollo: `Compiled successfully`,
`No issues found`. QA visual sigue pendiente.
