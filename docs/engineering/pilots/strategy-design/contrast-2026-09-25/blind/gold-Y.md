# Seguimiento de tendencia a 12 meses en futuros de oro (COMEX GC): propuesta y prueba de descarte

**Estado:** propuesta. No se corrió nada, no hay datos descargados y no se usaron cuentas ni proveedores
pagos. Todo número de rendimiento que aparezca después tiene que salir de la prueba, no de este documento.

**Fecha:** 2026-09-25 · **Autor:** host (Claude Code) · **Para:** owner de GaleCore

---

## 1. En una frase

La idea es mirar a fin de cada mes si el oro subió o bajó en los últimos 12 meses y quedar comprado o
vendido en futuros de oro durante el mes siguiente. La prueba compara eso, **después de costos**, con
mantener oro todo el tiempo y con quedarse en letras del Tesoro. Si no le gana a ninguna de las dos
alternativas de forma clara y robusta, la propuesta se descarta.

**Expectativa honesta de entrada:** con un solo activo y unos 20 años de datos gratuitos, esta prueba
tiene mucha más capacidad de **descartar** la idea que de **confirmarla**. El resultado más probable, si
no sale negativo, es «evidencia insuficiente», no «estrategia validada». Lo explico en la §7.

---

## 2. Qué se quiere saber, convertido en algo medible

| Lo que pediste | Cómo se mide en la prueba |
|---|---|
| «Ventaja verificable» | Diferencia de retorno ajustado por riesgo (Sharpe) contra cada alternativa, con un intervalo de confianza por remuestreo, no sólo el promedio |
| «Después de costos» | Comisiones, comisiones del mercado, deslizamiento y rolls de contrato descontados mes a mes, con un escenario base y uno exigente |
| «Frente a mantener oro» | Misma exposición (1 dólar de oro por dólar de capital), siempre comprado, pagando los mismos rolls |
| «Frente a quedarse en efectivo» | Letras del Tesoro a 3 meses (el colateral de los futuros rinde eso en ambas estrategias) |
| «Que pueda descartarla» | Criterios de descarte escritos **antes** de correr (§6), una sola corrida, veredicto tal cual |

Resultados posibles, con los nombres del caso de uso de desarrollo de estrategias del ecosistema:
`NO_VIABLE_STRATEGY` (descartada), `UNDERPERFORMS_BENCHMARK`, `INSUFFICIENT_EVIDENCE`, `CANDIDATE`
(sólo habilita seguimiento en SHADOW, no dinero).

---

## 3. La regla, exacta (se fija antes de ver los datos)

**Instrumento:** futuro de oro COMEX GC (100 onzas troy; tick de US$0,10 por onza = US$10 por contrato;
vencimientos activos feb, abr, jun, ago, oct, dic). Para cuentas chicas existe el Micro Gold MGC
(10 onzas, un décimo del GC). La regla es la misma para los dos; cambia la granularidad.

**Señal** (al cierre del último día hábil de cada mes *t*):

- `x(m)` = retorno del futuro de oro en el mes *m* **por encima de la tasa de letras** (retorno «excedente»,
  que es lo que realmente paga un futuro, porque el colateral rinde la tasa por separado).
- `R12(t)` = retorno excedente acumulado de los 12 meses *t-11 … t*.
- Si `R12(t) > 0` → **comprado** (+1) el mes siguiente. Si `R12(t) ≤ 0` → **vendido** (−1).

Es la regla de «time-series momentum» de Moskowitz, Ooi y Pedersen (2012), aplicada a un solo activo.
No se elige el lookback de 12 meses mirando el oro: viene de la literatura, y eso es lo que evita
sobreajustarlo.

**Ejecución:** se opera al cierre del **primer día hábil** del mes siguiente (un día de rezago), no al
mismo cierre que produce la señal. Es más conservador y evita usar un precio que en la práctica no se
alcanza a operar.

**Tamaño (variante principal):** exposición nocional igual al capital (1x), sin apalancamiento neto. El
resto del capital queda en letras. Así la comparación con «mantener oro» es de igual a igual.

**Retorno mensual de cada alternativa** (`rf` = letra del mes, `c` = costos del mes):

| Alternativa | Retorno del mes *t+1* |
|---|---|
| **E1 — Tendencia comprado/vendido** (la propuesta) | `s(t)·x(t+1) + rf(t+1) − c` |
| **B1 — Mantener oro** (futuro siempre comprado) | `x(t+1) + rf(t+1) − c_roll` |
| **B2 — Efectivo** | `rf(t+1)` |
| **C1 — Tendencia sólo comprado** (comprado o afuera) | `max(s(t),0)·x(t+1) + rf(t+1) − c` |
| **C2 — Control de «media histórica»** | comprado si el promedio histórico (desde el inicio hasta *t*) de `x` es positivo, vendido si no |

