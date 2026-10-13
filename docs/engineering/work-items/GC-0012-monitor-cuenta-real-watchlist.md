---
id: GC-0012
title: Monitor con cuenta real, watchlist ajustable y reloj argentino
status: READY_FOR_REVIEW
implementer: codex
review_result: PENDING
approval_result: PENDING
---

# GC-0012 — Monitor real y watchlist ajustable

Pedido directo del owner, 13/10/2026: sacar los datos simulados del monitor, ajustar el tamaño del watchlist derecho, mostrar Chg/Chg% con verde y rojo y usar hora argentina arriba. Este pedido autoriza los cambios locales del monitor; no modifica el plan del harness WS-0029.

## Alcance y aceptación

- Monitor → Resumen: balances y posiciones de la cuenta del operador, reutilizando AccountSummary y useAccountStore. Sale del Resumen el capital del perfil y las posiciones, exposición y avisos SHADOW. Sin lectura o con error se indica el faltante; no se reemplaza con cifras de ejemplo.
- Watchlist derecho: arrastrar el borde izquierdo para achicar/agrandar entre 360 y 720 px; teclado, cierre/reapertura conservando ancho y doble clic para volver a 420 px. El contenido principal reserva el mismo ancho en pantallas grandes; en pequeñas el panel se superpone y respeta el viewport.
- Chg/Chg%: conserva la presentación existente contra cierre previo real; sin cierre no calcula una variación. Positivo verde, negativo rojo, cero neutro.
- Encabezado: hora America/Argentina/Buenos_Aires, etiqueta ARG. El calendario y horario del mercado conservan ET.

Fuera de alcance: backend, órdenes, producción, push, PR y eliminación de las capacidades SHADOW del Lab. No se borran datos del runtime.

## Evidencia

- `CI=true npm run build`: compilación exitosa (13/10). Aviso no bloqueante de Browserslist desactualizado.
- Jest del área existente: LiveWatchlist, TickerWatchlist y StatusBar: 3 suites, 14 pruebas aprobadas en la primera corrida. Datos sintéticos de tests, no evidencia financiera en vivo.
- Corrida final conjunta: `CI=true npm test -- --watch=false --runInBand --runTestsByPath src/pages/Resumen.test.tsx src/components/layout/StatusBarArgentina.test.tsx src/components/ticker/LiveWatchlistResize.test.tsx src/components/ticker/LiveWatchlist.test.tsx src/components/ticker/TickerWatchlist.test.tsx src/components/layout/StatusBar.test.tsx`: exit 0, 6 suites y 21 pruebas aprobadas, sin avisos de act. Verifica cuenta real/faltantes, zona argentina en verano/invierno, ancho por teclado y cierre/reapertura; las otras pruebas cubren variaciones, selección y fallback de mercado.
- `git diff --check`: sin errores.
- QA visual del recorrido con la sesión real: pendiente. CUA y node_repl fallan al iniciar porque no se encuentra codex-windows-sandbox-setup.exe. No se acredita apariencia ni datos en vivo con el build o Jest.

## Para retomar

Cambios locales en el monitor servido desde GaleCore/source/galecore-monitor (:3039). Verificar visualmente Resumen y arrastre del watchlist con la sesión autenticada. Cambios concurrentes en TickerGrid, TickerWatchlist, useMarketStore, tipos y pruebas de watchlist se preservaron y fueron commiteados por otra sesión antes de registrar este pedido. Revisión independiente y aprobación del owner pendientes; no VALIDATED/CLOSED.
