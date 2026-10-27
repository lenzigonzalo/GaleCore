# Prueba del borrador — 24/09/2026

Estado: piloto de comportamiento inicial. No aprobación de ingeniería ni evaluación económica.
Artefacto evaluado: SKILL.md v0.1.0-draft y coverage.md, antes de la precisión de primera respuesta
descrita al final. Evaluador: subagente `pilot_behavior_review`, contexto inicial sin historial del
owner, con instrucción de leer únicamente esos dos archivos. Cinco casos dentro de un mismo contexto.
Sin red, mercado, operaciones, edición de archivos ni acceso a otras capacidades durante la prueba.

## Protocolo y reproducción

En una sesión nueva, pedir leer SKILL.md y coverage.md y aplicar la instrucción a los cinco inputs
de abajo, produciendo una respuesta inicial de máximo 160 palabras por caso y luego hallazgos y
límites. No proveer estas respuestas al evaluador. Permitir sólo lectura de esos archivos; ninguna
acción financiera. En esta corrida no se proporcionó la respuesta esperada ni hallazgos anticipados.
El evaluador recibió el rol de evaluación de comportamiento, no aprobación independiente de ingeniería.
Las respuestas siguientes son su salida real, conservada sin convertirla en resultados de mercado.
No se midieron latencia, tokens ni costo; no inferirlos. No se hizo A/B ni sesiones separadas por caso.

## Inputs y salidas reales

### 1 — SPY

Input: «Quiero SPY, retornos continuos estables, automatizable, bajo riesgo, alta probabilidad de
ganancia, no naked, idealmente spreads y poca gestión manual de roll.»

Tomaría como restricciones SPY y no naked; como preferencias, spreads y poca gestión manual de roll. Falta convertir «estable», «bajo riesgo» y «alta probabilidad de ganancia» en criterios: una alta frecuencia de ganancias no basta para evaluar pérdidas grandes ni retorno total.

Para orientar la primera propuesta:
- ¿Buscás retirar efectivo periódicamente o hacer crecer el capital? Eso cambia cómo medimos el resultado.
- ¿Qué priorizás si hay tensión: limitar pérdidas, regularidad o rentabilidad?
- ¿Qué intervención manual aceptarías ante una contingencia? Podés responder «todavía no sé».

Mientras tanto, podemos comparar diseños con y sin roll previsto, dejando sizing pendiente. La restricción no naked debe resolverse durante entrada, mantenimiento y salida, incluidos fills parciales y eventos contractuales. No hay todavía una tesis ni evidencia de estabilidad; los términos contractuales y capacidades del broker quedan pendientes de verificación.

### 2 — Bono

Input: «Quiero comprar un bono argentino porque sí; no sé cuál y no tengo una tesis.»

Podemos tratarlo como una compra discrecional: no hace falta inventar una ventaja predictiva. Por ahora está definida la intención de comprar un bono argentino; están pendientes el instrumento, la exposición buscada y la capacidad de pérdida.

¿Hay alguna moneda en la que quieras recibir los pagos? ¿Cuándo podrías necesitar recuperar el dinero? Podés decir «todavía no sé»: esas respuestas orientan qué flujos y plazos tendría sentido investigar.

El próximo resultado útil sería una comparación de exposiciones y condiciones, antes de elegir un bono. Para cada candidato habría que verificar serie y prospecto, monedas de negociación y pago, ley aplicable, cupones, amortizaciones, liquidez y escenarios de incumplimiento o reestructuración. La evaluación inicial puede centrarse en flujos y escenarios; no exige un backtest. No consulté fuentes ni seleccioné un instrumento.

### 3 — Futuros

Input: «Quiero automatizar cruces de medias en futuros; tengo OHLC de una serie continua, no sé contrato ni tamaño.»

Tenemos una idea de señal y datos OHLC de una serie continua. Falta identificar qué futuro representa y cómo fue construida la serie. No asumiría que sus valores son precios a los que se puede operar.

¿Qué subyacente y fuente tienen esos datos? ¿Cuál es la frecuencia de las barras? Eso permite decidir qué señales podemos investigar y qué información falta para simular operaciones.

Podemos avanzar definiendo cómo se calculan las medias, cuándo se conoce el cruce y cómo se responde a datos faltantes. Ventanas, dirección y salidas quedan pendientes, sin asignar defaults.

