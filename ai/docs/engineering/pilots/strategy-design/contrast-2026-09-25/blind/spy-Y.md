# Venta condicionada de prima put sobre SPY — propuesta evaluable y prueba de descarte

**Identidad:** `VCP-SPY` (Venta Condicionada de Prima put, SPY) · **versión:** 0.1-propuesta · **fecha:** 2026-09-25
**Pedido del owner:** investigar si vender prima con put credit spreads (PCS) sobre SPY, sólo cuando la prima es
atractiva y el entorno cumple condiciones de riesgo, tiene una ventaja verificable después de costos; usar RPF y
GaleCore como antecedentes a cuestionar; entregar una propuesta entendible y una prueba que permita descartarla.
**Alcance de este resultado:** definición + crítica de antecedentes + plan de prueba pre-declarado. No hay corridas
nuevas, ni datos comprados, ni órdenes. Nada de esto autoriza operar, ni PAPER, ni cambios en GaleCore.

---

## 1. Síntesis (lo que podés leer y decidir hoy)

**Respuesta corta a la pregunta:** con lo que existe hoy en GaleCore **no está demostrado** que haya una ventaja
después de costos, y tampoco está refutado. Lo que RPF muestra es real pero más débil de lo que parece:

1. **La muestra no alcanza para separar ventaja de ausencia de ventaja.** La configuración candidata (BT-17 “C”)
   hizo ~85 operaciones en 8 años con ~2 perdedoras. Con 2 pérdidas en 85, el intervalo de confianza 95 % de la
   frecuencia real de pérdida va de ~0,3 % a ~8,2 %; la frecuencia a la que la estrategia deja de ganar plata es
   ~9 % (ganancia media ~$43 contra pérdida ~$420; cálculo ilustrativo, §6.6). Es decir: **los datos son
   compatibles con una estrategia apenas en equilibrio.** Un 97 % de aciertos no valida el objetivo.
2. **La ventana de prueba está gastada.** 2018–2025 se usó para elegir delta, gestión, cartera, barras y capas en
   más de 15 corridas (BT-9 falló, H2, H3, scan de delta, BT-11…17, cambio de función objetivo en BT-17). Todo lo
   que salió de ahí es desarrollo, no confirmación.
3. **La configuración “final” nunca se corrió como tal** (delta 0,25 + GEX≥0 + cartera V2 es una interpolación
   entre dos filas medidas, admitido en la propia RPF §12.4).
4. **Nunca se comparó contra la alternativa correcta.** Una PCS es, en gran parte, una posición larga en SPY. En
   2018–2025 comprar y mantener SPY rindió ~14,2 % anual (BT-14); la estrategia, ~3,4 % sobre $10k (~2,1 % sobre la
   base de $16k que exige su propio límite de drawdown) más T-bill. La pregunta útil no es “¿gana?” sino “¿gana
   más que una cartera SPY+T-bill con el mismo riesgo, después de costos?”. Eso no está medido.
5. **El mecanismo tiene respaldo, pero la estructura cede buena parte de él.** La prima de volatilidad en puts del
   S&P 500 está documentada (Bondarenko), pero los puts más caros son justamente los más OTM, y la PCS **compra**
   ese wing: la propia RPF midió que el wing se lleva ~87 % de la prima bruta del short (BT-13b).

**Lo que propongo:** tratar la idea como **hipótesis a descartar barata primero**, en tres etapas, con reglas
congeladas antes de mirar resultados:

- **Etapa 1 (histórica, sin gasto):** re-simular con fills realistas y entrada ejecutable sobre los datos que ya
  están en disco, contra una cartera SPY+T-bill de riesgo equivalente y contra la misma PCS sin condiciones. Si
  pierde contra esas referencias **aun en la ventana que la favoreció**, se descarta. Si gana, **no** se confirma:
  sólo pasa a la etapa siguiente.
- **Etapa 2 (datos frescos):** dic-2025 → fecha de congelamiento no están en el dataset local; son los únicos
  datos históricos no tocados. Obtenerlos es una decisión tuya (costo), no la tomo.
- **Etapa 3 (prospectiva, en SHADOW o equivalente):** con reglas de descarte intermedias. Aviso honesto: confirmar
  la cola con significancia llevaría años (§6.6); la etapa 3 sirve sobre todo para **refutar** y para medir
  fills reales.

**Decisiones que te tocan (y qué cambian):**

| # | Decisión | Por qué importa | Si todavía no sabés |
|---|---|---|---|
| D1 | Contra qué querés ganarle: ¿T-bill, SPY+T-bill a igual riesgo, o ambos? | Define “ventaja”; propongo ambos, con SPY+T-bill como vara principal | Uso ambos; la principal es SPY+T-bill |
| D2 | Pérdida tolerable (drawdown máximo en % y en USD) y capital asignable | Fija la base de capital, que a su vez fija el retorno % | Uso los límites RPF (maxDD 5 %, heat 7 %, base $16k) sólo como supuesto |
| D3 | Utilidad económica mínima (p. ej., exceso anual sobre la referencia que justifica el trabajo) | Sin esto, “gana $2/año más” sería un “sí” | Reporto el exceso y no declaro “vale la pena” |
| D4 | Jurisdicción fiscal, broker y si SPY es el instrumento o podría ser XSP | Asignación anticipada, impuestos y costos cambian por instrumento y residencia | Queda `pendiente`; bloquea sólo el paso a operar, no la prueba |

