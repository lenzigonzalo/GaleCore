---
name: market-story
version: 1.0.0
display_name: Historia del mercado
description: >
  Lee qué historia está priceando hoy el mercado y si cambió desde la lectura anterior. Juntar es código (`story pack`:
  precios y variaciones de SPY y de los activos que cuentan la historia, la familia VIX y su estructura, las opciones
  de SPY y el calendario macro y FOMC, comparado con el pack anterior). Interpretar es el modelo: la historia en una
  frase, sus pilares, qué cobran las opciones por protección y qué pagan por venderla, la historia rival, qué la mueve
  hoy y si cambió. Se guarda como revisión de una investigación por símbolo. Sólo lectura: describe, nunca aconseja.
  Para el análisis de un dato puntual, on-demand-analysis.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Qué historia está priceando el mercado?», «¿Cambió la historia?», «¿Qué mueve hoy a SPY?». También la corre el
agente programado de historia del mercado (el runner le da el pack ya juntado, con su ref).

## Qué necesita
- El pack del día: en sesión, `story pack --symbol SPY --prompt "<pedido>"` una vez (~2 min) y usar el ref que
  imprime; en una corrida programada viene del runner. No volver a pedir sus datos con otros comandos.
- La revisión anterior: `kb search --kind research --text "historia del mercado"` y `kb show research:<id>` (hace falta
  su historia para decir si cambió). Un pack se lee con `kb show evidence:<id>`.

## Pasos
1. Todo número sale del pack y cita su ref (un hecho sin fuente se rechaza), copiado tal cual; un cociente o
   diferencia propia es interpretación y nombra sus insumos. Fechas del pack: los cierres son de la última rueda (un
   fin de semana es el mercado del viernes: decirlo).
2. **La historia** (`hypothesis`): una o dos frases en castellano simple: qué lidera y qué queda atrás, si tasas, dólar
   y crédito confirman o contradicen a las acciones, si la volatilidad pricea calma o estrés. Es una lectura de
   precios, no un pronóstico.
3. **Pilares** (`statements`, cada texto empieza con su pilar entre corchetes): [precio] SPY y el liderazgo entre QQQ e
   IWM (amplitud); [tasas y dólar] TLT y UUP; [crédito] HYG; [materias primas] GLD y USO; [volatilidad] nivel y
   variación del VIX, su estructura (VIX9D/VIX y VIX3M/VIX: debajo de 1 y arriba de 1 es la forma calma, al revés es
   estrés), VVIX; [opciones] skew de puts 25-delta contra su umbral, IV contra volatilidad realizada (a quién le pagan),
   IV rank (con la historia corta de GaleCore: decirlo), régimen de GEX y spot contra gamma cero si está; [calendario]
   datos macro y FOMC dentro de la ventana y qué pilar puede mover cada uno (`recent_releases` son los de la última
   semana, ya reaccionados). Un evento se nombra sólo si está en el calendario del pack. Por pilar, un `fact` con los
   números y una `interpretation` con lo que agrega. Si los pilares no coinciden, decirlo: la divergencia suele ser
   la historia.
4. **Qué la mueve hoy** (`drivers`): un `fact` y una `interpretation` por ítem, cada texto empieza con [qué lo
   mueve], con el tipo de dato: hecho, cálculo, estimación (el movimiento implícito: la IV de la vela leída como IV a
   30 días, no el straddle del día del dato; decirlo siempre) o hipótesis.
   - `co_movement`: qué activos se mueven con el símbolo en las últimas 20 ruedas y qué correlación cambió más contra
     las 20 anteriores. El tema propuesto es hipótesis; dar el tema rival y la observación que refutaría el tuyo.
     Veinte puntos son ruido y correlación no es causa: decir ambas cosas.
   - `reaction.by_release`: por tipo de dato, cuántos hubo, la mediana del movimiento contra la IV de la víspera,
     cuántos la superaron (comparar con `days_without_data`) y si mueve más o menos que un día sin datos. Varios datos
     el mismo día comparten el movimiento (`same_day`): nunca atribuirlo a uno. Con menos de cuatro, sin veredicto.
   - `upcoming`: por dato en la ventana, qué paga hoy la IV por un día contra lo que movieron los últimos, y si la prima
     parece cara, en línea o barata según la convención del pack; la sorpresa no se mide (no hay serie de consenso:
     a `missing`).
   Si `drivers` falta o está parcial, decir qué no se pudo medir; nunca rellenarlo.
5. **Qué se le vende al minorista**, sólo desde precios: cuánto cuesta la protección (skew), cuánto paga vender
   opciones (IV sobre HV), si lo caro es la calma o el miedo. Sin fuente de noticias, la narrativa de los medios va a
   `missing`, nunca imaginada.
6. **El cambio:** exactamente una `interpretation` que empieza con «Cambio de historia: sí —» o «Cambio de historia: no
   —», comparando con la historia de la revisión anterior y con `since_previous` (movimientos y cambios de signo). La
   primera vez: «Cambio de historia: no — primera lectura, sin anterior».
7. **La historia rival y qué la decidiría** (`test_plan`): dos o tres pasos con el dato a mirar, qué apoya la historia
   actual y qué la debilita. `next_steps`: qué tiene que chequear la próxima lectura. `status`: open.
8. `missing`: todo lo que el pack declaró faltante y lo que la historia necesitaría y ninguna fuente trae (noticias,
   posicionamiento por participante, tasas como rendimientos y no vía TLT, spreads de crédito, amplitud por acción).
   Nunca una estimación en un hueco.
9. Guardar: `research save --capability market_story --slug historia-del-mercado-spy`; después `research revise
   --capability market_story --id <id> --reason continuation --note "<qué cambia>"`.

## Qué entrega
Ejemplo de forma:

Historia: el mercado pricea calma con liderazgo de tecnología; tasas y crédito acompañan. Cambio de historia: no.

| Pilar | Dato (pack, fecha) | Qué agrega |
|---|---|---|
| [precio] | SPY, QQQ vs IWM | quién lidera |
| [volatilidad] | VIX, VIX9D/VIX, VIX3M/VIX | forma calma o estrés |
| [opciones] | skew 25Δ, IV vs HV | qué está caro |

Después: qué la mueve hoy, la historia rival y qué la decidiría, faltantes.

## Errores a evitar
- Nombrar un evento que no está en el calendario del pack (lo que uno recuerda de las noticias no es evidencia).
- Atribuir el movimiento de un día con varios datos a uno solo.
- Leer la IV de la vela como el straddle del día del dato sin decirlo.
- Aconsejar («comprá», «vendé», «conviene», «deberías»): la historia es contexto, no decisión.
- Volver a pedir con otros comandos los datos que ya trae el pack.

## Cómo responder
Primero `story pack --symbol SPY`, una vez (~2 min); la revisión anterior con `kb search --kind research --text "historia del mercado"`.
La historia en una línea y si cambió, después una tabla corta de pilares con sus números y fecha, y líneas breves de
qué la mueve hoy y la historia rival. Cada número del pack con su ref. Nada de consejos de operar.
