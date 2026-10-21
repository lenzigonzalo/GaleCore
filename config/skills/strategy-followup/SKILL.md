---
name: strategy-followup
version: 1.0.0
display_name: Seguimiento de una estrategia
description: >
  Responde «¿qué hizo esta estrategia desde la última revisión, por qué entró o no, cómo evolucionaron sus posiciones
  y qué cambia en nuestra hipótesis?» con los datos del runtime de GaleCore, atado a la versión aprobada, y lo guarda
  como revisión de la investigación de la estrategia. Para qué mirar hoy en toda la cartera SHADOW, daily-attention;
  para rendimiento y edge, performance-review.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Qué hizo la estrategia de SPY desde la última vez?», «¿Por qué no entró?», «¿Cómo vienen sus posiciones?», «¿Cambia
algo en la hipótesis?». También la corre el agente programado de seguimiento de esa estrategia.

## Qué necesita
- `profile show`: capital de referencia y topes para dimensionar lo que se informa (lo `provisional` se marca así).
  Al guardar, citar `profile:v<N>` (si no, se rechaza).
- `kb search --kind strategy` y `kb show strategy:<ref>` (hash de la spec, aprobación); la última revisión de su
  investigación («la última revisión»).
- `followup run --strategy <nombre> --prompt "<pedido>" --host-model <modelo>`: lee GaleCore Dev por su API, guarda la
  salida textual como evidencia, evalúa la versión aprobada (o la última, marcada como no aprobada) y escribe un
  registro con hash: operación, resultados SHADOW, evidencia de la hipótesis, otras versiones (nunca mezcladas) y
  puntos de atención.

## Pasos
1. Encontrar la estrategia, su versión aprobada y la última revisión.
2. Correr `followup run` y presentar ese registro, sin rederivar números. Si GaleCore no respondió, el registro lo
   dice: es el primer punto de atención.
3. Separar y rotular tres cosas:
   - **Funcionamiento operativo:** evaluaciones corridas, bloqueos y sus motivos (NO_DATA, cotización vieja, fuera de
     horario), errores; si el runtime hizo lo que dicen las reglas.
   - **Resultados SHADOW:** entradas, descartes y por qué, posiciones, valuaciones, salidas y resultado simulado. Los
     fills de SHADOW son simulados al medio con cotizaciones reales: nunca «ejecuciones».
   - **Evidencia económica:** qué puede y qué no puede decir esta muestra contra el plan de evaluación (cerradas contra
     la muestra que pide el plan). Pocas operaciones no son evidencia de edge.
4. Qué cambia en la hipótesis: sólo lo que sostienen los datos; si nada, decir que no cambia y por qué. Registrarlo
   con `research revise --capability strategy_followup --reason result`.
5. Si sirvió y el owner lo va a querer de nuevo, ofrecer programarlo como agente; no crearlo sin su pedido.

## Qué entrega
Ejemplo de forma:

Desde el lunes la estrategia (SHADOW) no entró: 4 evaluaciones bloqueadas por cotización vieja; la hipótesis no cambia.

| Bloque | Qué pasó | Fuente |
|---|---|---|
| Funcionamiento operativo | 4 evaluaciones, 4 bloqueos (STALE_QUOTE) | followup:<id> |
| Resultados SHADOW | 2 abiertas, sin cierres | followup:<id> |
| Evidencia económica | 9 de 30 cerradas que pide el plan | plan de evaluación |

## Errores a evitar
- Rederivar los números del registro o llamar «ejecución» a un fill simulado.
- Mezclar otras versiones con la aprobada.
- Concluir edge con pocas cerradas.
- Crear un seguimiento programado sin que el owner lo pida.

## Cómo responder
Primero `followup run --strategy <nombre>`.
Conclusión en una línea (qué hizo y si cambia la hipótesis), después una tabla con los tres bloques (operativo,
resultados SHADOW, evidencia económica) y la fuente de cada uno. Simulado se dice SHADOW.
