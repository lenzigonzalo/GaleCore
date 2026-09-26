# Tendencia de 12 meses en oro (COMEX GC): propuesta de investigación y prueba de descarte

- **Identidad:** `oro-tendencia-12m` · versión `0.1.0-draft` · 2026-09-25
- **Usuario / decisor:** owner de GaleCore. **Redacta:** host (Claude Code), con la instrucción piloto `strategy-design` 0.2.0-draft.
- **Alcance de esta entrega:** es una propuesta de investigación y un plan de prueba **fijado antes de ver datos**.
  **No contiene resultados**: no se corrió ningún backtest ni se descargaron precios. No autoriza operaciones,
  compra de datos ni conexión a brokers.

---

## 1. Síntesis (lo que podés evaluar hoy)

**La pregunta, dicha con precisión.** Cada fin de mes se mira si el oro "de futuros" (GC con roll, en exceso
sobre la tasa de letras del Tesoro) subió o bajó en los últimos 12 meses. Si subió, el mes siguiente se está
comprado; si bajó, vendido. ¿Esa regla, **después de costos**, le gana a (a) mantener oro siempre y (b) quedarse
en efectivo, con el mismo capital y el mismo calendario?

**Por qué la comparación contra "mantener oro" es simple de entender.** Con la misma exposición (1 vez el capital),
la estrategia y "mantener oro" son idénticas en los meses en que la señal dice *comprado*. Sólo difieren en los meses
en que dice *vendido*: ahí la diferencia es −2 × (lo que hizo el oro ese mes). Entonces:

> **La ventaja frente a mantener oro existe sólo si el oro, en promedio, bajó en los meses en que la regla estaba vendida,
> lo suficiente como para pagar los costos extra de cambiar de posición.**

Frente al efectivo, la estrategia gana si "comprado cuando subía / vendido cuando bajaba" deja retorno positivo neto por
encima de la tasa libre de riesgo.

**Qué dice la evidencia previa (resumen honesto).**
- A favor: Moskowitz, Ooi y Pedersen (2012) encuentran que el retorno de 12 meses predice el mes siguiente en los 58 futuros
  que estudian, oro incluido (COMEX), y que el efecto dura ~1 año y luego se revierte parcialmente. Pero esos resultados son
  **brutos de costos** (la Fig. 2 reporta Sharpe *gross*) y el valor específico del oro no lo pude extraer del PDF.
- A favor con costos: Hurst, Ooi y Pedersen ("A Century of Evidence…") muestran rentabilidad neta de costos estimados,
  pero **para una cartera diversificada de 67 mercados**, con señales de 1, 3 y 12 meses combinadas, y **sin incluir el
  costo de roll**. No es evidencia sobre una regla de un solo activo.
- En contra: Huang, Li, Wang y Zhou (JFE 2020) encuentran **poca evidencia activo por activo**, y que la rentabilidad de la
  estrategia es "virtualmente igual" a la de una regla basada en la media histórica. Para el oro, que tuvo fuerte deriva
  alcista, esa regla alternativa es prácticamente "mantener oro": exactamente el comparador que pedís.
- Conclusión: la prima de tendencia documentada es un fenómeno **de cartera diversificada**; que exista en **oro solo, neto de
  costos de roll y de cambios de señal, y frente a mantener oro** es una pregunta abierta. Eso es lo que la prueba decide.

**La prueba propuesta, en una línea.** Regla fija (la del paper de 2012, sin parámetros que ajustar), aplicada a GC
**después de 2010** —período posterior a la muestra del paper (1985–2009)— con precios de liquidación de cada contrato,
roll antes del primer aviso de entrega, costos por trade y por roll, y comparación de carteras con el mismo capital en letras.

**Cuándo se descarta (regla de decisión, ver §6.5):** si la ventaja neta estimada frente a mantener oro es ≤ 0, o si el
intervalo de confianza excluye la ventaja mínima que a vos te importaría, la idea queda **descartada en esta forma**.

**Advertencia importante sobre lo que la prueba puede y no puede decir.** Con ~16 años de un único activo y una señal lenta
(pocos episodios de "vendido"), la prueba es **buena para descartar una ventaja grande y mala para confirmar una chica**.
Un resultado "inconcluso" es probable y no es un fracaso del método (§6.6 tiene un cálculo ilustrativo).

