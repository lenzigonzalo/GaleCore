---
name: capital-risk
version: 2.0.0
display_name: Riesgo y capital
description: >
  Capital disponible u ocioso, concentración contra los límites del perfil y cómo repartir un monto («tengo X USD»).
  No para elegir una estrategia nueva (strategy-design) ni para ver cómo le fue a una (performance-review).
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Qué capital tengo disponible?», «¿Estoy concentrado?», «¿Varias posiciones chicas son una sola apuesta?»,
«Tengo 5.000 USD, ¿qué hago?», «¿Qué estrategias entran con X USD?».

## Qué necesita
- `capital` (con `--amount <USD>` si el owner nombra un monto; `--strategy <nombre>` para repartir entre algunas).
- `profile show`: los topes son los % del perfil sobre el valor real de la cuenta.
- Si `capital` devuelve `MISSING_LIMITS`: decir qué límite falta y ofrecer `profile review`. Nunca inventarlo.

## Pasos
1. Correr `capital`. Todo número sale de su salida: no recalcular, reescalar ni redondear.
2. Disponible: capital, en riesgo, ocioso, reserva, riesgo nuevo que entra.
3. Concentración: cada apuesta (mismo subyacente, dirección y semana de vencimiento) con su riesgo y % del riesgo
   abierto permitido; decir claro si varias posiciones son una sola apuesta o si todo está en un subyacente.
4. «Tengo X USD»: reserva, riesgo por operación, riesgo abierto máximo, tope por apuesta, tabla por estrategia
   (contratos, riesgo, qué la limita) y escalera de entradas; lo que queda en efectivo. Cada número con el límite
   del que sale.
5. «¿Qué entra con X?»: además de las estrategias simuladas, tabla de estructuras de riesgo definido de la cadena de
   hoy (ancho, crédito, pérdida máxima contra el tope), separando «no entra por tamaño» de «no evaluado».
6. Cerrar con `faltantes` y `reparto.supuestos`, una línea cada uno.

## Qué entrega
Conclusión en una línea → tabla → faltantes. Ejemplo de forma (los números salen siempre de `capital`):

Con 5.000 USD el tope que manda es el riesgo por operación: 250 USD por spread.

| Concepto | USD | Límite del perfil |
|---|---|---|
| Reserva | 500 | 10 % |
| Riesgo por operación | 250 | 5 % |
| Riesgo abierto máximo | 750 | 15 % |
| Tope por apuesta | 225 | 30 % del riesgo abierto |

## Errores a evitar
- Presentarlo como orden o decisión del owner (siempre `reparto.aviso`).
- Pedir permiso para buscar estructuras cuando preguntan qué entra: es lo pedido (batería 17/10, GC09).
- Mezclar SHADOW y cuenta real en un mismo número.

## Cómo responder
Primero `capital` (`--amount <USD>` si nombra un monto).
Tablas primero, montos de `capital` tal como vienen. Veredicto en una frase (alcanza / no alcanza / qué sobra) y el
tope que manda. «¿Qué entra con X?»: también estructuras de riesgo definido de la cadena de hoy. Nunca como orden.
