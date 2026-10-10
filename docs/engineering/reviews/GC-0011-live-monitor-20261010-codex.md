# GC-0011 — Review independiente de Monitor con watchlist y GEX reales

- Fecha: 2026-10-10
- Reviewer: Codex
- Modelo: `gpt-5.6-sol`
- Esfuerzo: high
- Resultado: **CHANGES_REQUESTED**
- Modalidad: una única pasada de sólo lectura; sin rechecks

## Alcance y estado del árbol

Se revisó el árbol local sin commit del worktree
`.worktrees/galecore/front-estructura-local`, con base
`a1f5e01700bb102726ec54ea53ab95e1b450d57a` (`feature/front-estructura-local`). El snapshot estaba
sucio: cambios versionados en `App.tsx`, `WorkspaceHeader.tsx`, `StatusBar.tsx`, `index.css`, `Gex.tsx`,
`MainDemo.tsx` y su test, `MonitorOverview.tsx/css`, `WorkspaceDemo.tsx`, `useMarketStore.ts` y
`types/market.ts`; archivos nuevos `StatusBar.css/test.tsx` y `LiveWatchlist.tsx/css/test.tsx`.

La pasada cubrió la composición real/demo, carga de reglas GEX, ownership y limpieza de suscripciones,
agregar/quitar símbolos, procedencia y frescura de precios, estado de rueda, recuperación ante errores y
aislamiento de sesión. Para verificar la integración se abrieron además, sin modificarlos,
`TickerGrid.tsx`, `TickerWatchlist.tsx`, `SymbolSearchCard.tsx`, `useGexStore.ts`, `useMarketSocket.ts`,
`useAppConfigStore.ts`, `resetUserScoped.ts`, `marketdata.ts` y `MarketDataHub.cs`.

No se editó implementación ni harness, no se ejecutaron suites y no hubo CUA disponible; por lo tanto no se
afirma QA visual. Se leyó el artefacto `docs/engineering/evidence/GC-0011-live-monitor-20261010.json`: registra
17 pruebas en 6 suites y build verde ejecutados por el implementer. La lectura Dev autenticada registró login,
reglas GEX y switch con HTTP 200, pero `MarketData/ByType` y `GEXAnalysis` con HTTP 500 por
`Tastytrade config authentication BadRequest`. Esa corrida demuestra manejo del fallo del proveedor; no demuestra
precios ni GEX reales end-to-end.

## Hallazgos

### 1. MAJOR — Un trade viejo recibido ahora puede confirmar falsamente que la rueda está abierta

`useMarketStore.ts:54` guarda `marketStatusReceivedAt: new Date()` cuando llega un `TradePayload` con
`extendedTradingHours`, pero no conserva ni valida `data.timestamp`, que es la hora del evento del proveedor.
`StatusBar.tsx:18-20` exige únicamente que la **recepción** tenga menos de 60 segundos para mostrar
`Rueda regular abierta`.

Una conexión o resuscripción que reciba un snapshot/replay del último trade regular puede entonces marcar una rueda
abierta durante 60 segundos aunque el evento sea de una sesión anterior. Esto es especialmente relevante en feriados:
el reloj sólo descarta fin de semana y horario exterior (`StatusBar.tsx:14-17`), y dentro de 09:30–16:00 ET delega
la confirmación a esa señal sin comprobar su hora de origen. El test de `StatusBar` alinea manualmente evento y reloj,
pero no cubre un payload viejo recibido ahora.

La confirmación de apertura debe fallar cerrada salvo que sean recientes tanto la recepción como el timestamp válido
del evento del proveedor; un timestamp ausente, inválido, futuro o viejo debe producir `Apertura sin confirmar`.

### 2. MAJOR — Un fallo REST queda pegado y oculta precios válidos que lleguen después por streaming

Cuando el batch REST falla, `TickerGrid.tsx:70-76` deja `ticker.error.price`. Ningún camino exitoso lo borra:
`applyMarketData` (`TickerGrid.tsx:23-30`), `updatePrice` y `updateQuote` (`useMarketStore.ts:45-72`) actualizan los
números pero conservan el objeto `error` anterior.

