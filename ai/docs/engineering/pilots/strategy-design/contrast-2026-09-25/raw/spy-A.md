# ¿Vender put credit spreads sobre SPY tiene una ventaja verificable después de costos?

Propuesta de investigación · 2026-09-25 · Estado: **hipótesis. No está validada ni aprobada.**

---

## 0. Resumen

- **Pregunta.** ¿Vender put credit spreads (PCS) sobre SPY sólo cuando la prima es atractiva y el
  entorno pasa ciertos controles de riesgo deja una ganancia neta de costos que no se explique por
  exposición al mercado ni por azar?
- **Punto de partida honesto.** Lo que hay en GaleCore (RPF, BT-0…BT-17) **no alcanza para afirmar
  esa ventaja**. Es compatible con una ventaja chica y también con una ventaja nula:
  - la ventana 2018–2025 se reutilizó en unas 20 corridas;
  - la configuración vigente nunca se corrió como tal (es una interpolación);
  - las reglas de gestión defensiva nunca se simularon;
  - con unos 85 trades en 8 años, 2 pérdidas en lugar de 5 o 6 se explican por azar con probabilidad
    del 7 % al 20 % (§3.2).
- **Propuesta.** Separar la afirmación en tres partes que se puedan probar por separado:
  - **H-A:** el PCS en sí paga, neto de costos.
  - **H-B:** los filtros de RPF agregan algo frente a vender de forma mecánica.
  - **H-C:** el resultado supera a la alternativa sin riesgo (T-bill) y a la exposición equivalente a
    SPY lo suficiente como para justificar operarlo.
- **La prueba** tiene tres etapas con criterios de descarte escritos antes de ver resultados:
  - **Etapa 0.** Auditoría sobre los datos que ya hay. Sólo puede **descartar**, porque la ventana
    está contaminada.
  - **Etapa 1.** Una ventana que nadie miró (2005–2012, con la crisis de 2008). Es la única prueba
    retrospectiva que puede **no refutar** con valor. Hace falta comprar datos, así que decide el owner.
  - **Etapa 2.** Seguimiento prospectivo congelado, sin órdenes.
- **Qué espero, sin haberlo corrido.** H-A probablemente sobrevive con un margen chico. H-B es la
  apuesta más frágil. H-C, al capital actual (~$16k), probablemente da "positivo pero económicamente
  débil". Hoy RPF declara ~$340 al año por contrato de ganancia de la estrategia pura; el ~6,4 % anual
  "combinado" es mayormente T-bill.

---

## 1. La pregunta en términos medibles

"Ventaja verificable después de costos" se define acá así. Las tres condiciones tienen que cumplirse
a la vez.

| Parte | Qué significa | Cómo se mide |
|---|---|---|
| **Neta** | Ganancia después de comisiones, fees, slippage realista y costos de gestión | P&L por trade con costos de dos escenarios (base y estresado, §5.1) |
| **Sobre la tasa libre de riesgo** | El colateral de un spread puede estar en T-bills: el P&L del spread **ya es** el exceso sobre T-bill. Sumar el T-bill al retorno (el "6,4 % combinado" de RPF) no agrega ventaja | P&L de la estrategia sola, sin T-bill, y su relación con el riesgo (CVaR 5 % mensual, maxDD) |
| **No explicada por beta** | Un PCS es una posición comprada en SPY de delta chico. Ganar en 2018–2025 (SPY ~14 % anual) puede ser simplemente estar comprado en un mercado alcista | Regresión del P&L diario (MTM) contra el retorno de SPY: el alfa (ordenada) tiene que ser > 0 |
| **No explicada por azar ni por selección** | Muchas variantes probadas sobre la misma ventana inflan el mejor resultado | Criterios pre-declarados, una sola corrida y ventana no usada. Sharpe deflactado por número de pruebas (Bailey y López de Prado) como control |
| **Verificable** | Alguien que no diseñó la estrategia puede reproducirla y llegar al mismo veredicto | Especificación congelada, scripts y datos identificados, criterios numéricos |

---

## 2. Antecedentes: qué dicen y cuánto pesan

### 2.1 GaleCore / RPF (antecedente, no respuesta)

