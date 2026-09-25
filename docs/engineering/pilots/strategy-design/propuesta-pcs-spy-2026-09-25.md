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
  supera a la realizada y de que **vender puts** de índice (ATM, con el efectivo como garantía) rindió con menos
  volatilidad que el índice (§3). **Esa evidencia no es sobre este put spread:** el spread también **compra**
  un put más abajo, y ese put también paga prima; cuánto de la prima neta queda depende de la pendiente del
  skew entre los dos strikes. Sobre el spread concreto sólo hay evidencia in-sample de RPF (E6, E12, E19).
- **Qué dice lo nuestro (RPF):** en 2013–2025 la versión filtrada ganó casi siempre que operó, poco y con
  renta chica; pero esos números salen de una ventana ya usada muchas veces, con muy pocas pérdidas para
  medir la cola, y la configuración final no fue medida tal cual (§3.2).
- **Lo que no sabemos y es lo importante:** si la ventaja es **la prima en sí** (vender siempre) o **el timing
  de RPF** (sus filtros), y cuánto pesa la cola en un período que RPF nunca vio (2008). **RPF tal cual no se
  puede probar en 2008:** VIX9D empieza en 2011 (E20); cualquier prueba ahí es una **variante** declarada.
- **Prueba que la descartaría (§6):** carteras comparadas en el mismo calendario, capital, restricciones y
  remuneración del efectivo: que RPF no supere a quedarse en efectivo, o que no supere a la venta mecánica,
  con el método estadístico que recomiendo en §6.4. El cumplimiento de tus límites de riesgo se juzga aparte
  y una violación conocida no se compensa con estadística.
- **Decisiones tuyas (sólo dos, §6.5):** (a) el **riesgo aceptable** (drawdown y pérdida por evento que
  tolerás, en % del capital); (b) la **utilidad económica mínima** (cuánto por encima del efectivo, por año,
  hace que valga la pena). Método, nivel del intervalo y muestra suficiente los recomiendo yo (§6.4).
  Comprar datos pre-2013 **no** es requisito del piloto; el precio público está en §6.2 como referencia.

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
   el entorno no muestra estrés (los filtros de RPF). **La pata comprada devuelve parte de la prima:** el
   spread captura la prima del put vendido **menos** la del put comprado; si los puts más alejados están
   relativamente más caros (skew), la protección consume una parte mayor de lo que se cobra. Esto es un
   mecanismo a medir, no un hecho demostrado para este spread (E19).
4. **Falla.** (a) la prima cobrada no cubre las pérdidas de los episodios de caída; (b) los costos se comen la
   prima (créditos chicos a delta bajo); (c) los filtros no anticipan el estrés y sólo reducen la frecuencia;
   (d) lo observado en 2013–2025 no representa el riesgo real (muestra sin un 2008).

### 3.2 Evidencia