La simulación de ejecución depende de identificar contratos negociables, meses, calendario y roll, precios y costos. El sizing queda bloqueado hasta conocer especificaciones contractuales y límites de riesgo; el margen no se tratará como pérdida máxima. No construí ni probé aún la estrategia.

### 4 — Sentimiento

Input: «Quiero comprar penny stocks por sentimiento de redes y vender cuando cambie.»

La intención es comprar según sentimiento y vender cuando cambie. Todavía falta una regla observable: «sentimiento» y «cambio» admiten distintas interpretaciones, y no tenemos evidencia de que anticipen un resultado aprovechable.

¿Qué mercado o universo querés considerar y qué redes o fuente de datos tenés disponibles? ¿El cambio significa pasar a negativo o deteriorarse respecto del nivel de entrada? Podés dejar cualquiera pendiente.

Mientras tanto, definiría una prueba que conserve qué mensajes estaban disponibles al decidir, su procedencia y las versiones del clasificador. También debe examinar duplicados, bots y manipulación. Antes de evaluar rendimiento, hay que resolver cómo representar liquidez, suspensiones y una venta sin contraparte: una señal de salida no equivale a una venta ejecutada.

El próximo entregable sería una definición verificable de señal y un inventario de datos faltantes. No hay universo elegido, sizing ni resultados.

### 5 — Diseño de skill

Input: «Diseñá la skill que atienda esos inputs; son ejemplos, no quiero completar ahora esas estrategias.»

El trabajo es diseñar la skill; los cuatro casos son pruebas de cobertura. No necesitamos completar sus estrategias ni pedirte capital o broker.

Usaría una conducción común: identificar el trabajo solicitado, preservar restricciones y preferencias, hacer pocas preguntas que cambien la siguiente decisión y avanzar con lo independiente. Cada propuesta conservaría decisiones, hipótesis, fuentes, pendientes y próximos pasos.

Las ramas cubrirían opciones y contingencias no naked; compra discrecional y términos de bonos; futuros, series continuas y contratos negociables; sentimiento, procedencia temporal y salida factible. Cada caso recibiría una evaluación acorde con su propósito, sin imponer backtest a todos.

La entrega sería una skill con cobertura condicional y casos de evaluación que comprueben también este cambio de nivel: diseñar el método no debe activar la elaboración de las estrategias de ejemplo. El texto del piloto ya ofrece esa base; aún queda comprobar su comportamiento sostenido.

## Hallazgos del evaluador (salida real)

- Los cuatro casos tienen ramas explícitas y pueden combinarse con cobertura común. El quinto está contemplado expresamente como diseño o evaluación de la propia skill.
- El método permite avanzar sin inventar sizing, parámetros ni tesis. Separa compra discrecional de estrategias repetitivas y no exige backtest universal.
- La cobertura aborda detalles que podrían perderse en una respuesta genérica: no naked durante todo el ciclo, contrato negociable frente a serie continua, flujos específicos del bono y disponibilidad temporal del sentimiento.
- Hay una tensión operativa entre «revisar siempre» toda la cobertura común y evitar un formulario o plantilla extensa. El texto permite una entrega progresiva, pero no define un criterio preciso para decidir qué dimensiones deben hacerse visibles en la primera respuesta.
- La estructura de entrega y el registro por dimensión son amplios. Estas respuestas iniciales priorizan decisiones inmediatas y pendientes; no demuestran cumplimiento del registro completo.
- No detecté una contradicción directa entre ambos archivos en estos casos. Las consultas de investigación y verificación contractual quedan pendientes por el alcance de esta prueba, no se simularon.

## Límites del evaluador (salida real)

Una pasada de cinco casos en un mismo contexto, con lectura de ambos archivos y sin respuestas posteriores del usuario. No son sesiones independientes ni una comparación A/B. No se probaron investigación, persistencia, recuperación, delegación, adaptación a StrategySpec, ejecución ni resistencia a fuentes adversariales. No se consultaron datos financieros, ejecutaron operaciones ni editaron archivos. Esto aporta observaciones sobre respuestas iniciales; no constituye validación económica ni aprobación independiente de ingeniería.

## Ajuste y checks del implementer

Después de esa corrida se precisó en §2 de SKILL.md qué mostrar en la primera respuesta (mandato,
faltantes que afectan el paso inmediato y resultado propuesto) y cuándo exponer cobertura completa.
No se rehízo la evaluación conductual: la mejora está redactada, su efecto queda pendiente de prueba.