| Afirmación de RPF | Tipo | Peso que le doy |
|---|---|---|
| El delta sobrestima ~2× la probabilidad de pérdida del lado put en SPY 2013–2025 (BT-1) | Hecho medido | Alto como hecho histórico. Bajo como ley: RPF mismo muestra que es "hija del drift" (IWM no lo replica; el factor deriva 0,33→0,61 entre ventanas y C4 falla) |
| VRP ≥ 1,2 separa trades mejores de peores (BT-2/3: $25,5 vs $9,5) | Medido in-sample, delta 0,20, hold a vencimiento | Medio. No es monótono (VRP > 1,55 es el peor cuartil, BT-10b) |
| La salida forzada a 21 DTE destruye resultados; el cierre al 50 % domina (BT-4) | Medido | Medio-alto: es un hallazgo mecánico con buena explicación |
| La config con filtros "gana siempre que opera" (win ~97 %) y opera ~8 veces al año | **Interpolado**, nunca corrido como fila (reconciliación §10.5) | Bajo |
| GEX ≥ 0 protege de crashes | Se apoya en **un** episodio (ago-2015), fuera del OOS | Bajo. Es un seguro plausible, no una evidencia |
| El walk-forward pasó (H2/H3) | Medido, pero después de que BT-9 falló y la hipótesis se re-formuló dos veces sobre la misma ventana | Medio-bajo: la disciplina fue buena, pero la ventana quedó agotada (lo dice RPF) |
| Escala: ~$340/año por contrato; maxDD −8,3 % sobre $10k | Medido (BT-15/17) | Alto como orden de magnitud |

### 2.2 Literatura pública (contexto, no prueba del caso)

- **La prima de volatilidad en opciones del S&P 500 existe y es persistente.** El índice Cboe PUT
  (venta de puts ATM con colateral en efectivo) tuvo retornos parecidos a los del S&P 500 con mucha
  menos volatilidad: 1986–2015, 10,1 % vs 9,8 % anual, desvío 10,1 % vs 15,3 %, Sharpe 0,67 vs 0,47.
  Entre 1990 y 2018, la volatilidad implícita promedio (19,3 %) superó a la realizada (15,1 %). Esto
  **apoya H-A en general**, pero para puts ATM a un mes sin ala comprada. No es el PCS a delta 0,25 con
  ala de $5.
