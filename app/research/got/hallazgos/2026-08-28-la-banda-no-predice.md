# 2026-08-28 — La §61.9 medida: la banda no predice, y el borde es un strike como cualquier otro

**Verifica:** la hipótesis única de la [§61.9](../galecore-estrategia-got.md) — *"la probabilidad
empírica de que el precio cruce el borde externo de una banda de gamma dominante es menor que el
delta de ese borde"*. Es la única afirmación falsable que quedaba en pie, y de ella depende si GOT
existe como estrategia.
**Datos:** `research/data/` (cadenas EOD SPY/QQQ/IWM 2013–2025), reducidas a
[`data/obs_banda_historica.csv`](../data/obs_banda_historica.csv) (926 observaciones de lado) y
[`data/obs_calibracion_delta.csv`](../data/obs_calibracion_delta.csv) (26.678 strikes de control).
**Los dos CSV se versionan**, así que la medición reproduce fuera de esta máquina.
**Reproduce:** [`scripts/banda_historica.py`](../scripts/banda_historica.py) construye las tablas;
[`scripts/medir_61_9.py`](../scripts/medir_61_9.py) las mide.
**Veredicto:** **falsa, y por el lado contrario.** El borde de la banda no cruza menos que su delta:
cruza **+0.025 más** (IC 95% [−0.005, +0.053]). Y contra un strike cualquiera del mismo delta y del
mismo lado, el borde no aporta nada: **B = +0.010 [−0.019, +0.040]**. El efecto que la §61.9 pedía
—vender a precio de delta 0.25 un riesgo de delta 0.18, o sea −0.07— queda **excluido con holgura**.

Vale la propia conclusión que la §61.9 dejó escrita para este caso: *"si es falsa, se vende delta
0.25 a precio justo y GOT es el edge test de la 43.3 con más pasos"*.

---

## 0. Las tres decisiones que se tomaron antes de correr nada

El [hallazgo del 2026-08-27](2026-08-27-la-historia-ya-existe.md) dejó dos preguntas de método
abiertas, y medir la banda obliga a una tercera. Se fijaron antes de ver un solo número:

1. **"Cruzar" = terminar más allá**, no tocar. El delta aproxima P(terminar ITM); medir toque contra
   delta da falso por construcción. El toque se registra igual, como descriptivo sin umbral.
2. **Historia entera (2013–2025), clusterizando por fecha de vencimiento.** SPY, QQQ e IWM del mismo
   mes no son tres observaciones independientes, y los dos lados del mismo ciclo tampoco: el
   bootstrap remuestrea **ciclos enteros**, así que no supone independencia — la mide. La ventana
   2013–2017, que el backtesting nunca tocó, se reporta aparte.
3. **La banda se mide a DTE 45 fijo**, una foto por ciclo, para que el conteo sea de caminos de
   precio y no de fotos.

La aritmética de la banda **no se reimplementó**: `banda_historica.py` importa `medir()` de
`banda_de_gamma.py`, que es el código que produjo los números de la §61. Lo único propio es el
adaptador de la cadena histórica a la forma de fila que ese código espera.

## 1. Antes del veredicto: el conteo de muestra estaba inflado ~15%

`inventario_historia.py` cuenta como mensual *"lo que caiga viernes o sábado entre el 15 y el 22"*.
Ese filtro también atrapa **weeklies**: en 24 meses del dataset hay **dos** fechas que lo pasan —
`2014-08-16` es el mensual y `2014-08-22` es un weekly—. Es el mismo defecto que el
[hallazgo del 2026-08-24](2026-08-24-el-4-sep-es-un-weekly.md) encontró en el `4-Sep`, otra vez.

Contando el mensual canónico —tercer viernes; sábado siguiente hasta feb-2015; y **jueves cuando el
tercer viernes es Good Friday** (2019-04-18, 2022-04-14, 2025-04-17), que no se deduce de ninguna
regla—:

| | hallazgo del 27/08 | real |
|---|---|---|
| Ciclos con resultado | 532 | **463** |
| Observaciones de lado | 1064 | **926** |
| Holdout 2013–2017 | 211 ciclos / 422 obs | **176 ciclos / 352 obs** |
| Ciclos de vencimiento **únicos** en el holdout | 71 / 142 obs | **59 / 118 obs** |

Sigue habiendo muestra de sobra para el total, pero **el holdout limpio empeora**, y eso es lo que
inclinó la decisión 2: 118 observaciones independientes no distinguen 0.20 de 0.25.