| # | A favor / en contra | Qué dice | Fuente |
|---|---|---|---|
| E1 | A favor | La varianza implícita del índice (swap rate sintetizado con opciones) supera sistemáticamente a la realizada: existe una prima de riesgo de varianza. | Carr & Wu (2009), *Variance Risk Premiums*, RFS 22(3):1311–1341, [doi:10.1093/rfs/hhn038](https://academic.oup.com/rfs/article-abstract/22/3/1311/1581057). **Visto sólo en resultados de búsqueda**, no se abrió el artículo. |
| E2 | A favor | 1990–2018: VIX promedio 19,3 % vs volatilidad realizada del S&P 500 15,1 %; el índice PutWrite (PUT) tuvo volatilidad anual 9,95 % vs 14,93 % del S&P 500 (1986–2018). | Nota de Cboe sobre el estudio de Bondarenko, 29/05/2019, [cboe.com](https://www.cboe.com/insights/posts/white-paper-shows-volatility-risk-premium-facilitated-higher-risk-adjusted-returns-for-put-index/). Es del patrocinador del índice; el PDF original no se pudo leer en esta máquina. |
| E3 | A favor | Los puts del S&P 500 fueron históricamente "demasiado caros" y, con un método que admite sesgos de selección como el *peso problem* y creencias incorrectas, "no model within a studied class of models can possibly explain the put anomaly". | Bondarenko (2014), *Why Are Put Options So Expensive?*, QJF 4(3); leído sólo el abstract, en [Crossref](https://api.crossref.org/works/10.1142/S2010139214500153) |
| E4 | **Alternativa (hipótesis del host, sin fuente propia)** | *Peso problem*: que la muestra no contenga los desastres raros que justifican el precio; si fuera así, la "ventaja" es pago por un riesgo todavía no visto. E3 la descarta dentro de la clase de modelos que estudia; no se buscó otra fuente que la sostenga. | Hipótesis del host |
| E5 | Matiz | La asimetría fue negativa en todos los índices estudiados (PUT −2,09; S&P 500 −0,81), pero el índice de Stutzer, que la penaliza, fue sólo "slightly lower" que el Sharpe, y PUT siguió primero en Sharpe, Sortino y Stutzer. | Nota de Cboe (E2) |
| E6 | A favor (in-sample) | Vender PCS **sin filtros de entorno** (sólo cascada de strikes + piso de crédito 1/3) en SPY 2013–2025 dio $17,1 promedio neto por señal-día (win 91,9 %); con todas las capas, $50,9 (win 99,2 %) y las pérdidas > $200 cayeron de 195 a 1. Medido con la configuración de entonces, hold a vencimiento y por señal-día: **no es** la "venta mecánica" que propone P1. | BT-5, `GaleCore/docs/rpf/galecore-research-backtesting-rpf.md` §BT-5 |
| E7 | **En contra** | Esa escalera es in-sample con 5 capas ajustadas sobre los mismos 13 años (lo dice el propio documento). | BT-5, caveat 4 |
| E8 | **En contra** | Primer walk-forward (H1, criterios pre-declarados): **reprobado**. La separación del filtro casi desapareció fuera de muestra (seleccionadas $13,31 vs rechazadas $12,60) y 2018 dio −$5.496 en SPY. **Erratum posterior:** esa corrida no aplicó el piso de crédito del 10 %; con el piso, 2018 da −$903 y win 94 %, y el veredicto se mantiene porque 2020 (−$1.776) sigue violando C3. | BT-9 y erratum en BT-10 punto 4, mismo documento |
| E9 | A favor (condicionado) | Tercera iteración (H3, delta 0,30) aprobó en QQQ; con gestión B, SPY dio win 96,5 %, avg $35,5, p5 +$32, peor año −$449. | BT-10c, mismo documento |
| E10 | **En contra** | La ventana 2018–2025 quedó "agotada": se usó en scan exploratorio y en tres iteraciones; el documento lo declara ("no queda superficie virgen"). | BT-11, mismo documento; RPF §12.1 |
| E10b | **En contra** | En el scan exploratorio, delta 0,25 pasó C3 pero "frágil a barras": con barras −0,05 el peor año pasa a −$1.829 (delta 0,30 era robusto ±0,05). | BT-10b, mismo documento |
| E11 | **En contra** | La configuración elegida (delta 0,25 + GEX ≥ 0) es una **interpolación**, no una fila medida: el ganador de BT-17 es delta 0,25 **sin** GEX. | RPF §12.4; `_meta.config_note` de `galecore_rules_rpf.json` |
| E12 | Renta vs cola | BT-17 variante C: 10,6 operaciones/año, win 97,6 %, total $2.723 en 8 años, peor año −$140, maxDD −8,4 %. | BT-17 |
| E13 | **En contra (cálculo propio)** | Con 10,6 op/año × 8 años ≈ 85 operaciones y 2,4 % de pérdidas, la cola se estima con **≈ 2 operaciones perdedoras**: no alcanza para medir el riesgo de cola. | Cálculo propio sobre E12 |
| E14 | **Ilustrativo (cálculo propio; combina antecedentes distintos)** | Renta ≈ $340/año ($2.723 / 8): es el resultado de la **cartera V2 de BT-17** (hasta 2 posiciones de 1 contrato, sobre $10k). Riesgo máximo ≈ $425–450 por **un** spread (ancho $5 − crédito de 10–15 % del ancho, RPF §4; BT-17 da ~$460). Cociente ≈ 1,25–1,3 años de renta por spread perdido, o ≈ 2,5–2,7 si las 2 posiciones permitidas pierden a la vez. **No es una métrica medida:** mezcla una renta de cartera con la pérdida de una posición, de fuentes y supuestos distintos. **Reducir contratos no la mejora:** renta y pérdida escalan juntas; sólo cambia si cambian crédito, ancho, frecuencia o cuántas posiciones se superponen. La medida comparable es el drawdown de la cartera en §6.3. | Cálculo propio sobre RPF §4, BT-17 y E12 |
| E15 | **En contra (cálculo propio)** | El piso de fricción de RPF (1,02–1,06) se calculó con crédito = 1/3 del ancho; a delta 0,25 el crédito es 10–15 % del ancho: $6,30 sobre $50–75 da un piso ≈ 1,08–1,13, **por encima** de la barra `min_edge` de régimen normal (1,05). | Cálculo propio sobre §7 del documento de backtesting y RPF §4, §6 |
| E16 | **En contra** | Los datos de opciones usados empiezan en 2013 (adquiridos 2013–2023 según §2.1; las corridas BT-0/BT-1/BT-9 usan 2013–2025): **2008 nunca se probó** con la estrategia. | §2.1, BT-0, BT-1, BT-9 del documento de backtesting |
| E17 | Contexto | Los umbrales del veto de cola (VVIX 110/130, skew 5 %/8 %) se calibraron "con ~5 crashes reales (muestra de un dígito)" y el documento los llama "provisorios y sobreajustados". | §1 del documento de backtesting |
| E19 | **Límite de E1–E5 (mecanismo ≠ estructura)** | El índice PUT de E2/E5 vende puts **ATM a un mes** garantizados con efectivo a T-bill; no compra protección. Un put credit spread vende un put OTM y **compra** otro más OTM, que también paga prima (E3 habla de puts caros en general). La prima neta que queda depende del skew entre ambos strikes. En este recorrido **no se encontró** evidencia pública específica de spreads de puts sobre el índice (una búsqueda; Cboe publica PUT y collars, no un índice de PCS); la única evidencia sobre el spread concreto es la de RPF, in-sample (E6, E12). | Definición de PUT: ["one-month, at-the-money, S&P 500 Index puts" … "cash at one- and three-month Treasury Bill rates"](https://en.wikipedia.org/wiki/CBOE_S%26P_500_PutWrite_Index) (Wikipedia, leída el 25/09; la página de Cboe devolvió 503: fuente secundaria declarada); resto: razonamiento del host |
| E20 | **En contra de "probar RPF en 2008"** | Historias oficiales de Cboe descargadas el 25/09: **VIX9D desde 2011-01-04**; VIX3M desde 2009-09-18 en el archivo oficial (Macroption indica datos de su antecesor VXV desde 2007-12-04, no verificado en Cboe); VVIX desde 2006-03-06 (con valores anómalos en los primeros días: 15,71 el 15/03/2006); VIX desde 1990. El gate `VIX9D < VIX` **no existe antes de 2011**. skew25, IV ATM, GEX y put wall salen de las cadenas SPY; SPY tiene cadenas EOD desde 2005 en al menos un proveedor con bid/ask, OI y griegas (E21). | `cdn.cboe.com/api/global/us_indices/daily_prices/{VIX9D,VIX3M,VVIX,VIX}_History.csv`; [Macroption](https://www.macroption.com/vix3m/) |
| E21 | Disponibilidad (secundario) | Historical Option Data "ALL SPY": EOD de ene-2005 a ago-2026, con bid, ask, OI, griegas e IV, **$455** (precio público, 25/09; no se compró ni se contactó al proveedor). | [historicaloptiondata.com](https://historicaloptiondata.com/product/allspy/) |
| E18 | Contexto vivo | El 25/09 en sesión, el GEX de SPY estuvo entre −81,9 y −86,3 en las 17 lecturas con dato (escala de GaleCore): medido por el gate `gex_non_negative` de la spec de prueba `shadow_runtime_test_v1`, no con la fórmula de RPF (DTE < 90). **Inferencia, no observación:** con su propio corte RPF probablemente tampoco habría operado, pero el signo puede depender del corte (R6). | `GaleCore/docs/evidence/gc-0004/run1-en-sesion.json` |

**Lectura.** La existencia de una prima de volatilidad en el índice, y de que **vender puts** la capturó, está
bien respaldada fuera de GaleCore (E1–E3). **No se traslada automáticamente al put spread** (E19): falta
evidencia fuera de muestra sobre la estructura concreta. Tampoco está respaldado que el **timing de RPF**
agregue valor fuera de muestra (E7, E8, E10, E11) ni que la cola esté medida (E13, E16). E14 ilustra que la
renta es chica frente a una pérdida, pero no es una medición.

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
| Tamaño y cartera | riesgo 3,5 % (máx 5 %, banda 5–8 % con aprobación); ≤ 2 posiciones, vencimientos distintos; heat ≤ 7 % | Riesgo, banda y heat: diseño RPF §7.1/§7.2 ("diseño; no refutado", reconciliación); 2 posiciones: BT-15; capital: decisión 3 |
| Salidas | cierre al 50 % del crédito; sin salida por DTE; defensa si delta short > 0,42 o pérdida ≥ 2× crédito; roll defensivo desde pérdida ≥ 1× crédito con `min_dte_remaining: 21` y crédito neto ≥ 0,20 (JSON; **la definición y la reconciliación dicen "nueva expiración ≥ 21 DTE"**: semántica en disputa, ver R10); kill switch −1 % diario | BT-4, BT-12, decisión 4; el roll: "§9 diseño; no refutado" (reconciliación) |
| Fricción | $6,30 por operación | §7 del documento de backtesting |
| Dato faltante | VIX absoluto sin dato → no opera (fail-closed); estructura temporal del VIX y veto de cola sin dato → **pasan** (`on_no_data: pass`, por cortes del feed); sin put wall → no opera | JSON (`_no_data_note`), definición §10 |

### 4.B Recomendaciones nuevas (propuestas en este recorrido)

| # | Recomendación | Razón |
|---|---|---|
| R1 | Medir la ventaja contra **dos líneas de base**: no operar (efectivo) y **venta mecánica** (mismo delta, DTE y gestión, sin filtros), como **carteras** en el mismo calendario, capital, restricciones y remuneración del efectivo (§6.3). | Separa "la prima existe" de "el timing agrega" (§3.3). |
| R2 | Resultados de cabecera **de cartera** (diarios, MTM) y, como complemento, por operación real (nunca por señal-día); intervalos por bloques de tiempo (§6.4). | BT-5 cuenta señales-día superpuestas, que no son independientes (coverage: dependencia entre observaciones). |
| R3 | La cola se evalúa con **escenarios de estrés y la pérdida máxima por construcción**, no con la tasa de acierto. | Con ≈ 2 pérdidas (E13) la estadística de cola no informa. |
| R4 | Recalcular el piso de fricción con el **crédito real a delta 0,25** y revisar la barra de régimen normal. | E15: el principio "min_edge ≥ 1 + fricción/crédito" de RPF no se cumpliría con créditos típicos. |
| R5 | Aclarar la regla de estructura temporal: **VIX9D < VIX** (JSON) vs **VIX9D > VIX3M** (definición §5 y reconciliación). Aclarar también "el GEX es informativo, no operativo" (`D-0001`) frente al gate GEX ≥ 0 de RPF (probablemente se refiere a la estrategia GEX). | Documentos de RPF que dicen cosas distintas; manda el JSON, pero la definición es la que se cita. |
| R6 | Probar la sensibilidad del gate GEX a la definición del corte (0DTE incluido o no, DTE < 90 vs < 60). | El gate usa sólo el signo, y el signo puede cambiar con el corte (`knowledge/research/2026-09-23-gex-0dte-post-cierre.md`: hipótesis en estado `test_planned`, nacida de una observación no archivada). |
| R7 | Tratar la configuración final como **no medida** hasta correr la fila delta 0,25 + GEX + V2. | E11; RPF §12.4 ya lo prevé si paper no coincide. |
| R8 | Declarar el **edge a vencimiento** vs la **gestión al 50 %**: el edge se calcula con probabilidades a vencimiento, pero la posición se cierra antes. | Coherencia entre la señal y la salida real (coverage: gestión y salidas). |
| R10 | Resolver la semántica del roll defensivo: `min_dte_remaining: 21` (JSON) vs "nueva expiración ≥ 21 DTE" (definición §9, reconciliación). Hasta resolverlo, el roll queda fuera de la prueba (§6) y figura pendiente en 4.C. | Son reglas distintas (cuándo se puede rolar vs a qué se rola) y la prueba no puede simular una regla ambigua. |
| R9 | Revisar qué pasa con dato faltante en los gates de seguridad: hoy la estructura temporal y el veto de cola **pasan** sin dato. | Una guarda que se apaga cuando falta el dato no protege en ese momento; la razón (cortes del feed) es operativa, no de la tesis. |

### 4.C Parámetros pendientes de fundamento (no se proponen números)

| Parámetro | Estado | Por qué está pendiente | Qué lo resuelve |
|---|---|---|---|
| Umbrales de régimen (VIX 30, 12 %) | pendiente | Calibrados en la ventana agotada | Prueba en datos nuevos (§6) |
| Veto de cola (VVIX 110/130, skew 5 %/8 %) | pendiente | "~5 crashes", "provisorios y sobreajustados" (E17) | Datos pre-2013 con 2008; escenarios |
| `vrp_min` 1,2 | pendiente | Prior de literatura, validado in-sample | §6, pregunta P2 |
| Barras `min_edge` | pendiente | Elegidas con barrido full-sample (BT-9); normal < piso de fricción (E15) | R4 + §6 |
| Delta 0,25 con GEX | pendiente | Interpolación (E11) y frágil a barras en el scan (E10b) | R7 |
| Roll defensivo desde 1× crédito | pendiente | Del diseño original, nunca medido; semántica de los 21 DTE en disputa (R10) | R10, después datos nuevos |
| Hard defense 0,42 / 2× crédito | pendiente | BT-12 midió hasta delta 0,35; 0,42 es una extrapolación ("vive ~0,40–0,45") | §6 |
| Riesgo por operación, heat 7 %, maxDD 5 %, kill −1 % | **restricción del usuario**, no parámetro investigable | Son preferencias de riesgo del owner, no se optimizan | Confirmación del owner (§1c) |

---

## 5. Cobertura de la instrucción (estado por bloque)

| Bloque (coverage.md) | Estado | Nota |
|---|---|---|
| Mandato e identidad | parcial | Nombre por propósito pendiente (no se usa "RPF" ni "PCS-SPY" como nombre de la estrategia); objetivo y pérdida tolerable: §1c. |
| Tesis y contexto | definida | §3.1, §3.3; abstención = los filtros de RPF cuando corresponda. |
| Universo | definida | SPY, opciones listadas en EE. UU., cuenta Tastytrade (antecedente RPF). |
| Datos y variables | parcial | EOD 2013–2025; quirks declarados sólo en notas del host, **no verificados en este recorrido** (IV/griegas degeneradas en 0DTE; `in_the_money` roto). Disponibilidad histórica por insumo en §6.2 (VIX9D sólo desde 2011: E20). La tasa de efectivo de BT-15 (GS3M del mismo mes) usa información futura (§6.3). |
| Señal y selección | antecedente | §4.A; cuestionada en §4.B/§4.C. |
| Construcción | antecedente | §4.A. |
| Sizing y cartera | pendiente | Depende de §1c; RPF: base $16k, fondeo $32k. |
| Ejecución | parcial | Fricción $6,30 base / $9,30 conservador (fills al natural) = ejecución **estimada**. SHADOW observa señales y cotizaciones, no fills; paper da fills simulados por el broker; fills reales sólo con órdenes reales (fuera de alcance). Ver P4 en §6.1. No se asume fill a mid como resultado. |
| Gestión y salidas | antecedente + R8 | |
| Riesgo operacional | parcial | Sugiere y no ejecuta; kill switch. Con dato faltante, algunos gates de RPF bloquean y otros pasan (§4.A, R9); en el runtime SHADOW (I2) todo dato faltante bloquea. |
| Eventos y obligaciones | **pendiente** | SPY: opciones de estilo americano con entrega física; asignación anticipada del put corto en profundidad ITM y riesgo al vencimiento. RPF cierra ITM; falta verificar términos vigentes en fuente primaria (OCC/Cboe) y el efecto de dividendos. |
| Medición | definida (propuesta) | R1–R3. |
| Evaluación | definida (propuesta) | §6. |
| Ciclo de vida | parcial | Versionado por hash en GaleCore (I2–I3); falta el vínculo propuesta → prueba → resultado (I4). |

---

## 6. Plan de prueba (fijado antes de ver resultados)

### 6.1 Preguntas

- **P1 — ¿Existe la ventaja sin timing?** Cartera de venta mecánica de PCS (delta, DTE, ancho, gestión y
  límites de cartera de §4.A, sin filtros de entorno) contra la cartera que sólo tiene efectivo.
- **P2 — ¿El timing de RPF agrega?** Cartera RPF contra la cartera mecánica, en el mismo calendario.
- **P3 — ¿Sobrevive a 2008?** Ambas en un período con una crisis que RPF no vio. **Sólo como variante**
  (§6.2): RPF tal cual no es reproducible antes de 2011.
- **P4 — ¿La ejecución se parece a la supuesta?** Separada por nivel de evidencia:

| Nivel | Qué es | De dónde sale | Qué puede decir |
|---|---|---|---|
| P4a estimada | Fill por modelo: al natural, fricción $6,30 (conservador $9,30) | Backtest | Nada sobre la realidad: es el supuesto a contrastar |
| P4b observada en cotizaciones | Bid/ask, crédito al natural y al mid, OI y frecuencia de señales **en el momento de la señal** | Runtime SHADOW (GaleCore Dev) | Si el costo **cotizado** y la frecuencia caben en los supuestos. **SHADOW no envía órdenes ni acredita fills** |
| P4c simulada por el broker | Fill que decide el motor de paper del broker | Cuenta paper | La lógica de órdenes funciona; no es un fill de mercado |
| P4d real | Fill de una orden real | Cuenta real | Único nivel que mide slippage. **Fuera de alcance** (LIVE; requiere decisión del owner) |

### 6.2 Datos, disponibilidad por insumo y variantes

Disponibilidad histórica de **cada** insumo de las reglas de §4.A (verificada el 25/09, E20–E21):

| Insumo | Fuente | Desde | ¿Cubre 2008? |
|---|---|---|---|
| VIX (nivel y aceleración RoC5d) | Cboe | 1990 | sí |
| **VIX9D** (gate `VIX9D < VIX`) | Cboe | **2011-01-04** | **no** |
| VIX3M (regla de la definición §5, R5) | Cboe; antes como VXV | 2009-09-18 en el archivo oficial; VXV desde 2007-12 según Macroption (no verificado en Cboe) | sólo con VXV, a verificar |
| VVIX (veto de cola) | Cboe | 2006-03-06 (primeros días con valores anómalos) | sí, con control de calidad |
| skew25 (veto de cola), IV ATM 30d (VRP), delta, crédito, bid/ask, OI, GEX, put wall | Cadenas EOD de SPY | 2005 en un proveedor (E21); **no están en casa** (dataset desde 2013) | sólo comprando |
| RV30 (VRP) | OHLC de SPY | disponible gratis | sí |
| Tasa de efectivo | FRED `DGS3MO` diaria | 1981-09-01 | sí |

**Consecuencia:** una corrida 2005–2012 **no es RPF**. Cualquiera de estas opciones es una **variante**
con nombre propio, declarada antes de correr y reportada como tal:

- **V-sin-VIX9D:** se omite el gate de estructura temporal. Ojo: es lo que haría el propio JSON por su
  `on_no_data: pass` (R9), pero eso no convierte la corrida en RPF: es un filtro omitido.
- **V-VXV:** se sustituye por `VIX < VXV/VIX3M` (la regla de la definición, no la del JSON), sólo si se
  verifica la serie VXV desde 2007-12. Es una regla distinta.
- **V-reconstruida:** VIX9D reconstruido con la metodología de Cboe sobre cadenas de SPX (otro dataset, otra
  compra). Es una reconstrucción, con su propio riesgo de error.

| Paso | Datos | Método | Estado |
|---|---|---|---|
| 1 | Cadenas EOD de SPY 2005–2012 | Tubería de BT-15/17, **una corrida** por variante declarada, reglas congeladas y las carteras de §6.3 | **no requerido por el piloto**; referencia pública $455 (E21), decide el owner si alguna vez se compra |
| 2 | Las mismas | Sensibilidad: fricción $6,30 y $9,30; GEX con y sin 0DTE (R6); delta 0,25 + GEX + V2 (R7) | depende de 1 |
| 3 | Ninguno | Estrés por construcción: gap a pérdida máxima con 1 y 2 posiciones abiertas, en % del capital | se puede hacer ya |
| 4 | Prospectivo: SHADOW con la regla congelada | P4b | requiere una spec equivalente (I4, conversión posterior) |
| 5 | 2013–2025 (en casa, ya usada) | Las carteras de §6.3 corridas **sólo** para verificar la tubería y **planificar la muestra** (§6.4); no cuentan como evidencia | se puede hacer ya |

Reglas del método (SKILL.md §6): versión de reglas, comparación, costos y métricas fijadas antes; una
corrida por variante; los fallos se reportan; ningún dato de 2013–2025 cuenta como prueba nueva.

### 6.3 Métricas y comparación (definidas antes de correr)

**Carteras, no sólo operaciones.** Se comparan tres carteras en el **mismo calendario** (todos los días
hábiles del período), el **mismo capital inicial** (la base de referencia de RPF, $16k, §7.3; al ser igual
para todas, la elección sólo afecta el redondeo de contratos), las **mismas restricciones** (riesgo por
operación, ≤ 2 posiciones, heat ≤ 7 %, kill switch; §4.A) y la **misma remuneración del efectivo**:

- **Efectivo:** todo el capital a la tasa de efectivo.
- **Mecánica:** PCS sin filtros de entorno; el efectivo libre a la tasa; el colateral, según la regla de abajo.
- **RPF** (o la variante declarada): ídem, con sus filtros.

**Tasa de efectivo, sin información futura.** BT-15 usó `GS3M` con el valor **del mismo mes**
(`tb.asof(day)` sobre fechas de primer día del mes). `GS3M` es el **promedio de los días hábiles del mes**
(FRED) y se publica después de terminado: en cada día simulado usaba información todavía no disponible.
Se corrige así:

- **Tasa de referencia:** `DGS3MO` diaria (3 meses, constant maturity, investment basis) con el valor del
  **día hábil anterior**. Si se quiere continuidad con BT-15, `GS3M` desfasado un mes (el del mes anterior).
- **Referencia ≠ retorno invertible.** La tasa del Tesoro es un rendimiento de referencia, no lo que cobra la
  cuenta. Corrida principal (igual para las tres carteras): el efectivo libre cobra la tasa de referencia y
  el **colateral no cobra** (como BT-15). Sensibilidad: el colateral también cobra la tasa (si el broker
  admite letras como garantía). Lo que paga realmente la cuenta (interés del broker, fondo money market o
  letras) queda **pendiente de verificar** en fuente primaria; hasta entonces se reporta como referencia.

**Métricas por cartera** (valuación diaria MTM al natural, neto de fricción):

- frecuencia: operaciones por año y fracción de días con posición;
- retorno neto total y exceso sobre la cartera de efectivo (en $ y % del capital);
- drawdown máximo MTM diario y su duración; peor mes;
- peor pérdida de una operación y peor pérdida diaria, en % del capital.

**Métricas por operación** (complemento, no base de la decisión): resultado neto = crédito − costo de
cierre − fricción; win rate y pérdida media, sólo descriptivos.

### 6.4 Método estadístico (recomendación del host)

- **Unidad de inferencia:** la serie de **diferencias diarias de retorno** entre dos carteras (P1: mecánica −
  efectivo; P2: RPF − mecánica). Al restar día por día sobre el mismo calendario, los shocks compartidos se
  comparan emparejados; no se tratan las operaciones como independientes.
- **Intervalo:** *stationary bootstrap* (Politis y Romano, 1994) sobre esa serie, remuestreando los
  **mismos bloques de días** para las carteras comparadas (conserva la dependencia entre ellas y la
  dependencia temporal). Largo medio de bloque: **63 días hábiles** (un ciclo de 35–50 DTE con dos posiciones
  escalonadas); sensibilidad con 21 y 126. Si la conclusión cambia entre esos largos, el resultado es
  inconcluso. **10.000** remuestreos; intervalo de percentiles.
- **Nivel:** **95 % bilateral** para cada una de las dos comparaciones principales (P1, P2). Equivale a
  97,5 % unilateral; con dos comparaciones, la probabilidad de declarar por error al menos una ventaja queda
  en ≤ 5 % (Bonferroni). Se prefiere a 90 % porque hay pocos episodios independientes de estrés y el costo
  de un falso positivo es capital.
- **Muestra suficiente (se decide antes de correr):** con la dispersión de las diferencias diarias en
  2013–2025 (datos ya usados, **sólo para planificar**; paso 5), se proyecta el error estándar del período
  de prueba. Es suficiente si ese error es ≤ **UEM / 2,8**, donde UEM es la utilidad económica mínima del
  owner: con eso, una ventaja del tamaño de la UEM se detectaría con ~80 % de probabilidad al nivel elegido.
  Si no alcanza, la prueba se declara **insuficiente antes de correr** y se informa qué largo haría falta.
  Además, para juzgar la cola el período tiene que contener al menos un episodio de estrés severo; si no,
  la cola queda "no evaluable".

### 6.5 Criterios: resultado estadístico y restricciones de riesgo, por separado

**Lo que decide el owner antes de correr:** (a) **riesgo aceptable**: drawdown máximo y pérdida máxima por
evento, en % del capital (RPF propone maxDD 5 % y heat 7 %: son tus restricciones, a confirmar); (b)
**UEM**: exceso anual mínimo sobre el efectivo que hace que valga la pena.

**Veredicto estadístico** (P1, P2; excluyentes, en este orden):

| Resultado | Condición |
|---|---|
| Insuficiente | la muestra no cumple §6.4 (se sabe antes de correr) |
| Refuta la utilidad | el extremo superior del intervalo < UEM (incluye ventaja nula o negativa) |
| Apoya | el extremo inferior > 0 **y** la estimación puntual ≥ UEM |
| Inconcluso | todo lo demás |

**Veredicto de restricciones** (por cartera, independiente del anterior):

| Resultado | Condición |
|---|---|
| Viola | cualquier incumplimiento **conocido**: en la corrida, en la variante 2008 o **por construcción** (paso 3: si 2 posiciones a pérdida máxima superan la pérdida por evento aceptable) |
| Cumple | período con estrés severo y ningún incumplimiento |
| No evaluable | sin incumplimientos, pero sin estrés severo en los datos |

**Combinación:** sólo "Apoya" + "Cumple" habilita proponer el paso siguiente (paper). **Una violación conocida
no queda neutralizada** por una muestra insuficiente ni por un resultado inconcluso: la cartera no es apta
bajo esos límites hasta cambiar la construcción o los límites (decisión del owner).

**P3:** mismo par de veredictos sobre la variante declarada, rotulada como variante.
**P4b:** apoya si el costo cotizado medio al natural ≤ $9,30 por operación **y** las operaciones por año
caen dentro del intervalo 95 % de la frecuencia anual de la cartera en 2013–2025 (bootstrap por años,
calculado antes de mirar SHADOW); refuta si alguno queda fuera; inconcluso con menos de un año de
observación. P4c y P4d no se evalúan en este plan.

---

## 7. Conclusiones pendientes (y qué sí se sostiene hoy)

**Se sostiene hoy:** la prima de volatilidad del índice y el resultado de **vender puts** existen en la
evidencia pública (E1–E3); RPF es una implementación prudente y bien documentada, con sus propios caveats
honestos.

**Pendiente, no se afirma:**
- que la prima se traslade al **put spread** después de pagar la pata comprada (E19);
- que exista una ventaja **después de costos** fuera de 2013–2025 (P1, P3);
- que los filtros de RPF agreguen valor fuera de muestra (P2; E8 lo puso en duda);
- que RPF se pueda probar en 2008 sin cambiarlo (E20: sólo variantes);
- el tamaño del riesgo de cola (E13, E16) y la relación renta/pérdida medida como drawdown de cartera (E14 es
  sólo ilustrativo);
- que la barra de régimen normal cubra la fricción (E15);
- que la ejecución real coincida con la estimada (P4; SHADOW sólo informa cotizaciones).

---

## 8. Pendientes priorizados

| # | Pendiente | Quién / qué lo resuelve |
|---|---|---|
| 1 | Riesgo aceptable y utilidad económica mínima (§6.5) | Owner |
| 2 | Estrés por construcción (§6.2 paso 3) y planificación de muestra con 2013–2025 (paso 5) | Host, sin datos nuevos |
| 3 | Aclarar VIX9D vs VIX/VIX3M (R5) y recalcular el piso de fricción (R4) | Host, lectura de código y documentos |
| 4 | Verificar qué remuneración cobra realmente el efectivo y el colateral en la cuenta | Host (términos del broker, fuente primaria) |
| 5 | Verificar términos de asignación/entrega de opciones SPY en fuente primaria | Host (OCC/Cboe) |
| 6 | Si se quisiera P3: elegir variante y comprar cadenas 2005–2012 (ref. $455) | Owner; **no** requisito del piloto |
| 7 | Nombre de la estrategia por propósito | Owner |

## Historial

- 2026-09-25 — primera versión, primer recorrido de la instrucción (GC-AI-0006).
- 2026-09-25 — correcciones de Codex C1: semántica del roll en disputa (R10), métricas de §6.3 definidas, regiones
  de §6.4 con inconcluso real, E1 y quirks de datos con su acceso declarado.
- 2026-09-25 — correcciones de la revisión interna: E3/E4 (Bondarenko 2014 estaba leído al revés), erratum de
  BT-9 en E8, E10b nuevo, E5/E6/E16/E18 precisados, origen del sizing, dato faltante (4.A, R9), hard defense
  pendiente, criterios de §6.3 excluyentes.
- 2026-09-25 — correcciones de la evaluación del owner: evidencia de venta de puts separada del spread (E19),
  disponibilidad por insumo y variantes para 2008 (E20, E21, §6.2), comparación de carteras (§6.3), P4 por nivel
  de ejecución, método estadístico recomendado (§6.4), veredicto estadístico separado de restricciones (§6.5),
  E14 ilustrativo, tasa de efectivo sin información futura y referencia ≠ retorno invertible.