---

## 2. Mandato entendido

| Campo | Contenido | Estado |
|---|---|---|
| Propósito | Ingreso por venta de prima con riesgo definido; objetivo: ventaja verificable neta de costos | definida |
| Instrumento | Put credit spread sobre opciones de SPY | definida (instrumento alternativo XSP en D4) |
| Horizonte de evaluación | Histórico 2013–2025 (desarrollo) + prospectivo | propuesto |
| Moneda | USD | definida |
| Referencia / “no operar” | T-bill 3m; SPY+T-bill a riesgo equivalente | propuesto, decide D1 |
| Capital | Antecedente RPF: base $16k, fondeo ~$32k para $200/mes | supuesto de RPF, no confirmado para esta propuesta (D2) |
| Pérdida tolerable | Antecedente RPF: maxDD 5 %, heat 7 %, riesgo/trade ≤5 % | supuesto (D2) |
| Grado de intervención | RPF: el sistema sugiere, el humano aprueba; nunca ejecuta | restricción heredada, se conserva |
| Tiempo de atención | Desconocido | pendiente (afecta gestión intradía y defensa) |

Separo, como pide el método: **ingreso de prima** (crédito cobrado) ≠ **resultado total** (P&L neto de cierre y
pérdidas) ≠ **retiro de efectivo** (la estrategia inmoviliza margen); **tasa de aciertos** ≠ **magnitud de
pérdidas** ≠ **riesgo de cola**.

---

## 3. Tesis

**Mecanismo esperado.** Los compradores de protección sobre el S&P 500 pagan una prima persistente: la volatilidad
implícita supera en promedio a la realizada (VIX medio 19,3 % vs realizada 15,1 % en 1990–2018 según Bondarenko
para Cboe) y los puts, sobre todo OTM, han tenido retornos muy negativos para el comprador (Bondarenko, *Why are
put options so expensive?*). Quien vende ese seguro cobra la prima a cambio de pérdidas grandes y concentradas.

**Resultado buscado.** Exceso de retorno neto sobre una cartera de riesgo comparable, con pérdidas acotadas.

**Forma de capturarlo.** Vender un put ~0,25 delta a 35–50 días y comprar otro $5 más abajo (riesgo definido),
cerrando al 50 % del crédito; entrar sólo si (a) la prima está cara (condición de “prima atractiva”) y (b) el entorno
no muestra estrés (condición de riesgo).

**Condiciones de falla (qué haría falsa la tesis).**
- El P&L es mayormente **beta a la acción** cobrada en un mercado alcista, no prima de volatilidad: en ese caso una
  cartera SPY+T-bill de igual riesgo rinde igual o más.
- La prima que queda después de **comprar el wing** y pagar costos (spread bid/ask, comisiones, fills peores que
  mid) es ~0.
- Las condiciones de entrada no agregan valor sobre vender sin condiciones, o lo agregan sólo en la ventana usada
  para elegirlas.
- La cola (gap/crash con la posición abierta) es más frecuente que lo observado en 2018–2025.

**Explicaciones alternativas y evidencia en contra.**
- *Beta/drift:* Israelov y Nielsen muestran, para covered calls (económicamente parecidos a vender puts), que la
  exposición a acciones explicó la mayor parte del riesgo y del retorno; la pata de volatilidad corta tuvo Sharpe
  ~1 pero ~10 % del riesgo. La RPF misma reconoce que su tabla de POP “es hija del drift” (13 años mayormente
  alcistas; C4 falló en H3).
- *Costos y márgenes:* Santa-Clara y Saretto encuentran que las fricciones y los requisitos de margen tienen un
  impacto económico importante en estrategias que venden puts OTM. Los índices PutWrite de Cboe son **brutos**; los
  productos que replican BXM rindieron sustancialmente menos que el índice (resumen de CXO Advisory).
- *Rendimiento reciente de put-write:* en 2006–2015 el PUT index rindió menos que el S&P 500 en términos absolutos
  (6,6 % vs 7,1 %) aunque con mejor Sharpe y menor drawdown — la ventaja histórica es de riesgo, no de retorno.
- *Peso problem:* 2018–2025 incluye 2018, 2020, 2022 y 2025, pero no 2008 ni ago-2015 (el único episodio que
  justifica la capa GEX está fuera de la ventana OOS).

**Distinción clave (mecanismo vs implementación).** La evidencia de Bondarenko es sobre **vender puts**, sobre todo
OTM. La PCS **compra** el put más OTM, que es el más caro: cede justamente la parte más rica de la prima. RPF lo
midió: el wing se lleva ~87 % de la prima bruta del short (BT-13b). La evidencia del mecanismo **no se traslada
sola** a esta estructura; lo que se captura es el diferencial de prima entre el strike 0,25 delta y el ~$5 más
abajo, más la beta. Eso es lo que hay que probar.

---

## 4. Antecedentes: qué tomo de RPF/GaleCore y qué cuestiono

Fuentes: `GaleCore/docs/rpf/` (definición v2, libro mayor, backtesting BT-0…BT-17), `GaleCore/decisiones/D-0001`,
`D-0002`, `GaleCore/research/backtesting/README.md`, `Files/Rpf/galecore_rules_rpf.json`,
`Files/pop_calibration.json`, `knowledge/research/2026-09-23-gex-0dte-post-cierre.md`, y el dataset en
`GaleCore/research/data/`. La base de conocimiento no tiene investigaciones previas sobre VRP/RPF (`kb search`
“prima VRP” y “RPF”: 0 resultados; eso no prueba que no existan en otro lado).

