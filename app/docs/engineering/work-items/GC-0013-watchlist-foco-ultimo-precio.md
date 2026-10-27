---
id: GC-0013
title: Watchlist — escritura y último precio
status: CLOSED
implementer: codex
review_result: PENDING
approval_result: APPROVED
approver: user
---

# GC-0013 — Watchlist: escritura y último precio

13/10/2026: el owner reportó que no podía escribir con el watchlist abierto y que al cierre veía `-`; pidió corregir ambos ahora. Alcance local autorizado por ese pedido, rama `fix/watchlist-input-last-price`, desde `local/integracion`. No modifica el plan de WS-0029 ni su estado.

## Aceptación y recorrido

- Abrir el watchlist y escribir en la caja de texto: las actualizaciones del padre no vuelven a enfocar el panel; Escape usa el callback vigente.
- Sin trades, cargar el último precio que devuelve GaleCore y refrescarlo por REST. Una suscripción al hub no acredita que llegaron trades; la recepción de trades se mide separada de quotes.
- Un precio cero, negativo o no finito no borra el último válido. Un error posterior no oculta el precio disponible; conserva el mensaje de error en el tooltip.
- Un trade válido reciente tiene prioridad sobre REST. No se inventa una cotización cuando la fuente no la proporciona.
- Fuera de alcance: redimensionar el panel, navegación, órdenes, producción, nuevos proveedores y calendario de mercados.

## Cambios y evidencia

- `LiveWatchlist.tsx`: el efecto de foco depende de abrir/cerrar, con referencia al callback actual; antes se reejecutaba por cada nueva función `onClose` del padre.
- `useMarketStore.ts`: conserva el precio frente a trades inválidos; distingue recepción de trade válido y lectura REST.
- `TickerGrid.tsx`: carga/refresca por REST cuando no hay trade válido reciente, incluso con el socket suscripto. Reevalúa los símbolos en cada poll y recupera errores al llegar datos válidos.
- `TickerWatchlist.tsx`: conserva el último precio visible aunque falle una lectura posterior.
- Pruebas finales: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/ticker/LiveWatchlist.test.tsx src/components/ticker/TickerWatchlist.test.tsx src/store/useMarketStore.test.ts` (PowerShell: `$env:CI='true'`). Tres suites, 14 pruebas, exit 0, incluida la prioridad del trade reciente sobre REST tardío. Salida: `../evidence/GC-0013/checks.json`.
- Build CI final: `npm run build` con `CI=true`, compilación correcta, exit 0. Incluye el árbol con cambios concurrentes, no sólo el diff de este fix. `git diff --cached --check`: exit 0 sobre el stage propio.
- Chromium con componentes reales en fixture aislado, actualizaciones del padre cada 250 ms y snapshot real de API Dev: escritura completa, foco retenido, precios SPY/QQQ visibles, anchos 1440 y 900 px, sin errores JS. Resultado y capturas: `../evidence/GC-0013/`. Comando: `node .tmp/watchlist-qa/check.cjs`, desde la raíz del workspace. Fixture de QA con textarea, no la conversación autenticada del Lab.

## Para retomar

Implementación local lista; pendientes revisión independiente y aprobación del owner. No VALIDATED/CLOSED.
QA autenticada del Lab y comprobación con mercado cerrado en vivo pendientes; la ausencia de trades y las lecturas vacías se verificaron con pruebas sintéticas explícitas. El snapshot real fue consultado el 13/10 y no acredita mercado cerrado.
La hora existente del watchlist sigue siendo recepción, no fecha de origen de la cotización.
Hay cambios concurrentes del owner/otra sesión en el mismo checkout (ancho del panel, App, StatusBar y Resumen): excluidos del commit de este fix.

## Cierre (15/10/2026, ok del owner al orden de piezas)

Cerrada: superada: lo que falta de la watchlist (guardado en la cuenta, grupos, buscador) quedó en WS-0038.
