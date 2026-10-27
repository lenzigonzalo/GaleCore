# 2026-08-25 — El sesgo por lado aguanta con book vivo, y la banda de quotes trunca en IV alta

**Verifica:** el pendiente que la [§43.4](../galecore-estrategia-got.md) dejó abierto y la §98 listaba
primero — el sesgo por lado medido el 2026-08-24, ¿es real o es un artefacto de haber cotizado SPY y
QQQ **después del cierre**?
**Datos:** los seis CSV de [`data/2026-08-25/`](../data/2026-08-25/), capturados entre las **10:09 y
las 10:23 ET** con el mercado abierto, sobre los dos vencimientos **regulares** del bucle de la §47.1
(2026-09-18, DTE 24; y 2026-10-16, DTE 52). Contra los de `data/2026-08-24/`, mismos símbolos y
mismos dos vencimientos.
**Reproduce:** [`scripts/skew_por_lado.py`](../scripts/skew_por_lado.py) sobre las dos carpetas.
La corrida completa, con horarios en ET, en [`data/2026-08-25/capturas.txt`](../data/2026-08-25/capturas.txt).
**Veredicto:** el sesgo es **real**. Con el book abierto y más ajustado, los seis cocientes conservan
signo y orden de magnitud: SPY y QQQ siguen pagando más del lado CALL, TSLA más del lado PUT. El
pendiente de la §43.4 queda **cerrado**. Aparecieron dos cosas que no se buscaban: un piso de ruido
día a día de hasta 0.15, y un defecto de la banda de quotes que invalida cualquier captura de un
símbolo de IV alta hecha con los parámetros de un ETF de índice.

---

## 1. La comparación

Cociente CALL/PUT del pago por unidad de delta, por vencimiento. La tanda del 24 es post-cierre en
SPY y QQQ (~17:25 y ~18:15 ET); la del 25 es intradía, con el mercado abierto:

| Símbolo | Vencimiento | 24-ago · post-cierre | 25-ago · **en sesión** | Δ |
|---|---|---|---|---|
| SPY | 2026-09-18 | 1.69 | **1.73** | +0.04 |
| SPY | 2026-10-16 | 1.92 | **1.87** | −0.05 |
| QQQ | 2026-09-18 | 1.47 | **1.36** | −0.11 |
| QQQ | 2026-10-16 | 1.53 | **1.38** | −0.15 |
| TSLA | 2026-10-16 | 0.51 | **0.56** | +0.05 |
| TSLA | 2026-09-18 | — | **0.73** | primera captura |

Con mid en vez de bid/ask la lectura es la misma: SPY 1.71 y 1.80, QQQ 1.33 y 1.33, TSLA 0.77 y 0.61.

Y el book se ajustó donde se puede comparar — SPY 4.7% → 4.3% en el 09-18 y 3.4% → 2.4% en el 16 Oct,
QQQ 1.9% → 1.6% y 1.2% → 1.0%. **Ese es el punto que cierra el pendiente:** el argumento a favor de
descartar la medición del 24 era que un book post-cierre, más ancho, castigaba de manera despareja al
crédito conservador (bid del short contra ask del long). Con el book más angosto el sesgo no se
movió de signo ni de escala.

El book de TSLA **no** entra en esa comparación, por lo del §4.

## 2. Qué queda cerrado

**El sesgo por lado es una propiedad de la superficie de cada símbolo, no del horario de captura ni
del motor.** Era la última objeción abierta contra la §43.5, y con esto la sección se sostiene tal
como está escrita: sobre SPY y QQQ el filtro económico simétrico favorece al CALL, sobre TSLA al PUT,
y por eso no hay constante que declarar.

Queda cerrado también el segundo pedido del pendiente, que era medirlo **sobre vencimientos
regulares**: los dos de esta tanda lo son, y salieron marcados `Regular` por la columna que
`gex-strikes.ps1` registra desde el hallazgo del weekly.

## 3. El piso de ruido, que no se buscaba

El mismo símbolo, el mismo vencimiento y **un día de diferencia** mueven el cociente hasta 0.15:

| | 24-ago | 25-ago |
|---|---|---|
| QQQ 09-18 · lado PUT | 0.56 | 0.62 |
| QQQ 10-16 · lado PUT | 0.54 | 0.60 |
| QQQ 09-18 · lado CALL | 0.83 | 0.85 |
| QQQ 10-16 · lado CALL | 0.84 | 0.83 |

**En QQQ el cociente bajó porque subió el lado PUT, no porque bajara el CALL.** El put se puso más
caro por unidad de delta de un día para el otro, un 10% en los dos vencimientos. SPY se movió apenas
0.04–0.05 y TSLA 0.05.

Es un dato con consecuencias para lo que viene: **ninguna calibración sobre esta métrica puede
reclamar precisión más fina que su propia variación día a día**, y con una captura por día hacen
falta muchas ruedas para distinguir una diferencia real de esta oscilación. Refuerza lo que la §47.1
ya anotó sobre el tamaño de la muestra: con ocho celdas por corrida, la captura periódica no es un
lujo, es la única forma de que el número signifique algo. Cuánto de esto es ruido de mercado y cuánto
es la hora del día —10:15 ET contra 17:25 ET— esta medición no lo separa; ver §5.