### 4.1 Lo que se conserva (con motivo)

| Elemento RPF | Por qué se conserva |
|---|---|
| PCS sólo, riesgo definido; sin naked, sin IC/CCS | Restricción del owner (heredada) y BT-11 (IC/CCS sin edge a prob. honesta) |
| Ancho $5 | BT-13c/BT-17: a riesgo constante el $5 domina; $10 es apalancamiento |
| Cierre al 50 % del crédito, **sin** salida forzada a 21 DTE | BT-4: la salida a 21 DTE destruye el win rate y empeora la cola. Nota: la v1.4.0 vigente todavía tiene `time_exit 21 DTE` activo (libro mayor §12.3) |
| Sugerir, nunca ejecutar; aprobación manual | Restricción de producto |
| Disciplina de pre-declaración, una corrida, conservar fallas | Es lo mejor de RPF; se mantiene y se extiende a costos y referencias |

### 4.2 Lo que cuestiono

| # | Regla o afirmación RPF | Objeción | Qué propongo |
|---|---|---|---|
| Q1 | “`edge > 1 ⟺ EV > 0`, identidad” (backtesting §1) y `edge_emp = (crédito/ancho)/p_ITM` | No es identidad: el pago esperado de un vertical es `∫ P(S<x) dx` entre strikes ≤ `ancho·P(S<K_short)`. `edge>1` es condición **suficiente** a vencimiento sin costos, no equivalencia. Además la estrategia no se lleva a vencimiento (cierre 50 %, defensa): el EV relevante es el de la política gestionada, no el de expiración | Mantener `edge_emp` sólo como variante; medir su valor incremental contra la misma estrategia sin el gate (V-S vs V-RPF, §6) |
| Q2 | Tabla POP empírica (`pop_calibration.json`) | Es frecuencia de terminar ITM, **incondicional**, sobre observaciones diarias solapadas (n inflado), pero se aplica **condicionada** a días ARMED. La diferencia entre delta y frecuencia realizada no es que “el delta miente”: es la prima de riesgo (drift + VRP) — o sea, lo que la estrategia quiere cobrar. Estimarla trailing es estimar la prima con 13 años de mercado alcista. El archivo servido no declara ventana ni corte temporal | Declarar ventana/corte; en la prueba usar sólo la versión trailing anti-lookahead (como BT-10c) |
| Q3 | Barras `min_edge` 1,05/1,10/1,10/1,20 y `vrp_min 1,2` “calibradas” | Salieron de barridos full-sample (BT-3 run-2), luego “congeladas”. BT-10b midió que VRP no es monótono (>1,55 = peor cuartil). Son parámetros estimados en la misma ventana en que se evalúan | Tratarlos como parámetros heredados, no validados; contar sus intentos en la corrección por pruebas múltiples |
| Q4 | Filtro de VRP = `atm_iv / rv30` | Mide la prima **ATM**, no la del tramo que se vende (0,25 delta menos wing). La condición de “prima atractiva” y lo que se cobra son objetos distintos | Mantener como condición de entorno; la atracción de la prima del spread se mide por el crédito neto de costos vs pérdida esperada (Q1) |
| Q5 | Gate `GEX ≥ 0` “mantenido, safety-first” | Lo justifica **un** episodio (ago-2015) fuera de la ventana; reconstruido con OI EOD cuyo momento de publicación no está verificado; el cálculo vivo incluye 0DTE y hay una investigación abierta sobre cuánto pesa (knowledge 2026-09-23). Además `D-0001` dice “el GEX es informativo, no operativo”, en contradicción con la definición RPF | Variante declarada con y sin GEX; no atribuirle protección de cola sin evidencia; resolver la contradicción documental (decisión tuya) |
| Q6 | Configuración final delta 0,25 + GEX + V2, “~8 trades/año, win ~97 %, peor año ≤ −$140” | Nunca corrida (interpolación). El delta 0,25 se eligió tras cambiar la función objetivo en BT-17, sobre ventana agotada | Correrla como fila propia en la etapa 1; los números “esperados” no se usan como criterio |
| Q7 | Fills: `crédito = mark_short − mark_long`, entrada **al cierre del día de señal** con datos de ese cierre | Mark = mid. Calcular la señal con el cierre y llenar a ese mismo cierre no es ejecutable. Fricción base $6,30 supone ½ spread por vía; la conservadora ($9,30) nunca se usó como vara | Fill principal: entrada a la sesión siguiente (o cotización ~15:45 si el dato existe), a mid menos concesión; sensibilidad a natural completo |
| Q8 | `hard_defense` (delta short > 0,42 ∨ pérdida ≥ 2× crédito) y `daily_kill_switch −1 %` | Nunca backtesteados (BT-4: “hard_defense no testeada”); con datos EOD sólo se aproximan | Simular a nivel EOD como variante declarada y registrar que la versión intradía no tiene evidencia |
| Q9 | Límite maxDD 5 % resuelto “subiendo el capital” a $16k | Legítimo, pero entonces el retorno % de la estrategia baja a ~2,1 % (≈$340/$16k) más T-bill; y ~$32k para $200/mes | La comparación se hace sobre la base de capital que cumple los límites, no sobre $10k |
| Q10 | “La config gana siempre que opera” | Muestra chica y agrupada (2021 concentra 48/117 señales en H3; 2019 sólo 4). Ver §6.6 | No se usa win rate como criterio |
| Q11 | put_wall como “restricción de sanidad”; sin muro → no_trade | Muerde <1 % de las entradas; en vivo un `putWall` null se volvió resultado legítimo (definición §10), así que puede bloquear más de lo medido | Mantener como variante; medir cuántos días bloquea por dato ausente |
| Q12 | Dataset | Cadenas SPY EOD 2013 → 2025-12-12 con OI, bid/ask, griegas (verificado en disco); proveedor/licencia no identificados (el PDF de descripción no se pudo leer); hora del snapshot y momento del OI no verificados; `spy_eod` sólo llega a 2023 | Verificación point-in-time como etapa 0 (§6.2) |

