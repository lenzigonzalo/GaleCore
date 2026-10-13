---
id: GC-0012
title: Monitor con cuenta real, watchlist ajustable y reloj argentino
status: READY_FOR_REVIEW
implementer: codex
review_result: CHANGES_REQUESTED
approval_result: PENDING
---

# GC-0012 — Monitor real y watchlist ajustable

Pedido directo del owner, 13/10/2026: sacar los datos simulados del monitor, ajustar el tamaño del watchlist derecho, mostrar Chg/Chg% con verde y rojo y usar hora argentina arriba. Este pedido autoriza los cambios locales del monitor; no modifica el plan del harness WS-0029.

## Alcance y aceptación

- Monitor → Resumen: balances y posiciones de la cuenta del operador, reutilizando AccountSummary y useAccountStore. Sale del Resumen el capital del perfil y las posiciones, exposición y avisos SHADOW. Sin lectura o con error se indica el faltante; no se reemplaza con cifras de ejemplo.
- Watchlist derecho: arrastrar el borde izquierdo para achicar/agrandar entre 360 y 720 px; teclado, cierre/reapertura conservando ancho y doble clic para volver a 420 px. El contenido principal reserva el mismo ancho en pantallas grandes; en pequeñas el panel se superpone y respeta el viewport.
- Chg/Chg%: conserva la presentación existente contra cierre previo real; sin cierre no calcula una variación. Positivo verde, negativo rojo, cero neutro.
- Encabezado: hora America/Argentina/Buenos_Aires, etiqueta ARG. El calendario y horario del mercado conservan ET.

Fuera de alcance: órdenes, producción, push, PR y eliminación de las capacidades SHADOW del Lab. No se borran datos del runtime. El feedback de cotizaciones requirió corregir la deserialización del cierre previo en el proveedor backend local, dentro del mismo recorrido del watchlist.

## Evidencia

- `CI=true npm run build`: compilación exitosa (13/10). Aviso no bloqueante de Browserslist desactualizado.
- Jest del área existente: LiveWatchlist, TickerWatchlist y StatusBar: 3 suites, 14 pruebas aprobadas en la primera corrida. Datos sintéticos de tests, no evidencia financiera en vivo.
- Corrida final conjunta: `CI=true npm test -- --watch=false --runInBand --runTestsByPath src/pages/Resumen.test.tsx src/components/layout/StatusBarArgentina.test.tsx src/components/ticker/LiveWatchlistResize.test.tsx src/components/ticker/LiveWatchlist.test.tsx src/components/ticker/TickerWatchlist.test.tsx src/components/layout/StatusBar.test.tsx`: exit 0, 6 suites y 21 pruebas aprobadas, sin avisos de act. Verifica cuenta real/faltantes, zona argentina en verano/invierno, ancho por teclado y cierre/reapertura; las otras pruebas cubren variaciones, selección y fallback de mercado.
- `git diff --check`: sin errores.
- QA visual del recorrido con la sesión real: pendiente. CUA y node_repl fallan al iniciar porque no se encuentra codex-windows-sandbox-setup.exe. No se acredita apariencia ni datos en vivo con el build o Jest.

## Para retomar

Cambios locales en el monitor servido desde GaleCore/source/galecore-monitor (:3039). Verificar visualmente Resumen y arrastre del watchlist con la sesión autenticada. Cambios concurrentes en TickerGrid, TickerWatchlist, useMarketStore, tipos y pruebas de watchlist se preservaron y fueron commiteados por otra sesión antes de registrar este pedido. Revisión independiente y aprobación del owner pendientes; no VALIDATED/CLOSED.

## Corrección de cotizaciones (feedback del owner, 13/10)

El owner informó «la lista queda vacía o cargando». El watchlist tomaba su universo y bloqueo de carga exclusivamente de GEX; ahora usa también los símbolos configurados en la plataforma y no bloquea sus precios por reglas GEX pendientes. Al abrir/reabrir consulta cotizaciones y el botón Actualizar permite reintentar; una respuesta sin cotización válida muestra el faltante en vez de una fila vacía sin explicación.

También se verificó en API Dev que `prev-close` y `updated-at` llegaban en cero/fecha mínima: el proveedor usaba System.Text.Json con un modelo anotado con Newtonsoft.Json. La lectura ahora respeta esos atributos, y el frontend normaliza el nombre real `prev-close`. Así Chg/Chg% tienen el cierre real, sin sustituirlo por apertura.

Ejecutado: Jest (marketdata, LiveWatchlist, TickerWatchlist y LiveWatchlistResize), 4 suites y 17 pruebas aprobadas; `dotnet test .../DataFeed.Tests.csproj --filter FullyQualifiedName~TastytradeMarketDataTests --nologo -v quiet`, 1 prueba aprobada (warnings previos del repo); build del frontend exitoso; diff sin errores. La prueba de GEX pendiente y reintento es sintética, no un recorrido en navegador.

API Dev recargada después de comprobar que el proceso que escuchaba :7001 era exactamente `DataFeed.Api/bin/Debug/net8.0/DataFeed.Api.exe` de este workspace. Evidencia real sanitizada en `docs/engineering/evidence/GC-0012/watchlist-api-before.json` y `watchlist-api-after.json`: HTTP 200, precios reales SPY/QQQ/IWM; antes cierre 0, después cierre previo y fecha válidos. No acredita la sesión del navegador del owner. Reproducir desde GaleCore: `python docs/engineering/evidence/GC-0012/check-watchlist.py <salida.json>`.

Monitor servido: consulta HTTP a `http://localhost:3039/static/js/bundle.js` (exit 0); el bundle incluye `Actualizar cotizaciones`, `baseSymbols` y la explicación de cotización faltante. Confirma que el servidor de desarrollo sirve el arreglo; no sustituye QA visual.

Pendiente: verificación visual del watchlist en la sesión autenticada (CUA sigue sin iniciar por ejecutable del sandbox faltante), revisión independiente y aprobación del owner. Se conserva READY_FOR_REVIEW.

Revisión independiente realizada en `docs/engineering/reviews/GC-0012-watchlist-quotes.md`: CHANGES_REQUESTED. Hallazgo corregido por implementer: tras fallo, cotización omitida o `last` inválido, el último precio real se conserva con etiqueta visible «Lectura anterior» y Chg/Chg% quedan sin cálculo; también se informa el fallo en polling. Test agregado de lectura válida → fallo → respuesta parcial. Corrida final tras corrección: 4 suites y 18 pruebas aprobadas. Sin segunda pasada del reviewer, según ENGINEERING.md; el informe original no se modifica. Pendientes QA visual y aprobación del owner.
