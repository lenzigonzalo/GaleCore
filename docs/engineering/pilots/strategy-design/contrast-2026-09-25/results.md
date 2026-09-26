# Contraste con y sin instrucción — resultados (25/09/2026)

Protocolo: [protocol.md](protocol.md), commiteado en `69848fa` antes de lanzar las corridas. Evidencia
preliminar: 2 casos × 2 condiciones × 1 corrida. No prueba robustez general.

## Condiciones reales

| Corrida | Condición | Salida (sin corregir) | Tokens del subagente | Herramientas | Duración | Web (autodeclarado) |
|---|---|---|---|---|---|---|
| spy-A | sin instrucción | [raw/spy-A.md](raw/spy-A.md) (4.231 palabras) | 193.990 | 31 | 7,0 min | 8 de 15 |
| spy-B | con v0.2.0-draft | [raw/spy-B.md](raw/spy-B.md) (5.951) | 188.867 | 39 | 9,8 min | 12 de 15 |
| gold-A | sin instrucción | [raw/gold-A.md](raw/gold-A.md) (3.799) | 113.423 | 30 | 6,8 min | 14 de 15 (3 lecturas fallidas) |
| gold-B | con v0.2.0-draft | [raw/gold-B.md](raw/gold-B.md) (4.948) | 121.884 | 29 | 10,0 min | 13 de 15 (2 cortadas) |

Tokens, herramientas y duración: los reporta el harness al terminar cada subagente. Las cuatro: subagente
`general-purpose`, parámetro `model: opus`, lanzadas en paralelo el 25/09 ~21:00 (UTC−3), prompts idénticos
salvo la línea de la instrucción (ver protocolo).

**Evaluador:** Codex CLI 0.154.0, `gpt-5.6-sol`, esfuerzo alto, sandbox `read-only`, cwd en la carpeta del
paquete ciego, 113.547 tokens. Prompt: [blind/EVALUATOR_PROMPT.md](blind/EVALUATOR_PROMPT.md). Salida completa
sin editar: [eval-codex.md](eval-codex.md). El evaluador consultó además fuentes web (AQR, CME, GLD): el sandbox
de sólo lectura no le impidió la red.

**Desvelado:** `label_map.json` (sha256 `001dae28…74858a`, igual al sellado en el protocolo):
SPY: X = A (sin), Y = B (con). Oro: X = B (con), Y = A (sin).

## Puntajes del evaluador ciego (desvelados)

| Caso | Condición | D1 | D2 | D3 | D4 | D5 | D6 | D7 | Suma | Errores materiales (alta/media/baja) | Preferida |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SPY | A sin | 4 | 2 | 5 | 5 | 5 | 4 | 3 | 28 | 1 / 2 / 0 | |
| SPY | B con | 5 | 2 | 5 | 5 | 5 | 4 | 4 | 30 | 1 / 2 / 0 | **B** (margen moderado) |
| Oro | A sin | 2 | 2 | 4 | 5 | 4 | 5 | 2 | 24 | 2 / 2 / 1 | |
| Oro | B con | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 34 | 0 / 0 / 1 | **B** (claramente) |

Errores de alta severidad según el evaluador:
- **spy-A:** la "ventana virgen 2005–2012" calibra la tabla POP con 2013–2017 y la aplica hacia atrás
  (información futura en la etapa que debía ser independiente).
- **spy-B:** el benchmark principal "SPY+T-bill de igual riesgo" iguala sólo la delta media, no la cola.
- **gold-A:** prueba GLD (oro físico) en lugar de los retornos realizables de GC con sus rolls, y juzga
  "ganarle a mantener oro" por Sharpe, lo que puede aprobar menos retorno. Cambia la pregunta del owner.

**Ciego:** no funcionó en la práctica. El evaluador adivinó las dos condiciones con confianza alta por la
estructura (mandato, cobertura, pendientes con responsable). La redacción literal también dejó rastros
(`[REF]` sólo en las salidas B; en gold-B el texto decía "con la instrucción piloto", corregido antes de la
evaluación ampliando la redacción; ver `blind.py`). Pudo haber sesgo a favor del formato estructurado.

## Análisis secundario (no ciego, del implementer; sesgado a favor de B en SPY)

¿Aparecen en las salidas SPY los problemas que el owner marcó en la primera entrega?

| Problema | spy-A (sin) | spy-B (con) |
|---|---|---|
| Venta de puts ≠ put spread | Evitado: "apoya H-A en general, pero para puts ATM a un mes sin ala comprada" | Evitado, y cita BT-13b (la pata comprada) |
| Insumos no disponibles en 2008 | Parcial: propone 2005–2012, advierte VIX9D/VIX3M incompletos y usa "proxy declarado"; no lo llama variante; además el error de POP de arriba | No propone 2008; lo trata por escenarios de estrés; insumos a t−1 o "variante con nombre" |
| Carteras comparables | Parcial: totales, maxDD, CVaR y regresión contra SPY; sin misma remuneración del efectivo explícita | Sí: MTM diario, mismo calendario, capital y remuneración del efectivo |
| SHADOW ≠ fills | Parcial: mide "costo efectivo" en SHADOW/paper sin separar niveles | Separa niveles en §6, pero la síntesis dice que la etapa prospectiva sirve "para medir fills reales": **contradicción interna** |
| Estadística ≠ restricciones | Mezclados en un mismo criterio de descarte (que igual descarta ante violación) | Separados, con orden excluyente |
| Cociente pérdida/renta mal construido | No cometido | No cometido; cálculo de muestra marcado ilustrativo |
| Tasa de efectivo con información futura | No especifica serie ni fecha | "Serie mensual: usar el mes anterior" |
| Método estadístico delegado | Recomienda (bloques de 45 días, Sharpe deflactado); propone un umbral económico por defecto para discutir | Recomienda (bootstrap estacionario ~1 mes, nivel 90 %); deja riesgo y utilidad mínima al owner |

