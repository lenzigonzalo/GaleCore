# GEX — Gamma Exposure (informativa)

Documentación de la estrategia **GEX**, prefijo `Gex`. Estrategia **sin trades**: su único producto es
información de gamma exposure para que el operador decida.

## Contenido de esta carpeta

| Archivo | Rol |
|---|---|
| [`galecore-estrategia-gex.md`](galecore-estrategia-gex.md) | **Definición canónica.** Qué es, GEX global vs. de un vencimiento, capa 1 compartida, latencia y cache, umbral por símbolo, switch, contrato de render. La **banda de gamma** —el sombreado del gráfico— está en su [§8.1](galecore-estrategia-gex.md); el **buscador de símbolos** —analizar uno que no está en el universo— en su [§5.1](galecore-estrategia-gex.md). |
| [`gex_endpoint.md`](gex_endpoint.md) | Referencia del endpoint `/App.Analytics/GammaExposure` — el GEX de **un solo** vencimiento. Es el motor de cálculo sobre el que se apoya la estrategia, no la estrategia. Incluye el contrato de `CallBand` / `PutBand`. |

## Los dos objetos del gráfico, que no son lo mismo

| | Contesta | Cómo se muestra | Definido en |
|---|---|---|---|
| **Muro** (`CallWall` / `PutWall`) | *qué número* | fila en el Expiry Engine + línea con etiqueta | [`gex_endpoint.md`](gex_endpoint.md) §1 |
| **Banda** (`CallBand` / `PutBand`) | *qué tan ancha es la concentración alrededor* | solo zona sombreada, sin fila y sin etiqueta | [§8.1](galecore-estrategia-gex.md) |

**Ninguno de los dos predice.** El muro es un argmax sobre un strike y está medido que salta; la
banda es estable pero su borde se comporta como un strike cualquiera de su mismo delta —926 ciclos
de SPY/QQQ/IWM 2013-2025, ver
[el hallazgo](../../research/got/hallazgos/2026-08-28-la-banda-no-predice.md)—. Los dos describen
dónde está apilado el open interest. GEX es informativa y su vocabulario lo respeta: por eso la
banda no lleva etiqueta y ninguna pantalla habla de zonas para operar.

En la app, lo mismo está en **References → Definiciones**, tarjeta *C.2 · Banda de gamma*.

## Fuente de verdad operativa

[`galecore_rules_gex.json`](../../source/galecore-datafeed/DataFeed.Api/Files/Gex/galecore_rules_gex.json)
— servido tal cual por `GET /App/Gex/Rules`. Ante discrepancia con los docs, manda el JSON.
Sus invariantes los congela `DataFeed.Tests/GexRulesJsonTests.cs`.