- `python -X utf8 C:/Users/lenzi/.codex/skills/.system/skill-creator/scripts/quick_validate.py docs/engineering/pilots/strategy-design`: `Skill is valid!`, exit 0 antes del ajuste.
- Comprobación Python de UTF-8, links Markdown locales y whitespace de los tres archivos iniciales:
  `PASS`, exit 0. No prueba semántica financiera.
- `git diff --check`: exit 0; no cubre archivos untracked. La revisión de whitespace anterior sí los leyó.
- Puntero raíz sigue en GC-0004. Los status del workspace y checkout original de GaleCore-AI mantienen
  los mismos archivos sucios observados al inicio. No se editaron desde este piloto.

## Matriz de alcance

| Criterio | Evidencia disponible | Pendiente |
|---|---|---|
| C1 | Casos 1–5: intención, preferencias, preguntas iniciales | Conversación de varias vueltas y contradicciones del usuario |
| C2 | Casos 1–4: ramas distintas sin defaults comunes | Instrumento nuevo, combinaciones, cobertura completa de una propuesta |
| C3 | Salidas sin precios, probabilidades o resultados fabricados | Fuentes reales, calidad de respaldo, reglas simultáneas y eventos |
| C4 | Instrucciones de ruteo y límites inspeccionadas | Ejecución de ese ruteo, capacidades ausentes y respuesta a fallos |
| C5 | Salidas reales y caso 5 | Persistir/retomar propuesta, A/B, utilidad evaluada por owner |

Siguiente evaluación propuesta: conversación multivuelta y recuperación, usando inputs del owner
ya disponibles sin convertir la evaluación de la skill en un pedido de estrategia perfecta. Comparar
después con host sin skill, igual modelo, acceso a datos/herramientas, inputs y presupuesto. Evaluador
sin saber condición cuando sea viable; registrar outputs, omisiones críticas, contradicciones,
trazabilidad, utilidad del owner y tiempo/consumo sólo si se pueden medir. No usar win rate financiero
como métrica de calidad de instrucciones.

---

# Primer recorrido real — 25/09/2026 (idea del owner: PCS sobre SPY)

Estado: evidencia de un recorrido, no A/B ni revisión independiente. Host: Claude Code (Opus 5.5), la misma
sesión que cerró GC-0004, **no** un contexto limpio: conocía RPF y GaleCore de antes, y eso pudo suplir huecos
de la instrucción (sesgo a declarar). Salida: [propuesta-pcs-spy-2026-09-25.md](propuesta-pcs-spy-2026-09-25.md).
No se midieron tokens ni costo; tiempo aproximado: una tarde de sesión, sin cronometrar.

**Input:** "investigar si vender prima mediante put credit spreads sobre SPY, cuando la prima resulte atractiva
y el entorno cumpla condiciones de riesgo, tiene una ventaja verificable después de costos. RPF como
antecedente, no como respuesta aprobada."

**Recorrido real:** `cli kb search` (dos búsquedas; sólo devolvió registros de régimen) → lectura de la
definición, el JSON, el backtesting y la reconciliación de RPF en `GaleCore/docs/rpf/` y
`Files/Rpf/galecore_rules_rpf.json` → cuatro búsquedas web y tres lecturas: dos fallaron (un PDF primario
sin extractor en esta máquina y una página de AQR que dio 404); se usó la nota del patrocinador y se declaró → propuesta.

## Qué aportó la instrucción

- **Separar hechos, interpretaciones, hipótesis, parámetros y decisiones** (SKILL §3–§4) dio la estructura de
  tres capas pedida por el owner y la distinción entre **parámetro investigable** y **restricción del usuario**
  (heat, maxDD, riesgo por operación), que RPF mezcla en la misma tabla.
- **Tesis como mecanismo → falla + explicaciones alternativas** (§4) llevó a la pregunta central que RPF no se
  hace de forma explícita: ¿la ventaja es la prima en sí o el timing de los filtros?
- **"Un conjunto consultado para ajustar deja de ser prueba intacta"** y **dependencia entre observaciones**
  (§6) permitieron leer el backtesting de RPF con criterio: ventana OOS reutilizada, señales-día superpuestas.
- **"No inventes datos…"** (§3) y **"sin umbrales universales"** (§6) llevaron a dejar los criterios de la prueba
  en forma y los números como decisión del owner.
