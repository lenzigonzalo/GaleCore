# Propuesta: ¿vender prima con put credit spreads sobre SPY tiene ventaja después de costos?

Primer recorrido real de la instrucción [`SKILL.md`](SKILL.md) (v0.1.0-draft) + [`coverage.md`](coverage.md).
GC-AI-0006, piloto de I4. Fecha: 2026-09-25. Autor: Claude Code (host) aplicando la instrucción.

**Qué es y qué no es.** Es una propuesta para que el owner la entienda y la evalúe: hipótesis, reglas
cuestionadas, evidencia, faltantes y una prueba que permitiría descartarla. **No** es una estrategia aprobada,
no demuestra rentabilidad, no convierte nada a `StrategySpec` ni se despliega. RPF se usa como antecedente,
no como respuesta.

**Convenciones.** Cada número dice de dónde sale. "Cálculo propio" = aritmética sobre números citados, sin
datos nuevos. Las rutas son relativas al workspace (`GaleCore/…`, `knowledge/…`).

---

## 1. En corto (lo que podés decidir hoy)

- **Ventaja buscada:** cobrar la prima que el mercado paga por protegerse de caídas (implícita > realizada)
  vendiendo un put spread de riesgo definido en SPY, y quedarse con ella **después de costos** y **sin que
  una pérdida grande se coma años de cobro**.
- **Por qué podría existir:** hay evidencia pública de décadas de que la volatilidad implícita del índice
  supera a la realizada y de que vender puts de índice rindió con menos volatilidad que el índice (§3).
- **Qué dice lo nuestro (RPF):** en 2013–2025 la versión filtrada ganó casi siempre que operó, poco y con
  renta chica; pero esos números salen de una ventana ya usada muchas veces, con muy pocas pérdidas para
  medir la cola, y la configuración final no fue medida tal cual (§3.2).
- **Lo que no sabemos y es lo importante:** si la ventaja es **la prima en sí** (vender siempre) o **el timing
  de RPF** (sus filtros), y cuánto pesa la cola en un período que RPF nunca vio (2008).
- **Prueba que la descartaría (§6):** en datos nunca usados (SPY pre-2013, a comprar) y luego en seguimiento
  prospectivo, que el resultado neto por operación no supere a no operar (T-bill), o que los filtros no mejoren
  a la venta mecánica por unidad de riesgo.
- **Decisiones tuyas que destraban el paso siguiente:** (a) si se compran datos de opciones SPY anteriores
  a 2013 (costo a cotizar); (b) los umbrales de aceptación de la prueba (§6.3), que no fijo yo; (c) qué
  pérdida máxima tolerás respecto de la renta esperada (define sizing y si la idea sirve para tu objetivo).

---

## 2. Mandato entendido

| Dimensión | Estado | Contenido / motivo |
|---|---|---|
| Propósito | definida | Verificar si existe una ventaja **después de costos** (owner, 25/09). |
| Instrumento | definida | Put credit spreads sobre SPY (owner). Riesgo definido: sin naked, sin ratio, sin long direccional (`GaleCore/CLAUDE.md`). |
| Condiciones | definida en forma, pendiente en contenido | "Prima atractiva" + "entorno cumple condiciones de riesgo": RPF las operacionaliza (§4.A); aquí se cuestionan. |
| Objetivo de negocio | antecedente, no confirmado hoy | RPF: $200/mes ≈ $32k de fondeo live (`GaleCore/decisiones/D-0001-pivot-v140-pcs-only.md`). Para esta propuesta, la pregunta es la ventaja, no la meta de renta. |
| Pérdida tolerable, horizonte, capital | pendiente | Decide el owner (§1c). RPF fijó base $16k, heat 7 %, maxDD 5 % como restricciones de riesgo (`GaleCore/docs/rpf/galecore-estrategia-rpf.md` §7.3). |
| Grado de intervención | definida (antecedente) | "El sistema sugiere, nunca ejecuta" (RPF §1.6). |

---

## 3. Tesis, alternativas y evidencia