C1 y C2 no son alternativas para operar: son **controles** para entender de dónde viene el resultado (§5).

**Variantes de sensibilidad** (se reportan, **no** se eligen entre ellas): lookback de 6, 9 y 11 meses;
tamaño por volatilidad objetivo (como en el paper original) en vez de 1x fijo.

---

## 4. Por qué podría haber ventaja, y por qué podría no haberla

**A favor (mecanismo plausible):**

- La evidencia académica de tendencia en futuros es amplia: Moskowitz, Ooi y Pedersen documentan
  predictibilidad del propio retorno pasado en 58 futuros y forwards (índices, monedas, commodities y
  bonos), y reportan que la ganancia a 12 meses fue positiva en **todos** los contratos que estudiaron.
- Explicaciones habituales: sub-reacción inicial a información y luego sobre-reacción; coberturistas que
  pagan por reducir riesgo; flujos que persiguen precio.
- El oro tiene un patrón de «meses quieto, después movimientos grandes» que en teoría favorece reglas
  lentas de tendencia. Los backtests de divulgación sobre reglas de media móvil de 12 meses en oro
  (comprado o afuera, 1971–2021) reportan mejoras frente a mantener; **no son evidencia independiente**
  (sin costos claros, sin control de sobreajuste) y se citan sólo como antecedente.

**En contra (lo que hace que valga la pena probarlo en vez de creerlo):**

- **Huang, Li, Wang y Zhou (2020, *Journal of Financial Economics*)**: analizando activo por activo,
  encuentran **poca evidencia** de que el retorno de 12 meses prediga el del mes siguiente, dentro y fuera
  de muestra. El t-estadístico grande de las regresiones agrupadas no resiste un bootstrap. Y la estrategia
  de tendencia rinde **prácticamente lo mismo** que una regla basada en el promedio histórico, que no
  necesita predictibilidad. Traducido: buena parte de la ganancia de la tendencia puede ser simplemente
  «estar comprado en algo que subió en promedio». Si eso pasa con el oro, **la tendencia no le agrega nada
  a mantener oro**, y eso es exactamente lo que el control C2 mide.
- El oro no tiene un flujo propio (no paga cupón ni dividendo). Si su retorno de largo plazo por encima de
  la tasa es chico o inestable, un sistema comprado/vendido depende sólo de acertar el timing.
- En rangos laterales la regla se da vuelta seguido y pierde en cada vuelta («whipsaw»).
- El lado **vendido** tiene pérdida teórica ilimitada, y en futuros una suba fuerte genera llamados de
  margen antes de que llegue la próxima fecha de revisión mensual.

---

## 5. La prueba

### 5.1 Datos (todos gratuitos y públicos; nada se compra)

| Dato | Fuente propuesta | Para qué | Cuidado |
|---|---|---|---|
| Tasa de letras a 3 meses, mensual | FRED `TB3MS` (el workspace ya tiene `GaleCore/research/data/tbill_3m_monthly.csv`, pero sólo desde 2018) | `rf` y retorno excedente | Hay que bajar la serie completa desde el inicio de la muestra |
| Oro, precio de **cierre de fin de mes** | Serie principal: cierre ajustado de GLD (ETF respaldado en oro físico, desde nov-2004) | Construir `x(m)` sintético: retorno de GLD + su gasto anual − `rf` | Aproxima al futuro; no replica su carry exacto |
| Futuro de oro, frente de la curva | Yahoo `GC=F` (serie continua, desde ~2000) | Control cruzado del signo de la señal y de `x(m)` | Es una serie **sin ajustar**: los saltos al cambiar de contrato no son retorno y hay que neutralizarlos en los meses de roll |
| Oro mensual largo (desde 1960) | World Bank «Pink Sheet» (CMO) | **Sólo** contexto histórico | Es **promedio mensual de precios diarios**, no cierre. Promediar crea autocorrelación positiva artificial en los retornos, es decir, **fabrica tendencia**. No se usa para la prueba |

La serie LBMA que antes estaba gratis en FRED (`GOLDPMGBD228NLBM`) ya no está disponible. Queda pendiente
conseguir una fuente gratuita de **cierres** de fin de mes anterior a 2004. Sin ella, la muestra principal
va de dic-2005 a ago-2026: unos 249 meses. El primer mes operable es dic-2005 porque la señal necesita 12
meses de historia.