**Lo que necesito de vos antes de ver resultados (2 decisiones, ninguna bloquea este diseño):**
1. **Ventaja mínima que te importaría** (`u_min`, en puntos porcentuales anuales frente a mantener oro). Sin eso, sólo se
   puede usar la regla "≤ 0 → descartar"; con eso, también se puede descartar una ventaja positiva pero demasiado chica.
   Podés decir "todavía no sé": en ese caso la regla se evalúa sólo con `u_min = 0` y se deja constancia.
2. **Datos:** la fuente adecuada (liquidaciones por contrato de GC desde 2010) es **paga** (Databento, por uso; no consulté
   precio). Opciones: (a) autorizar más adelante pedir cotización; (b) empezar con una **variante gratuita** con precio spot
   LBMA, que tiene nombre propio y sesgos declarados (§5.2) y sirve como filtro previo, **no** como prueba de la regla.

---

## 2. Mandato entendido

| Campo | Estado | Contenido |
|---|---|---|
| Propósito | definida | Investigar si una regla de tendencia de 12 meses sobre GC tiene ventaja verificable neta de costos frente a mantener oro y frente a efectivo. **No** es comprar ni operar. |
| Resultado buscado | definida | Propuesta entendible + prueba capaz de refutarla. |
| Mercado/instrumento | definida | Futuros de oro COMEX GC (100 oz troy). Variantes de tamaño (MGC) sólo relevantes para una eventual implementación. |
| Dirección | definida | Comprado o vendido (siempre posicionado), por decisión del owner. Long/flat queda como variante secundaria declarada. |
| Moneda | propuesta | USD, antes de impuestos. |
| Comparadores | definida (owner) + propuesta (forma) | (a) mantener oro; (b) efectivo. Forma propuesta en §6.2. |
| Horizonte de evaluación | propuesta | Prueba histórica 2010-07 → último mes completo disponible; seguimiento prospectivo posterior opcional. |
| Capital asignable | pendiente | No hace falta para la prueba (se normaliza a 1 unidad de capital). Hace falta para sizing real. |
| Pérdida tolerable | pendiente | Preferencia del owner; se reporta el drawdown observado y se juzga **aparte** del resultado estadístico. |
| Utilidad económica mínima `u_min` | pendiente | Decisión del owner (ver síntesis). |
| Tiempo de atención | propuesta | Revisión mensual (una decisión por mes + rolls bimestrales). |
| Grado de intervención | definida | Ninguna ejecución. Sin datos propios aún. Sin compras. |

---

## 3. Tesis

**Mecanismo esperado → resultado → captura → falla.**

1. **Mecanismo (hipótesis, no hecho):** los precios incorporan información con retraso (sub-reacción inicial y luego
   reacción tardía/manada), y hay presión de coberturistas que pagan por transferir riesgo; eso produce continuación de
   retornos a 1–12 meses (interpretación de Moskowitz-Ooi-Pedersen 2012). En oro, los impulsores plausibles (tasas reales,
   dólar, compras de bancos centrales, demanda de refugio) cambian lentamente — hipótesis del host, sin fuente cuantitativa.
2. **Resultado buscado:** estar vendido durante tramos bajistas prolongados del oro y comprado durante los alcistas, con
   mejor retorno neto que mantener oro (evitando parte de las caídas) y retorno positivo sobre efectivo.
3. **Captura:** señal = signo del retorno en exceso de 12 meses del GC con roll; posición ±1× capital; revisión mensual.
4. **Condiciones de falla:**
   - cambios de tendencia bruscos (el oro rebota fuerte estando vendido): la regla llega tarde en ambos sentidos;
   - mercados laterales con señales que cambian seguido: se pagan costos sin capturar tendencia;
   - deriva alcista persistente: cada mes "vendido" es caro (−2× el retorno del oro);
   - reversión a 1–5 años documentada por el propio paper: las tendencias maduras pueden revertir.

**Explicaciones alternativas y evidencia contraria.**
- *El efecto agregado no implica efecto por activo* (Huang et al. 2020): el t-estadístico agregado depende de la
  agrupación; activo por activo la predictibilidad es débil. → La prueba tiene que ser en oro, no heredada del agregado.
