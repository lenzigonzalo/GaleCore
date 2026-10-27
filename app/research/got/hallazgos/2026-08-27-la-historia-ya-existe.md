# 2026-08-27 (noche) — La historia de cadenas que la §61.9 iba a comprar ya está en la máquina

**Verifica:** la premisa de la [§61.9](../galecore-estrategia-got.md) — que medir la hipótesis única
exige elegir entre ensanchar el universo, **comprar historia de cadenas con open interest**, o
aceptar el negativo. ¿Hace falta comprarla?
**Datos:** [`research/data/`](../../data/), que el README de
[`research/backtesting/`](../../backtesting/README.md) lista como prerrequisito de los ciclos BT-10…BT-17.
**Reproduce:** [`scripts/inventario_historia.py`](../scripts/inventario_historia.py).
**Veredicto:** **no hace falta comprarla: ya está.** Cadenas EOD de SPY, QQQ e IWM de 2013 a 2025,
con `open_interest`, `gamma`, `delta` e `implied_volatility` por strike y por día — todo lo que la
banda de la §61.4 necesita para reconstruirse históricamente. Son **532 ciclos** (símbolo,
vencimiento mensual) con resultado observable, o **1064 observaciones de lado**, contra las ~300 que
la §61.9 pide. **La §61.9 deja de estar bloqueada por falta de datos.** Lo que queda abierto es de
método, no de acceso, y hay un problema de especificación en el enunciado que hay que resolver antes
de medir (§4 de acá).

---

## 1. Qué hay

| Símbolo | Archivos | Filas (2025) | Días | Vencimientos | OI no nulo | OI>0 | gamma no nula |
|---|---|---|---|---|---|---|---|
| SPY | 14 | 2.320.196 | 238 | 271 | 100.0% | 79.0% | 100.0% |
| QQQ | 14 | 2.000.800 | 239 | 271 | 100.0% | 77.5% | 100.0% |
| IWM | 13 | 1.146.274 | 239 | 270 | 100.0% | 71.8% | 100.0% |

Columnas de cada cadena:

```
contract_id · symbol · expiration · strike · type · date
last · mark · bid · bid_size · ask · ask_size · volume · open_interest
implied_volatility · delta · gamma · theta · vega · rho · in_the_money
```

**`open_interest` y `gamma` por strike es exactamente lo que le faltaba a la §61.9.** La banda se
construye sobre el GEX por strike, que es gamma × OI; sin esas dos columnas no hay forma de
reconstruir una banda histórica, y con ellas la reconstrucción es directa. El spot para los 3256
días ya está derivado en `derived/{sym}_gex_daily.parquet`.

## 2. La muestra

Un ciclo es un par (símbolo, vencimiento **mensual**) ya vencido dentro del dataset, o sea con
camino de precio completo. Los vencimientos posteriores a 2025 existen en la cadena (LEAPS hasta
2028) pero no tienen resultado:

| Símbolo | Mensuales con resultado | Rango |
|---|---|---|
| SPY | 178 | 2013-01-19 → 2025-12-19 |
| QQQ | 177 | 2013-01-19 → 2025-12-19 |
| IWM | 177 | 2013-01-19 → 2025-12-19 |
| **Total** | **532 ciclos** | **1064 observaciones de lado** |

> **Trampa del conteo: hasta febrero de 2015 los mensuales vencían el SÁBADO** siguiente al tercer
> viernes, no el viernes. Filtrando por `weekday()==4` se pierden 2013 y 2014 enteros —el primer
> mensual detectado pasa a ser 2015-02-20— y la muestra cae ~15% sin que nada avise. El script filtra
> por viernes **o** sábado entre los días 15 y 22.

## 3. Hay un holdout limpio, y no es un detalle

El README de `research/backtesting/` declara: *"La ventana OOS 2018–2025 está **agotada**: cualquier
corrida nueva sobre ella es exploratoria (genera hipótesis) — no habilita nada."* Esa regla aplica a
cualquier medición nueva sobre esos años, incluida ésta.

| Ventana | Ciclos | Obs. de lado | Estado |
|---|---|---|---|
| **2013–2017** | 211 | **422** | **nunca tocada** por el trabajo de backtesting |
| 2018–2025 | 321 | 642 | agotada — sirve para explorar, no para habilitar |

O sea que la §61.9 se puede plantear como corresponde: **explorar y fijar el procedimiento sobre
2018–2025, y medir el veredicto sobre 2013–2017**, que nadie miró. Es mejor situación que la de un
dataset comprado hoy, donde todo sería una sola ventana.

**Con la reserva de independencia**, que es la parte incómoda: SPY, QQQ e IWM del mismo vencimiento
no son tres observaciones independientes —los tres son renta variable estadounidense, y dos de ellos
casi el mismo índice—. Contando ciclos de vencimiento únicos, la ventana limpia da **71 ciclos = 142
observaciones de lado**, por debajo de las 300. Para llegar al número con holdura hay que usar la
historia entera, y entonces el holdout deja de ser limpio. **Esa tensión hay que resolverla al
diseñar la prueba, no al leer el resultado.** IWM ayuda —small caps, el menos correlacionado de los
tres— pero no está en el universo de la §4: entra como dato, no como universo declarado.

## 4. El enunciado tiene una ambigüedad que decide el resultado

