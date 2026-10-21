---
name: daily-attention
version: 1.0.0
display_name: Qué merece mi atención hoy sobre lo que tengo en SHADOW
description: >
  Responde «¿qué merece mi atención hoy sobre lo que tengo en SHADOW?»: exposición simulada contra los topes de
  referencia del perfil, qué dicen las reglas de la estrategia aprobada, qué cambió desde la última revisión, qué
  eventos (datos macro, FOMC, balances, subastas) caen antes del vencimiento o la salida de cada posición, el contexto
  de mercado y qué falta. Se guarda como revisión de una investigación de atención diaria por estrategia. Sólo
  lectura: ni órdenes ni cambios de asignación. Para la cuenta real, capital-risk; para cómo le fue a una estrategia,
  performance-review.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Qué merece mi atención hoy?», «¿Qué cambió y me afecta?», «¿Cómo está la exposición y qué dicen las reglas sobre lo
abierto?», «¿Qué evento macro viene y cómo afecta mis posiciones?». También la corre el agente programado de atención
diaria, con este mismo método.

Una **pregunta puntual** («¿qué hago con SPY antes del CPI?», «¿cierro, roleo o dejo antes del FOMC?») no es la
revisión diaria: ir directo al paso 10.

## Qué necesita
- `profile show`: capital de referencia, topes (pérdida por operación y sumada), drawdown, horizonte, fuentes y
  formato. Lo que está en `provisional` es provisorio y toda comparación que dependa de eso se marca así. Citar
  `profile:v<N>` al guardar (si no, se rechaza).
- Estrategias: `kb search --kind strategy` y `kb show strategy:<nombre>/<versión>` de cada versión aprobada.
- Última revisión: `kb search --kind research --text "atencion diaria <estrategia>"` y `followup history --strategy
  <nombre>`.
- Hoy: `followup run --strategy <nombre> --prompt "<pedido>" --host-model <modelo>`.
- Contexto: `prepare --symbol SPY --skill regime` (GEX, skew 25Δ, VIX/VVIX; sólo lectura); si GaleCore no responde,
  el último registro de régimen fechado (`kb search --kind regime --symbol SPY`).
- Eventos: `galecore get calendar.macro_releases --param From=<hoy> --param To=<último vencimiento> --param
  ReleaseIds=50,10,46,53,54,9`, `galecore get calendar.fomc_meetings` (marcar las que tienen proyecciones),
  `galecore get calendar.treasury_auctions` (sólo notes y bonds de 2 años o más); balances desde los conectores que
  lista el registro. Cada respuesta con `evidence add` y citada como `evidence:<id>`.
- Si hace falta: `galecore get rates.treasury_curve`, `galecore get history.index_daily --param Index=VIX`,
  `sources query --need "<dato>"` antes de usar otra fuente.
- Falta por registro (se declara, nunca se estima): griegas de las posiciones SHADOW.

## Pasos
1. Perfil primero (arriba).
2. Qué hay en SHADOW y sus reglas, de la propuesta guardada de cada versión aprobada (hash, aprobación, reglas de
   entrada, seguimiento, ajuste, salida, invalidación). Nunca de memoria.
3. Última revisión: la última revisión de atención diaria o, la primera vez, el último seguimiento. Decir cuál y su
   fecha.
4. Hoy: `followup run`. Presentar sus números sin rederivarlos. Si GaleCore no respondió, ése es el primer punto y el
   resto va como «no actualizado».
5. Exposición, por posición y sumada, sólo con lo que trae el registro (posiciones, valuaciones, resultado simulado,
   riesgo máximo), incluidas las de versiones anteriores u otras specs (`other_versions`). Una spec que no se pudo
   leer es «no verificada», nunca cero; un valor ausente es `missing`, nunca tomado de otro día. Se llama
   «exposición SHADOW (simulada)»: no suma a la cartera real ni consume capital real. Los topes del perfil son la vara
   de referencia («supera el tope de referencia del perfil», no «tu apuesta pasa tu tope»). La cartera real va en
   una línea aparte, nunca sumada. La comparación con los topes es «Cálculo propio», citando el registro.
6. Reglas: por posición y por las evaluaciones de hoy, qué regla aplica ahora (salida, ajuste, invalidación, entrada
   bloqueada) y si el runtime hizo lo que dice. Las reglas que el runtime no ejecuta las vigila el owner: listarlas.