- *Parte de la "ganancia" de tendencia es sólo estar comprado un activo con deriva positiva*: por eso el comparador principal
  es mantener oro, no efectivo. Superar al efectivo solamente puede ser "beta de oro".
- *Evidencia gruesa vs implementación*: los resultados publicados son brutos (MOP 2012) o netos para cartera diversificada
  sin costo de roll (Century). Esta regla agrega roll bimestral y señal de un solo activo. La evidencia del mecanismo **no se
  traslada sola** a esta implementación.
- *Estudios con resultados extraordinarios*: apareció un preprint (arXiv 2511.08571) que reporta en oro 2015–2025 un Sharpe
  de 2,88 y drawdown de 0,52% netos. **No lo leí**; es otra estrategia (walk-forward, señales de estado), y cifras así son
  una señal de alerta, no respaldo. No se usa.

**Abstención / invalidación de la tesis:** se invalida si la prueba de §6 cae en "descartada". No se propone filtro de
régimen: no hay razón previa para creer que agregue en este caso, y cada filtro agregado es otro intento a controlar.

---

## 4. Reglas de la variante principal (V0)

| Elemento | Especificación |
|---|---|
| Observación | Precio de **liquidación (settlement)** diario del contrato GC mantenido; tasa de letras del Tesoro de EE.UU. |
| Serie de retorno | Retorno diario en exceso del contrato mantenido (cambio de settlement / settlement previo − tasa diaria), compuesto; en el roll se encadena el retorno del contrato nuevo desde su propio settlement (no se "empalman" niveles). |
| Señal | `s_t = signo(R_exceso[t−12m, t])`, con R de la serie anterior, medido al settlement del **último día hábil del mes t**. Igual a MOP 2012 (k=12, h=1). |
| Momento de disponibilidad | Tras publicarse el settlement del último día hábil (hora exacta de publicación: **verificar** con CME). |
| Acción | Ajustar la posición a `s_t × 1 × capital` de nocional. |
| Orden y fill (en prueba) | Ejecución supuesta **al settlement del primer día hábil siguiente** (un día de desfase, evita comprar al mismo precio que generó la señal) + costo modelado. Variante de sensibilidad: 2 días. |
| Empate (`R = 0` exacto) | Mantener posición anterior. |
| Roll | Mantener el contrato activo más cercano (meses activos de GC: feb, abr, jun, ago, oct, dic) y rolar al siguiente activo **N = 5 días hábiles antes del primer día de aviso (FND)**; N es restricción estructural (evitar entrega), no parámetro a optimizar. |
| Roll + cambio de señal el mismo día | Se ejecuta una sola transición: cerrar contrato viejo, abrir el nuevo en la dirección nueva (dos patas de costo, no cuatro). |
| Dato faltante al fin de mes | Se evalúa con el siguiente settlement disponible y se registra el evento; si faltan > 3 días hábiles, el mes se marca y se reporta con y sin él. |
| Rebalanceo intra-mes | No (salvo roll). El nocional deriva con el precio dentro del mes; se reajusta a 1× en la fecha de señal. Variante: reajuste en cada roll. |
| Stops / tomas de ganancia | Excluidos explícitamente: la regla es la del paper; agregarlos es otra estrategia. |

**Parámetros**

| Parámetro | Valor | Unidad | Origen | Dominio | Política de ajuste |
|---|---|---|---|---|---|
| Lookback | 12 | meses | literatura (MOP 2012) | fijo | **No se optimiza.** Otros valores sólo como sensibilidad declarada. |
| Frecuencia | mensual | — | literatura | fijo | idem |
| Exposición | 1× capital | nocional/capital | propuesta (iguala al comparador "mantener oro") | fijo en V0 | — |
| Desfase de ejecución | 1 | día hábil | propuesta | {1, 2} | sensibilidad |
| Días antes de FND para rolar | 5 | días hábiles | propuesta (restricción) | ≥ 2 | verificar política del broker si hubiera implementación |
| Costo por trade (una vía) | 0,10% del nocional | % | estimación de Century (commodities 2003–2016) | {0,10%; 0,20%; 0,05%} | escenario base + estrés; no se "ajusta" al resultado |
| Tasa de efectivo | T-bill 3 meses | %/año | propuesta | alternativa: 4 semanas | sensibilidad; ver §6.3 |

