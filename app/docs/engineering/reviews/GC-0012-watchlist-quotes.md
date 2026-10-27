# Revisión independiente — GC-0012 corrección de cotizaciones

Fecha: 2026-10-13
Reviewer: Codex
Veredicto: **CHANGES_REQUESTED**

## Alcance

Revisión de una pasada sobre `local/integracion`, `HEAD e1782893f776f26c97f2cac70c05a2772f6c01dc`, y el árbol de trabajo sin commit. Se revisaron los cambios de cotizaciones en `TastytradeApiProvider.cs`, `types/api.ts`, `api/marketdata.ts`, `LiveWatchlist.tsx`, `TickerGrid.tsx`, sus pruebas nuevas/modificadas y la evidencia de GC-0012. El árbol estaba sucio; se excluyeron los dos JSON no versionados de `DataFeed.Api/Files/Runtime/`, ajenos a esta corrección. No se editó implementación ni se ejecutaron cambios de entorno.

La evidencia sanitizada before/after respalda el arreglo del contrato real: la API Dev pasó de `prev-close: 0` y fecha mínima a cierres previos y `updated-at` válidos para SPY, QQQ e IWM. Se inspeccionaron los resultados declarados de 17 pruebas frontend, una prueba del proveedor, build exitoso y diff limpio; no se repitieron esas corridas. La verificación visual autenticada sigue pendiente por la falla documentada de CUA.

## Hallazgos

### Bloqueante — una falla posterior conserva y muestra la cotización anterior como vigente

`TickerGrid` registra `error.price` cuando el batch falla o no devuelve un `last` válido, pero no invalida el `price` ni el `prevClose` ya guardados. `TickerWatchlist` decide qué renderizar primero por `price > 0`: si el símbolo tuvo una respuesta válida antes, sigue mostrando ese precio y calcula `Chg/Chg%` aun después de que Actualizar falle o la API omita ese símbolo. El error queda sólo en el atributo `title`; `Sin datos` aparece únicamente cuando nunca hubo precio.

Esto contradice la corrección declarada (`una respuesta sin cotización válida muestra el faltante`) y puede presentar una cotización anterior sin indicación visible de que el refresh falló. La prueba de reintento cubre fallo inicial → éxito, pero no éxito → fallo ni éxito → resultado parcial/inválido. Debe hacerse visible el error por encima del valor conservado, o invalidar de forma explícita el valor usado por la fila, y congelar ambos casos en una prueba.

### Menor — el contrato del work item contradice el diff

El alcance original mantiene `backend` en «Fuera de alcance», aunque esta corrección modifica el proveedor de Tastytrade y agrega una prueba backend. La sección de corrección explica el motivo, pero el contrato queda internamente contradictorio. Conviene actualizar alcance y aceptación para que el cambio del proveedor trace formalmente al criterio revisado.

## Evaluación

La deserialización con Newtonsoft coincide con los atributos del modelo y la evidencia real confirma que recupera `prev-close` y `updated-at`. La normalización frontend usa el nombre HTTP observado, y el cálculo de la lista usa el cierre previo sólo cuando es finito y positivo. El universo de plataforma permite pedir precios sin esperar GEX; `active` y `refreshKey` vuelven a habilitar pedidos al reabrir o actualizar.

El hallazgo bloqueante impide aprobar esta pasada. No corresponde marcar GC-0012 como `VALIDATED` ni `CLOSED`; además de corregirlo, sigue pendiente el recorrido visual autenticado ya registrado en el work item.