**Por qué alcanza con un proxy del futuro.** El precio del futuro de oro está normalmente por encima del
contado aproximadamente en la tasa de interés más el almacenamiento, menos la tasa de alquiler («lease»)
del oro. Por eso un futuro comprado y renovado rinde, en la práctica, «oro menos tasa»: justamente el
retorno excedente `x`. La diferencia entre el proxy (GLD) y el futuro real es chica y se controla
comparando contra `GC=F`: si el signo de `R12` difiere en más del 5 % de los meses, se investiga antes de
dar un veredicto.

### 5.2 Costos (el escenario exigente es el que decide)

| Componente | Base | Exigente | Cuándo se paga |
|---|---|---|---|
| Comisión + tasas del mercado, por contrato y por lado | US$5 | US$15 | En cada cambio de signo (2 lados: cerrar y abrir) y en cada roll |
| Deslizamiento, por contrato y por lado | 1 tick (US$10) | 3 ticks (US$30) | Igual |
| Rolls | 6 por año (vencimientos bimestrales) | 6 por año | **También en B1**, que paga los mismos rolls |

Los costos se pasan a una fracción del nocional con el precio del oro de cada mes (nocional GC = 100 × precio).
Las tasas exactas de CME **no están verificadas** en esta propuesta: CME las publica en su «Non-Member Fee
Finder» y anunció cambios de tarifas desde el 1-oct-2026. Por eso el escenario exigente triplica el
deslizamiento y los montos. Si la estrategia sobrevive sólo en el escenario base, se considera que no sobrevive.

Orden de magnitud esperado: con un contrato GC de nocional alto, los costos por operación son muy chicos en
porcentaje. Es probable que los costos **no** sean lo que decide, **salvo** con una cuenta chica
(indivisibilidad: ver §8). La prueba lo confirma o lo refuta; no se asume.

### 5.3 Qué se calcula

Para E1, B1, B2, C1 y C2, y para cada variante de sensibilidad:

- Retorno anual, volatilidad, **Sharpe neto de costos** (sobre la tasa de letras), máxima caída (drawdown),
  peor período de 12 meses, cantidad de cambios de señal por año y porcentaje de meses comprado.
- **Diferencia de Sharpe E1 − B1**, con un intervalo del 90 % por **bootstrap en bloques** (bloques de 12
  meses, 10.000 repeticiones). Así se respeta que los meses consecutivos no son independientes.
- **Placebo:** 1.000 estrategias con signos al azar y la **misma cantidad de cambios de señal** que E1. Se
  mide en qué percentil cae E1.
- **Descomposición:** cuánto del resultado de E1 viene de los meses comprado y cuánto de los meses vendido.
- **Dos mitades:** dic-2005 a mar-2016 y abr-2016 a ago-2026, reportadas por separado.
- **Dependencia de episodios:** el resultado sin los 5 mejores meses de E1 y sin su mejor ventana de
  12 meses.

---

## 6. Criterios de descarte (escritos antes de correr)

Se corre **una vez**, con la regla de la §3 y los costos exigentes de la §5.2. Si se cumple **cualquiera**
de estos criterios, la propuesta queda **descartada** (`NO_VIABLE_STRATEGY` / `UNDERPERFORMS_BENCHMARK`):

| # | Criterio de descarte | Qué significaría |
|---|---|---|
| D1 | El retorno medio de E1 por encima de las letras, neto de costos, es ≤ 0 | No le gana al efectivo |
| D2 | El Sharpe neto de E1 es ≤ al de B1 (mantener oro) | No le gana a mantener oro ajustado por riesgo |
| D3 | La máxima caída de E1 es mayor que la de B1 **y** su Sharpe no es mayor por al menos 0,10 | Más riesgo sin compensación |
| D4 | E1 cae en o por debajo del percentil 75 del placebo | El timing no se distingue del azar |
| D5 | Con lookback de 6, 9 u 11 meses, el Sharpe neto queda ≤ al de B1 en dos de las tres | El resultado depende de un número exacto: no hay meseta |
| D6 | Sin los 5 mejores meses, el retorno excedente neto de E1 es ≤ 0 | Depende de unos pocos episodios |
| D7 | En alguna de las dos mitades, E1 queda por debajo de B1 **y** de las letras | No es estable en el tiempo |

