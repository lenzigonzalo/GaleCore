---
id: GC-0008
title: Tema carbón del monitor inspirado en la referencia del owner
status: IN_PROGRESS
implementer: codex
reviewer: internal
approver: user
review_result: APPROVED
approval_result: PENDING
---

# GC-0008 — Tema carbón

Pedido explícito del owner en esta sesión: adaptar letra, tema y colores del front a la imagen de referencia.
Rama local `feature/GC-0008-tema-carbon`, desde `local/integracion` (`99fea8f`). Sin push, PR ni despliegue.
El puntero del workspace sigue en GC-AI-0020: no se reemplaza el trabajo paralelo de agentes.

## Para qué y primera demostración

Mejorar la lectura y coherencia visual del monitor con fondos negros y carbón, texto neutro, DM Sans,
tarjetas suaves y selección blanca. La primera demostración es abrir el monitor local y comparar Main y
Mi espacio con la referencia, conservando sus datos y funciones. No requiere cambios de API ni datos nuevos.
Fuera de alcance: copiar el dashboard financiero de la referencia, cambiar estrategias, ejecutar órdenes.

## Criterios

- Paleta compartida carbón y tipografía consistente incluso en componentes con estilos inline.
- Navegación activa distinguible, foco de teclado visible y botones legibles.
- Mi espacio conserva filtros, lectura y edición con tarjetas y acentos del nuevo tema.
- Gráfico GEX usa fondos neutros; se conservan los colores de identidad CALL/PUT y las referencias.
- Build de producción y revisión interna de todo el diff. Cierre pendiente del owner.

## Evidencia y handoff

- `CI=true npm run build`: compilación de producción exit 0. Se ejecutó fuera del sandbox: dentro, Node fallaba con EPERM al resolver `C:/Users/lenzi`. Repetición final tras corrección de menú: exit 0, Compiled successfully.
- `git diff --check`: exit 0.
- QA visual: no realizada. `cua.getState()` no devolvió navegadores conectados y `createBrowserTab(iab)` respondió `Browser is not available: iab`. No se afirma comparación visual ni E2E.
- La revisión interna detectó recorte potencial del menú de cuenta por `overflow-x: auto` en nav; eliminado. Recheck interno APPROVE en `../reviews/GC-0008-tema-carbon-internal.md`; reviewer separado, misma familia de modelo (Sonnet no disponible).
- DM Sans usa el proveedor de fuentes que ya utilizaba el front (Google Fonts); tiene fallback local Segoe UI. No se instalaron dependencias.
- Un JSON Runtime preexistente y no trackeado queda fuera del cambio.
- Uso: recargar `http://localhost:3039` (Ctrl+F5 si hay CSS en caché), revisar Main y Mi espacio. Si el servidor sirve `build/`, la compilación lo actualiza; si usa el servidor de desarrollo, toma los fuentes.
- Cierre y conformidad visual pendientes del owner. No se modifican estados VALIDATED/CLOSED.

## Segunda entrega — legibilidad

Pedido del owner: texto y números más grandes, con más tamaño para lo importante.
Se aumenta la escala tipográfica compartida y los estilos inline; precios, balances y métricas
reciben mayor jerarquía. El balance principal se separa de las filas secundarias, la barra lateral
crece y las métricas GEX se distribuyen en grupos que pueden envolver para evitar recortes.
Se conserva la identidad y proporción de los grupos; no cambian datos ni reglas.
Primera comprobación: compilar y revisar el diff; recorrido visual pendiente por falta de navegador conectado.
Compilación final de esta entrega: `CI=true npm run build`, exit 0, Compiled successfully.
`git diff --check` exit 0.
Revisión interna [APPROVE](../reviews/GC-0008-legibilidad-internal.md) tras corregir la fila
Bid/Ask/Volume para permitir envolver. La revisión es estática; no se afirma QA visual.
Texto general 14–16 px, títulos de pantalla 24 px, precios 30 px, balance principal 28 px
y métricas de riesgo 22 px. Valores de GEX 20 px con etiquetas y referencias separadas.
Sin cierre ni aprobación del owner.