## 2. El test A — el enunciado literal, y sale al revés

`A = tasa empírica de terminar más allá − delta medio del borde`. La §61.9 pide `A < 0`.

| | n | ciclos | empírica | delta | **A** | IC 95% |
|---|---|---|---|---|---|---|
| **todas** | 926 | 155 | 0.271 | 0.246 | **+0.025** | [−0.005, +0.053] |
| 2013–2017 | 352 | 59 | 0.267 | 0.246 | +0.021 | [−0.023, +0.066] |
| 2018–2025 | 574 | 96 | 0.274 | 0.247 | +0.027 | [−0.011, +0.065] |
| PUT | 463 | 155 | 0.153 | 0.248 | **−0.094** | [−0.141, −0.042] |
| CALL | 463 | 155 | 0.389 | 0.245 | **+0.144** | [+0.082, +0.207] |

**El signo de A lo decide el lado, y eso ya avisa que A no mide lo que dice medir.** Entre 2013 y
2025 el índice sube: los call terminan más allá mucho más seguido que los put al mismo delta. Un A
de −0.094 del lado put no es un muro que defiende — es deriva alcista. Leer el A del lado put como
confirmación de la §61.9 sería el mismo error que la sección se pasa el documento entero evitando.

## 3. El test B — el control, y es el que decide

La §61.8 lo deja escrito: *"ninguna métrica derivada de los precios de las opciones puede producir
una probabilidad favorable"*, y de las dos fuentes que quedan, **la brecha entre distribución
implícita y empírica ya es el edge test de la §43.3 y pertenece a RPF**. O sea que si la tasa
empírica está por debajo del delta en toda la cadena, encontrarlo en el borde de la banda no dice
nada sobre el muro: dice que se midió VRP.

Por eso se construyó la curva empírica `P(terminar más allá | delta, lado)` sobre los **26.678
strikes** del mismo dataset, sin los que son borde de banda, y el borde se mide contra ella:

`B = tasa empírica del borde − curva de control en su delta y su lado`

| | n | **B** | IC 95% | p(B ≥ 0) |
|---|---|---|---|---|
| **todas** | 926 | **+0.010** | [−0.019, +0.040] | 0.75 |
| 2013–2017 *(holdout limpio)* | 352 | +0.011 | [−0.035, +0.055] | 0.68 |
| 2018–2025 | 574 | +0.010 | [−0.028, +0.048] | 0.69 |
| PUT | 463 | +0.001 | [−0.046, +0.050] | 0.50 |
| CALL | 463 | +0.019 | [−0.042, +0.083] | 0.72 |
| SPY | 306 | +0.027 | [−0.011, +0.065] | 0.92 |
| QQQ | 310 | +0.014 | [−0.025, +0.052] | 0.76 |
| IWM | 310 | −0.010 | [−0.050, +0.029] | 0.30 |
| **donde ata la banda** | 229 | +0.013 | [−0.043, +0.072] | 0.67 |
| donde ata el delta | 697 | +0.009 | [−0.025, +0.046] | 0.70 |

**La curva por lado se lleva puesto todo el efecto aparente del test A**: PUT pasa de −0.094 a
**+0.001** y CALL de +0.144 a **+0.019**. Lo que el A medía del lado put era la deriva del mercado,
y una vez que la deriva está en la referencia, **no queda nada**.

Y la fila que más importa es la anteúltima: **donde la banda efectivamente ata** —los 229 casos en
que el borde estructural es más restrictivo que el corte de delta 0.20, o sea donde la §61.7 dice
que la estructura aportó algo— el borde tampoco se distingue de un strike cualquiera.

## 4. El negativo no depende de `W`, que es lo que lo hace terminal

Es el reparo obvio, y el que el [hallazgo del 2026-08-28](2026-08-28-el-borde-le-debe-todo-a-W.md)
dejó armado: `W` no está calibrado, mueve el borde $9.6 en promedio y hasta 0.174 de delta. Un
negativo medido a `W = 0.25 EM` podría ser un negativo sobre el `W` equivocado.

No lo es. Reconstruyendo las 926 observaciones enteras con cada ancho:

| `W` | empírica | delta | A | **B** | IC 95% de B |
|---|---|---|---|---|---|
| 0.20 EM | 0.285 | 0.256 | +0.029 | **+0.014** | [−0.015, +0.043] |
| 0.25 EM | 0.271 | 0.246 | +0.025 | **+0.010** | [−0.019, +0.040] |
| 0.30 EM | 0.257 | 0.238 | +0.019 | **+0.006** | [−0.025, +0.036] |