**Descarte parcial (del lado vendido):** si C1 (sólo comprado) tiene un Sharpe neto mayor o igual que el de
E1, o si los meses vendidos aportan un retorno neto negativo, **se descarta la versión comprado/vendido**.
Queda, como mucho, la pregunta distinta de si conviene «comprado o afuera», que requeriría otra propuesta
con sus propios criterios.

**Control de Huang et al.:** si E1 y C2 (media histórica) difieren en menos de 0,10 de Sharpe, se registra
que **la ganancia viene de estar expuesto al oro, no de seguir la tendencia**. No es un descarte automático
si E1 pasa D1–D7, pero cambia la interpretación y se informa en primera línea.

**Para llegar a `CANDIDATE`** hacen falta **todas** estas condiciones: no se cumple ningún criterio D1–D7,
el intervalo del 90 % de la diferencia de Sharpe E1 − B1 queda **entero por encima de cero** y E1 supera
el percentil 95 del placebo. Si no se cumple ningún D pero tampoco esto, el resultado es
`INSUFFICIENT_EVIDENCE`.

---

## 7. Por qué lo más probable es «insuficiente» aunque la idea sea buena

La precisión con que se estima un Sharpe crece con la raíz de los años. Con unos 20 años, una ventaja real
de 0,3 de Sharpe sobre mantener oro da un estadístico de alrededor de 0,3 × √20 ≈ 1,3: **no alcanza** para
distinguirla del ruido. Además, una regla a 12 meses cambia de signo pocas veces por año, así que las
apuestas realmente independientes son pocas.

Consecuencias que conviene aceptar antes de correr:

- Si sale mal, **se descarta con confianza** (los criterios D son exigentes con la estrategia, no con los datos).
- Si sale bien, lo honesto es `INSUFFICIENT_EVIDENCE` o, en el mejor caso, `CANDIDATE` para seguimiento
  sin dinero, nunca «verificado».
- La muestra 2005–2026 **no es ciega**: todos conocemos a grandes rasgos lo que hizo el oro (suba hasta
  2011, caída 2013–2015, suba posterior). Por eso la regla viene fija de la literatura y no se ajusta después
  de ver el resultado. Cualquier corrida con otra regla, hecha después de ver esta, es exploratoria y no
  habilita nada: la misma disciplina que el ecosistema ya aplica a los backtests de SPY.

---

## 8. Riesgos operativos, aunque hoy no se opere

- **Tamaño mínimo:** un GC equivale a 100 onzas de nocional y un MGC a 10. Con exposición 1x, el capital
  necesario para un solo contrato es el nocional completo; con menos capital, el contrato mínimo ya implica
  apalancamiento. Hay que definirlo antes de pasar a papel, no para el backtest.
- **Margen:** los márgenes los fija CME y cambian con la volatilidad; las cifras de sitios de terceros
  (≈US$15.000 GC, ≈US$1.500 MGC) no son autoritativas. Un movimiento fuerte en contra puede exigir fondos
  en el medio del mes: la regla mensual no protege de eso.
- **Lado vendido:** pérdida no acotada; es el principal riesgo de cola de E1 frente a B1.
- **Rolls:** hay que renovar el contrato antes del período de entrega; un error de roll puede terminar en
  entrega física o en un precio malo.
- **Fuera del alcance:** impuestos, moneda de la cuenta del owner y tratamiento fiscal de futuros.

---

## 9. Qué pasa según el resultado

| Resultado | Qué se hace |
|---|---|
| Descartada | Se registra con la evidencia (datos, script, salida) para no repetir la investigación. Fin. |
| Descarte del lado vendido, «comprado o afuera» interesante | Nueva propuesta separada, con sus criterios propios, sin reutilizar este resultado como prueba |
| `INSUFFICIENT_EVIDENCE` | Se guarda. Se puede reabrir si aparece una fuente gratuita de cierres previos a 2004 (más historia = más poder) |
| `CANDIDATE` | Seguimiento **SHADOW** mensual durante 12 meses: registrar la señal a fin de mes y el resultado al mes siguiente, sin dinero. Sirve para verificar datos, roll y cálculo en tiempo real, **no** como prueba estadística (12 observaciones no prueban nada). Pasar a papel o a dinero es otra decisión, tuya |

---

## 10. Qué haría falta para correrla y cómo encaja en el ecosistema

- **Hoy GaleCore no tiene futuros ni oro:** su datafeed y sus backtests son de opciones sobre SPY, QQQ e
  IWM. Esta prueba no necesita tocar GaleCore ni GaleCore-AI: alcanza con un script de investigación
  independiente (como los de `GaleCore/research/backtesting/`) que baje tres series públicas, calcule y
  guarde datos de entrada, salida y comando.
