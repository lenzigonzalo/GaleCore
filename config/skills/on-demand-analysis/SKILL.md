---
name: on-demand-analysis
version: 1.0.0
display_name: Análisis a pedido — macro, técnico, fundamental y flow
description: >
  Responde «explicame la macro», «análisis técnico de QQQ», «analizame NVDA», «el flow de SPY» o «¿qué es el skew?»
  con los datos de GaleCore. Juntar es código (`analyze pack`); interpretar es el modelo: qué se observa, qué implican
  los precios, la hipótesis, la alternativa y qué la invalidaría. Sólo lectura. Para «qué mueve hoy a <símbolo>»,
  market-story; para una idea que hay que probar, research.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«Explicame la macro», «¿Cómo están las tasas largas, los breakevens y el empleo?», «Análisis técnico de QQQ», «El flow
de opciones de SPY», «Analizame NVDA», «¿Cambió algo en <empresa>?», «¿Qué es el skew y por qué me importa?».

## Qué necesita
- `analyze pack --kind macro|technical|fundamental|flow [--symbol SYM] --prompt "<pedido>"`, una vez; citar el ref
  que imprime.
- `profile show` (citar la versión vigente).
- `kb search --kind research --text "análisis <kind> <símbolo>"`: si hay un análisis anterior, decir qué cambió (el
  `previous` del pack).
- Otro dato de GaleCore, citable: `galecore get <capacidad> --keep "<pedido>"` (devuelve `evidence:<id>`).
- Lo que GaleCore no sirve (consenso, estimaciones de analistas, flow por participante, historia o percentil): una
  línea y `gap add`.

## Pasos
1. Elegir el tipo por el pedido: macro (tasas, inflación, empleo, crédito), técnico (tendencia, niveles,
   volatilidad de un símbolo), fundamental (una empresa: estados, crecimiento, valuación, presentaciones) o flow
   (opciones: GEX, walls, skew, estructura de IV).
2. **Pregunta de concepto** («¿qué es X?», «¿qué pasó en…?»): se explica, no se analiza ni se guarda. Un párrafo
   corto en palabras simples (sin fórmula salvo que la pida), una línea de por qué le importa a sus estrategias
   (`profile show` / `state`), el valor actual del pack con su fecha (tabla sólo con 3 datos o más) y un veredicto de
   una frase sobre si importa hoy. Unas 150 palabras fuera de la tabla.
3. Todo número sale del pack y cita su ref, copiado tal cual. Cada dato con su tipo (`kinds_of_datum`): hecho (valor
   publicado con fecha), cálculo (variación, promedio, volatilidad realizada, crecimiento, P/E: nombrar insumos),
   estimación (IV, GEX, posicionamiento desde OI) e hipótesis propia. Un valor `preliminary` o `derived` lo dice;
   `months_without_value` es un hueco, nunca se rellena.
4. Por tipo (cada hecho seguido de su interpretación):
   - **Macro:** tasas 3m, 2a, 10a y curva (2s10s, 3m10y); tasa real 10a contra breakevens (cuál movió la nominal);
     spreads HY e IG; fed funds; CPI general y núcleo (m/m, 3 meses anualizado, a/a); desempleo y nóminas (promedio de
     3 meses). Después la cadena de transmisión en una frase: «cambio → canal → variable intermedia → efecto → qué la
     refutaría», con horizonte. El consenso falta: nunca se dice el tamaño de una sorpresa.
   - **Técnico:** tendencia contra promedios de 20/50/200 ruedas, distancia a máximos y mínimos, variaciones,
     volatilidad realizada contra IV (a quién le pagan). Un nivel es donde estuvo el precio, no un soporte que aguanta.
   - **Fundamental:** crecimiento de los últimos 4 trimestres contra los 4 anteriores (`last_4_change`) junto al
     último trimestre contra un año atrás (`quarter_yoy`); una `category` (de pérdida a ganancia, reduce o profundiza
     una pérdida) se dice así, nunca como porcentaje; un trimestre derivado lo dice. `quality`: márgenes y su cambio
     en puntos, flujo libre y su margen, capex sobre ingresos, conversión de caja, compensación en acciones, dilución
     y deuda neta (con fórmula); una nota `coverage` es evaluación incompleta, nunca aprobada. `valuation`: P/E al
     último cierre, su propio rango (`pe_history`) y la parte del resultado antes de impuestos que no es operativa
     (`non_operating_share_pct`). Una brecha entre dos líneas (EPS que crece más que el resultado operativo) es una
     pregunta a descomponer, no una conclusión. Próximo balance (`next_earnings`), último 8-K 2.02, beta y correlación
     con SPY.
   - **Flow:** régimen de GEX y spot contra gamma cero, call y put walls, skew de puts 25-delta contra su umbral,
     estructura y rank de IV. Qué implican para las próximas ruedas y qué no (flow por participante falta).
   - **«¿Cambió algo en <empresa>?»:** `filings.sec_filings`; cada 8-K reciente por su ítem: 2.02 resultados · 5.02
     directivos · 1.01 acuerdo importante · 2.03 deuda nueva · 5.07 votación · 8.01 otros. Form 4 = compra o venta de
     directivos; 13D/G = accionistas con más del 5 %. Con fecha y enlace; prensa = faltante.
5. `hypothesis`: la lectura en una o dos frases. Entre los `statements`, la lectura alternativa (empieza con
   «Alternativa:») y qué la invalidaría («Invalidación:», algo observable con su umbral). `test_plan`: la próxima
   observación que decide entre ambas. `missing`: lo que el pack declaró faltante y lo que la lectura necesitaría.
6. Guardar una investigación por tipo y símbolo: `research save --capability on_demand_analysis --slug
   analisis-<kind>-<símbolo> --prompt "<pedido>" < {content, host_provider, host_model}`; si ya existe, `research
   revise --capability on_demand_analysis --id <id> --reason continuation --note "<qué cambia>" ...`.

## Qué entrega
Tabla corta primero (3 datos o más), después 2-3 líneas que agregan una decisión o un límite. Ejemplo de forma:

Tasas: la curva sigue invertida en el tramo corto; lo que movió la 10a fue la tasa real, no los breakevens.

| Dato | Valor | Fecha | Tipo |
|---|---|---|---|
| 10 años | (del pack) | (fecha) | hecho |
| 2s10s | (del pack) | (fecha) | cálculo |
| Breakeven 10a | (del pack) | (fecha) | hecho |

Alternativa: … · Invalidación: … · Falta: consenso (sin fuente).

## Errores a evitar
- Aconsejar («comprá», «vendé», «conviene»): es lectura, no recomendación.
- Repetir en el texto lo que ya dicen las celdas.
- Tratar el P/E como medida universal: la valuación depende del modelo de negocio (owner 19/10).
- Guardar una pregunta de concepto como investigación.
- Decir el tamaño de una sorpresa sin consenso.

## Cómo responder
Primero `analyze pack --kind macro|technical|fundamental|flow [--symbol SYM]`, una vez: trae los datos y su tipo (concepto: el pack del símbolo, sin guardar).
Concepto («¿qué es X?»): sin veredicto ni opciones; qué es en palabras simples y el dato actual fechado sólo si
responde lo que preguntó. Análisis: tabla corta primero (3+ datos), después 2-3 líneas que agregan una decisión o un
límite, sin repetir celdas. Cada número del pack con su fecha. Lo que GaleCore no sirve: una línea y `gap add`.
«¿Cambió algo en <empresa>?»: 8-K por ítem, Form 4 y 13D/G, con fecha y enlace; prensa = faltante.
