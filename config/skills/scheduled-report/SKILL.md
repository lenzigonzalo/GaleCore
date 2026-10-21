---
name: scheduled-report
version: 1.0.0
display_name: Reporte programado
description: >
  Un reporte que el owner define con sus palabras (qué leer de GaleCore, qué decir, contra qué comparar la corrida
  anterior), corrido por un agente programado (p. ej. cada día hábil antes de la apertura) o a pedido. Cada corrida lee
  GaleCore, escribe el reporte y lo guarda como revisión de una investigación por reporte, diciendo qué cambió. Sólo
  lectura: describe, nunca dice que opere ni pone órdenes. Para buscar candidatos con condiciones, market-watch.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«Cada mañana decime cómo está el gamma de SPY», «Un resumen de volatilidad antes de la apertura», o la corrida de un
agente de reporte: el objetivo del agente ES el método.

## Qué necesita
- El objetivo de la tarea, leído al pie de la letra.
- `profile show` (citar la versión); `kb search --kind research --text "<slug del reporte>"` y la revisión anterior.
- Sólo GaleCore, lo más barato primero: `galecore list` una vez; `galecore get compute.gex_analysis --symbol <SYM>`,
  `galecore get market_data.volatility_metrics --symbol <SYM>`, `galecore get calendar.macro_releases --param
  From=<hoy> --param To=<hasta>` según pida el objetivo. Una cadena pesa ~1 MB: siempre `--out
  <dir>/<SYM>-chain.json`.

## Pasos
1. Leer el objetivo literal; no agregar secciones propias. Lo que no se puede leer con los datos disponibles va como
   «sin evaluar» (en `missing`), nunca supuesto.
2. Traer los datos. Antes de la apertura una cotización puede no tener precio vivo: usar el último cierre y decirlo con
   su fecha; la fecha de un dato es la suya, nunca la hora de la consulta.
3. Todo número sale de una respuesta guardada como evidencia (`evidence add --slug <fuente-serie>`, citada
   `evidence:@<slug>`) con su `retrieved_at`. Una cuenta propia (distancia al spot) es interpretación con sus insumos.
   Un dato viejo o faltante se declara, nunca se estima.
4. Escribir: veredicto en una línea, tabla de 6 filas como máximo y qué cambió desde la corrida anterior. Si el
   objetivo pide un veredicto de abrir u operar, se da como lectura de las condiciones del owner, nunca como orden:
   «con los datos de hoy se cumplen / no se cumplen estas condiciones de tu perfil» y cuáles. Toda afirmación de hecho
   (también en el veredicto) cita al menos una evidencia.
5. Estado: OK si se leyó todo lo pedido; INCOMPLETE si algo no se pudo obtener (qué, en `reason` y `missing`). Un tope
   del perfil que sólo aplica a una posición concreta (riesgo por operación, ancho, crédito) se nombra «no aplica sin
   una estructura concreta», no como faltante, y no vuelve INCOMPLETE la corrida. Un dato macro que GaleCore todavía no
   tiene va con su fecha y hora, no como faltante. Corrida corta: la tarea tiene tope de turnos.
6. Guardar con `research save|revise --capability scheduled_report`.

## Qué entrega
Ejemplo de forma:

Gamma de SPY positivo y el spot 1,2 % arriba de gamma cero (cierre del viernes 17/10); sin cambio de régimen.

| Dato | Hoy | Corrida anterior | Fuente |
|---|---|---|---|
| Régimen GEX | (evidence) | (revisión anterior) | compute.gex_analysis |
| Gamma cero | | | |
| Call / put wall | | | |

## Errores a evitar
- Agregar secciones que el objetivo no pidió.
- Presentar el último cierre como precio de ahora, o usar la hora de la consulta como fecha del dato.
- Consejos dirigidos al lector («comprá», «vendé», «conviene», «abrí», «no abras», «deberías»).
- Marcar INCOMPLETE por un tope que no aplica sin una estructura concreta.

## Cómo responder
Datos sólo de GaleCore (`galecore get`), cada uno guardado como evidencia.
Veredicto en una línea, tabla de hasta 6 filas con los números y su fecha, y qué cambió desde la corrida anterior. Si
pide un veredicto de operar, como lectura de sus condiciones, nunca como orden.