- **Esfuerzo:** chico. Tres descargas públicas, un script y una corrida. Sin infraestructura nueva, sin
  base de datos y sin costos.
- **Registro:** la pregunta, la hipótesis, el plan y los criterios de esta propuesta encajan en el formato
  de `knowledge/research/` (`cli research save`). La propuesta no escribió nada ahí.
- **Prioridad:** por las reglas de este ejercicio no leí el plan (`roadmap/README.md`). Según
  `ENGINEERING.md` §1, una idea nueva se contrasta primero con el plan: **hace falta tu decisión** sobre
  si esto entra ahora o va al backlog. Es trabajo fuera del circuito de opciones sobre SPY.

### Decisiones tuyas pendientes (con recomendación)

1. **¿Aprobás la regla y los criterios tal como están (§3 y §6)?** Recomiendo aprobarlos sin cambios o
   cambiarlos **antes** de correr. Una vez corrida, no se tocan.
2. **¿Dónde se registra?** Recomiendo `knowledge/research/` como investigación, con el script al lado de
   los de backtesting.
3. **¿Se incluye el lado vendido?** Recomiendo correr ambos (E1 y C1) en la misma corrida, como ya está
   previsto: cuesta lo mismo y responde tu pregunta tal como la hiciste.

---

## 11. Qué es hecho, qué es interpretación y qué no está verificado

- **Hecho (fuente consultada):** especificaciones de GC y MGC (CME); el hallazgo general de Moskowitz,
  Ooi y Pedersen (58 contratos, 12 meses positivo en todos); el resumen de Huang et al. (2020) (poca
  predictibilidad activo por activo y rendimiento igual al de la regla de media histórica); que el Pink
  Sheet del Banco Mundial reporta el oro como promedio de cotizaciones diarias; que la serie LBMA ya no está
  en FRED; que el contango del oro se aproxima a la tasa corta más almacenamiento, menos lease; que el
  dataset público de AQR es un **factor agregado** (1985–2009), sin la serie del oro por separado.
- **No verificado en esta sesión:** el resultado específico del oro en el paper de 2012 (el PDF no se pudo
  leer); las tarifas exactas de CME; los márgenes vigentes; el gasto anual de GLD (a tomar del prospecto
  al correr); una fuente gratuita de cierres de oro anteriores a 2004.
- **Interpretación:** que el poder estadístico será bajo (§7); que los costos probablemente no decidan con
  un contrato completo; que el control C2 es el más informativo para tu pregunta.
- **Sin datos simulados:** ningún número de rendimiento de este documento es un resultado.

---

## Fuentes