---

## 5. Datos

### 5.1 Lo que necesita la variante principal

| Insumo | Fuente candidata | Cobertura / estado | Point-in-time | Riesgos a controlar |
|---|---|---|---|---|
| Settlement diario por contrato GC | Databento `GLBX.MDP3` (CME Globex MDP 3.0), esquema **Statistics** (settlement) + **Definition** | Desde 2010-06-06; contratos individuales (p. ej. GCZ6). **Pago por uso; precio no consultado; compra no autorizada.** | Sí: settlement publicado cada día | **No usar el cierre de OHLCV-1d como settlement** (último trade ≠ liquidación): verificar el tipo de estadística; contrastar una muestra de fechas contra settlements publicados por CME. |
| Calendario de contratos (FND, último día) | Reglamento COMEX cap. 113 + Definition | El último día de negociación es el 3er hábil antes del fin del mes de entrega (según CME); FND a verificar por contrato | Conocido de antemano | Cambios de reglas en el período; feriados. |
| Tasa de efectivo | FRED (T-bill secundario, p. ej. DTB3/TB3MS) o Ken French RF | Larga historia (verificar series exactas antes de usar) | Se usa la tasa conocida al inicio de cada mes/día | Distinguir tasa de referencia de lo que el broker efectivamente paga (§6.3). |
| Costos | Supuestos de Century (Apéndice B) | Estimaciones hechas en 2012, aplicadas hacia atrás con multiplicadores | **No son point-in-time**: son una suposición; por eso se estresan | No incluyen roll ni impacto específico de oro. |

Datos que **no** hacen falta para la prueba: margen (sí para sizing real), posicionamiento CFTC, volatilidad implícita.

### 5.2 Alternativas y variantes con nombre propio (no son la regla original)

