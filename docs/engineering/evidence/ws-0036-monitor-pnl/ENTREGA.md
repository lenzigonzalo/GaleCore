# WS-0036 ? P&L de la cuenta y jerarqu?a visual

## Resultado evaluado

Resumen consume quotes bid/ask del store de mercado para valuar todas las patas de cada fila;
`closePrice` no se usa como cotizaci?n actual. El precio de apertura permanece tomado de la
API de posiciones del operador. Los valores ausentes/cruzados y quotes con m?s de 60 segundos
sin recepci?n no generan un cero: la fila muestra `Sin cotizaci?n` o `Cotizaci?n anterior`.
El temporizador de pantalla reeval?a esa caducidad aunque el stream quede quieto.

La suscripci?n del monitor ahora abarca todas las patas OCC y subyacentes de la cuenta,
aun sin formar spreads reconocidos. Al reconectar se vuelve a suscribir; la prueba incluye
una put aislada y una acci?n fuera del universo, sin suscribir cantidades cero.

Se retiraron los tres textos citados por el owner y el pie repetido de hora de la cuenta.
La hora permanece en el tooltip de actualizar; el aviso de cuenta desactualizada sigue visible.
El significado del valor bruto y del porcentaje est? en t?tulos/tooltips. Monitor usa la tira
compartida de balances, sin sobreescrituras locales; tokens comunes definen tama?os, padding,
radio y superficie de tarjetas. Las etiquetas de Operativa y Lab tienen piso compartido de14px.
El calendario conserva tem?tica, procedencia y cobertura con texto normal legible.

## Ejecutado

- API Dev `GET /Data/Tastytrade/Account/Positions`: HTTP200. Dos patas SPY20/11/2026,
  short730 entrada/cierre3.8; long710 entrada/cierre2.4; cantidad1 y multiplicador100.
  Se omitieron identificadores de cuenta y credenciales de los artefactos.
- SignalR Dev: quotes reales del14/10/2026, recepci?n17:09:36 UTC. Bid/ask short3.92/3.95,
  long2.47/2.50: P&L -5USD, -3.57%; con cierres iguales a entrada el c?lculo anterior daba0.
  Ese snapshot es el caso de regresi?n `portfolioSummary.test.ts`.
- `CI=true npm test -- --watchAll=false --runInBand`: exit0, 32suites y121tests.
  Log: `tests.log`. Incluye avisos `act()` preexistentes de otras ?reas; no son fallos.
- `CI=true npm run build`: exit0, compilaci?n exitosa. Log: `build.log`.
  Aviso de Browserslist desactualizado, sin actualizar dependencias.
- `git diff --check`: exit0 antes del commit.
- Edge headless/Playwright preinstalado, login real Dev: Monitor?Resumen?PCS SPY,
  P&L num?rico visible y los tres textos ausentes. Capturas1600x1000 y760x1000, la segunda
  con scroll horizontal hacia el P&L; sin overflow externo y con balance visible. Navegaci?n
  a Operativa y Lab para observar jerarqu?a. Datos/fecha de esa corrida: `qa.json`.
  Herramienta CUA fall? por helper de sandbox ausente; Playwright permiti? observar las pantallas.
  Puerto de prueba5173 (permitido por el CORS Dev), sin alterar el backend.

## Reproducir el recorrido

Con API Dev en7001 y el front de esta rama en5173 (o3039):

```powershell
python docs/engineering/evidence/ws-0036-monitor-pnl/qa_monitor.py --dev-root C:/Users/lenzi/OneDrive/Escritorio/GaleCore/GaleCore --url http://localhost:5173
```

El script lee la configuraci?n local ignorada, no imprime credenciales ni env?a ?rdenes.
El P&L de la captura cambia con el mercado; no se usa el snapshot hist?rico como precio vigente.

## Revisi?n y pendiente

Review independiente: `docs/engineering/reviews/ws-0036-monitor-pnl-independent.md`, APPROVE,
base cd49bd4, ?rbol sin commit revisado. Hallazgos de suscripciones y contexto visual corregidos
durante esa misma pasada. No es aprobaci?n de cierre del owner.

Falta aceptaci?n visual del owner. WS-0036 sigue IN_PROGRESS; no VALIDATED/CLOSED.
Sin push, PR, producci?n ni operaciones financieras.
