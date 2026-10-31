---
name: market-story
version: 1.1.2
display_name: Historia del mercado
description: >
  Resume qué pasó en el mercado con acciones, sectores y otras clases de activos de GaleCore, con cobertura y fecha
  explícitas; en sesión usa los datos disponibles y macro.board según necesidad, sin exigir el análisis profundo.
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
También «¿Qué pasó hoy en el mercado interesante?» y resúmenes de movimientos o sectores. Un pedido abierto no es
ambiguo por ser amplio: si contexto resuelve fecha y mercado, responder con alcance explícito; si falta una precisión
que cambia materialmente la respuesta, preguntar antes de elegir por el trader.

## Resumen abierto en sesión
1. Reutilizar el contexto y respuestas ya disponibles para la fecha del pedido. Para descubrir movimientos individuales
   y sectores, `galecore get macro.board --out .scratch/mercado.json --keep "<pedido>"` una vez si no está ya disponible.
   Leer localmente las filas pertinentes de `tabs → sections → groups → rows` (en particular liderazgo), sin volcar el
   JSON completo ni `spark` al contexto. Conservar el ref de evidencia y `missing`; no volver a consultar cada símbolo.
2. Mirar `symbol`, `name`, `last`, `changeDay`, `changeUnit`, `asOf` y `source` por fila; evitar contar varias veces el
   mismo símbolo. Inspeccionar los movimientos diarios, no las primeras filas: el resumen y algunos grupos están
   ordenados por cambio o valor agregado MENSUAL. No mezclar % con puntos o puntos básicos.
3. `asOf` global es generación, no fecha del dato. Usar la fecha de cada fila: si no coincide con la rueda pedida,
   decirlo y no presentarla como movimiento de ese día. Es una selección fija y parcial de acciones, sectores y
   canastas, no todo el mercado. Distinguir cobertura no investigada, datos ausentes y consultas fallidas;
   `missing=[]` sólo dice que las consultas del tablero no declararon fallas, no que no falte nada relevante.
4. Contar lo destacado con cifras, fecha y fuente de los datos consultados,
   sin concluir calma general desde ETFs. Mantener el significado y período de cada cifra: una variación de cinco
   ruedas no es distancia al máximo ni variación diaria. Si se busca una
   causa o resultados, consultar sólo el dato adicional pertinente disponible en GaleCore (`galecore list`); un precio
   no prueba causa ni un evento previsto prueba que se publicó un resultado: la agenda sólo acredita programación.
   Si no hay evidencia, decir que la causa o la publicación no está verificada.
   `--keep` conserva la evidencia canónica para comprobar las cifras. En el chat indicar GaleCore, la fuente de cada
   dato y su fecha; no copiar JSON a Archivos ni generar informes o enlaces a evidencia cruda para un resumen puntual.
   Mantener el significado de cada medida: `valueAddedMonth` es cambio de valor de mercado
   de esa empresa, no contribución al índice (faltan pesos/composición); SKEW en puntos no mide el precio relativo
   de puts contra calls. Si ese análisis no es necesario para el resumen ni está acreditado, omitirlo.
5. Síntesis primero y tabla breve cuando ayude. No exigir pack profundo, opciones ni revisión anterior para responder
   el resumen. Ampliar con el método de historia de abajo sólo si el pedido lo necesita. No guardar investigación por
   defecto: rige Memoria de PRODUCT.md. Este recorrido en sesión no cambia el flujo de las corridas programadas.

## Qué necesita
- Para la historia profunda, el pack del día: en sesión, `story pack --symbol SPY --prompt "<pedido>"` una vez (~2 min) y usar el ref que
  imprime; en una corrida programada viene del runner. No volver a pedir sus datos con otros comandos.
- La revisión anterior: `kb search --kind research --text "historia del mercado"` y `kb show research:<id>` (hace falta
  su historia para decir si cambió). Un pack se lee con `kb show evidence:<id>`.

## Pasos
Estos pasos son para la historia profunda y las corridas programadas; el resumen en sesión usa el recorrido anterior.
1. Todo número sale del pack o de otra respuesta de GaleCore conservada como evidencia y cita su ref, copiado tal cual;
   un cociente o diferencia propia es interpretación y nombra sus insumos. Fechas del pack: los cierres son de la última rueda (un
   fin de semana es el mercado del viernes: decirlo).