- **Los puts más fuera del dinero son los más caros** (Bondarenko, "Why are put options so
  expensive?"). La consecuencia para el PCS es incómoda: el spread **vende** un put moderadamente
  caro (Δ 0,25) y **compra** el más caro de la curva (el ala). RPF lo midió: el ala se lleva ~87 % de
  la prima bruta (BT-13b, a Δ 0,30). El PCS es la forma **menos eficiente** de cosechar la prima por
  unidad de prima. Se justifica sólo por el riesgo definido y porque, a riesgo constante, en las
  pruebas de RPF el $5 le ganó a las alternativas.
- **Costos.** Muravyev y Pearson (RFS 2020) muestran que el spread efectivo de quien elige cuándo
  ejecutar puede ser menos del 40 % del spread cotizado. Suponer el precio medio no es absurdo, pero
  depende de la ejecución. Un spread de dos patas enviado por un minorista no tiene garantizado ese
  resultado, así que la prueba lleva un escenario estresado.
- **Sobreajuste por pruebas múltiples.** El Sharpe deflactado (Bailey y López de Prado) ajusta el
  umbral según cuántas variantes se probaron, la asimetría y las colas. En venta de prima, la
  asimetría negativa hace que el Sharpe ingenuo sobrestime más todavía.
- **Timing de la prima de volatilidad.** Hay literatura que vincula la estructura temporal del VIX con
  las primas de riesgo. No verifiqué un resultado concreto de timing fuera de muestra, así que lo trato
  como abierto. La idea de RPF de que "condicionar mejora" es justamente lo que H-B tiene que demostrar.
- **SPY es de ejercicio americano.** Existe riesgo de asignación anticipada y de pin al vencimiento
  (Cboe, Fidelity). Es menor en un PCS lado put, pero el backtest de RPF liquida a vencimiento contra el
  cierre y no lo modela.

---

## 3. Cuestionamiento de las reglas de RPF

### 3.1 Regla por regla

| # | Regla RPF | Problema | Qué hago con ella |
|---|---|---|---|
| R1 | `edge_emp = (crédito/ancho) / p_pérdida_empírica(delta)` con tabla trailing sin shrinkage | La tabla aprende de 13 años mayormente alcistas: el filtro de edge es, en buena parte, **una apuesta a que el drift continúe**. BT-9 ya mostró que esa tabla "miente en la transición" (2018). C4 (estabilidad) falla, declarado. Con shrinkage 50 % (H2) la estrategia casi no opera | Es el brazo a probar, no un supuesto. En la prueba compite contra no tener filtro de edge (M1) |
| R2 | VRP = IV ATM / RV30 trailing ≥ 1,2 | Mide la prima **ATM**, pero se vende a Δ 0,25 y se compra el ala: la prima relevante es la del ala put. No es monótono (VRP alto = espejismo de denominador). El 1,2 es un prior de literatura confirmado sobre la misma muestra | Se mantiene congelado en el brazo RPF. Sin re-tunear |
| R3 | GEX ≥ 0 como veto | Justificado por **un** episodio (2015), fuera del OOS; la mitad de las ocurrencias se pierden por él (BT-5). La reconstrucción histórica depende de una convención de signo del posicionamiento de dealers que no se observa. **Inconsistencia:** `GaleCore/decisiones/D-0001` dice "el GEX es informativo, no operativo", mientras el JSON RPF lo tiene como gate operativo | Decide el owner cuál vale. En la prueba, GEX va como sub-brazo (M2 con y sin GEX), sin elegir por resultado |
| R4 | Config final = Δ 0,25 + GEX + V2 | **Nunca se corrió** (es una interpolación entre dos filas de BT-17 y BT-15) | La Etapa 0 la corre tal cual, como primera cosa |
| R5 | Gestión: TP 50 %, `hard_defense` (Δ > 0,42 o pérdida ≥ 2× crédito), `defensive_roll`, `structural_support_loss`, kill switch −1 % | Sólo el TP 50 % está simulado. BT-4 mostró que las reglas de salida cambian la distribución a lo bruto (win 97 %→75 % con 21 DTE). Tres reglas del JSON **cambian la cola y nunca se probaron**. `hard_defense` a 2× crédito puede cristalizar pérdidas que BT-4 dice que "casi siempre se recuperan" | La prueba corre el JSON completo (aproximado a fin de día) **y** la versión sólo-TP. Si las defensas empeoran, se proponen quitar |
| R6 | "Win ~97 %" como evidencia central | La tasa de acierto no es la métrica: ver §3.2. El break-even del trade está en ~92–95 % de acierto | Métricas principales: P&L neto, CVaR, alfa |
| R7 | Entrada al cierre con datos del mismo cierre, crédito = `mark` corto − `mark` largo, fricción fija $6,30 | Supone ejecutar en el mismo instante en que se observa la señal y al precio medio. La fricción "conservadora" ($9,30, §7 del backtesting) no aparece como sensibilidad en BT-15/17 | Entrada al día siguiente y dos escenarios de costos (§5.1) |
| R8 | Ventana OOS 2018–2025 | Agotada (lo dice RPF). Más de 20 corridas: H1, H2, H3, scans, BT-11…17 | No se usa para confirmar nada, sólo para descartar (Etapa 0) |
| R9 | Capital: "$200/mes con ~$32k" | Mezcla T-bill con estrategia. La estrategia pura aporta ~$340/año por contrato: a $32k (≈2 contratos por posición) son ~$700/año. El resto es T-bill, que se obtiene sin operar | H-C se juzga sólo con el P&L de la estrategia |
| R10 | Liquidación a vencimiento contra el cierre de SPY | Ignora ejercicio americano, pin risk y el cierre real de posiciones parcialmente ITM | Se cierra el día hábil previo al vencimiento si no se tocó el TP (regla operable) |

### 3.2 Por qué 97 % de acierto no prueba nada con esta muestra

Una ganancia típica de un trade cerrado al 50 % es de ~$25–40. La pérdida máxima es de ~$420–450.

| Crédito | Ganancia al 50 % neta | Pérdida máx. neta | Acierto de break-even (si toda pérdida fuera máxima) |
|---|---|---|---|
| $0,60 | $23,7 | $446 | 95,0 % |
| $0,75 | $31,2 | $431 | 93,3 % |
| $0,90 | $38,7 | $416 | 91,5 % |

Con ~85 trades en 8 años (BT-17 C: 10,6 al año) y ~2 pérdidas observadas:

- si la verdadera tasa de pérdida fuera la de break-even (6,7 %), ver 2 o menos pérdidas tiene una
  probabilidad del **7 %**;
- con una tasa del 5 %, del **20 %**;
- con los 59 trades de la variante vigente (7,4 al año), del 23 % y del 43 %.

Todo esto, antes de corregir por las ~20 variantes probadas sobre la misma ventana. **La muestra no
separa "ventaja" de "sin ventaja".** Eso no refuta a RPF, pero sí vuelve inválido presentarlo como
validado.

---

## 4. La propuesta

### 4.1 En una frase

Vender un put credit spread de $5 sobre SPY, a ~45 días y con el put vendido cerca de Δ 0,25. Cerrarlo
al 50 % de la ganancia. Abrir sólo cuando el entorno no esté en alerta y la prima pague más que la
pérdida esperada. Aceptar la estrategia **sólo si** supera, neta de costos, a hacer lo mismo sin
filtros, al T-bill y a la exposición equivalente a SPY, en datos que nadie usó para diseñarla.

### 4.2 Brazos que se comparan (congelados antes de correr)

Estructura común a todos:

- PCS SPY, vencimiento en [35, 50] días, el más cercano a 45;
- short = el strike con |Δ| más cercano a 0,25 y long = short − $5;
- crédito ≥ $0,30 y crédito ≥ 10 % del ancho; spread cotizado ≤ 5 % por pata;
- TP al 50 % del crédito; sin salida por DTE; cierre el día hábil previo al vencimiento si sigue abierto;
- cartera: máximo 2 posiciones con vencimientos distintos (V2); 1 contrato por posición.

| Brazo | Qué agrega | Para qué |
|---|---|---|
| **M0 — mecánico** | Nada: abre cada vez que hay cupo | Mide si el PCS en sí paga (H-A) |
| **M1 — entorno** | M0 + flags rápidos (VIX < 30, VIX9D ≤ VIX3M, RoC5d VIX ≤ 12 %) + tail_score (VVIX 110/130 + skew25 RoC5d 5 %/8 %, score < 2) | Mide si los controles de seguridad reducen la cola sin matar el retorno |
| **M2 — RPF** | M1 + VRP ≥ 1,2 + `edge_emp` ≥ barra (1,05 / 1,10 / 1,10 / 1,20) + short ≤ put_wall; variantes **M2g** (con GEX ≥ 0) y **M2s** (sin GEX) | Mide si la parte "prima atractiva" agrega (H-B) |
| **M2-JSON** | M2g + `hard_defense` 0,42/2×, `defensive_roll`, `structural_support_loss`, kill switch, evaluados a fin de día | Mide si las defensas que no se probaron mejoran o empeoran |

Benchmarks: **T-bill 3m** sobre el mismo capital (el P&L del spread ya es exceso) y **SPY
delta-equivalente** (regresión del P&L diario contra SPY, que da alfa y beta).

Capital de referencia: $16k (el de RPF). Se reporta también a $32k.

### 4.3 Métricas (en este orden de importancia)

1. P&L neto total y por año, en ambos escenarios de costos.
2. Alfa diario contra SPY, con error estándar robusto a autocorrelación (bloques de 45 días).
3. CVaR 5 % del P&L mensual y maxDD sobre MTM diario.
4. Retorno por unidad de CVaR: se usa para comparar brazos.
5. Trades por año, días en posición y espera máxima entre entradas.
6. Tasa de acierto (informativa, nunca decisoria).

---

## 5. La prueba que permite descartarla

### 5.1 Reglas de ejecución (todas las etapas)

- Señal con datos del cierre t. **Entrada al cierre t+1** con las cotizaciones de t+1. Si en t+1 el
  spread ya no cumple los pisos, no se entra.
- **Costos base:** precio medio y $6,30 por contrato ida y vuelta (el cálculo de RPF).
- **Costos estresados:** cada pata se ejecuta a medio ± 50 % del semi-spread cotizado, más $2,48 de
  comisiones y fees y $0,80 de gestión. Si el spread cotizado no está disponible, se usa el piso de
  RPF de $9,30.
- La decisión se toma **con los costos estresados**. Los costos base se reportan como contexto.

### 5.2 Etapa 0: auditoría sobre 2013–2025 (datos existentes; sólo puede descartar)

La ventana está contaminada, así que aprobarla no prueba nada. Lo que sí vale es un fracaso **con
ejecución realista**: la ventana que favoreció al diseño tampoco lo sostiene.

**Pre-registro de descarte.** Cualquiera de estos, con costos estresados y entrada t+1, descarta la
hipótesis en su forma actual:

- **E0-1.** El P&L total neto de M2g en 2018–2025 es ≤ 0.
- **E0-2.** El alfa estimado de M2g contra SPY es ≤ 0 (punto estimado). Sería "beta cara".
- **E0-3.** M2g no supera a M0 en retorno por unidad de CVaR. En ese caso **los filtros se
  descartan** (H-B cae) y la hipótesis sigue sólo como M0 o M1.
- **E0-4.** M2-JSON empeora el P&L o el CVaR frente a M2g. En ese caso **las defensas no probadas se
  proponen quitar**; esto no descarta la estrategia.

También se reporta, para entender el resultado y no para decidir: la diferencia entre la config
interpolada (Δ 0,25 + GEX) y los números esperados de RPF (~8 trades/año, win ~97 %, peor año
≥ −$140).

**Costo.** Tiempo de cómputo con los scripts existentes (`GaleCore/research/backtesting/`, que ya
tienen el pipeline). No requiere compras.

### 5.3 Etapa 1: ventana virgen 2005–2012 (la prueba que puede "no refutar")

Por qué esta ventana:

- nadie la miró: RPF sólo tiene SPY desde 2013;
- incluye **2008**, el escenario que todos los gates dicen cubrir, además de 2010 y 2011;
- es anterior a las series de VIX9D y VIX3M completas. Si falta alguna serie, se usa el proxy
  declarado **antes** de correr (p. ej. VIX vs VXV) y se registra.

Procedimiento:

1. Congelar este documento, el JSON y los scripts con hash, **antes** de obtener los datos.
2. La tabla POP se calibra sólo con datos anteriores a cada año. Para 2005–2007 no hay historia
   previa; la regla congelada es calibrar con 2013–2017 y aplicarla hacia atrás. Es una debilidad
   declarada.
3. Correr una vez cada brazo y reportar tal cual.

**Criterios (inamovibles):**

| Id | Descarta si… | Qué descarta |
|---|---|---|
| E1-1 | P&L neto total de M0 ≤ 0 | H-A: el PCS en sí no paga neto en este período |
| E1-2 | P&L neto total de M2g ≤ 0, **o** algún año < −$870 (≈ 2 pérdidas máximas, una por cupo V2), **o** maxDD > 15 % de $16k | La estrategia completa |
| E1-3 | M2g no supera a M0 **y** a M1 en retorno por unidad de CVaR | H-B: los filtros de prima |
| E1-4 | Alfa de M2g contra SPY ≤ 0 | "Ventaja" (es beta) |
| E1-5 | El factor put `p_real/Δ` en la ventana es ≥ 0,9 (el delta no sobrestimó el riesgo) | El fundamento de `edge_emp` fuera del período alcista |

Si nada se dispara, el resultado es "**no refutada en una ventana independiente**", no "probada". Con
~8 trades al año, 8 años dan ~60 trades: poca potencia estadística, por diseño del problema.

**Requiere decisión del owner:** comprar cadenas EOD de SPY 2005–2012 (fuentes que RPF ya lista: Cboe
DataShop, ORATS, Polygon, OptionMetrics). No contacté proveedores ni consulté precios.

### 5.4 Etapa 2: prospectiva congelada (sin órdenes)

La especificación ganadora de las etapas anteriores se congela y corre en SHADOW/paper con cotizaciones
reales en el momento de la sugerencia. GaleCore ya tiene el feed y el loop RPF.

Hay dos registros:

- **Libro de trades**, según la regla de cartera.
- **Libro diario hipotético:** cada día se registran el spread que abriría M0 y la decisión de M1 y de
  M2, con su resultado posterior. Da ~250 observaciones al año, solapadas, que se analizan por bloques
  de 45 días. Sirve para comparar brazos más rápido que esperar trades.

**Criterios de descarte:**

| Id | Descarta si… | Lectura |
|---|---|---|
| E2-1 | ≥ 2 trades perdedores en los primeros 10, o ≥ 3 en los primeros 20 | Con 3 % de pérdidas (lo que afirma RPF), la probabilidad es del 3,5 % y del 2,1 %. Refuta el "~97 %" y acerca al break-even |
| E2-2 | Costo efectivo medio (medio vs precio que se habría obtenido a la cotización natural, más comisiones) > $9,30 por contrato en los primeros 10 trades | Refuta el supuesto de costos |
| E2-3 | Factor put trailing de 12 meses ≥ 0,9 | Cambió el drift: `edge_emp` pierde fundamento |
| E2-4 | Después de 24 meses, el libro diario M2 no supera a M0 en retorno por CVaR | H-B |

**Límite honesto.** A ~8 trades al año, llegar a 20 trades lleva ~2,5 años. La Etapa 2 **descarta
rápido si la estrategia es mala**, pero confirma lento. No hay atajo sin más subyacentes o más
historia.

### 5.5 Qué no cuenta como evidencia

- Resultados de la ventana 2018–2025 a favor.
- Tasa de acierto alta sin P&L ni CVaR.
- Retorno "combinado" con T-bill.
- Re-corridas con parámetros ajustados después de ver un resultado.
- Casos sueltos ("hoy habría disparado bien").

---

## 6. Qué haría con cada resultado

| Resultado | Veredicto | Siguiente paso |
|---|---|---|
| Falla E0-1 o E0-2 | **Hipótesis descartada** en su forma actual | Registrar. No gastar en datos. Si se quiere seguir, sería otra hipótesis |
| Pasa Etapa 0, falla E0-3 | **Filtros de prima descartados** | Seguir sólo con M0/M1 (más simple, más trades) a Etapa 1 |
| Pasa Etapa 0, el owner no compra datos | **Evidencia insuficiente** | Etapa 2 directa, sabiendo que confirma lento |
| Pasa Etapa 1 | **No refutada** en ventana independiente | Etapa 2 y evaluación de H-C: ¿el P&L de la estrategia (no el T-bill) justifica la operación al capital real? |
| Pasa todo, pero con P&L de la estrategia < umbral del owner | **Positiva pero económicamente débil** | Decisión de negocio, no de datos |

---

## 7. Decisiones que necesita el owner

1. **¿GEX es gate o sólo informativo?** D-0001 y el JSON RPF se contradicen. Mientras tanto, la prueba
   corre ambas variantes.
2. **¿Se compran cadenas SPY 2005–2012?** Es la única prueba retrospectiva limpia que queda. No tengo
   precios porque no contacté proveedores.
3. **Umbral económico de H-C:** cuánto P&L de estrategia pura por año, sobre qué capital y con qué
   maxDD, hace que valga la pena operar. Propuesta por defecto, para discutir: ≥ 2 pp anuales sobre
   T-bill en el capital asignado, con maxDD ≤ 10 %.
4. **¿Se aceptan quitar reglas de gestión no probadas** si la Etapa 0 muestra que empeoran?
5. **Fuera de alcance, pero a considerar:** XSP/SPX (europeas, liquidación en efectivo, sin asignación
   anticipada) en lugar de SPY. Sería otra ficha, con su propia prueba.

---

## 8. Limitaciones de esta propuesta

- No corrí nada. Todos los números de la §2 y la §3 vienen de los documentos de RPF y de la
  literatura citada. Las probabilidades de la §3.2 son un cálculo binomial simple.
- Leí los scripts `scan_delta.py` y `bt10_mgmtB.py`. No leí `bt15_portfolio.py` ni `bt17_levers.py`,
  así que no verifiqué si la cartera V2 usa exactamente la misma ejecución.
- Supongo que `mark` es el precio medio del dataset: no abrí `dataset_description.pdf`.
- La aproximación de `hard_defense` a fin de día subestima los disparos intradía.
- No leí `galecore-rpf-fase5-orquestacion.md`, `galecore-rpf-implementacion.md` ni
  `galecore-rpf-plan-validacion.md`. Para esta pregunta pesan menos que el research y el libro mayor.

---

## Registro

### Archivos leídos (workspace)

- `CLAUDE.md` (raíz; provisto en contexto)
- `GaleCore/docs/rpf/README.md`
- `GaleCore/docs/rpf/galecore-estrategia-rpf.md`
- `GaleCore/docs/rpf/galecore-rpf-reconciliacion.md`
- `GaleCore/docs/rpf/galecore-research-backtesting-rpf.md` (completo)
- `GaleCore/research/backtesting/README.md`
- `GaleCore/research/backtesting/scan_delta.py`
- `GaleCore/research/backtesting/bt10_mgmtB.py`
- `GaleCore/source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json` (estructura,
  `trade_management`, `position_builder`, fragmentos del resto)
- `GaleCore/decisiones/D-0001-pivot-v140-pcs-only.md`
- `GaleCore/decisiones/D-0002-skew25-domina-tail-score.md`
- `GaleCore/docs/tastylive-options-strategy-put-credit-spread.md` (primeras 60 líneas)
- `knowledge/README.md` (primeras 60 líneas)
- `knowledge/research/2026-09-23-gex-0dte-post-cierre.md` (primeras 80 líneas)
- `GaleCore-AI/docs/architecture/USE-CASE-STRATEGY-DEVELOPMENT-E2E.md` (líneas 1–200 y 358–537)
- Listados de directorio: raíz, `GaleCore/`, `GaleCore/docs/`, `GaleCore/docs/rpf/`, `knowledge/`,
  `GaleCore/estrategias/` (vacías), `GaleCore/catalogo/` (vacío), `GaleCore/research/`,
  `GaleCore/research/data/`, `GaleCore-AI/docs/`

No se leyó nada bajo `.worktrees/`, `roadmap/`, `decisiones/D-0004*`, `decisiones/D-0005*`,
`GaleCore-AI/docs/engineering/work-items/`, `GaleCore-AI/docs/engineering/reviews/`, ningún
`SESSION_HANDOFF.md` ni la memoria de `~/.claude/projects`.

### Consultas web (8 de 15)

Búsquedas (7):

1. `Cboe PutWrite index PUT long-term performance vs S&P 500 risk-adjusted study`
2. `Muravyev Pearson "Options Trading Costs Are Lower Than You Think" effective spread`
3. `Bailey López de Prado deflated Sharpe ratio multiple testing backtest overfitting`
4. `Bondarenko "Why are put options so expensive" out-of-the-money S&P 500 puts returns`
5. `short put vertical spread S&P 500 backtest returns after transaction costs study delta 0.25 45 DTE 50% profit`
6. `SPY options early assignment dividend risk short put spread American exercise ex-dividend`
7. `timing the variance risk premium VIX term structure conditional short volatility strategy out-of-sample evidence`

Lecturas de página (1):

8. https://spintwig.com/short-spx-vertical-put-45-dte-s1-signal-options-backtest/ (resultados
   detrás de un muro de pago; no se usó ningún número)

