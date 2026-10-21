# docs/ — Índice

Fuentes de verdad y documentación de GaleCore. Regla: **una sola versión vigente por tema.** Lo
superado va a [`archive/`](archive/) con cabecera que lo marca.

## Vigente

| Doc | Rol |
|---|---|
| [`REFERENCIA-DESARROLLO.md`](REFERENCIA-DESARROLLO.md) (mapa corto en [`../CLAUDE.md`](../CLAUDE.md)) | **Contrato de arquitectura** (plataforma, backend, front, endpoints, convención de estrategias). |
| [`GaleCore-arquitectura-datos.md`](GaleCore-arquitectura-datos.md) | **PROPUESTA** (no implementada): cómo sostener N estrategias sobre un feed compartido, con las mediciones de capacidad de DXLink del 2026-08-11. Incluye por qué la base de datos entra por multi-usuario y no por el feed, y las decisiones tomadas y pendientes. |
| [`rpf/`](rpf/) | Estrategia **RPF** ("disparo por prima real", operativa): definición, research, reconciliación. |
| [`gex/`](gex/) | Estrategia **GEX** (Gamma Exposure, informativa): definición + referencia del endpoint. |

**Una carpeta por estrategia**, `docs/<prefijo>/` en minúscula, con su definición canónica
`galecore-estrategia-<prefijo>.md`. El índice de qué estrategias existen está en el nodo "Estrategias"
de [`REFERENCIA-DESARROLLO.md`](REFERENCIA-DESARROLLO.md).

**Fuentes de verdad operativas** (no son docs), en `../source/galecore-datafeed/DataFeed.Api/Files/`:
`galecore_rules_core.json` (config de la **aplicación**: universo, `strategies[]`, `monitor`) y un
JSON por estrategia en su subcarpeta (`Rpf/`, `Gex/`).

## Referencia externa (Tastylive)

`tastylive-options-strategy-*.md` — call/put credit spread, iron condor. `tastylive-options-strategy-guide-2023.pdf`
(⚠️ 51 MB — candidato a sacar del repo / git-lfs / Drive).

## Archivo (superado, solo registro histórico)

Ver [`archive/`](archive/): definición v2.1.5 (línea multi-factor invalidada por BT-11), mapa
v215-vs-backtest, el candidato `v1.4.0`, y — desde el 2026-08-06 — toda la documentación de la
estrategia **v1.4.0 PCS-only**, eliminada cuando GaleCore pasó a ser plataforma:
`galecore-estrategia-definicion.md`, `galecore-rules-reference.md` y `galecore-research-backtesting.md`.
Su research vive replicado y vigente en [`rpf/`](rpf/), que es la estrategia que la sucedió.

