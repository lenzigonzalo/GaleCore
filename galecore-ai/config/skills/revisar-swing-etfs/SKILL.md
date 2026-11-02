---
name: revisar-swing-etfs
version: 1.0.0
display_name: Revisión de swing de ETFs
description: >
  Revisar candidatos manuales de swing en SPY, IEF y GLD con cierres completos, las reglas propuestas del proyecto y un
  cálculo determinista que corre como script con datos de GaleCore. Sólo lectura: no es para opciones, órdenes ni otra cartera.
output_contract: galecore_ai.contracts.research.ResearchContent
---
# Revisión de swing de ETFs

Versión 1.0.0. Método propio del proyecto swing_de_etfs, ahora como skill con carpeta (WS-0073). El trader autorizó guardar el método, no aprobó sus reglas para operar.

## Cuándo se usa
“Revisá los ETFs al mediodía”, “¿hay señal de swing?”, “hagamos la revisión semanal”. Trabajar desde el proyecto swing_de_etfs. Leer files/metodo-inicial.md, files/fuentes.json, el último informe y files/registro-senales.csv. Capital declarado 1.000 USD, tolerancias del trader 200/500 USD; conservar separados los límites propuestos de 10 USD de riesgo y 500 USD invertidos. Si difieren decisiones posteriores, no inventar una versión combinada.

## Qué necesita
Datos de GaleCore, que el script trae solo (velas 1d de SPY, IEF y GLD y quote). Aparte, con `galecore get`: calendar.macro_releases (From, To para próximos 30 días), calendar.fomc_meetings (Years) y market_data.volatility_metrics por ETF; consultas independientes en paralelo. No usar datos guardados como cotización actual. Los datos de hoy deben tener su propia fecha, no la de consulta. Si falta un dato, señalarlo y bloquear la entrada correspondiente.

## Pasos
1. Identificar la última rueda terminada con calendario NY; descartar la vela de la rueda en curso aunque el endpoint la entregue. Revisar cambios autorizados y señales/decisiones previas antes de preguntar.
2. Correr el cálculo: `python -B -m galecore_ai.adapters.cli skill run revisar-swing-etfs revision_swing.py --cutoff AAAA-MM-DD`, donde cutoff es la última rueda terminada, no necesariamente hoy. El script trae de GaleCore velas y cotización de SPY, IEF y GLD, no consulta otras APIs, no tiene secretos, no coloca órdenes e imprime JSON por stdout; el script se ejecuta, no se lee. Nunca hacer a mano medias, señales o vigilancia si no puede ejecutarse: declarar el impedimento (el resultado trae `ok`, `exit_code` y `stderr`).
3. Aplicar reglas de files/metodo-inicial.md. Tendencia, retroceso y confirmación son diferentes. Señal técnica confirmada requiere cierre mayor que los tres anteriores, recuperación de promedio50, tendencia y retroceso en cinco observaciones previas. Validar calidad de las últimas 220 ruedas contra fechas del universo, calendario, calidad de cotización, cantidad entera y costos antes de llamar ejecutable a algo. Si sólo hay dato viejo/sin fecha, puede existir evaluación técnica pero no entrada ejecutable.
4. Emitir como máximo tres fichas en total: ETF | evidencia y fecha | condición de entrada | invalidación | salida | riesgo | próxima acción. Marcar dentro de evidencia candidata, señal técnica activada o descartada. Nunca mostrar una candidata como señal activada. Si no hay entrada que cumpla todos los controles, empezar exactamente por “sin oportunidad” y explicar los motivos. Un dato faltante se distingue de una regla que no cumple.
5. Registrar cada evaluación en files/registro-senales.csv sin borrar descartes previos. Incluir fecha/hora, fecha y precio fuente, estado técnico, versión, decisión, entrada hipotética si existe (si no, vacío), cantidad, invalidación, salida y costos supuestos/reales separados, motivo, resultado y minutos. Preservar el registro original y agregar revisiones con su referencia. No rellenar ejecuciones ni convertir muestras históricas en operaciones simuladas.
6. Semanal: usar rutina de 45 minutos del método; no concluir ventaja por pocas señales, no cambiar umbrales por cada pérdida. Guardar conclusión y fuentes mediante research save/revise, esquema research, y reescribir memoria del tema/mapa. Datos GaleCore se citan por ref de --keep. No tocar otras estrategias, memoria del perfil ni activar SHADOW.
7. Conservar referencias y salidas antes de descartar temporales. Un agente programado puede correr el mismo script con `skill run`; set-scan no filtra tendencia/retroceso. Nunca prometer que un agente lo hará mediante instrucciones de texto.

## Qué entrega
Hasta tres fichas, descartes conservados y registro actualizado. Ejemplo de forma: SPY | candidata, vela 30/10/2026 | esperar cierre confirmado | nivel fijo sólo al activarse | 20 ruedas/invalidación | sin tamaño aprobado | esperar.

## Errores a evitar
Velas intradiarias usadas como cierre; corregir precios de GaleCore; señal sin tamaño; usar alerta como corte; suponer fracciones o llenado al medio; atribuir resultados de estudio de cierres a un backtest; costos supuestos como cargos reales; programar sin prueba y aprobaciones.

## Cómo responder
Primero correr el cálculo (trae solo velas y cotización); aparte, traer los calendarios y las métricas de volatilidad.
Empezar por sin oportunidad si ningún ETF cumple todos los controles.
Hasta tres fichas, separando candidata, señal y descarte.
Precio con fecha de fuente; quote sin hora se declara.
Riesgo planificado separado de pérdida extrema y tamaño.
Eventos, próxima acción y vigilancia efectiva explícitos.
Guardar investigación y registro sólo en el proyecto autorizado.