spy-B repite además la frase ambigua de BT-13b ("~87 % de la prima bruta"), que en realidad es 87 % del
resultado de la venta del put sola (ver E22 de la propuesta corregida). La cita de BT-13b en spy-B llevó a
corregir una omisión de la propuesta del implementer (E22).

## Lectura

**A favor de la instrucción:**
- En el caso nuevo (oro), el único que v0.2 no conocía, B fue claramente mejor (34 vs 24) y sin errores de
  severidad alta o media. La diferencia principal es la que la instrucción pide explícitamente: A sustituyó
  el instrumento (GLD por GC) y la métrica (Sharpe por exceso de retorno) sin tratarlo como variante; B
  conservó GC, comparó por diferencias de retorno contra las dos alternativas en el mismo calendario y
  recomendó el método sin delegarlo.
- En SPY, B quedó levemente mejor (30 vs 28) y evitó la mayoría de los problemas marcados por el owner; pero
  ese caso está contaminado.
- Sin costo visible de claridad: D6 empató en ambos casos, aunque B escribe ~30–40 % más.

**En contra o sin efecto:**
- En SPY los errores materiales fueron iguales en cantidad y severidad (D2 = 2 en ambos), aun con una
  instrucción escrita a partir de ese mismo caso. La instrucción no evitó un benchmark de "igual riesgo"
  mal construido ni una contradicción interna sobre fills que ella misma prohíbe.
- spy-A, sin instrucción, ya separó venta de puts y spread y recomendó método: parte de lo que se atribuía a
  la instrucción lo hace el host solo.
- B tardó más (9,8–10,0 min vs 6,8–7,0) con consumo de tokens similar.

**Qué no se puede concluir:** n = 1 por celda; evaluador único y no ciego en la práctica; un solo modelo. Es un
indicio a favor en generalización (oro), no un efecto medido.

## Desviaciones del protocolo y limitaciones

- **Redacción ampliada** después de ver las salidas y antes de la evaluación (la literal no cubría una frase
  de gold-B). No cambió puntajes porque se hizo antes de evaluar, pero es una intervención post-salida.
- **Aislamiento no verificable:** las exclusiones de archivos se pidieron por instrucción; el cumplimiento es
  autodeclarado (spy-A y gold-A lo declaran; spy-B y gold-B listan sus lecturas y ninguna ruta excluida).
  No se auditaron las transcripciones completas.
- **Contexto inyectado por el harness** (CLAUDE.md del workspace, skills de GaleCore visibles) igual para las
  cuatro; no se controló.
- **Esfuerzo:** no configurable por corrida; se asume el mismo por usar el mismo tipo de agente y modelo.
- **Presupuesto:** límite de consultas web por instrucción; tokens y tiempo no se limitaron.
- **Sin ronda de mejoras:** el esfuerzo de revisión se estima por los errores materiales encontrados; no se
  midió cuánto cuesta corregirlos.
- El evaluador usó la web aunque el sandbox era de sólo lectura; sus verificaciones externas no se re-verificaron.

## Corrección de foco del owner (25/09, después del contraste): datos de GaleCore — no probado

El piloto busca que el host **obtenga datos de GaleCore** y construya su análisis sobre ellos. En este
contraste **ninguna corrida consultó datos de GaleCore**: no hubo llamadas a la API DataFeed (`/Data/*`,
`/App/*`), al MCP ni al runtime SHADOW, y no hay solicitudes ni respuestas para conservar. Lo que hubo
(según los registros autodeclarados de cada salida):

| Corrida | Consultas locales | Datos obtenidos de GaleCore usados en conclusiones |
|---|---|---|
| spy-A | lectura de documentos de RPF y del JSON de reglas; listado de `GaleCore/research/data/` | ninguno |
| spy-B | ídem, más esquema y rango de parquets de `research/data/`; CLI de GaleCore-AI `catalog` y `kb search` (sólo registros de régimen, sin datos de mercado) | ninguno |
| gold-A | primeras/últimas filas de `research/data/tbill_3m_monthly.csv` | ninguno (GaleCore no tiene futuros ni oro) |
| gold-B | CLI `catalog` y dos `kb search` (sin resultados pertinentes) | ninguno |

Leer documentación, archivos de research o la web no equivale a obtener datos de GaleCore. **El recorrido
"consultar GaleCore → interpretar lo obtenido" sigue sin probar**; este contraste sólo informa sobre
investigación documental y diseño de la prueba. El siguiente contraste usa GaleCore local como fuente, sin web.
