---
name: market-watch
version: 1.0.0
display_name: Vigía de mercado
description: >
  Un vigía que el owner define con sus palabras (qué símbolos, qué condiciones, qué cuenta como hallazgo), corrido por
  un agente programado (p. ej. cada 30 minutos en la rueda) o a pedido. Cada corrida lee los datos de GaleCore (IV rank,
  estructura de IV, métricas de volatilidad, cadenas y griegas, velas, GEX, skew) y el calendario macro, chequea las
  condiciones símbolo por símbolo y guarda lo que encontró como revisión de una investigación por agente: los
  candidatos que cumplen todo, los que quedaron cerca y por qué, y qué dato faltó. Sólo lectura: describe candidatos,
  nunca dice que opere ni pone órdenes. Para diseñar una estrategia con un candidato, strategy-design.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«Avisame cuando el IV rank de QQQ pase 50 y el skew esté alto», «Buscame oportunidades de vender puts en estos
símbolos», o la corrida de un agente de oportunidades: el objetivo del agente ES el método.

## Qué necesita
- El objetivo de la tarea (símbolos, condiciones y qué es un hallazgo, en palabras del owner), leído al pie de la letra.
- `profile show` (citar la versión); `kb search --kind research --text "<slug del agente>"` y la revisión anterior
  (`kb show research:<id>`) para decir qué cambió desde la última corrida.
- GaleCore, lo más barato primero: `galecore list` una vez; `galecore get compute.iv_rank --symbol <SYM>`, `galecore
  get market_data.volatility_metrics --symbol <SYM1,SYM2,...>`, `galecore get compute.implied_volatility --symbol
  <SYM>` antes que las cadenas. Una cadena pesa ~1 MB: siempre `galecore get market_data.option_chains --symbol <SYM>
  --out <dir>/<SYM>-chain.json` y leer sólo los vencimientos y strikes necesarios. Griegas sólo de los contratos de un
  candidato (`market_data.option_greeks --symbol "<OCC>"`). Velas: `market_data.candles --symbol <SYM> --param
  interval=1d --param fromTime=<ISO>`.
- Calendario: `galecore get calendar.macro_releases --param From=<hoy> --param To=<hasta> --param
  ReleaseIds=50,10,46,53,54,9` y `galecore get calendar.fomc_meetings` (404 o 502 → faltante con el error).
- Contexto cuando una condición lo usa: `prepare --symbol <SYM> --skill regime` (GEX, skew 25Δ, VIX/VVIX),
  `history.index_daily --param Index=VIX --param From=<fecha>` (percentil), `rates.treasury_curve`.

## Pasos
1. Leer el objetivo literal. Una condición que no se puede evaluar con los datos disponibles va como «sin evaluar» (en
   `missing`), nunca dada por cumplida. No agregar condiciones propias.
2. Si el runner dice que ya filtró los símbolos por código, ese filtro es la primera condición: armar y chequear
   candidatos sólo de sus hallazgos; los demás símbolos van como los dejó el filtro (no, cerca, sin evaluar), sin volver
   a pedir sus cadenas.
3. Traer los datos. Todo número informado sale de una respuesta guardada como evidencia (`evidence add --slug
   <fuente-serie>`, citada `evidence:@<slug>`) con el `retrieved_at` de GaleCore. Una cuenta propia (crédito, ancho,
   distancia al spot) es interpretación y nombra sus insumos. Un dato viejo o faltante se declara, nunca se estima.
4. Hallazgos, símbolo por símbolo: CUMPLE (todas las condiciones, con el valor de cada una), CERCA (qué condición falla
   y por cuánto) o NO (una línea). Una estructura candidata (p. ej. un spread de venta de puts con strikes,
   vencimiento, crédito y pérdida máxima) se describe como lo que cumple, nunca como consejo.
5. Respetar los topes del perfil al describir un candidato (pérdida máxima por operación, pérdida abierta sumada): uno
   que pasa un tope va con esa marca, no se esconde.
6. Estado: OK si se evaluaron todos los símbolos; INCOMPLETE si faltaron datos de alguno (cuál, en `reason` y
   `missing`). Corrida corta: la tarea tiene tope de turnos. Guardar con `research save|revise --capability
   market_watch`.

## Qué entrega
Ejemplo de forma:

Un candidato cumple todo: QQQ; IWM quedó cerca (IV rank 44 contra 50 pedido).

| Símbolo | Estado | IV rank | Skew 25Δ | Candidato | Marca de tope |
|---|---|---|---|---|---|
| QQQ | CUMPLE | (evidence) | (evidence) | spread de venta de puts: strikes, vto., crédito, pérdida máx. | dentro |
| IWM | CERCA | 44 (pide 50) | | | |
| SPY | sin evaluar | | | | falta la cadena |

## Errores a evitar
- Dar por cumplida una condición que no se pudo evaluar, o agregar condiciones propias.
- Bajar una cadena entera sin `--out`, o pedir griegas de toda la cadena.
- Esconder un candidato que pasa un tope del perfil.
- Consejos («comprá», «vendé», «conviene», «deberías»): decide el owner.

## Cómo responder
Datos de GaleCore, lo más barato primero (IV rank y métricas antes que cadenas; cadenas con `--out`).
Conclusión en una línea (cuántos cumplen y cuál), después una tabla por símbolo (CUMPLE / CERCA / NO / sin evaluar)
con el valor de cada condición y la marca de tope. Describe candidatos, no aconseja.