---

## 5. Reglas propuestas (v0.1) y parámetros

### 5.1 Variantes pre-declaradas (no se elige la mejor después)

| Id | Qué es | Para qué |
|---|---|---|
| **V-RPF** | La configuración RPF tal como está documentada (delta 0,25, $5, DTE 35–50 obj. 45, VRP≥1,2, flags, tail_score, GEX≥0, short ≤ put_wall, edge_emp ≥ barra, anti-pennies, cartera V2, gestión B, hard_defense EOD) | Probar lo que GaleCore efectivamente propone |
| **V-S** (simple) | Misma estructura, gestión y cartera; entra si: flags de régimen OK ∧ tail_score < 2 ∧ VRP ≥ 1,2 ∧ crédito ≥ 10 % del ancho y ≥ $0,30. Sin GEX, sin muro, sin tabla POP | Versión mínima de “prima atractiva + entorno de riesgo” con menos grados de libertad |
| **V-M** (mecánica) | Misma estructura, gestión y cartera; entra siempre que haya cupo, sin condiciones | Aísla el valor de las condiciones |
| **B-TB** | 100 % T-bill 3m (tasa point-in-time) | Referencia “no operar” |
| **B-EQ** | SPY + T-bill con peso de SPY fijo `w`, elegido **ex ante** para igualar la exposición delta media en dólares de V-RPF medida en el período de desarrollo 2013–2017 (no en el período evaluado) | Separa prima de beta. Diagnóstico adicional (no criterio): SPY con la misma exposición delta diaria que la estrategia |

Pregunta 1 (¿hay prima capturable?): V-M vs B-EQ. Pregunta 2 (¿las condiciones agregan?): V-RPF y V-S vs V-M.
Pregunta del owner (¿condicionado tiene ventaja?): V-RPF (y V-S) vs B-EQ y B-TB.

### 5.2 Reglas operativas (V-RPF; V-S y V-M quitan lo marcado)

| Paso | Observación y momento | Condición | Acción | Si falta el dato |
|---|---|---|---|---|
| 1 Calidad | Cotizaciones de la cadena; en histórico, snapshot EOD; en vivo, ≤15 s | Sin mercado cruzado; spread de cada pata ≤5 % del mid | Continuar | No se evalúa: estado “sin señal por datos” (se registra) |
| 2 Régimen | VIX, VIX9D, VIX3M de **cierre del día anterior** en histórico (variante: mismo día si se prueba que están antes de la decisión) | NO (VIX≥30 ∨ VIX9D>VIX3M ∨ RoC5d VIX>12 %) | Continuar | No entrar |
| 3 Cola | VVIX; skew25 = IV put 25Δ / IV ATM (DTE 25–35), RoC 5d | score < 2 (VVIX 110/130; skew 5 %/8 %) | Continuar | No entrar; skew exige ≥6 días de historia (`D-0002`) |
| 4 Gamma [sólo V-RPF] | GEX con OI **publicado** antes de la decisión | GEX ≥ 0 | Continuar | No entrar (declarado) |
| 5 Prima de entorno | IV ATM 30d / RV30 trailing (cierres hasta t−1) | ≥ 1,2 | Estado armado | No entrar |
| 6 Construcción | Cadena en la hora de decisión | Vencimiento DTE∈[35,50] más cercano a 45; short = put más cercano a 0,25 |Δ|; long = short − $5; [V-RPF] short ≤ put_wall | Candidato | Sin vencimiento/strike válido → no entrar |
| 7 Piso | Crédito del candidato a **precio ejecutable** (§5.4) | ≥ $0,30 y ≥ 10 % del ancho | Continuar | — |
| 8 Edge [sólo V-RPF] | Tabla trailing anti-lookahead | edge_emp ≥ barra por régimen | Señal | Tabla sin datos suficientes en el bucket → no entrar |
| 9 Cupo | Posiciones abiertas | ≤2 abiertas, la 2ª con vencimiento distinto; heat ≤7 % del capital base | Sugerencia | Sin cupo → registrar “señal sin cupo” |
| 10 Sizing | Capital base declarado | contratos = floor(presupuesto de riesgo / pérdida máxima por contrato) | — | Si da 0 contratos → no entrar |

Prioridades: salidas se procesan antes que entradas; si coinciden cierre por objetivo y defensa, gana defensa; una
señal no se reevalúa en el mismo día después de rechazarse. Señal, decisión (aprobación humana), orden y fill se
registran por separado con timestamp.