- **V-spot (gratuita, filtro previo):** precio LBMA (publicado por LBMA; FRED lo quitó en enero de 2022 por la licencia de
  IBA — **verificar licencia de uso**) + T-bill. Aproxima el retorno en exceso del futuro como `spot − tasa`, ignorando la
  tasa de arrendamiento del oro y los costos de roll. Sesgo esperado: sobreestima el retorno del futuro comprado. Horizonte
  largo (desde fines de los '60 según la fuente secundaria consultada, sin verificar). Sirve para responder barato "¿hay
  algo que valga la pena comprar datos para mirar?"; **no puede confirmar ni refutar V0**.
- **Series continuas gratuitas** (Kaggle/TradingView, Investing.com, tradingcharts): procedencia y método de empalme no
  verificados; sólo para chequeos cruzados. Nasdaq Data Link CHRIS (continuas) está discontinuada.
- **Historia larga de futuros (1979–2009):** existe en proveedores pagos (Bloomberg, CSI según Century). Además está **dentro
  de la muestra del paper**: sirve como consistencia histórica, no como prueba intacta.

### 5.3 Controles de calidad antes de mirar resultados

Faltantes y días duplicados; saltos en el roll (retorno del día de roll calculado dentro de cada contrato); settlements
fuera de rango (> 5 desvíos diarios) revisados a mano contra otra fuente; mapeo símbolo→mes de entrega; zona horaria
(fecha de sesión de CME, no UTC). Si fallan: resultado **inválido**, no "inconcluso".

---

## 6. Plan de prueba (fijado antes de ver datos)

### 6.1 Por qué 2010 en adelante

La regla sale de un paper publicado en 2012 con muestra hasta diciembre de 2009. Aplicarla sin tocar nada a 2010-07 →
presente es una **prueba posterior a la publicación**: no hay parámetros que estimar ni que elegir, así que no hace falta
separar desarrollo/selección/test **siempre que no se cambie la regla después de ver datos**. Coincide con la cobertura de
la fuente candidata. El primer mes con señal requiere 12 meses de historia: si los datos arrancan en 2010-06, la primera
señal es a fines de 2011-06 (o antes si se consigue historia previa sólo para la señal — sería una variante declarada).

### 6.2 Carteras comparadas (mismo capital C, mismo calendario, mismos costos por trade)

| Cartera | Composición | Retorno mensual |
|---|---|---|
| **T (tendencia, V0)** | C en letras + posición ±C nocional en GC | `rf + s·r_exc − costos(cambios de señal + rolls)` |
| **H (mantener oro, futuros)** — comparador principal | C en letras + siempre +C nocional en GC | `rf + r_exc − costos(rolls)` |
| **H-spot (mantener oro físico/ETF)** — comparador secundario | C en oro spot | retorno LBMA − gasto de custodia/ETF (parámetro, **pendiente**) |
| **E (efectivo)** | C en letras | `rf` |

H aísla exactamente la decisión de *timing* (mismo instrumento, mismos rolls). H-spot responde a "¿y si simplemente
compraba oro?", con otras fricciones; se reporta, pero la decisión principal usa H.

### 6.3 Remuneración del efectivo

Todas las carteras con futuros asumen que el capital cobra la tasa de referencia. Eso **no** es lo que el capital cobraría
necesariamente en un broker. Sensibilidad: `rf − 0,5 pp` (valor ilustrativo del host, no dato de broker). Afecta igual a
T, H y E, pero no a H-spot: por eso la comparación con H-spot se reporta con ambos supuestos.

### 6.4 Métricas (USD, mensuales, antes de impuestos, netas de costos modelados)

- **Primaria:** `D = media anualizada de (T − H)`. Como T y H tienen igual exposición, tienen volatilidad similar y
  comparar medias ≈ comparar retorno ajustado por riesgo.
- **Secundaria obligatoria:** `X = media anualizada de (T − E)` (debe ser > 0 para hablar de ventaja sobre efectivo).
- **Descriptivas:** volatilidad, máximo drawdown y su duración, peor retorno de 12 meses, % de meses vendido, número de
  episodios de "vendido" (tramos consecutivos), número de cambios de señal, costos totales pagados (señal vs roll),
  contribución de meses vendidos a D. Sin ratios adicionales.
- No se anualizan subperíodos cortos como expectativa.

### 6.5 Criterios de decisión (excluyentes, en este orden)

0. **Inválida** — si fallan los controles de §5.3 o se detecta información futura. No se interpreta nada.
1. **Descartada (refutación fuerte)** — el límite superior del IC 90% de D < `u_min`. La ventaja, si existe, es menor que la
   que te importa. (Con `u_min` = 0 esta regla sólo dispara si D es claramente negativa.)
2. **Descartada (regla de decisión)** — la estimación puntual de D con costo base ≤ 0, **o** la estimación puntual de X ≤ 0.
   No es prueba de ausencia; es la decisión que pediste: no seguir invirtiendo tiempo en esta forma.
3. **Apoyada** — límite inferior del IC 90% de D > 0 **y** de X > 0, **y** la estimación puntual de D > `u_min` y sigue
   > 0 con costos ×2 y con desfase de 2 días.
4. **Inconclusa** — cualquier otro caso (D > 0 puntual pero sin significancia o sensible a costos). Siguiente paso: §6.8.

**Aparte, no compensable:** si el drawdown máximo de T supera la pérdida tolerable que declares, se informa como
**violación de restricción** aunque el resultado sea "apoyada" o "inconclusa".

### 6.6 Inferencia y suficiencia de muestra

- **Método:** bootstrap estacionario por bloques sobre las diferencias mensuales (bloque medio 12 meses; sensibilidad 6 y
  24; 10.000 réplicas; semilla fija registrada). Motivo: la señal de 12 meses genera posiciones persistentes y
  retornos dependientes; tratar meses como independientes infla la confianza. Nivel 90% (propuesto por el host: con esta
  muestra, 95% dejaría casi todo en "inconcluso"; se reporta también el 95%).
- **La muestra efectiva es el número de episodios de "vendido", no de meses.** Se reporta ese número; si es < 5, el
  resultado se etiqueta "muestra insuficiente" dentro de la categoría que corresponda.
- **Cálculo ilustrativo (supuestos del host, no datos):** `T − H = −2·r·1[vendido]`. Si el oro tuviera ~15% de volatilidad
  anual, la regla estuviera vendida ~30% del tiempo y hubiera ~15 años de datos, el error estándar de D rondaría
  `2 × 15% × √0,3 / √15 ≈ 4 pp/año`; para que el IC 90% excluya 0, D tendría que ser del orden de **6–7 pp/año**. Es decir:
  sólo una ventaja grande se confirmaría; una chica quedaría inconclusa. Los valores reales salen de los datos.

### 6.7 Variantes declaradas (se reportan todas; **la decisión se toma sólo con V0**)

| Variante | Qué cambia | Para qué |
|---|---|---|
| V1 vol-target | Posición `= σ_objetivo / σ̂` con σ̂ EWMA de retornos diarios (centro de masa 60 días, como MOP); σ_objetivo = volatilidad realizada de H en 2010→presente (definido ex ante); tope 2× | Ver si el escalado por volatilidad cambia la conclusión |
| V2 long/flat | En "vendido" se queda en efectivo | Alternativa natural a "o quedarse en efectivo" |
| Sensibilidad de lookback | 9 y 15 meses | Sólo robustez: si V0 "funciona" pero 9 y 15 no, se reporta como frágil |
| V-spot | §5.2 | Filtro previo barato, historia larga |
| Historia 1979–2009 | Si se consiguiera | Consistencia; dentro de la muestra del paper |

Se registran también las variantes que se descarten o fallen. Ninguna variante se promueve a principal después de ver resultados:
eso sería otra propuesta, con su propia prueba sobre datos futuros.

### 6.8 Si sale inconclusa

Opciones (decisión del owner): (a) seguimiento prospectivo mensual sin capital, con la señal calculada al cierre y registrada
antes del mes siguiente (acredita sólo señales y precios de settlement, **no fills**); (b) ampliar historia con datos pagos
pre-2010 sabiendo que son muestra del paper; (c) cerrar la línea.

### 6.9 Nivel de evidencia de la ejecución

La prueba usa **fills modelados** al settlement + costo supuesto. No hay cotizaciones bid/ask observadas ni fills reales. Un
resultado "apoyada" no acredita ejecutabilidad; para eso haría falta comparar con cotizaciones observadas (paso posterior).

---

## 7. Recorrido de situaciones (revisión local, sin delegación)

| Situación | Respuesta |
|---|---|
| Mes normal sin cambio de señal | Se mantiene; sólo costo si hay roll. |
| Cambio de señal | Cierre y apertura al settlement del día hábil siguiente; costo de 2 vías (salir de un lado y entrar al otro = 2× nocional). |
| Cambio de señal el día de roll | Una transición (§4). |
| Dato faltante | §4; si persiste, mes marcado y reportado con/sin. |
| Orden rechazada o parcial | No aplica a la prueba histórica (fill modelado). En seguimiento prospectivo: se registra, sin reintentos automáticos. |
| Evento contractual (FND, último día, feriado) | Roll 5 días hábiles antes del FND; feriados según calendario CME. Si el roll no se pudo hacer (dato ausente), se rola el primer día con dato y se marca. |
| Límite de precio / pausa de negociación | En la prueba: fill al siguiente settlement disponible (verificar reglas de límites dinámicos de COMEX, no confirmadas). |
| Salto de precio (gap) contra la posición | No hay stop; la pérdida se absorbe; se refleja en drawdown. |
| Límite de riesgo (pérdida tolerable) | Juzgado aparte (§6.5). |
| Entrega física | Evitada por construcción del roll. En una implementación real: estar comprado en entrega obliga a pagar el nocional completo; vendido obliga a entregar oro que no se tiene. **Verificar la política del broker** sobre cierre antes del FND. |

---

## 8. Cobertura (registro)

| Bloque | Estado | Contenido / motivo | Próximo paso |
|---|---|---|---|
| Mandato e identidad | definida (con 2 pendientes) | §1–2 | Owner: `u_min`, pérdida tolerable |
| Tesis y contexto | definida | §3, con evidencia contraria | Se valida/refuta con §6 |
| Universo | definida | GC COMEX, contrato activo más cercano (feb/abr/jun/ago/oct/dic) | Verificar specs vigentes en el reglamento (la página de CME no respondió) |
| Datos y variables | pendiente | Fuente adecuada identificada (paga); PIT por insumo en §5.1 | Owner decide datos (síntesis, punto 2) |
| Señal y selección | definida | §4 | — |
| Construcción | definida | Una pata, roll bimestral, ±1× | — |
| Sizing y cartera | pendiente (no crítico para la prueba) | La prueba normaliza a 1 unidad de capital. Implementar 1× requiere capital ≈ nocional de un GC (100 oz × precio); MGC (10 oz) da 10× más granularidad — liquidación, meses y liquidez de MGC **a verificar**. Margen ≠ pérdida máxima: con 1× nocional, una caída del oro de X% es pérdida de X% del capital, sin importar el margen. | Owner: capital; investigar margen vigente si se avanza |
| Ejecución | definida para la prueba; pendiente para implementación | Fill modelado al settlement; horario Globex dom–vie 18:00–17:00 ET con pausa de 60 min (CME) | Si se avanza: bid/ask observados, tipo de orden (a settlement: TAS, verificar disponibilidad en GC) |
| Gestión y salidas | definida | Sin stops/TP por diseño; salida = cambio de señal | — |
| Riesgo operacional | pendiente (no aplica a la prueba) | Sin ejecución en esta etapa | Definir si hubiera seguimiento prospectivo |
| Eventos y obligaciones | parcial | Entrega evitada por roll; límites de precio a verificar. **Impuestos y regulación para residente argentino operando futuros de EE.UU.: bloqueado** — no se resuelve de memoria | Consulta profesional/fuente vigente antes de cualquier implementación; no afecta la prueba (antes de impuestos) |
| Medición | definida | §6.4 | — |
| Evaluación | definida | §6.1–6.9 | Ejecutar cuando haya datos |
| Ciclo de vida | propuesta | Versión 0.1.0-draft; la regla queda congelada; resultados enlazados a esta versión; intentos fallidos registrados | Guardar en `knowledge/research` vía `cli research save` si el owner lo autoriza (no se escribió en esta sesión) |
| Rama futuros | parcial | Tamaño, tick ($0,10/oz → $10 por contrato), meses, último día de negociación, entrega (barra de 100 oz o 3 de 1 kg, fineza mínima 995, mediante warrant de depósito); serie continua vs contratos negociables distinguidos (§4) | Verificar reglamento cap. 113 directamente; límites de precio; margen |

---

## 9. Pendientes priorizados

| # | Pendiente | Tipo | Lo resuelve | Bloquea |
|---|---|---|---|---|
| 1 | `u_min` y pérdida tolerable | decisión del owner | owner | Nada del diseño; sí el criterio 1 y la restricción |
| 2 | Fuente de datos: pedir cotización a Databento o empezar con V-spot | decisión del owner | owner | Correr V0 |
| 3 | Verificar reglamento COMEX cap. 113 (FND, límites de precio, cambios 2010→hoy) y hora de settlement | investigación | host | Calendario de roll exacto |
| 4 | Verificar esquema de settlement en Databento y licencia LBMA | investigación | host | Carga de datos |
| 5 | Impuestos/regulación para residente argentino | fuente vigente / profesional | owner + especialista | Implementación (no la prueba) |
| 6 | Capital, broker, margen, MGC | decisión + investigación | owner + host | Sizing real (no la prueba) |

**Siguiente paso útil propuesto:** con tu `u_min` (o "todavía no sé"), correr V-spot como filtro gratuito, dejando V0
congelada. Si V-spot ya muestra D claramente negativa en historia larga, eso es información para decidir no comprar datos.
Si no, cotizar datos para V0.

---

## 10. Historial

- `0.1.0-draft` (2026-09-25): primera propuesta. Sin resultados previos. Búsqueda en la base de conocimiento sin
  antecedentes sobre oro o tendencia (búsqueda vacía ≠ prueba de ausencia).

---

## Fuentes

- Moskowitz, Ooi, Pedersen (2012), *Time Series Momentum*, JFE 104: 228–250. PDF: https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf
  — usado: regla (12m, 1m de tenencia), 58 contratos con TSMOM positivo (52 significativos al 5%), Sharpe por instrumento **bruto**,
  retornos del contrato más líquido, volatilidad EWMA con centro de masa 60 días, oro de COMEX, muestra 1985–2009, persistencia ~1 año
  y reversión parcial. La cifra propia del oro de la Tabla 1/Fig. 2 no se pudo leer de forma confiable en la extracción.
- Hurst, Ooi, Pedersen, *A Century of Evidence on Trend-Following Investing* (AQR). PDF: https://static.twentyoverten.com/593e8a9e7299b471eaecf644/SkLoGL67M/A-Century-of-Evidence-on-Trend-Following-Investing.pdf
  — usado: 67 mercados 1880–2016, señales 1/3/12m combinadas, target 10% vol, costos una vía para commodities 0,10% (2003–2016),
  ×2 (1993–2002), ×6 (1880–1992); **excluye costos de roll**.
- Huang, Li, Wang, Zhou (2020), *Time-series momentum: Is it there?*, JFE 135(3): 774–794. https://www.sciencedirect.com/science/article/abs/pii/S0304405X19301953
  (resumen vía búsqueda; texto completo no leído).
- CME Group, GC: especificaciones y reglamento cap. 113 (contenido tomado de resúmenes de búsqueda; las páginas no respondieron): https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html, https://www.cmegroup.com/rulebook/COMEX/1a/113.pdf, horarios: https://www.cmegroup.com/trading-hours.html
- Databento, catálogo GC: https://databento.com/catalog/cme/GLBX.MDP3/futures/GC (consultado 2026-09-25).
- FRED, retiro de datos IBA/LBMA (enero 2022): https://news.research.stlouisfed.org/2022/01/ice-benchmark-administration-ltd-iba-data-to-be-removed-from-fred/ (resumen de búsqueda).
- Preprint no leído y no usado: https://arxiv.org/pdf/2511.08571

---

## Registro

**Archivos leídos (workspace y locales)**
- `…/scratchpad/contrast/instruction/SKILL.md` y `…/instruction/coverage.md`
- `CLAUDE.md` (raíz, provisto en contexto)
- `ENGINEERING.md` (líneas 1–80)
- `knowledge/README.md` (inicio) y listado de `knowledge/research/`
- CLI de GaleCore-AI: `catalog`; `kb search --text "gold trend following futures time series momentum"` (4 resultados, todos
  registros de régimen SPY, no pertinentes); `kb search --text "oro gold GC COMEX momentum tendencia"` (0 resultados)
- Búsqueda de contenido (Grep) en `GaleCore/` por futuros/oro: sólo coincidencias en el runtime de opciones/SHADOW; no hay
  soporte de futuros de oro (no se abrieron esos archivos)
- PDFs descargados por las lecturas web (en `tool-results/`) y convertidos a texto en `scratchpad/tsmom.txt` y `scratchpad/century.txt`

**Consultas web (13 de 15)**
1. Lectura: https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html — timeout
2. Búsqueda: "Moskowitz Ooi Pedersen 2012 time series momentum gold futures 12-month results"
3. Lectura: https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf
4. Búsqueda: "Huang Li Wang Zhou 'Time-series momentum: Is it there?' …"
5. Búsqueda (cmegroup.com): "CME COMEX Gold futures GC contract specifications …"
6. Lectura: https://www.cmegroup.com/rulebook/COMEX/1a/113.pdf — timeout
7. Búsqueda: "COMEX gold futures delivery 995 fineness … Micro Gold MGC …"
8. Búsqueda: "free historical daily gold futures data … CHRIS discontinued … FRED LBMA removed 2022"
9. Lectura: https://databento.com/catalog/cme/GLBX.MDP3/futures/GC
10. Búsqueda: "Hurst Ooi Pedersen 'A Century of Evidence on Trend-Following Investing' transaction costs …"
11. Lectura: https://static.twentyoverten.com/593e8a9e7299b471eaecf644/SkLoGL67M/A-Century-of-Evidence-on-Trend-Following-Investing.pdf
12. Búsqueda: "gold futures time series momentum 12-month trend following evidence out-of-sample transaction costs …"
13. Búsqueda (cmegroup.com): "CME Globex gold futures GC trading hours … dynamic circuit breaker …"

Sin compras, sin contactos con proveedores, sin órdenes, sin conectores de cuentas. No se editaron archivos del workspace.