## 4. La banda de quotes trunca la cadena en símbolos de IV alta

**La primera captura de TSLA de hoy salió inservible, y el script la reportó como un número normal.**
Corrida con los mismos `-QuoteBandPct 12` que SPY y QQQ, dio 0.71 y 0.67 — cerca de lo esperado, sin
nada que llamara la atención. Está guardada como evidencia en
[`data/2026-08-25/descartado-banda12/`](../data/2026-08-25/descartado-banda12/), fuera del alcance del
glob de `skew_por_lado.py`, que no es recursivo.

Lo que había abajo:

* **17 de 137 strikes tenían quote en el 16 Oct, y 27 de 167 en el 18 Sep.** La banda es ±12% del
  spot, y TSLA a 351.87 con **41.7% de ATM
  IV** tiene su strike de delta 0.10 muy afuera de ±12%. Para SPY, al 13% de IV, ese mismo ±12%
  cubre de sobra la zona que la estrategia vende.
* **Los tres objetivos de delta cayeron en el mismo strike.** `candidato()` busca el delta más
  cercano a 0.10, 0.15 y 0.20; sin strikes cotizados más afuera, los tres se conformaron con el
  borde de la banda: **0.218 del lado put y 0.324 del lado call**. El promedio "sobre tres
  objetivos" era un strike contado tres veces.
* **Y el cociente comparaba delta 0.32 contra delta 0.22.** La métrica existe para comparar los dos
  lados a moneyness equivalente. Así no mide lo que dice medir.

Recapturado a las 10:22 ET con `-QuoteBandPct 35`, TSLA da 59 y 49 strikes cotizados, los objetivos
caen donde deben (0.095 / 0.147 / 0.218 del lado put del 09-18) y el cociente se corrige a **0.73 y
0.56**. La truncadura empujaba el número **hacia 1**, o sea que atenuaba justo el efecto que la
sección quiere medir.

**Por qué no se había visto antes:** el TSLA del 24 se capturó **sin banda ninguna** — 137 de 137
strikes, de 50 a 900 — mientras SPY y QQQ iban con banda 12. Los dos símbolos con parámetros
distintos, y la línea de ejemplo de [`data/README.md`](../data/README.md) documenta solo el 12.

Dos consecuencias operativas:

* **El `book` de la tabla del §1 solo es comparable a banda igual.** El 7.7% del TSLA del 24 promedia
  strikes de 50 a 900, donde el spread relativo es enorme; el 2.1% de hoy promedia una banda de ±35%.
  No hay lectura posible entre esos dos números, y por eso TSLA no entra en el argumento del §1.
* **La banda está definida en porcentaje de spot cuando lo que importa es distancia en delta o en
  EM.** ±12% es una distancia distinta según la IV del símbolo y el DTE. Un `-QuoteBandPct` fijo no
  es trasladable entre símbolos, que es exactamente la clase de error que el
  [hallazgo del sesgo por lado](2026-08-24-sesgo-por-lado-spy-qqq.md) encontró en otro parámetro.

## 5. Qué NO prueba

* **Es una hora de una rueda.** 10:09–10:23 ET del 2026-08-25, con el mercado abierto hacía 40
  minutos. No dice nada sobre la estabilidad intradía, que la §67 tiene como pendiente propio, ni
  separa el ruido de mercado del efecto de la hora: el Δ del §1 mezcla las dos cosas y ninguna
  captura sola puede desarmarlo.
* **Son dos vencimientos.** Los del bucle de hoy, no una curva de DTE.
* **No cambia nada de la economía.** Sigue siendo el crédito conservador contra el delta; el edge
  test —el gate económico que falta, §43.3— no está implementado y esto no lo acerca.
* **El sesgo confirmado no es una instrucción de operar.** La §43.5 dice que se mide y se deja a la
  vista, no que se corrija con un factor; esto la confirma, no la modifica.

## 6. Qué hacer

* **Aplicar a la §43.4 y la §98:** el pendiente de recapturar en sesión está cumplido, y con
  vencimientos regulares.
* **La banda de quotes se elige por símbolo.** Como mínimo, que `gex-strikes.ps1` avise cuando la
  banda deja afuera el strike de delta 0.10 del vencimiento que se está capturando — es la
  información que hoy hay que ir a buscar contando filas. Mejor todavía: expresar la banda en
  múltiplos de EM, que ya se calcula.
* **`skew_por_lado.py` tiene que delatar cuando un objetivo no se cumple.** Que dos objetivos de
  delta distintos devuelvan el mismo strike, o que el delta encontrado esté a más de ~0.03 del
  pedido, es un resultado inválido y hoy se imprime igual que uno bueno. Es la misma forma de
  romperse que el error de columna del [crédito CALL](2026-08-24-credito-call-columna-equivocada.md):
  un número plausible, sin nada que avise.
* **Corregir la línea de ejemplo de `data/README.md`**, que documenta un `-QuoteBandPct 12` con el
  que no se capturó TSLA ninguno de los dos días.