**Gestión:** cierre cuando el costo de recompra ejecutable ≤ 50 % del crédito; defensa si delta del short > 0,42 o
pérdida ≥ 2× crédito (evaluación EOD en histórico; intradía sin evidencia); sin salida por DTE; sin rolls en la
prueba (RPF permite rolls OTM por crédito: quedan fuera hasta tener evidencia; en vivo, cerrar). Al vencimiento: si
el short está cerca del dinero el día de vencimiento, cerrar antes del cierre (riesgo de pin y de movimiento
after-hours con liquidación física).

### 5.3 Parámetros

| Parámetro | Valor | Unidad | Origen | Dominio / política de ajuste |
|---|---|---|---|---|
| delta short | 0,25 | |Δ| | RPF BT-12/17 (estimación) | Congelado en la prueba; meseta 0,25–0,32 como sensibilidad declarada, no selección |
| ancho | 5 | USD de strike | RPF BT-13c/17 | Estructural |
| DTE | [35,50], obj. 45 | días | RPF | Estructural |
| vrp_min | 1,2 | ratio | literatura + BT-2/3 (in-sample) | Congelado; sensibilidad ±0,1 sólo reportada |
| flags régimen | VIX 30; TS; RoC 12 % | puntos/ratio | priors v2.1.5 | Congelados |
| tail | VVIX 110/130; skew 5 %/8 % | puntos/% | priors v2.1.5 | Congelados |
| min_edge | 1,05/1,10/1,10/1,20 | ratio | BT-3 run-2 (in-sample) | Sólo V-RPF |
| profit target | 50 % | % del crédito | BT-4 | Congelado |
| hard_defense | 0,42 ∨ 2× crédito | |Δ| / múltiplo | recomendación RPF, sin backtest | Congelado; marcado sin evidencia |
| cartera | 2 posiciones, vencimientos distintos | — | BT-15 | Congelado |
| heat / riesgo por trade | 7 % / ≤5 % | % capital base | RPF (supuesto) | Decide el owner (D2) |
| capital base | 16.000 | USD | RPF (supuesto) | Decide el owner (D2) |
| costos | ver §5.4 | USD/contrato | tastytrade (búsqueda) + RPF §7 | Escenarios fijos, no se optimizan |

### 5.4 Ejecución y costos (modelo de la prueba)

- **Comisiones:** según resultados de búsqueda de 2026, tastytrade cobra US$1 por contrato al abrir (tope US$10 por
  pata) y US$0 al cerrar, más cargos de clearing/regulatorios de traspaso; su tabla oficial figura “actualizada
  30-jul-2026” pero **no pude leer el PDF** → `pendiente` verificar la tabla primaria y el broker real (D4).
- **Escenarios de fill (fijos, pre-declarados):** (F1) mid − 25 % del ancho bid/ask del combo en contra, por vía;
  (F2) mid − 50 % (≈ RPF $6,30); (F3) natural completo (≈ RPF $9,30 o peor). **F2 es la vara principal**; la
  estrategia debe sobrevivir a F3 para no considerarse frágil.
- **Momento:** decisión con datos disponibles antes de la orden; fill en la sesión siguiente en histórico si no hay
  snapshot intradía (declarado como variante con nombre propio: “V-x/next-day”).
- **Orden:** combo límite (vertical) con precio límite ≥ crédito mínimo; validez: el día; sin “legging”. Parcial:
  se conserva lo llenado y se cancela el resto; rechazo: se registra y no se persigue el precio más allá del piso.
- **Nivel de evidencia de cada fuente de ejecución:** histórico = estimado por modelo de fill; SHADOW = observado en
  cotizaciones (no acredita fills); paper del broker = simulado; real = real. Ninguna etapa de esta propuesta
  produce fills reales.

---

## 6. Prueba que permite descartarla

### 6.1 Orden de evaluación y veredictos (excluyentes)

Se evalúan en este orden; el primero que aplica decide:

1. **INCONCLUSO por integridad** — falla una verificación point-in-time (§6.2) que no pueda corregirse sin cambiar
   una regla (cambiar la regla crea otra variante con nombre propio).
2. **RECHAZO por restricciones** (se juzga aparte de la estadística) — en la base de capital declarada, V-RPF
   supera maxDD o heat, o una pérdida individual excede el riesgo por trade. Una violación conocida no se neutraliza
   por muestra chica ni por resultado inconcluso. (Hoy, a $10k, ya viola maxDD 5 %: BT-15/17.)
3. **REFUTADA** — cualquiera de:
   - (R1) Exceso de V-RPF sobre **B-EQ** ≤ 0 en P&L neto total bajo **F2** en 2018–2025, **o** ≤ 0 bajo F3.
   - (R2) Exceso de V-RPF sobre **B-TB** ≤ 0 bajo F2.
   - (R3) Para la afirmación “condicionar agrega”: V-RPF **y** V-S no superan a V-M en P&L neto por unidad de
     riesgo-día (P&L / Σ pérdida máxima × días abiertos). Esto refuta las condiciones, no necesariamente la venta
     de prima.
   Como 2018–2025 favoreció a la estrategia (se eligió ahí), refutar ahí es un resultado fuerte.
4. **SOBREVIVE (no confirmada)** — ninguna refutación aplica. Pasa a etapa 2/3. Se reporta además el límite
   inferior del intervalo 90 % del exceso sobre B-EQ por bootstrap en bloques (§6.4); se espera que incluya 0.