- **Coverage** marcó dos huecos que la propuesta dejó pendientes: eventos contractuales (asignación, entrega)
  y ejecución (no asumir fill a mid).

## Qué omitió o dificultó

1. **Auditar evidencia existente.** La instrucción dice cómo construir una propuesta, no cómo evaluar un
   antecedente con backtests propios: cuántas veces se usó la ventana, si la configuración elegida fue medida
   tal cual, cuántas pérdidas sostienen la estimación de cola. Se hizo a criterio del host. Propuesta: una
   sección breve "auditar un antecedente cuantitativo" con esas preguntas.
2. **Renta vs pérdida máxima.** Para venta de prima, la comparación "cuántos períodos de cobro borra una
   pérdida máxima" fue lo más revelador y la instrucción no la pide (coverage/Medición habla de colas en
   general). Propuesta: agregarla a la rama de opciones.
3. **Dónde persistir.** SKILL §7 pide un destino autorizado; no existe uno para propuestas (`BL-009` abierto).
   Se usó la carpeta del piloto.
4. **Base de conocimiento incompleta para el caso.** `kb search` no indexa `GaleCore/docs/` (RPF): la búsqueda
   "vacía" habría hecho perder el antecedente principal a un host sin contexto previo. La instrucción advierte
   que una búsqueda vacía no prueba ausencia, pero no dice dónde mirar después.
5. **Fuentes que no se pueden leer.** No hay guía para una fuente primaria inaccesible (PDF sin extractor). Se
   declaró el uso de una fuente secundaria del patrocinador; conviene que la instrucción lo pida.
6. **Pedido de propuesta completa.** La guía de primera respuesta (1–3 preguntas, no bloquear) no aplicó: el
   owner pidió la entrega completa. La instrucción lo permite (§1, "acordá el próximo resultado útil"), pero
   la mayor parte de su texto está orientada a la primera vuelta.

## Revisión interna de la entrega (25/09) — qué encontró y qué dice de la instrucción

La revisión interna (agente `reviewer`, contexto limpio) pidió cambios; todos se corrigieron en la propuesta:

- **E4 contradecía su fuente.** El host citó a Bondarenko (2014) como fuente del *peso problem* cuando el abstract
  dice lo contrario: la anomalía no se explica ni admitiendo ese sesgo. **Falla del host, no de la instrucción:**
  SKILL §3 ya pide "comprobá el contenido y anotá contradicciones"; el host usó el fragmento de un buscador.
- **Fuentes vistas sólo en resultados de búsqueda:** Carr & Wu (E1) y Bondarenko 2014 (E3) no se abrieron
  (E3 se verificó después, por el abstract en Crossref); la nota de Cboe (E2, E5) sí se leyó. En el work item
  decía "verificadas por búsqueda", que sobrestimaba lo hecho.
- **Erratum omitido:** E8 usaba cifras de BT-9 que el mismo documento corrige en BT-10.
- **Criterios de prueba solapados** (refuta/inconcluso): permitían clasificar después de ver el resultado.
- **Respuesta a dato faltante por regla:** SKILL §4 la pide y la propuesta la omitía; en RPF algunos gates de
  seguridad pasan sin dato.

Huecos de la instrucción que agrega esta revisión:

7. **Fuentes de buscador.** La instrucción no pide distinguir una fuente leída de una vista en el resultado de un
   buscador. Propuesta: exigir marcar "sólo resumen/fragmento" y no usarlo como hecho sin abrirlo.
8. **Erratas y versiones dentro de un antecedente.** No pide buscar correcciones posteriores del mismo
   documento antes de citar un número. Propuesta: sumarlo a "auditar un antecedente cuantitativo" (punto 1).
9. **Criterios excluyentes.** §6 pide criterios de apoyo, refutación e inconclusión, pero no que sean
   mutuamente excluyentes con un orden de evaluación. Propuesta: agregarlo.

## Límites de esta evidencia

Un solo caso, host con contexto previo, sin evaluador ciego ni comparación contra el host sin la instrucción
(paso posterior previsto en el piloto). No dice nada sobre la calidad financiera de la idea; eso lo dice la
propuesta, con sus pendientes.

---

# Evaluación del owner de la primera entrega — 25/09/2026