Los tres dan lo mismo, y los tres del lado equivocado. **`W` decide dónde cae el borde pero no
cambia que el borde no informa** — que es, además, la explicación de por qué `W` nunca se pudo
calibrar: no había nada contra qué calibrarlo.

## 5. El tamaño de efecto que queda excluido

La §61.9 glosa su propia hipótesis: *"se vende a precio de delta 0.25 un riesgo de delta 0.18"*. Eso
es **B = −0.07**. El intervalo de confianza de B es [−0.019, +0.040] sobre todo el dataset y
[−0.035, +0.055] sobre el holdout limpio. **−0.07 queda afuera de los dos**, y afuera del de cada
subgrupo excepto los más chicos.

No es "no se pudo demostrar": es que el efecto del tamaño que GOT necesita **no está**.

## 6. Dos cosas de arrastre

**El delta está bien calibrado en el agregado y muy mal por lado.** Agrupando los dos lados,
`P_emp − delta` va de −0.03 a +0.01 en toda la franja: el delta es casi exactamente la probabilidad
terminal. Separado por lado no se parece en nada —

| bin de delta | PUT | CALL |
|---|---|---|
| 0.150–0.175 | 0.103 | 0.253 |
| 0.200–0.225 | 0.128 | 0.313 |
| 0.250–0.275 | 0.170 | 0.424 |
| 0.300–0.325 | 0.192 | 0.435 |

— y eso es una advertencia directa para el **edge test de la §43.3**: medir la brecha
implícita-vs-empírica sobre deltas agrupados da cero por cancelación entre lados. La brecha existe,
pero es direccional, y en este período es indistinguible de la deriva del índice.

**`xmed` no es comparable entre años en este dataset, y eso mata la idea de calibrar su umbral acá.**
Su mediana va de **205.8 en 2013 a 19.4 en 2025**, monótona. No es que los muros se hayan aflojado:
es que la cadena lista cada vez más strikes lejanos con gamma ~0, la ventana mediana del lado se
vacía y el cociente explota. El cuartil alto de `xmed` es, en los hechos, "2013–2017 y lado put"
(151 de 232 de cada uno) — que es exactamente la composición donde la deriva empuja el A hacia
abajo. Su `A = −0.039` es esa composición, no un muro fuerte: su **B es −0.021 [−0.075, +0.035]**,
indistinguible de cero como todos los demás.

**Y el toque confirma que la decisión 1 era necesaria.** Sobre los mismos bordes: `toco` 0.473
contra `cerró más allá` 0.271, **1.75x**. El principio de reflexión predice ~2x, y era el argumento
por el cual medir toque contra delta habría dado falso por construcción. Estaba bien planteado.

## 7. Qué cambia

**La §61.9 queda cerrada, en negativo, y con eso no queda ninguna hipótesis abierta en GOT.** La
§61 entera —la banda, sus dos tests, el borde externo, `W`, el `buffer`— describe una construcción
que es real, estable y medible, y que **no predice nada que el delta no prediga ya**.

Sobre la pregunta de plataforma del README, que tenía tres salidas: la 1 (extender GEX) y la 2
(estrategia propia con prefijo, JSON, pestaña y switch) pedían que hubiera algo que justificara el
costo. No lo hay. **Queda la 3: plegar GOT al edge test de RPF**, que es lo que el README ya
anticipaba como *"el resultado por defecto"* — sólo que ahora es un resultado medido y no una
concesión por no poder medir.

Lo que **sí sobrevive**, y conviene no tirarlo con el resto:

* **La maquinaria de medición.** `banda_historica.py` + `medir_61_9.py` convierten 13 años de
  cadenas en una tabla de (borde, delta, resultado) con control de calibración y bootstrap por
  cluster. Es reusable tal cual para cualquier pregunta de la forma *"¿este nivel predice algo que
  el delta no prediga?"* — el edge test de la §43.3 incluido, que es la que sigue.
* **La curva `P_emp(terminar más allá | delta, lado)`**, que es la mitad empírica del edge test y
  ahora está medida sobre 26.678 strikes.
* **El descubrimiento de que la brecha implícita-empírica es direccional**, que le pone una
  condición a cómo se puede plantear ese edge test.

Lo que **no** sobrevive: `buffer`, `delta_max` modulado por régimen, los umbrales de `xmed` y
`xvalle`, y `W`. Los cuatro estaban esperando a esta medición para calibrarse. No hay nada que
calibrar.