5. **APOYO** — sólo en etapa 3 o con datos frescos: exceso sobre B-EQ > 0 con límite inferior 90 % > 0, y además
   ≥ tu utilidad mínima (D3). Ningún resultado de 2013–2025 puede producir APOYO.

### 6.2 Etapa 0 — verificación point-in-time (antes de ver resultados)

| Insumo | Qué verificar | Si falla |
|---|---|---|
| Cadenas EOD | Hora del snapshot del proveedor; que bid/ask sean cotizaciones y no calculadas; calcular ITM desde precio del subyacente vs strike, no desde el campo del proveedor | Si el snapshot es posterior a la decisión posible → variante next-day |
| Open interest | ¿Es el OI publicado a la mañana (cierre anterior) o el del día? | Usar OI de t−1 para GEX y muro |
| VIX/VIX9D/VIX3M/VVIX | Cierres CBOE: disponibles después de la sesión | Usar t−1 o variante con nombre |
| RV30, skew25 | Sólo cierres ≤ t−1 / cadena de t | — |
| Tabla POP | Sólo vencimientos ≤ corte (como BT-9) | — |
| T-bill | Serie mensual: usar el mes anterior | — |
| Costos | Tabla de comisiones vigente en cada año, no la de 2026 | Si no se consigue → aplicar la de 2026 y declararlo |
| GEX | Mismos vencimientos que en vivo (¿incluye 0DTE?) | Variante con/sin 0DTE, declarada |

### 6.3 Datos y separación temporal

- **Desarrollo (contaminado):** 2013–2025-12-12, local. Tabla POP trailing con ventana expansiva; primer año
  operable 2018 (como RPF). Todo resultado acá es desarrollo.
- **Fresco:** 2025-12-15 → fecha de congelamiento de esta v0.1. No está en disco; obtenerlo cuesta dinero o acceso
  (pendiente, decide el owner). Da pocas operaciones (~5–8): sólo sirve para refutar.
- **Prospectivo:** desde el congelamiento, con cotizaciones vivas de GaleCore. Registrar cada señal, cotización del
  combo a la hora de decisión, y el fill hipotético F1/F2/F3.
- **Múltiples intentos:** se registran todos. Número mínimo a declarar en la corrección: RPF corrió ≥17 ciclos
  sobre la misma ventana; más las 3 variantes de acá × 3 escenarios de fill. Para métricas tipo Sharpe, reportar la
  versión deflactada (Bailey y López de Prado) con ese número de intentos; para el veredicto se usan los criterios
  de §6.1, no el Sharpe.

### 6.4 Método e inferencia

- Simulación de cartera **path-level** con MTM diario, mismo calendario, mismo capital base y misma remuneración del
  efectivo para todas las variantes y referencias (el efectivo ocioso de la estrategia cobra T-bill, igual que en
  B-EQ/B-TB, descontado el margen inmovilizado).
- Comparación sobre la **serie diaria de diferencias** (V − B-EQ), bootstrap estacionario en bloques de ~1 mes
  (las posiciones duran ~17–21 días y se agrupan en clusters); reportar además por año calendario.
- Frecuencia de pérdidas: intervalo de Clopper-Pearson por operación y, como control de dependencia, por mes con
  pérdida.
- Sensibilidad (sólo reporte, no selección): delta 0,28/0,32; VRP 1,1/1,3; F1/F3; con/sin defensa.
- Escenarios de estrés (no son observaciones): gap −7 % overnight con IV +50 % con dos posiciones abiertas; se
  verifica que la pérdida quede en ≤ 2 × pérdida máxima y dentro del heat. 2008 y ago-2015 no están en la ventana
  2018–2025: el estrés los representa, no los prueba.

### 6.5 Métricas (USD, capital base declarado, neto de costos)

Retorno total y exceso sobre B-EQ y B-TB; ingreso de prima bruto vs P&L neto; maxDD de equity MTM y su duración;
peor año, peor mes, peor operación; frecuencia y tamaño medio de pérdidas; % de días con capital en riesgo;
operaciones/año; espera máxima entre entradas (régimen-cero, medido 272 días en BT-15). No se anualizan muestras
prospectivas menores a 2 años.

### 6.6 ¿Alcanza la muestra? (cálculo ilustrativo)

Supuestos (de BT-17 C): ~85 operaciones, ~2 perdedoras, pérdida ~$420, total $2.723. Ganancia media de las
ganadoras ≈ (2.723 + 2×420)/83 ≈ $43. Frecuencia de pérdida de equilibrio ≈ 43/(43+420) ≈ **9,3 %**. Intervalo 95 %
(Clopper-Pearson) de 2/85: **0,3 %–8,2 %**. Para que el límite superior quede por debajo de la mitad del equilibrio
(~4,6 %) sin pérdidas nuevas harían falta ~65 operaciones (regla del 3) ≈ **6–8 años** a 8–10 operaciones/año. Si
las pérdidas son parciales (gestión), el equilibrio sube; si hay más pérdidas máximas o las operaciones no son
independientes, la muestra efectiva baja. **Conclusión:** la prueba prospectiva puede refutar en meses (una o dos
pérdidas máximas tempranas cambian el cuadro), pero confirmar la cola lleva años. La decisión de operar, si llega,
va a descansar en mecanismo + estrés + ausencia de refutación, no en significancia.