El owner evaluó la propuesta: se entiende y sirve para ordenar la investigación; **no** aprueba la estrategia,
no valida la instrucción ni cierra el item. Marcó siete problemas; se corrigieron en la propuesta (historial,
entrada del 25/09 "evaluación del owner"). Para cada uno: ¿la instrucción ya lo pedía y el host no lo hizo, o
la instrucción no lo pedía?

| Problema | Clasificación | Qué cambió en v0.2.0-draft |
|---|---|---|
| Evidencia de venta de puts usada como si fuera del spread (la pata comprada también paga prima) | **Omisión de la instrucción**: pedía evidencia a favor/en contra y alternativas, no distinguir mecanismo de implementación | SKILL §3: evidencia del mecanismo ≠ de la implementación |
| "Cadenas pre-2013 permiten probar RPF en 2008" sin verificar insumos (VIX9D existe desde 2011) | **Falla del host** (coverage ya pedía cobertura histórica y disponibilidad point-in-time) + omisión menor: no decía que reconstruir/sustituir/omitir crea una variante | SKILL §6: verificar cada insumo antes de proponer un período; variantes con nombre |
| Sólo métricas por operación; sin carteras comparables | **Omisión de la instrucción** (pedía baseline y drawdown, no comparación de carteras con el mismo calendario, capital, restricciones y efectivo) | SKILL §6 y coverage/Evaluación |
| P4: SHADOW presentado como fuente de fills | **Falla del host** (SKILL §4 ya separa señal, orden y fill) + omisión menor: no aplicaba esa separación a las fuentes de evidencia | SKILL §6: niveles de ejecución (estimada, cotizada, simulada, real) |
| Estadística y restricciones de riesgo mezcladas; una violación podía quedar como "inconcluso" | **Omisión de la instrucción** | SKILL §6 y coverage/Evaluación: restricciones juzgadas aparte; criterios excluyentes con orden (también hallazgo 9 del recorrido anterior) |
| Cociente pérdida máxima/renta que mezcla antecedentes y no escala | **Falla del host** (SKILL §3: comprobar el contenido) + omisión menor | SKILL §3: un cálculo que combina fuentes se declara ilustrativo, con supuestos y efecto de escala |
| GS3M del mismo mes (información futura) y rendimiento de referencia tomado como invertible | **Falla del host** (coverage pedía point-in-time) + omisión: no extendía point-in-time a benchmarks y tasas ni separaba referencia de retorno invertible | SKILL §6 y coverage/Datos |
| Método, nivel del intervalo y muestra suficiente delegados al owner | **Omisión (y efecto no buscado) de la instrucción:** "sin umbrales universales" y "decisiones del usuario" empujaron al host a delegar detalles técnicos | SKILL §6: el investigador recomienda método, nivel y suficiencia; el usuario decide riesgo aceptable y utilidad mínima |

No se agregó nada específico de RPF ni de opciones. Las propuestas 1–8 del recorrido anterior (auditar un
antecedente cuantitativo, fuentes de buscador, erratas, dónde persistir, etc.) siguen **propuestas, no
aplicadas**: no las pidió esta evaluación. La 9 (criterios excluyentes) quedó incorporada.

**Contaminación declarada:** v0.2 se escribió a partir de problemas del caso SPY; en el contraste, SPY no es
un caso nuevo para v0.2. El caso oro sí.

## Contraste con y sin instrucción (v0.2.0-draft) — 25/09

Protocolo y rúbrica fijados antes ([protocol.md](contrast-2026-09-25/protocol.md)); resultados, salidas sin
corregir y evaluación ciega de Codex en [results.md](contrast-2026-09-25/results.md). En corto: en el caso
nuevo (futuros de oro) la salida con instrucción fue claramente mejor (34 vs 24 sobre 35; la salida sin
instrucción probó GLD en vez de GC y juzgó por Sharpe); en SPY, levemente mejor (30 vs 28) con los mismos
errores materiales, en un caso contaminado porque v0.2 salió de él. n = 1 por celda y el ciego no funcionó
(el evaluador reconoció las condiciones por la estructura): indicio a favor, no efecto medido.

Candidatos a la instrucción que surgen del contraste, **no aplicados** (sería otra ronda sin caso nuevo):
declarar qué riesgo iguala un benchmark "de igual riesgo" y comprobar que no cambie la pregunta; revisar que
la síntesis no contradiga las reglas del cuerpo.