### URLs citadas (de los resultados de búsqueda)

- https://en.wikipedia.org/wiki/CBOE_S&P_500_PutWrite_Index
- https://cdn.cboe.com/resources/education/research_publications/PUTIndexEnnisKnupp.pdf
- https://www.cboe.com/insights/posts/white-paper-shows-volatility-risk-premium-facilitated-higher-risk-adjusted-returns-for-put-index/
- https://cdn.cboe.com/resources/education/research_publications/PutWriteCBOE19_v14_by_Prof_Oleg_Bondarenko_as_of_June_14.pdf
- https://academic.oup.com/rfs/article-abstract/33/11/4973/5732665
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=375784
- https://www.worldscientific.com/doi/10.1142/S2010139214500153
- https://www.fidelity.com/learning-center/investment-products/options/dividends-options-assignment-risk
- https://www.cboe.com/insights/posts/dont-get-stuck-paying-the-dividend-on-your-short-trade
- https://www.travislakejohnson.com/pdfs/Johnson%20VIXTS%202017%20(JFQA).pdf (sólo como referencia de
  que existe literatura; no verifiqué su contenido)

### Cálculos propios

- Binomial y break-even de la §3.2 (Python, en línea): P(≤2 pérdidas | n=85, p=0,067) = 0,070;
  (n=85, p=0,05) = 0,196; (n=59, p=0,067) = 0,235; (n=59, p=0,05) = 0,429; P(≥2 | n=10, p=0,03) =
  0,035; P(≥3 | n=20, p=0,03) = 0,021; acierto de break-even con crédito $0,60 / $0,75 / $0,90 =
  95,0 % / 93,3 % / 91,5 %.

### Sin acciones externas

Sin compras, sin contacto con proveedores, sin órdenes, sin conectores de cuentas (IBKR, IoL,
Supabase, etc.). Sin ediciones en el workspace.