### 6.7 Reglas de descarte prospectivas (etapa 3)

- Revisión trimestral con las mismas métricas; **refutación temprana** si: (a) 2 pérdidas ≥ 80 % de la pérdida
  máxima en las primeras 20 operaciones, o (b) exceso acumulado sobre B-EQ bajo F2 < −1 pérdida máxima tras
  ≥12 meses, o (c) los fills observados (spread del combo a la hora de decisión) son peores que F3 en >25 % de las
  señales.
- Inconcluso por defecto hasta ≥24 meses y ≥20 operaciones; APOYO sólo con el criterio 5 de §6.1.

---

## 7. Recorrido de situaciones (revisión local, sin delegación)

| Situación | Respuesta |
|---|---|
| Oportunidad normal | Pasos 1–10 → sugerencia con crédito mínimo; aprobación humana; combo límite |
| Sin señal por meses | Esperado (régimen-cero). Capital en T-bill; se registra la espera. No se relajan condiciones |
| Dos señales el mismo día | Una sola entrada por día; la 2ª posición exige vencimiento distinto; desempate: mayor crédito neto/pérdida máxima |
| Salida y entrada el mismo día | Se procesa primero la salida |
| Datos faltantes (skew sin historia, VIX9D ausente, muro null) | No entrar; posiciones abiertas se siguen gestionando con lo disponible; si falta la cotización de la posición, alerta al responsable |
| Orden rechazada / parcial | Registrar; no perseguir precio; parcial se conserva y el resto se cancela |
| Asignación anticipada del short (SPY es americana y de entrega física) | Riesgo mayor cerca de ex-dividendo y con el short ITM. Respuesta: ejercer el long o cerrar la acción recibida el mismo día; margen para 100 acciones por contrato puede exigirse → verificar con el broker (pendiente D4). XSP (europea, liquidación en efectivo) evita este evento; su liquidez y costos no están evaluados |
| Vencimiento con el short cerca del dinero | Cerrar antes del cierre; no dejar llegar a liquidación física |
| Límite de riesgo (kill switch −1 % diario, heat) | Pausa de entradas; posiciones abiertas se gestionan por sus reglas |
| Caída del broker / datos | Sin entradas; contingencia manual del responsable (a definir) |

---

## 8. Cobertura

| Bloque | Estado | Contenido / motivo | Próximo paso |
|---|---|---|---|
| Mandato e identidad | pendiente parcial | Nombre, propósito, moneda definidos; capital, pérdida tolerable, utilidad mínima, tiempo de atención sin decidir | D1–D3 |
| Tesis y contexto | definida | §3, con alternativas y fallas | Revisar tras etapa 1 |
| Universo | definida / pendiente | SPY opciones listadas; broker y jurisdicción pendientes; XSP como alternativa no evaluada | D4 |
| Datos y variables | pendiente | Dataset identificado; proveedor, licencia, hora de snapshot y momento del OI sin verificar | Etapa 0 |
| Señal y selección | definida | §5.2, variantes §5.1 | — |
| Construcción | definida | PCS $5, 0,25Δ, 35–50 DTE | — |
| Sizing y cartera | pendiente | Método definido; capital base y límites son supuestos RPF | D2 |
| Ejecución | pendiente | Modelo de fills definido; tabla primaria de costos sin leer; broker sin decidir | Verificar fee schedule; D4 |
| Gestión y salidas | definida con salvedad | 50 %, defensa sin evidencia, sin rolls | Registrar defensa como no validada |
| Riesgo operacional | pendiente | Respuestas en §7; responsable y contingencia manual sin asignar | Owner |
| Eventos y obligaciones | pendiente | Asignación anticipada, entrega física, dividendos, margen, **impuestos según residencia** — no resueltos desde memoria | Fuente fiscal y del broker (D4) |
| Medición | definida | §6.5 | — |
| Evaluación | definida | §6 | Congelar y correr etapa 0–1 |
| Ciclo de vida | pendiente | Registrar esta propuesta como investigación en `knowledge/` (no lo hice: no se me autorizó escribir) | `research save` con destino autorizado |
| Rama opciones | definida / pendiente | Estilo americano y entrega física verificados (Cboe); strikes/DTE definidos; asignación y margen pendientes con broker; “delta ≠ probabilidad empírica” explícito en Q2 | D4 |

---

## 9. Pendientes priorizados

| Prioridad | Pendiente | Resuelve | Siguiente acción |
|---|---|---|---|
| 1 | Congelar v0.1 (variantes, costos, criterios) antes de correr | Owner + investigador | Aprobación de este documento o cambios |
| 2 | Etapa 0 point-in-time (snapshot, OI, VIX, costos por año) | Investigador | Leer metadatos del proveedor y muestrear fechas |
| 3 | Etapa 1 histórica (V-RPF, V-S, V-M, B-EQ, B-TB × F1–F3) | Investigador | Script nuevo reutilizando `bt15_portfolio.py`/`bt17_levers.py` sin modificar los originales |
| 4 | Decidir D1–D3 | Owner | — |
| 5 | Broker, jurisdicción fiscal, margen, SPY vs XSP (D4) | Owner + fuente primaria | Bloquea sólo el paso a operar |
| 6 | Datos dic-2025 → hoy | Owner (costo) | Decidir si se adquieren |
| 7 | Contradicción `D-0001` (“GEX informativo”) vs RPF (GEX gate) y `time_exit 21 DTE` activo en v1.4.0 | Owner | Registro de decisión |
| 8 | Seguimiento prospectivo en SHADOW con cotización del combo | Trabajo posterior con sus controles | No inicia con esta propuesta |

