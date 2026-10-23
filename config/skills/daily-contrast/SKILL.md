---
name: daily-contrast
version: 2.0.0
display_name: Contraste diario de estrategias con la historia del mercado
description: >
  Lee la historia del mercado de hoy contra cada estrategia y la cartera y propone, por estrategia, si prenderla,
  mantenerla, esperar o apagarla en SHADOW, con el motivo, el riesgo contra los topes y qué cambiaría la propuesta,
  más ideas nuevas para probar. Los datos salen de `contrast pack` (código); el modelo sólo interpreta. Sólo propone:
  el owner decide y actúa. Para la historia sola, market-story; para lo que pide atención hoy, daily-attention.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Prendo, mantengo o apago alguna estrategia con lo que está pasando?», «¿La historia de hoy le sirve a mis
estrategias?», «¿Qué ideas vale la pena probar con este mercado?».

## Qué necesita
- `state` primero: lo que se dice del runtime (entradas prendidas o pausadas, instancias, posiciones abiertas,
  estructuras que ejecuta) y de los datos (conexión, frescura, cobertura) sale de esa lectura y su hora. Un contraste o
  seguimiento guardado es antecedente, nunca el estado; lo que `state` no leyó está «sin verificar».
- `contrast pack [--symbol SPY]`. Si falta la historia, correr market-story antes; si está vieja, decirlo arriba.
- `capital` para el riesgo contra los topes (si no responde, es faltante).

## Pasos
1. Por estrategia: comparar la historia (sus afirmaciones) con dónde trabaja la estrategia (las entradas `story` de su
   proyecto, su hipótesis y condiciones de falla), con su último seguimiento y con lo que mueve el símbolo (`drivers`
   del pack: datos que vienen dentro de su plazo, qué paga hoy la IV por ellos contra lo que movieron los últimos de
   ese tipo, y la reacción por tipo; citar su evidencia).
2. Proponer exactamente una de prender | mantener | esperar | apagar | sin datos, como `interpretation` (nunca
   `decision`: decide el owner), con la forma «<nombre>: <propuesta> — <motivo> … qué la cambiaría: <dato y umbral>»,
   citando la historia (research:) y la estrategia (strategy:). El guardado rechaza una propuesta sin «qué la
   cambiaría:».
   - «esperar» = sin entradas nuevas hasta un evento o dato nombrado; decir cuándo se vuelve a mirar. Esperar es una
     respuesta válida.
   - «qué la cambiaría» nombra algo observable (resultado de un dato contra el movimiento implícito, un nivel, una
     correlación que se da vuelta, un resultado de seguimiento), nunca una sensación.
   - Si la estrategia no dice en qué historia trabaja: «sin datos» (igual con qué la cambiaría: que el owner lo diga).
3. Cartera: chequear la propuesta contra los límites del diseño de cada estrategia y lo que el trader tiene en Memoria.
4. Ideas: si la historia favorece una estructura que GaleCore no puede correr en SHADOW (las que corre son
   `estructuras_ejecutables` de `state`), decirlo como idea con lo que necesitaría; nunca diseñarla acá
   (strategy-design lo hace).
5. Guardar una investigación por serie diaria: `research save --capability daily_contrast --slug contraste-diario` la
   primera vez, después `research revise --capability daily_contrast --id <id> --reason continuation --note "<qué
   cambia>"`. Antecedentes: la historia y cada estrategia.
6. Cuando el owner decide, registrarlo: `project add <nombre> --kind decision --text "<sus palabras>" --prompt
   "<pedido>"`. Nunca desplegar, pausar ni cambiar nada acá.

## Qué entrega
Ejemplo de forma:

| Estrategia (SHADOW) | Propuesta | Motivo | Riesgo contra topes | Qué la cambiaría |
|---|---|---|---|---|
| spy_prima_varianza_30_45d | esperar | el CPI del jueves paga poco contra lo que movieron los últimos | (de `capital`) | CPI dentro del movimiento implícito |

Después, las ideas nuevas con lo que necesitarían.

## Errores a evitar
- Hablar del runtime o de los datos desde un contraste guardado en vez de `state`.
- Una propuesta sin «qué la cambiaría:» o con algo no observable.
- Registrar la propuesta como `decision`.
- Diseñar una estrategia nueva acá, o desplegar, pausar o cambiar algo.

## Cómo responder
Primero `state` y `contrast pack`.
Tabla corta primero (estrategia · propuesta · motivo · riesgo contra topes · qué la cambiaría), después las ideas. Es
una propuesta: decide el owner. «Esperar» es una respuesta válida.
