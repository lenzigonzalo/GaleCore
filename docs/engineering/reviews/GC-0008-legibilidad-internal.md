# GC-0008 — Revisión interna de la segunda entrega: legibilidad

- Fecha: 2026-10-03.
- Modo: `uncommitted`, diff completo y recheck acotado de la corrección TickerCard.
- Base y HEAD: `b5c0e2f1c4e050f1f76d8920d412b9f4af04e02a`, rama `feature/GC-0008-tema-carbon`.
- Árbol: sucio; 44 archivos de frontend modificados y actualización del work item. JSON Runtime no trackeado preexistente excluido.
- Alcance: segunda entrega completa contra esa base; tipografía inline y Tailwind, balances, navegación, sidebar, métricas, agrupación DetailsPanel y riesgo de recortes. La primera revisión permanece intacta en `GC-0008-tema-carbon-internal.md`; este documento cubre una nueva entrega, no la sustituye.
- Reviewer: subagente de esta sesión Codex, separado del implementer. Sonnet de ENGINEERING.md no está disponible; revisión con el modelo de sesión, sin independencia de familia de modelo.
- Comandos: `git status --short`, `git rev-parse HEAD`, `git diff --stat b5c0e2f`, `git diff --numstat b5c0e2f`, `git diff b5c0e2f -- source/galecore-monitor`, diff acotado por grupos de archivos, lecturas del layout y `git diff --check b5c0e2f`.
- Gates y límites: build ejecutado por el padre, no por este reviewer. Sin navegador conectado; no se ejecutó QA visual, recorrido con backend ni comparación de screenshots. Las conclusiones de layout son estáticas y no certifican todas las resoluciones.

## Resultado

APPROVE del diff inspeccionado tras la corrección puntual de TickerCard. Sin BLOCKER/MAJOR abiertos. Quedan la verificación visual y conformidad del owner; este resultado no cambia VALIDATED/CLOSED.

## Hallazgo corregido y recheck

**MINOR — fila Bid/Ask/Volume podía desbordar al aumentar su fuente.** TickerGrid conserva un mínimo de 210 px por tarjeta, mientras el texto mono de la fila sube de 11 a 13 px. Con bid/ask de tres dígitos y volumen, los tres contenidos y gaps exceden el interior de una tarjeta cercana a ese mínimo; la fila no permitía envolver. Era un riesgo preexistente que la ampliación agravaba. Se comunicó al implementer y este agregó `flex-wrap`, `gap-x-3`, `gap-y-1`. Recheck por lectura: la fila final permite repartir sus contenidos en líneas conservando valores y etiquetas. No se afirma reproducción visual.

## Comprobaciones

- Los cambios son de presentación: tamaños, pesos, line-height, anchuras y distribución. No cambian handlers, condiciones financieras, permisos, API ni datos. El work item relaciona la entrega con el pedido del owner de hacer texto y números más grandes.
- Tailwind aumenta la escala xs/sm/base/lg/xl/2xl y los valores inline crecen en componentes que no heredan esas clases. El gráfico canvas sube a 13 px conservando resolución explícita de la fuente CSS.
- El balance principal pasa a 28 px y se apila sobre su etiqueta; los secundarios usan 16 px. Se conserva el contenido y se permite envolver valores. Sidebar crece a 270 px (220 px en media query); logo de 100 px coincide con status 40 px más nav 60 px.
- DetailsPanel conserva orden, scope, filtros y colores. Los grupos vacíos se filtran antes del cálculo de flex, por lo que no generan bases cero. Cada grupo recibe peso y base proporcionales a su cantidad de celdas, puede envolver y contiene una grilla adaptable. Etiquetas y valores dejan de truncarse con ellipsis y permiten cortes de línea; referencias continúan visibles.
- Mi espacio permite envolver la cabecera y los títulos, aumenta el ancho máximo y conserva edición/filtros. PositionCard amplía las columnas mínimas de métricas y mantiene el contenedor padre con flex-wrap para separar el bloque de management cuando no cabe al lado.
- El ajuste de la navegación no reintroduce el overflow que recortaba el menú de cuenta en la primera entrega.
- `git diff --check b5c0e2f` terminó exit 0; advertencias de acceso al ignore global y conversión LF/CRLF, sin error del check.

## Limitaciones prácticas

La navegación sigue siendo una fila sin adaptación completa a pantallas estrechas y PositionCard conserva cuatro columnas mínimas. Su ajuste real, textos largos, importes grandes, líneas de referencia y carga de fuentes requieren observación en navegador. No se presentan como verificados por el build ni como nuevas capacidades responsive. El cambio cumple la ampliación solicitada según inspección de código; su utilidad visual debe confirmarse en el monitor local.