---

## 10. Historial y referencias

- v0.1-propuesta (2026-09-25): primera versión. Antecedente: RPF v2 (2026-07-29), BT-0…BT-17 (cerrado 2026-07-14),
  libro mayor (2026-07-29). No modifica ninguno.
- Límites de esta entrega: no se corrió ningún backtest nuevo; los números citados son de documentos de GaleCore o
  cálculos ilustrativos marcados; la tabla primaria de comisiones no pudo leerse; la fiscalidad no se investigó.

---

## Registro

**Archivos leídos (workspace):**
- `[REF]`, `[REF]`
- `GaleCore/docs/rpf/README.md`
- `GaleCore/docs/rpf/galecore-estrategia-rpf.md`
- `GaleCore/docs/rpf/galecore-rpf-reconciliacion.md`
- `GaleCore/docs/rpf/galecore-research-backtesting-rpf.md` (§1–BT-12 inicio, BT-13, BT-14, BT-15, BT-16, BT-17, 3-bis, §4–§9)
- `GaleCore/decisiones/D-0001-pivot-v140-pcs-only.md`, `GaleCore/decisiones/D-0002-skew25-domina-tail-score.md`
- `GaleCore/research/backtesting/README.md`
- `GaleCore/source/galecore-datafeed/DataFeed.Api/Files/Rpf/galecore_rules_rpf.json` (claves de primer nivel)
- `GaleCore/source/galecore-datafeed/DataFeed.Api/Files/pop_calibration.json`
- `knowledge/README.md`, `knowledge/research/2026-09-23-gex-0dte-post-cierre.md` (primeras 60 líneas)
- `GaleCore-AI/CLAUDE.md` (primeras 80 líneas)
- Metadatos/esquemas de `GaleCore/research/data/`: `spy_options/*.parquet` (esquema, rango 2025), `spy_underlying_prices.parquet`,
  `spy_eod/` (listado), `derived/spy_gex_daily`, `spy_skew25_daily`, `spy_walls_daily`, `vvix_history.csv`, `tbill_3m_monthly.csv`
  (`dataset_description.pdf` no se pudo leer: sin herramientas PDF instaladas)
- Comandos: `galecore_ai.adapters.cli catalog`; `kb search` con “put credit spread SPY” (sólo registros de régimen), “prima VRP” (0), “RPF” (0)

**Búsquedas web (8):**
1. tastytrade options commissions pricing per contract 2026
2. variance risk premium put writing equity beta decomposition Israelov put spread out-of-the-money puts overpriced Bondarenko
3. Bondarenko Cboe PutWrite index PUT historical performance study risk-adjusted returns S&P 500
4. Bondarenko "Why are put options so expensive" out-of-the-money puts abnormal returns
5. SPY options product specifications American style exercise physical settlement Cboe expiration
6. Santa-Clara Saretto "Option strategies: Good deals and margin calls" transaction costs margin put writing
7. Bailey López de Prado probability of backtest overfitting deflated Sharpe ratio multiple testing trials
8. Israelov Nielsen "Covered Call Strategies: One Fact and Eight Myths" equity exposure short volatility equity reversal decomposition

**Páginas consultadas (4 lecturas), fecha de consulta 2026-09-25:**
- https://assets.contentstack.io/v3/assets/blt7dc2e3d4a7071563/blt2b752fef372188fe/commissions-and-fees (PDF tastytrade “last updated July 30, 2026”; descargado, no legible)
- https://support.tastytrade.com/support/s/solutions/articles/43000435233 (no cargó contenido)
- https://cboe.com/tradable-products/product-comparison (SPY americana/entrega física vs XSP/SPX europeas/efectivo)
- https://www.cxoadvisory.com/equity-options/performance-of-cboe-putwrite-indexes/ (PUT/WPUT 2006–2015, caveats de costos)

**Fuentes citadas a partir de resultados de búsqueda (no leídas completas):**
- Bondarenko, *Historical Performance of Put-Writing Strategies* (2019, Cboe): https://cdn.cboe.com/resources/education/research_publications/PutWriteCBOE19_v14_by_Prof_Oleg_Bondarenko_as_of_June_14.pdf
- Bondarenko, *Why Are Put Options So Expensive?* (QJF 2014): https://papers.ssrn.com/sol3/papers.cfm?abstract_id=375784
- Israelov y Nielsen, *Covered Calls Uncovered* / FAJ 2014: https://papers.ssrn.com/sol3/Papers.cfm?abstract_id=2444999
- Santa-Clara y Saretto, *Option strategies: Good deals and margin calls* (JFM 2009): https://ideas.repec.org/a/eee/finmar/v12y2009i3p391-417.html
- Bailey y López de Prado, *The Deflated Sharpe Ratio*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551 ; Bailey et al., *The Probability of Backtest Overfitting*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253
- Cboe, especificaciones de opciones sobre ETP (resultado de búsqueda): https://res.cboe.com/exchange-traded-stock/etp-options-spec

**Total de consultas web:** 12 (8 búsquedas + 4 lecturas).