La §61.9 dice:

> La probabilidad empírica de que el precio **cruce** el borde externo de una banda de gamma
> dominante es menor que **el delta** de ese borde.

**"Cruzar" y "delta" no miden lo mismo.** El delta de una opción aproxima P(terminar ITM), no
P(tocar el strike alguna vez). Para un proceso sin deriva, P(tocar) ≈ 2 × P(terminar más allá) — es
el principio de reflexión. Si la prueba mide *tocar* y lo compara contra *delta*, **la hipótesis sale
falsa casi por construcción**, y el negativo no diría nada sobre el muro: diría que se compararon dos
cosas distintas.

La lectura coherente con el resto del documento es **terminar más allá**: la §61.9 misma glosa la
hipótesis como *"se vende a precio de delta 0.25 un riesgo de delta 0.18"*, que es lenguaje de
probabilidad terminal, y `derived/pop_obs_*.parquet` —la maquinaria empírica que ya existe— usa una
columna `itm`, o sea resultado a vencimiento.

**Hay que fijarlo por escrito antes de correr nada.** Las dos preguntas son legítimas y distintas: la
terminal es la que corresponde a un spread llevado a vencimiento, y la de toque es la que
corresponde a una posición gestionada con roll defensivo. La §61 es sobre dónde vender, así que la
terminal es la que cierra la hipótesis; la de toque, si se quiere, es una segunda medición con su
propio umbral de comparación (que no es delta).

## 5. El reparo que hay que tener presente: los datos no viajan con el repo

**`research/data/` está en `.gitignore`** — lo dice el README de backtesting y lo confirma el
`.gitignore`. Los parquet viven solo en la máquina donde se bajaron; son cientos de MB por año y por
símbolo. Consecuencias:

* Una sesión futura que lea el repo **no ve estos datos** y va a volver a concluir que la historia
  hay que comprarla, exactamente como pasó hasta hoy. Por eso este hallazgo existe.
* Cualquier número de la §61.9 va a ser reproducible solo en esta máquina, salvo que **se versione
  el derivado intermedio**. Eso es barato: los `derived/*.parquet` pesan KB, no MB, y ya hay
  precedente de versionar derivados (`spy_skew25_daily.parquet` y compañía figuran en el repo).
  La recomendación es que la medición de la §61.9 escriba su tabla de observaciones —un renglón por
  (símbolo, vencimiento, lado): borde, delta del borde, resultado— y que **esa** tabla se commitee.
* `inventario_historia.py` avisa y sale limpio si no encuentra `research/data/`, en vez de fallar
  con un stack trace.

## 6. De arrastre: otras dos cosas destrabadas

**El edge test de la §43.3.** `derived/pop_obs_{calls,puts}_{spy,qqq}.parquet` son 1.29 millones de
filas de `(expiration, bucket de delta, delta, itm)` — la probabilidad **empírica** por delta, que es
justo la mitad que le falta al edge test. La otra mitad, la implícita, sale del crédito. Y
`pop_calibration_{sym}.parquet` ya tiene la curva ajustada, que es el análogo del
`pop_calibration.json` que RPF usa en vivo.

**Una alarma sobre la serie que calibró los umbrales del skew.** `spy_skew25_daily.parquet` tiene
`iv_atm` **repetido día a día el 37.3% de las veces**, con `iv_p25` moviéndose en esos mismos días
—las tres primeras filas comparten `iv_atm` 0.12219 mientras `iv_p25` va 0.15146 → 0.14170 →
0.13195—. Como `skew25 = iv_p25 / iv_atm`, un denominador congelado inyecta variación espuria en el
RoC, que es lo que calibró `warn 0.05` / `block 0.08`. **No es** el bug de rollover mensual que se
arregló hoy en `SkewSnapshotService`: los saltos grandes no se apilan en los días 15–21, están
repartidos por todo el mes. El builder de esa serie es uno de los scripts BT-0…BT-9b que se
perdieron, así que la única forma de diagnosticarlo es reconstruir la serie desde las cadenas crudas
y diferenciar. Queda anotado, no medido.

## 7. Qué cambia esto

La §61.9 planteaba tres salidas y decía que la 2 *"contesta en semanas, cuesta dinero"*. **La 2 ya
está pagada.** Y el README de esta carpeta decía que había que elegir entre ensanchar el universo,
comprar historia, o plegar GOT al edge test de RPF — con la conclusión de que *"la 3 dejó de ser una
alternativa entre iguales: es el resultado por defecto"*. Esa conclusión se apoyaba en que medir era
inviable. **Ya no lo es**, así que la pregunta de plataforma vuelve a estar abierta de verdad.

Lo que queda para la próxima sesión, en orden:

1. **Fijar la definición de "cruce"** (§4 de acá). Es una decisión de una línea y condiciona todo.
2. **Resolver la tensión holdout / independencia** (§3): o se acepta 142 observaciones limpias, o se
   usa la historia entera y el resultado es exploratorio, o se busca un tercer arreglo.
3. **Reconstruir la banda histórica** por (símbolo, vencimiento, fecha de medición) con el
   procedimiento de la §61.7, y escribir la tabla de observaciones, que se versiona.
4. Recién ahí, medir.

Nada de esto toca las definiciones de la §61: la banda, sus tests y el `delta_max` quedan como están.