7. Qué cambió desde la última revisión: entradas, descartes y por qué, cierres, bloqueos (NO_DATA, cotización vieja,
   fuera de horario), cambios de versión o instancia, cambio de versión del perfil.
8. **Siempre, aunque nada más cambie: eventos contra posiciones.** Una fila por evento entre hoy y el último
   vencimiento: evento, fecha (con día de la semana), días desde hoy y, por posición, si cae antes del vencimiento,
   antes de la salida por tiempo (p. ej. 21 DTE) o después de ambos, con su evidencia. Después una línea por evento
   que cae dentro de la vida de una posición, en palabras del owner («hay un NFP en 3 días y tu PCS vence después»),
   leído a través de las reglas y la distancia al stop/objetivo, nunca como pronóstico. Fechas programadas pueden
   moverse: decirlo. Si el calendario no vino (502/404), la tabla lo dice y va a `missing`; nunca una tabla vacía
   como «sin eventos». Lo que ninguna fuente registrada cubre va a `missing`, nunca de memoria ni de la web.
9. Entregar y guardar. Primero un pantallazo (posiciones y estado, qué pasó, qué viene), después los puntos de
   atención en orden: lo que rompe una regla o un tope, lo que está cerca, eventos dentro de la vida de una posición,
   huecos de datos, contexto. Cada punto con su fuente. Guardar: la primera vez `research save --capability
   daily_attention --slug atencion-diaria-<estrategia>` (minúsculas con guiones), después `research revise
   --capability daily_attention --id <id> --reason continuation`; estado open, con próximos pasos, limitaciones y
   antecedentes (profile, strategy, la revisión anterior y toda evidencia usada). Si la quiere todos los días, se
   programa como agente; sin conectores de balances en esa corrida, los balances salen de evidencia guardada o van a
   `missing`.
10. **Pregunta puntual:** sin los pasos 1-9 y sin guardar. `supervise exposure --symbol <SYM> --event <texto>` (trae
    el evento de cada posición, su fecha y días hábiles; no pedir `calendar.*` para esa fecha) y `capital --strategy
    <nombre>`, montos tal cual. Veredicto primero (qué hacer y por qué, diciendo que es SHADOW), tabla de la posición
    contra el evento y el tope, y una alternativa por opción (cerrar todo o parte, rolear, dejar, esperar) con su
    número: lo que libera o deja bajo el tope y el peor caso. «Rolear» con número sólo si GaleCore lo sirve; si no,
    «no cuantificado», sin inventar crédito. Si la estrategia está frenada o los stops no se pueden verificar,
    decirlo antes del peor caso.

## Qué entrega
Ejemplo de forma:

Hoy: nada rompe una regla; el CPI del jueves cae dentro de las dos posiciones de SPY (SHADOW).

| Posición (SHADOW) | Vence | Salida por tiempo | Riesgo máx. | Estado |
|---|---|---|---|---|
| (del registro) | (fecha) | (fecha) | (USD) | dentro de reglas |

| Evento | Fecha | Días | Cae antes de… |
|---|---|---|---|
| CPI | jue 13/11 | 3 | vencimiento y salida por tiempo |

Después: qué cambió, huecos (griegas: no las sirve ninguna fuente) y próximos pasos.

## Errores a evitar
- Recortar un tope superado o un evento cercano (CPI, FOMC) para acortar.
- Llamar «tu exposición» o «tu apuesta» a lo simulado, o sumarlo a la cuenta real.
- Rellenar un valor faltante con el de otro día, o tomar una spec no leída como cero.
- Fechas sin día de la semana; eventos de memoria o de la web.
- Presentar una recomendación como decisión del owner: «la regla X dice…».

## Cómo responder
Revisión: `followup run --strategy <nombre>` y los calendarios (`calendar.macro_releases`, `calendar.fomc_meetings`); `catalog --match` trae los pasos.
Veredicto primero (qué hacer y por qué). Una tabla corta: posiciones contra topes y eventos dentro de su vida. Nunca
recortar un tope superado ni un evento cercano (CPI, FOMC); fechas con día de la semana. SHADOW y real separados y con
su nombre: lo simulado no es «tu exposición»; los topes del perfil son la vara de referencia, no un límite que la
simulación consuma. Pregunta puntual («¿qué hago antes del CPI?»): `supervise exposure` + `capital`, una alternativa
por opción con su número y el peor caso; no guardar.