Las dos superficies nuevas toman ese error como autoridad aun después de recibir datos: `TickerWatchlist.tsx:28-42`
no considera utilizable un precio con `error.price`, y `StatusBar.tsx:32-40` hace lo mismo. Por eso un fallo transitorio
de `ByType`, seguido por un `ReceiveTrade` real o por una recarga REST exitosa al retirar/restaurar un símbolo, sigue
mostrando `Sin datos` / `datos no disponibles`. La evidencia Dev recorrió precisamente el fallo de `ByType`, pero los
tests sólo verifican que el error inicial no fabrique precios; no prueban recuperación posterior.

Un update válido debe limpiar el error de precio del símbolo correspondiente, y hace falta cubrir la secuencia
fallo REST → trade válido y, si se conserva el reintento visual, fallo REST → REST válido.

### 3. MAJOR — La selección y los símbolos analizados sobreviven al logout y aparecen al siguiente usuario

La lista `added` de `LiveWatchlist.tsx:18` sí pertenece al montaje del Dashboard. Sin embargo, al seleccionar un símbolo
agregado, `LiveWatchlist.tsx:55-61` llama `pinAdHoc` y lo mueve al store de módulo `useGexStore`, junto con
`selectedSymbol`, `adHocSymbols`, caché GEX, errores y vencimiento seleccionado (`useGexStore.ts:66-82,132-170`).

`App.tsx:216,228-235` remonta el Dashboard al cambiar de sesión y llama `resetUserScopedStores`, pero
`resetUserScoped.ts:1-22` sólo limpia usuario actual y cuenta. En consecuencia, la persona siguiente hereda el símbolo
seleccionado, lo ve en la nueva watchlist y en la StatusBar, y puede recibir el barrido GEX cacheado por la sesión
anterior. Esto contradice la propia definición de `adHocSymbols` como datos de “esta sesión y de esta persona”
(`useGexStore.ts:31-35`) y amplía a todas las superficies de mercado un arrastre que antes quedaba acotado a GEX.

Los campos de preferencia/sesión de GEX deben resetearse al cambiar de usuario. Si reglas y universo son de plataforma,
pueden conservarse por separado; selección, ad-hoc y cachés derivados no deben heredarse sin una decisión explícita.

### 4. MINOR — El botón de watchlist declara como controlado el título, no el diálogo

`StatusBar.tsx:44` usa `aria-controls="lw-title"`, mientras `LiveWatchlist.tsx:53-54` asigna ese id al `h2`; el
`aside role="dialog"` no tiene id. La relación accesible del botón apunta al texto interno en lugar del panel que abre.
Asignar un id al `aside` y referenciarlo desde `aria-controls` corrige el contrato sin cambiar la interacción.

## Comportamiento confirmado por lectura

- `LiveWatchlist` es el único dueño de las suscripciones extra en estas superficies; `Gex` recibe
  `externalWatchlist`, omite su propia suscripción y conserva los controles y barridos GEX existentes.
- El efecto de suscripción excluye el universo de plataforma y devuelve cleanup para el delta de símbolos; agregar
  varias cotizaciones no queda limitado por `max_pinned`, que sólo se aplica al elegir una para análisis GEX.
- Retirar un ticker configurado sólo oculta su fila en esta sesión; no edita reglas ni configuración. Los símbolos
  agregados se eliminan de la lista local y un ad-hoc seleccionado se despinea.
- La demo distingue cuenta/estrategias de ejemplo de watchlist/GEX reales, retira `P&L por sesión`, mueve seguimiento y
  agenda a la derecha y reutiliza el componente GEX real. El aspecto, densidad y contraste no se certifican sin QA visual.

El resultado permanece **CHANGES_REQUESTED**. Este review no marca GC-0011 como `VALIDATED` ni `CLOSED` y no convierte
las pruebas o la corrida Dev del implementer en evidencia propia del reviewer.
