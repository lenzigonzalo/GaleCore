# Contraste con y sin instrucción — protocolo y rúbrica (fijados antes de ejecutar)

GC-AI-0006, piloto de I4. Fecha: 2026-09-25. Este archivo se commitea **antes** de lanzar la primera
corrida; lo que diga el resultado no lo modifica (las desviaciones se registran en `results.md`).

## Pregunta

¿La instrucción `strategy-design` (v0.2.0-draft) mejora la primera propuesta del host frente al mismo host
sin la instrucción? Es evidencia preliminar: 2 casos × 2 condiciones × 1 corrida. No prueba robustez general.

## Condiciones

| | A — sin instrucción | B — con instrucción |
|---|---|---|
| Host | Subagente `general-purpose` de Claude Code, contexto nuevo | ídem |
| Modelo | `opus` (mismo parámetro para las 4 corridas) | ídem |
| Esfuerzo | el de la definición del agente (no configurable por corrida; igual para las 4) | ídem |
| Herramientas | las del agente `general-purpose` (idénticas) | ídem |
| Antecedentes | workspace GaleCore con las exclusiones de abajo; web pública | ídem |
| Presupuesto | hasta 15 consultas web (búsquedas + lecturas), una sola entrega | ídem |
| Única diferencia | — | una línea que pide aplicar `SKILL.md` + `coverage.md` (copia de v0.2.0-draft fuera del repo; sha256 LF: `dcabcf05…2f02dc` y `6d11dc95…68939a`) |

**Exclusiones para ambas** (el resultado resuelto o los hallazgos de revisión no deben llegar a ninguna
condición): `.worktrees/`, `roadmap/`, `decisiones/D-0004*`, `decisiones/D-0005*`,
`GaleCore-AI/docs/engineering/{work-items,reviews}/`, `SESSION_HANDOFF.md` y la memoria del asistente
(`~/.claude/projects/*/memory`). Se piden por instrucción; **no se pueden hacer cumplir técnicamente** y se
pide a cada corrida un registro de lo que leyó.

**Aislamiento:** cada corrida es un subagente distinto sin el historial de esta sesión. Lo que el harness
inyecte igual a todos (CLAUDE.md del workspace, memoria si la hubiera) no se controla; se declara.

## Inputs (idénticos en ambas condiciones)

**Caso SPY** (la idea del owner del 25/09, sin la lista de entregables del work item):

> Quiero investigar si vender prima mediante put credit spreads sobre SPY, cuando la prima resulte atractiva y
> el entorno cumpla condiciones de riesgo, tiene una ventaja verificable después de costos. Usá RPF
> (`GaleCore/docs/rpf/`) y lo que haya en GaleCore como antecedentes, no como respuesta aprobada: cuestioná
> sus reglas. Quiero una propuesta que pueda entender y evaluar, y una prueba que permita descartarla.

**Caso oro** (instrumento distinto: futuros, sin antecedentes propios en GaleCore):

> Quiero investigar si seguir la tendencia en futuros de oro (COMEX GC) —comprado o vendido según el retorno
> de los últimos 12 meses— tiene una ventaja verificable después de costos frente a mantener oro o quedarse en
> efectivo. No tengo datos propios todavía y no quiero comprar nada por ahora. Quiero una propuesta que pueda
> entender y evaluar, y una prueba que permita descartarla.

Encuadre común de ambas: el owner pide la **propuesta completa en una entrega**; no una ronda de preguntas.
Sin compras, contactos con proveedores, órdenes ni conectores de cuentas.

## Salidas

Cada corrida escribe su propuesta en un archivo y agrega un registro de fuentes y búsquedas. Las **primeras
salidas se conservan sin corregir** en `raw/`. No hay ronda de mejoras en este contraste: el esfuerzo de
revisión se estima por la cantidad y gravedad de errores materiales que el evaluador encuentra (lo que habría
que corregir).

## Evaluación

- **Evaluador independiente:** Codex (`gpt-5.6-sol`), otra familia de modelo, sandbox de sólo lectura, sin
  acceso a esta sesión, a la propuesta corregida ni a los hallazgos del owner.
- **Ciego:** las salidas se rotulan X/Y por caso con un sorteo sellado (`label_map.json`, sha256
  `001dae28…74858a`, fuera del repo hasta terminar la evaluación). Antes de pasarlas se reemplazan por
  `[REF]` las menciones literales a la instrucción (`SKILL.md`, `coverage.md`, `strategy-design`). El estilo
  (p. ej. tablas de estado) puede delatar la condición: se le pide al evaluador que adivine y se reporta.
- **Rúbrica** (1 = muy deficiente … 5 = excelente, con justificación y citas del texto evaluado):

| # | Dimensión | Qué se mira |
|---|---|---|
| D1 | Preservación de intención | Responde la pregunta pedida (ventaja después de costos frente a la alternativa); no cambia el objetivo, no convierte ejemplos en decisiones |
| D2 | Errores materiales | Afirmaciones falsas o no sostenidas que cambiarían una decisión o la prueba (datos inexistentes, información futura, fuente leída al revés, cálculo inválido). Se listan uno por uno con severidad; 5 = ninguno |
| D3 | Trazabilidad de fuentes | Cada hecho con fuente que resuelve; distingue leído / visto en buscador / memoria; cálculos propios marcados |
| D4 | Separación hechos / hipótesis / decisiones | Evidencia, interpretación, propuesta del host y decisión del owner claramente separadas |
| D5 | Faltantes detectados | Qué datos, verificaciones y decisiones faltan, con qué los resuelve |
| D6 | Claridad | El owner lo entiende sin leer código; lo decidible primero |
| D7 | Utilidad para decidir | Prueba capaz de descartar la idea: comparación, costos, criterios fijados antes, método estadístico recomendado y no delegado sin fundamento |

Además: ranking X vs Y por caso, y la conjetura del evaluador sobre cuál tuvo instrucción.

- **Análisis secundario (no ciego, del implementer):** en el caso SPY, cuáles de los siete problemas que el
  owner marcó en la primera entrega aparecen en cada salida. Está sesgado a favor de B, porque v0.2 se
  escribió a partir de esos problemas; se reporta aparte y no cuenta como evidencia de generalización. El
  caso oro es el que mide generalización.

## Qué se podrá concluir

A favor de la instrucción: B supera a A en el caso oro en D2/D7 sin perder en D1/D6. En contra: sin
diferencia o peor en oro; o B más largo/menos claro sin menos errores. Con n = 1 por celda, cualquier
diferencia es indicio, no efecto medido; no se calcula significancia.