### 3.1 Tesis (mecanismo → resultado → captura → falla)

1. **Mecanismo.** Los compradores de protección sobre el índice pagan una prima por encima de la volatilidad
   que después se realiza (prima de riesgo de volatilidad, VRP). El vendedor cobra esa prima como
   compensación por cargar el riesgo de caídas bruscas.
2. **Resultado buscado.** Resultado neto positivo por operación, después de comisiones, spread bid/ask y
   gestión, mayor que el de no operar (efectivo a T-bill), con pérdidas acotadas por construcción.
3. **Captura.** Vender un put OTM y comprar otro más abajo (riesgo máximo = ancho − crédito), a ~45 días,
   cerrando al 50 % del crédito; opcionalmente, **sólo cuando** la prima está cara respecto de lo realizado y
   el entorno no muestra estrés (los filtros de RPF).
4. **Falla.** (a) la prima cobrada no cubre las pérdidas de los episodios de caída; (b) los costos se comen la
   prima (créditos chicos a delta bajo); (c) los filtros no anticipan el estrés y sólo reducen la frecuencia;
   (d) lo observado en 2013–2025 no representa el riesgo real (muestra sin un 2008).

### 3.2 Evidencia

| # | A favor / en contra | Qué dice | Fuente |
|---|---|---|---|
| E1 | A favor | La varianza implícita del índice (swap rate sintetizado con opciones) supera sistemáticamente a la realizada: existe una prima de riesgo de varianza. | Carr & Wu (2009), *Variance Risk Premiums*, RFS 22(3):1311–1341, [doi:10.1093/rfs/hhn038](https://academic.oup.com/rfs/article-abstract/22/3/1311/1581057) |
| E2 | A favor | 1990–2018: VIX promedio 19,3 % vs volatilidad realizada del S&P 500 15,1 %; el índice PutWrite (PUT) tuvo volatilidad anual 9,95 % vs 14,93 % del S&P 500 (1986–2018). | Nota de Cboe sobre el estudio de Bondarenko, 29/05/2019, [cboe.com](https://www.cboe.com/insights/posts/white-paper-shows-volatility-risk-premium-facilitated-higher-risk-adjusted-returns-for-put-index/). Es del patrocinador del índice; el PDF original no se pudo leer en esta máquina. |
| E3 | A favor (con reserva) | Los puts del S&P 500 fueron "demasiado caros" para los modelos estándar de valuación. | Bondarenko (2014), *Why Are Put Options So Expensive?*, QJF 4(3), [worldscientific](https://www.worldscientific.com/doi/abs/10.1142/S2010139214500153) |
| E4 | **En contra / alternativa** | El mismo trabajo analiza el "peso problem": que la muestra no contenga los desastres raros que justifican el precio. Si eso fuera la explicación, la "ventaja" es pago por un riesgo que todavía no se vio. | Bondarenko (2014), misma fuente (resumen del artículo) |
| E5 | **En contra / matiz** | Todos los índices de opciones y de acciones estudiados tienen asimetría negativa: métricas tipo Sharpe pueden sobrestimar la calidad. | Nota de Cboe (E2) |
| E6 | A favor (in-sample) | Vender PCS **sin filtros** en SPY 2013–2025 ya dio $17,1 promedio neto por señal-día (win 91,9 %); con todos los filtros de RPF, $50,9 (win 99,2 %) y las pérdidas > $200 cayeron de 195 a 1. | BT-5, `GaleCore/docs/rpf/galecore-research-backtesting-rpf.md` §BT-5 |
| E7 | **En contra** | Esa escalera es in-sample con 5 capas ajustadas sobre los mismos 13 años (lo dice el propio documento). | BT-5, caveat 4 |
| E8 | **En contra** | Primer walk-forward (H1, criterios pre-declarados): **reprobado**. La separación del filtro casi desapareció fuera de muestra (seleccionadas $13,31 vs rechazadas $12,60) y 2018 dio −$5.496 en SPY. | BT-9, mismo documento |
| E9 | A favor (condicionado) | Tercera iteración (H3, delta 0,30) aprobó en QQQ; con gestión B, SPY dio win 96,5 %, avg $35,5, p5 +$32, peor año −$449. | BT-10c, mismo documento |
| E10 | **En contra** | La ventana 2018–2025 quedó "agotada": se usó en scan exploratorio y en tres iteraciones; el documento lo declara ("no queda superficie virgen"). | BT-11, mismo documento; RPF §12.1 |
| E11 | **En contra** | La configuración elegida (delta 0,25 + GEX ≥ 0) es una **interpolación**, no una fila medida: el ganador de BT-17 es delta 0,25 **sin** GEX. | RPF §12.4; `_meta.config_note` de `galecore_rules_rpf.json` |
| E12 | Renta vs cola | BT-17 variante C: 10,6 operaciones/año, win 97,6 %, total $2.723 en 8 años, peor año −$140, maxDD −8,4 %. | BT-17 |
| E13 | **En contra (cálculo propio)** | Con 10,6 op/año × 8 años ≈ 85 operaciones y 2,4 % de pérdidas, la cola se estima con **≈ 2 operaciones perdedoras**: no alcanza para medir el riesgo de cola. | Cálculo propio sobre E12 |
| E14 | **En contra (cálculo propio)** | Renta ≈ $340/año por contrato ($2.723 / 8, coincide con RPF §12). Riesgo máximo por contrato ≈ $425–450 (ancho $5 − crédito de 10–15 % del ancho, RPF §4). **Una pérdida máxima ≈ 1,25–1,3 años de renta.** | Cálculo propio sobre RPF §4, §12 y E12 |
| E15 | **En contra (cálculo propio)** | El piso de fricción de RPF (1,02–1,06) se calculó con crédito = 1/3 del ancho; a delta 0,25 el crédito es 10–15 % del ancho: $6,30 sobre $50–75 da un piso ≈ 1,08–1,13, **por encima** de la barra `min_edge` de régimen normal (1,05). | Cálculo propio sobre §7 del documento de backtesting y RPF §4, §6 |
| E16 | **En contra** | Los datos de opciones del backtest cubren 2013–2025: **2008 nunca se probó** con la estrategia. | §2.1 del documento de backtesting |
| E17 | Contexto | Los umbrales del veto de cola (VVIX 110/130, skew 5 %/8 %) se calibraron "con ~5 crashes reales (muestra de un dígito)" y el documento los llama "provisorios y sobreajustados". | §1 del documento de backtesting |
| E18 | Contexto vivo | El 25/09 en sesión, el GEX de SPY estuvo entre −81,9 y −86,3 en las 17 lecturas con dato (escala de GaleCore): con el gate GEX ≥ 0, RPF no habría operado. | `GaleCore/docs/evidence/gc-0004/run1-en-sesion.json` |

**Lectura.** La existencia de una prima de volatilidad en el índice está bien respaldada fuera de GaleCore
(E1–E3). Lo que **no** está respaldado es que el **timing de RPF** agregue valor fuera de muestra (E7, E8, E10,
E11) ni que la cola esté medida (E13, E16). La renta es chica frente a una pérdida máxima (E14).

### 3.3 Explicaciones alternativas del resultado de RPF

- **La prima sola alcanza:** E6 sugiere que vender siempre ya era positivo in-sample; los filtros podrían sólo
  cambiar frecuencia y varianza. Se prueba comparando contra la venta mecánica (§6).
- **Sobreajuste:** barras elegidas con barrido full-sample (declarado en BT-9) y ventana reutilizada (E10).
- **Drift alcista 2013–2025:** RPF dice que la calibración de probabilidad de pérdida es "hija del drift"
  (RPF §3.2); con otro drift, cambia.
- **Peso problem:** E4; los años sin desastre hacen ver la prima como ventaja.

---

## 4. Reglas: tres capas separadas

### 4.A Reglas actuales de RPF (antecedente, tal como están)

Fuente de verdad operativa: `GaleCore/source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json`
(v0.2.0-draft, `paper_only`); definición: `GaleCore/docs/rpf/galecore-estrategia-rpf.md`.

| Regla | Valor actual | Origen declarado |
|---|---|---|
| Universo / estructura | SPY; sólo put credit spread | Decisión del operador + BT-11 (IC/CCS podados) |
| Régimen (`macro_regime`) | VIX < 30; VIX9D < VIX; aceleración de vol ≤ 12 %; GEX ≥ 0 | BT-0; GEX: BT-5/BT-17 + decisión "safety-first" |
| Veto de cola | VVIX 110/130 + RoC5d del skew25 5 %/8 %, score ≥ 2 → no opera | BT-9b |
| Prima cara | VRP = IV ATM 30d / RV30 ≥ 1,2 | BT-2/3 (prior de literatura) |
| Edge | (crédito/ancho) / p_pérdida empírica ≥ 1,05 normal · 1,10 low_vol/elevated · 1,20 caution | BT-3 run-2 |
| Construcción | short delta 0,25; ancho $5; DTE 35–50 (objetivo 45); short ≤ put wall | BT-17, BT-12, BT 3-bis |
| Pisos | crédito ≥ $0,30 y ≥ 10 % del ancho; OI ≥ 100; spread ≤ 5 % | BT-3, §8 |
| Tamaño y cartera | riesgo 3,5 % (máx 5 %, banda 5–8 % con aprobación); ≤ 2 posiciones, vencimientos distintos; heat ≤ 7 % | BT-15, decisión 3 |
| Salidas | cierre al 50 % del crédito; sin salida por DTE; defensa si delta short > 0,42 o pérdida ≥ 2× crédito; roll defensivo desde pérdida ≥ 1× crédito (nuevo vencimiento ≥ 21 DTE); kill switch −1 % diario | BT-4, BT-12, decisión 4; el roll: "§9 diseño; no refutado" (reconciliación) |
| Fricción | $6,30 por operación | §7 del documento de backtesting |

### 4.B Recomendaciones nuevas (propuestas en este recorrido)

| # | Recomendación | Razón |
|---|---|---|
| R1 | Medir la ventaja contra **dos líneas de base**: no operar (T-bill) y **venta mecánica** (mismo delta, DTE y gestión, sin filtros). Reportar RPF como diferencia contra ambas. | Separa "la prima existe" de "el timing agrega" (§3.3). |
| R2 | Todo resultado de cabecera **por operación** de la cartera real (no por señal-día) y con intervalos por bloques de tiempo. | BT-5 cuenta señales-día superpuestas, que no son independientes (coverage: dependencia entre observaciones). |
| R3 | La cola se evalúa con **escenarios de estrés y la pérdida máxima por construcción**, no con la tasa de acierto. | Con ≈ 2 pérdidas (E13) la estadística de cola no informa. |
| R4 | Recalcular el piso de fricción con el **crédito real a delta 0,25** y revisar la barra de régimen normal. | E15: el principio "min_edge ≥ 1 + fricción/crédito" de RPF no se cumpliría con créditos típicos. |
| R5 | Aclarar la regla de estructura temporal: **VIX9D < VIX** (JSON) vs **VIX9D > VIX3M** (definición §5). | Dos documentos de RPF dicen cosas distintas; manda el JSON, pero la definición es la que se cita. |
| R6 | Probar la sensibilidad del gate GEX a la definición del corte (0DTE incluido o no, DTE < 90 vs < 60). | El gate usa sólo el signo, y el signo puede cambiar con el corte (`knowledge/research/2026-09-23-gex-0dte-post-cierre.md`). |
| R7 | Tratar la configuración final como **no medida** hasta correr la fila delta 0,25 + GEX + V2. | E11; RPF §12.4 ya lo prevé si paper no coincide. |
| R8 | Declarar el **edge a vencimiento** vs la **gestión al 50 %**: el edge se calcula con probabilidades a vencimiento, pero la posición se cierra antes. | Coherencia entre la señal y la salida real (coverage: gestión y salidas). |

### 4.C Parámetros pendientes de fundamento (no se proponen números)

| Parámetro | Estado | Por qué está pendiente | Qué lo resuelve |
|---|---|---|---|
| Umbrales de régimen (VIX 30, 12 %) | pendiente | Calibrados en la ventana agotada | Prueba en datos nuevos (§6) |
| Veto de cola (VVIX 110/130, skew 5 %/8 %) | pendiente | "~5 crashes", "provisorios y sobreajustados" (E17) | Datos pre-2013 con 2008; escenarios |
| `vrp_min` 1,2 | pendiente | Prior de literatura, validado in-sample | §6, pregunta P2 |
| Barras `min_edge` | pendiente | Elegidas con barrido full-sample (BT-9); normal < piso de fricción (E15) | R4 + §6 |
| Delta 0,25 con GEX | pendiente | Interpolación (E11) | R7 |
| Roll defensivo desde 1× crédito | pendiente | Del diseño original, nunca medido | Datos nuevos, §6 |
| Hard defense 0,42 / 2× crédito | definida con reserva | BT-12 midió deterioro sin acantilado en la ventana usada | §6 |
| Riesgo por operación, heat 7 %, maxDD 5 %, kill −1 % | **restricción del usuario**, no parámetro investigable | Son preferencias de riesgo del owner, no se optimizan | Confirmación del owner (§1c) |

---

## 5. Cobertura de la instrucción (estado por bloque)

| Bloque (coverage.md) | Estado | Nota |
|---|---|---|
| Mandato e identidad | parcial | Nombre por propósito pendiente (no se usa "RPF" ni "PCS-SPY" como nombre de la estrategia); objetivo y pérdida tolerable: §1c. |
| Tesis y contexto | definida | §3.1, §3.3; abstención = los filtros de RPF cuando corresponda. |
| Universo | definida | SPY, opciones listadas en EE. UU., cuenta Tastytrade (antecedente RPF). |
| Datos y variables | parcial | EOD 2013–2025 con quirks conocidos (IV/griegas degeneradas en 0DTE; `in_the_money` roto, memoria del host); faltan pre-2013 (bloqueado por compra). |
| Señal y selección | antecedente | §4.A; cuestionada en §4.B/§4.C. |
| Construcción | antecedente | §4.A. |
| Sizing y cartera | pendiente | Depende de §1c; RPF: base $16k, fondeo $32k. |
| Ejecución | parcial | Fricción $6,30 base / $9,30 conservador (fills al natural); falta observar fills reales (SHADOW/paper). No se asume fill a mid como resultado. |
| Gestión y salidas | antecedente + R8 | |
| Riesgo operacional | antecedente | Sugiere y no ejecuta; kill switch; datos que faltan bloquean (runtime SHADOW, I2). |
| Eventos y obligaciones | **pendiente** | SPY: opciones de estilo americano con entrega física; asignación anticipada del put corto en profundidad ITM y riesgo al vencimiento. RPF cierra ITM; falta verificar términos vigentes en fuente primaria (OCC/Cboe) y el efecto de dividendos. |
| Medición | definida (propuesta) | R1–R3. |
| Evaluación | definida (propuesta) | §6. |
| Ciclo de vida | parcial | Versionado por hash en GaleCore (I2–I3); falta el vínculo propuesta → prueba → resultado (I4). |

---

## 6. Plan de prueba (fijado antes de ver resultados)

### 6.1 Preguntas

- **P1 — ¿Existe la ventaja sin timing?** Venta mecánica de PCS (delta, DTE, ancho y gestión de §4.A, sin
  filtros): resultado neto por operación vs T-bill.
- **P2 — ¿El timing de RPF agrega?** RPF completo vs venta mecánica, por unidad de riesgo y en la cola.
- **P3 — ¿Sobrevive a 2008?** Ambas en un período con una crisis que RPF no vio.
- **P4 — ¿La ejecución real se parece a la simulada?** Fricción, fills y frecuencia en seguimiento prospectivo.

### 6.2 Datos y método

| Paso | Datos | Método | Estado |
|---|---|---|---|
| 1 | Cadenas EOD de opciones SPY **anteriores a 2013** (idealmente desde 2004–2005, con 2008), con bid/ask, griegas, IV y OI | Misma tubería que BT-15/17, **una sola corrida** con reglas congeladas de §4.A y las dos líneas de base de R1 | **bloqueado**: compra de datos (costo a cotizar, decide el owner) |
| 2 | Las mismas | Sensibilidad: fricción $6,30 y $9,30; gate GEX con y sin 0DTE (R6); fila delta 0,25 + GEX + V2 (R7) | depende de 1 |
| 3 | Estrés sintético | Gap a pérdida máxima con 1 y 2 posiciones abiertas; consumo de capital y heat | se puede hacer ya (no requiere datos nuevos) |
| 4 | Prospectivo: runtime SHADOW (GaleCore Dev) con la regla congelada | Frecuencia, fricción y fills observados vs supuestos | requiere una spec equivalente (I4, conversión posterior) |

Reglas del método (de SKILL.md §6): versión de reglas, comparación, costos y métricas fijadas antes; una
corrida; los fallos se reportan; ningún dato de 2013–2025 cuenta como prueba nueva.

### 6.3 Criterios (forma fijada; umbrales los decide el owner antes de correr)

| Pregunta | Apoya si | Refuta si | Inconcluso si |
|---|---|---|---|
| P1 | Resultado neto por operación > T-bill con intervalo por bloques que excluye cero | El intervalo queda por debajo o incluye cero con la fricción base | Muy pocas operaciones para el intervalo |
| P2 | RPF mejora a la mecánica en resultado por unidad de riesgo **y** no empeora la peor pérdida | RPF no mejora o sólo reduce frecuencia | Diferencias dentro del intervalo |
| P3 | La peor pérdida de período (2008) cabe en la pérdida tolerable declarada (§1c) | No cabe | — |
| P4 | Fricción observada ≤ el supuesto conservador ($9,30) y frecuencia compatible con lo esperado | Fricción observada > conservador | Menos de [n a decidir] operaciones observadas |

Los niveles de confianza, el tamaño mínimo de muestra y la pérdida tolerable **no los fijo**: son decisión del
owner (§1). Sin esos números la prueba no se corre.

---

## 7. Conclusiones pendientes (y qué sí se sostiene hoy)

**Se sostiene hoy:** la prima de volatilidad del índice existe en la evidencia pública (E1–E3); RPF es una
implementación prudente y bien documentada, con sus propios caveats honestos; la renta es chica frente a la
pérdida máxima (E14).

**Pendiente, no se afirma:**
- que exista una ventaja **después de costos** fuera de 2013–2025 (P1, P3);
- que los filtros de RPF agreguen valor fuera de muestra (P2; E8 lo puso en duda);
- el tamaño del riesgo de cola (E13, E16);
- que la barra de régimen normal cubra la fricción (E15);
- que la ejecución real coincida con la simulada (P4).

---

## 8. Pendientes priorizados

| # | Pendiente | Quién / qué lo resuelve |
|---|---|---|
| 1 | Pérdida tolerable y umbrales de §6.3 | Owner |
| 2 | Cotizar datos de opciones SPY pre-2013 (proveedores candidatos en §2.1 del documento de backtesting) | Owner decide; el host cotiza sin comprar |
| 3 | Estrés sintético (§6.2 paso 3) | Host, sin datos nuevos |
| 4 | Aclarar VIX9D vs VIX/VIX3M (R5) y recalcular el piso de fricción (R4) | Host, lectura de código y documentos |
| 5 | Verificar términos de asignación/entrega de opciones SPY en fuente primaria | Host (OCC/Cboe) |
| 6 | Nombre de la estrategia por propósito | Owner |

## Historial

- 2026-09-25 — primera versión, primer recorrido de la instrucción (GC-AI-0006).
