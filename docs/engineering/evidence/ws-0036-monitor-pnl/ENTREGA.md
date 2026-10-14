# WS-0036 — P&L de la cuenta y jerarquía visual

## Resultado evaluado

Resumen consume quotes bid/ask del store de mercado para valuar todas las patas de cada fila;
`closePrice` no se usa como cotización actual. El precio de apertura permanece tomado de la
API de posiciones del operador. Los valores ausentes/cruzados y quotes con más de 60 segundos
sin recepción no generan un cero: la fila muestra `Sin cotización` o `Cotización anterior`.
El temporizador de pantalla reevalúa esa caducidad aunque el stream quede quieto.

La suscripción del monitor ahora abarca todas las patas OCC y subyacentes de la cuenta,
aun sin formar spreads reconocidos. Al reconectar se vuelve a suscribir; la prueba incluye
una put aislada y una acción fuera del universo, sin suscribir cantidades cero.

Se retiraron los tres textos citados por el owner y el pie repetido de hora de la cuenta.
La hora permanece en el tooltip de actualizar; el aviso de cuenta desactualizada sigue visible.
El significado del valor bruto y del porcentaje está en títulos/tooltips. Monitor usa la tira
compartida de balances, sin sobreescrituras locales; tokens comunes definen tamaños, padding,
radio y superficie de tarjetas. Las etiquetas de Operativa y Lab tienen piso compartido de 14 px.
El calendario conserva temática, procedencia y cobertura con texto normal legible.

## Ejecutado

- API Dev `GET /Data/Tastytrade/Account/Positions`: HTTP 200. Dos patas SPY 20/11/2026,
  short 730 entrada/cierre 3.8; long 710 entrada/cierre 2.4; cantidad 1 y multiplicador 100.
  Se omitieron identificadores de cuenta y credenciales de los artefactos.
- SignalR Dev: quotes reales del 14/10/2026, recepción 17:09:36 UTC. Bid/ask short 3.92/3.95,
  long 2.47/2.50: P&L -5 USD, -3.57%; con cierres iguales a entrada el cálculo anterior daba 0.
  Ese snapshot es el caso de regresión `portfolioSummary.test.ts`.
- `CI=true npm test -- --watchAll=false --runInBand`: exit 0, 32 suites y 121 tests.
  Log: `tests.txt`. Incluye avisos `act()` preexistentes de otras áreas; no son fallos.
- `CI=true npm run build`: exit 0, compilación exitosa. Log: `build.txt`.
  Aviso de Browserslist desactualizado, sin actualizar dependencias.
- `git diff --check`: exit 0 antes del commit.
- Edge headless/Playwright preinstalado, login real Dev: Monitor → Resumen → PCS SPY,
  P&L numérico visible y los tres textos ausentes. Capturas 1600x1000 y 760x1000, la segunda
  con scroll horizontal hacia el P&L; sin overflow externo y con balance visible. Navegación
  a Operativa y Lab para observar jerarquía. Datos/fecha de esa corrida: `qa.json`.
  Herramienta CUA falló por helper de sandbox ausente; Playwright permitió observar las pantallas.
  Puerto de prueba 5173 (permitido por el CORS Dev), sin alterar el backend.
- Integrado con merge `cd5d2d0` en `local/integracion`, conservando los ajustes SHADOW de `967500f`.
  La primera comprobación en 3039 encontró el proceso sirviendo la pantalla anterior (P&L total 0).
  Reiniciado sólo el monitor local con `python dev/galecore_dev.py monitor`, el recorrido se repitió
  en 3039: PASS, recepción 17:25:22 UTC del 14/10/2026, PCS SPY -8.50 USD / -6.07% en esa lectura.
  Las capturas y `qa.json` son de esta corrida integrada. API Dev y producción no se reiniciaron.

## Reproducir el recorrido

Con API Dev en 7001 y el front de esta rama en 5173 (o 3039):

```powershell
python docs/engineering/evidence/ws-0036-monitor-pnl/qa_monitor.py --dev-root C:/Users/lenzi/OneDrive/Escritorio/GaleCore/GaleCore --url http://localhost:5173
```

El script lee la configuración local ignorada, no imprime credenciales ni envía órdenes.
El P&L de la captura cambia con el mercado; no se usa el snapshot histórico como precio vigente.

## Revisión y pendiente

Review independiente: `docs/engineering/reviews/ws-0036-monitor-pnl-independent.md`, APPROVE,
base cd49bd4, árbol sin commit revisado. Hallazgos de suscripciones y contexto visual corregidos
durante esa misma pasada. No es aprobación de cierre del owner.

Falta aceptación visual del owner. WS-0036 sigue IN_PROGRESS; no VALIDATED/CLOSED.
Sin push, PR, producción ni operaciones financieras.