- Moskowitz, Ooi, Pedersen (2012), *Time Series Momentum*, JFE — [AQR](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum) · [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0304405X11002613) · [PDF NYU](https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf)
- [AQR — Time Series Momentum: Original Paper Data](https://www.aqr.com/Insights/Datasets/Time-Series-Momentum-Original-Paper-Data)
- Huang, Li, Wang, Zhou (2020), *Time-series momentum: Is it there?*, JFE 135(3) — [RePEc](https://ideas.repec.org/a/eee/jfinec/v135y2020i3p774-794.html) · [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3165284)
- [CME — Gold Futures Contract Specs](https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html) · [Reglamento COMEX cap. 113](https://www.cmegroup.com/rulebook/COMEX/1a/113.pdf) · [QuantVPS — MGC](https://www.quantvps.com/blog/micro-gold-futures-tick-value)
- [CME — Exchange Fees](https://www.cmegroup.com/company/clearing-fees.html) · [Non-Member Fee Finder](https://www.cmegroup.com/company/clearing-fees/fee-finder.html)
- Carry del oro: [World Gold Council — curvas de futuros](https://www.gold.org/goldhub/data/gold-futures-curves) · [Money Metals](https://www.moneymetals.com/price/gold-spot-price-vs-futures) · [MetalCharts](https://metalcharts.org/guides/gold-futures-vs-spot)
- Datos: [Yahoo GC=F](https://finance.yahoo.com/quote/GC%3DF/history/) · [Barchart GC*0](https://www.barchart.com/futures/quotes/GC*0/price-history/historical) · [FRED gold tags](https://fred.stlouisfed.org/tags/series?t=gold%3Bprice) · [eco3min — reemplazo de GOLDPMGBD228NLBM](https://eco3min.fr/en/gold-price-history-dataset/) · [World Bank Pink Sheet](https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Pink-Sheet-August-2026.pdf) · [datahub gold-prices](https://datahub.io/core/gold-prices)
- Antecedente de divulgación (no independiente): [QuantifiedStrategies — media móvil en oro](https://www.quantifiedstrategies.com/gold-moving-average-strategy/)

---

## Registro

### Archivos leídos (workspace)

- `CLAUDE.md` (raíz; provisto en el contexto de la sesión)
- `ENGINEERING.md` (primeras 200 líneas: §0–§4)
- `knowledge/README.md`
- `knowledge/research/2026-09-23-gex-0dte-post-cierre.md` (como ejemplo del formato de investigación)
- `GaleCore-AI/docs/architecture/USE-CASE-STRATEGY-DEVELOPMENT-E2E.md` (índice de secciones; §6, §8, §9, §20, §21)
- `GaleCore/research/backtesting/README.md` (primeras 120 líneas)
- `GaleCore/research/data/tbill_3m_monthly.csv` (primeras y últimas filas; 2018-01 a 2025-12)
- Listados de directorios: raíz, `knowledge/`, `.claude/`, `.agents/`, `GaleCore-AI/`, `GaleCore-AI/docs/`
  (excluidos work-items, reviews y SESSION_HANDOFF), `GaleCore/research/`, `GaleCore/research/backtesting/`,
  `GaleCore/research/data/`
- Búsqueda local (Grep) de `gold|oro|GC=F|COMEX|trend following|time series momentum|momentum` excluyendo
  las rutas vedadas: sólo apareció en `ENGINEERING.md` y `archive/GaleCore-AI-arquitectura-v4.md` (no leído;
  no hay trabajo previo sobre oro)

No se leyó nada bajo `.worktrees/`, `roadmap/`, `decisiones/D-0004*`, `decisiones/D-0005*`, work-items,
reviews, `SESSION_HANDOFF.md` ni memoria. No se editó ningún archivo del workspace. No se usaron conectores
de cuentas, órdenes ni proveedores.

### Consultas web (14 de 15)

| # | Tipo | Consulta / URL | Resultado |
|---|---|---|---|
| 1 | Búsqueda | Moskowitz Ooi Pedersen time series momentum 2012 gold futures 12-month lookback results | Hallazgo general; sin dato del oro por separado |
| 2 | Búsqueda | Huang Li Wang Zhou "Time-series momentum: Is it there?" Journal of Financial Economics | Resumen y referencias |
| 3 | Búsqueda | CME Gold futures GC contract specifications 100 troy ounces tick size Micro Gold MGC | Especificaciones |
| 4 | Lectura | https://www.aqr.com/Insights/Datasets/Time-Series-Momentum-Original-Paper-Data | Factor agregado 1985–2009, no por activo |
| 5 | Lectura | https://ink.library.smu.edu.sg/context/lkcsb_research/article/7520/viewcontent/Time_series_momentum_JFE_sv.pdf | Falló (contenido vacío) |
| 6 | Lectura | https://alphaarchitect.com/are-trend-following-and-time-series-momentum-research-results-robust/ | Falló (HTTP 403) |
| 7 | Lectura | https://ideas.repec.org/a/eee/jfinec/v135y2020i3p774-794.html | Abstract de Huang et al. |
| 8 | Búsqueda | free historical gold futures daily data continuous contract download GC=F Yahoo Stooq Nasdaq Data Link CHRIS discontinued | Fuentes gratuitas (Yahoo, Barchart, Investing) |
| 9 | Búsqueda | trend following gold 12-month momentum backtest evidence gold futures time series momentum performance study | Antecedentes de divulgación |
| 10 | Lectura | https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf | PDF binario; no se pudo extraer texto |
| 11 | Búsqueda | gold futures contango carry equals interest rate minus gold lease rate roll yield COMEX basis | Relación del carry |
| 12 | Búsqueda | CME Group exchange fees COMEX gold futures non-member per contract fee schedule 2026 | Sin monto exacto; cambio de tarifas desde el 1-oct-2026 |
| 13 | Búsqueda | FRED LBMA gold price series discontinued GOLDPMGBD228NLBM removed alternative free monthly gold price history World Gold Council download | Serie LBMA retirada de FRED; alternativa Pink Sheet |
| 14 | Búsqueda | World Bank Pink Sheet commodity prices monthly averages gold definition "monthly average" CMO historical data | Oro en el Pink Sheet = promedio de cotizaciones diarias |