2. **La historia** (`hypothesis`): una o dos frases en castellano simple: qué lidera y qué queda atrás, si tasas, dólar
   y crédito confirman o contradicen a las acciones, si la volatilidad pricea calma o estrés. Es una lectura de
   precios, no un pronóstico.
3. **Pilares** (`statements`, cada texto empieza con su pilar entre corchetes): [precio] SPY y el liderazgo entre QQQ e
   IWM (amplitud); [tasas y dólar] TLT y UUP; [crédito] HYG; [materias primas] GLD y USO; [volatilidad] nivel y
   variación del VIX, su estructura (VIX9D/VIX y VIX3M/VIX: debajo de 1 y arriba de 1 es la forma calma, al revés es
   estrés), VVIX; [opciones] skew de puts 25-delta contra su umbral, IV contra volatilidad realizada (a quién le pagan),
   IV rank (con la historia corta de GaleCore: decirlo), régimen de GEX y spot contra gamma cero si está; [calendario]
   datos macro y FOMC dentro de la ventana y qué pilar puede mover cada uno (`recent_releases` y `recent_fomc` son las
   fechas de la última semana, ya reaccionadas; el calendario no verifica publicación, resultado ni causa). Un evento se
   nombra sólo con evidencia del calendario consultado. Por pilar, un `fact` con los
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
8. `missing`: fallas del pack y límites de cobertura de la lectura. Si otra respuesta consultada cubre un faltante
   (por ejemplo tasas o spreads de crédito del tablero), citarla y distinguirlo de la falla original. Lo no consultado
   no equivale a inexistente; lo que ninguna fuente trae no se rellena con una estimación.
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
- Nombrar un evento sin evidencia consultada (lo que uno recuerda de las noticias no es evidencia).
- Atribuir el movimiento de un día con varios datos a uno solo.
- Leer la IV de la vela como el straddle del día del dato sin decirlo.
- Aconsejar («comprá», «vendé», «conviene», «deberías»): la historia es contexto, no decisión.
- Volver a pedir con otros comandos los datos que ya trae el pack.

## Cómo responder
Para «qué pasó hoy en el mercado» o sectores: reutilizar contexto y datos; si falta cobertura de acciones/sectores,
`galecore get macro.board --out .scratch/mercado.json --keep "<pedido>"` una vez. Leer localmente filas de liderazgo
en `tabs/sections/groups/rows`, sin `spark` ni JSON completo al contexto. Mirar `changeDay`, `changeUnit`, `asOf` y
`source` por fila, sin duplicar símbolos; el orden de grupos/resumen puede ser mensual, no es ranking del día.
Fecha global es generación; no usar otra rueda como hoy. Conservar significado y período de cifras del contexto:
variación de cinco ruedas no es distancia al máximo ni variación diaria. Síntesis y cifras destacadas con fuente y
fecha en texto (GaleCore y origen por fila). `--keep` conserva la evidencia canónica; no copiar JSON a Archivos ni
crear informes o enlaces a evidencia cruda para un resumen puntual. Cobertura parcial: no es todo el mercado y
`missing=[]` no prueba cobertura completa. Causas/resultados sólo con evidencia adicional
pertinente de GaleCore; agenda prevista no acredita publicación de resultados. Si no hay evidencia, causa/publicación
sin verificar. Sin repetir consultas por símbolo ni inferir calma general de ETFs.
No convertir `valueAddedMonth` en contribución al índice sin pesos/composición ni SKEW en precio relativo de puts/calls.
Antes de enviar, comprobar fuente/fecha y que cada conclusión conserve el significado de sus datos; omitir lo no acreditado.
Una consulta abierta no exige aclaración si contexto resuelve fecha/mercado; si falta una precisión material, preguntar.
Para historia profunda, `story pack --symbol SPY` una vez (~2 min), revisión anterior si se compara y pasos de la skill:
historia, pilares, cambio y rival. El resumen breve no exige pack, opciones ni investigación guardada. Las corridas
programadas mantienen el pack del runner. Cada número cita el pack u otra respuesta conservada. Nada de consejos de operar.
