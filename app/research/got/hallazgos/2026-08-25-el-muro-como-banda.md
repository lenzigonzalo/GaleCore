# 2026-08-25 — El muro como banda: estable, casi nunca restringe, y sin premio de crédito

**Verifica:** las dos cosas que la [§61](../galecore-estrategia-got.md) dejó abiertas el mismo día —
el umbral de dominancia que la §61.4 le pide al muro para dejar de ser un argmax inestable, y la
validación que la §61.6 llama *"la que puede matar todo"*: la Sell Zone, ¿es una función monótona
del delta?
**Datos:** las tres tandas de [`data/`](../data/) — `2026-08-24` (post-cierre en SPY y QQQ),
`2026-08-25` (en sesión, 10:09–10:23 ET, los tres símbolos) y `2026-08-25-t2` (SPY, 11:57–12:01 ET).
Doce combinaciones símbolo × vencimiento × lado sobre los dos vencimientos **regulares** del bucle
de la §47.1. Las secciones 2–4 corren sobre `2026-08-25`, que es la única tanda con los tres
símbolos y el book abierto.
**Reproduce:** [`scripts/banda_de_gamma.py`](../scripts/banda_de_gamma.py), que imprime las cuatro
secciones de abajo en el mismo orden.
**Veredicto:** la banda **resuelve** el problema del argmax que planteaba la §61.4 — es estable en
5 de 6 series con dos tomas, y falla exactamente donde su propia métrica de concentración la marca
como floja. Pero las otras dos mediciones son negativas: **el borde de la banda restringe en 2 de
12 casos**, los dos SPY del lado call, y **no hay premio de crédito atribuible a la estructura** —
el borde paga exactamente lo que le corresponde por su delta. Sumado a que `d_min × EM` resultó
tener ρ = −1.0000 contra el delta en las doce, **la definición de zona de la §61.3 queda sin
contenido independiente del delta**, y toda la estrategia se reduce a una sola hipótesis que
ninguna captura transversal puede contestar.

---

## 0. El borde por Expected Move es un corte de delta

La §61.3 pone dos condiciones sobre el mismo eje: pasar el muro **y** separarse `d_min × EM`. La
segunda no es estructural, y no hace falta discutirlo — se mide.

Dentro de un vencimiento, `EM` es una constante, así que `distancia/EM` es una transformación afín
del strike; y el delta es monótono en el strike. Correlación de rango entre las dos, sobre los
strikes con book vivo:

```text
ρ(distancia/EM, |delta|) = -1.0000 exacto en las 12 combinaciones
                           (n de 22 a 87 strikes por caso)
```

**Ordenan la cadena idéntico.** Un corte en `d_min × EM` es un corte de delta escrito de otra
manera, y no puede aportar información que el delta no tenga. Es el mismo hallazgo que la §43.2
hizo con `WD` contra el delta, repetido sobre la variable que lo reemplazó.

Corolario que conviene dejar escrito porque cierra una familia entera de intentos: **el Expected
Move, el delta, la POP y la densidad risk-neutral son el mismo objeto** — la distribución implícita
en los precios. Es, por construcción, la distribución bajo la cual ningún strike es favorable.
Pedirle "probabilidad estructuralmente favorable" a una métrica derivada de los precios de las
opciones es pedirle que se contradiga.

Queda un solo eje de la §61.3 que puede tener contenido propio: **el muro**, que sale del open
interest y no de los precios. Las tres secciones que siguen lo miden.

## 1. La banda resuelve el problema del argmax

`SelectCallWall` toma el strike de mayor GEX del lado. La §61.4 mostró que eso no alcanza:
concentración nunca mayor al 19%, dominancia contra el segundo candidato bajando a 1.0x, y el muro
saltando. La alternativa que se prueba acá es que el muro sea la **ventana de strikes más densa**
—ancho `0.25 × EM*`— en vez del strike más alto.

Las seis series con dos o más tomas:

| | tanda | argmax (dom) | banda | % del lado | xmed | xdisj |
|---|---|---|---|---|---|---|
| SPY 09-18 CALL | 24-ago | 790 (1.57x) | 784.0–790.9 | 27.8% | 3.4x | 1.22x |
| | 25-ago 10:1x | 790 (1.42x) | 784.0–790.8 | 30.2% | 3.3x | 1.22x |
| | 25-ago 12:00 | 790 (1.40x) | 784.0–790.7 | 30.3% | 3.4x | 1.20x |
| SPY 09-18 PUT | 24-ago | 760 (1.50x) | 753.1–760.0 | 23.9% | 13.8x | 1.49x |
| | 25-ago 10:1x | 760 (1.45x) | 753.2–760.0 | 22.5% | 14.2x | 1.54x |
| | 25-ago 12:00 | 760 (1.45x) | 753.3–760.0 | 22.8% | 14.8x | 1.56x |
| SPY 10-16 CALL | 24-ago | 790 (**1.02x**) | 790.0–800.8 | 34.5% | 2.0x | 1.27x |
| | 25-ago 10:1x | 790 (**1.00x**) | 790.0–800.7 | 36.7% | 2.1x | 1.32x |
| | 25-ago 12:00 | 790 (**1.02x**) | 790.0–800.5 | 34.6% | 2.0x | 1.31x |
| SPY 10-16 PUT | 24-ago | 730 (1.44x) | 729.2–740.0 | 23.6% | 3.8x | 1.26x |
| | 25-ago 10:1x | 730 (1.42x) | 729.3–740.0 | 23.0% | 3.8x | 1.25x |
| | 25-ago 12:00 | 730 (1.32x) | 729.5–740.0 | 22.4% | 3.8x | 1.21x |
| QQQ 10-16 CALL | 24-ago | 750 (1.56x) | 736.0–750.4 | 31.7% | 1.8x | 1.35x |
| | 25-ago 10:1x | 750 (1.50x) | 736.0–750.4 | 32.1% | 1.8x | 1.41x |
| TSLA 10-16 PUT | 24-ago | 330 (2.05x) | 324.8–340.0 | 40.6% | 13.7x | 2.28x |
| | 25-ago 10:1x | 330 (2.10x) | 324.9–340.0 | 42.9% | 15.8x | 2.46x |
| **QQQ 09-18 CALL** | 24-ago | 710 (1.50x) | **710.0–719.5** | 24.3% | **1.5x** | 1.32x |
| | 25-ago 10:1x | 750 (**1.01x**) | **725.0–734.4** | 24.3% | **1.3x** | 1.24x |

**Cinco de seis series conservan la banda**, incluso entre el cierre del 24 y la apertura del 25 con
el open interest actualizado de por medio. El caso más elocuente es SPY 10-16 CALL: el argmax es
inservible —1.00x de dominancia, empatado con el 797 que está a $7— y la banda 790–800 no se movió en
tres tomas repartidas en dos días.

`xmed` es la banda contra la ventana **mediana** del mismo lado, y `xdisj` contra la mejor ventana
**disjunta**. Los dos tests hacen falta: TSLA 09-18 CALL da `xmed` 8.6x y `xdisj` 1.01x — muy
concentrado, pero en dos lugares distintos, o sea que no hay *un* muro.

**La que falla es la única marcada como floja.** QQQ 09-18 CALL tiene `xmed` 1.3–1.5x: la "banda más
densa" apenas supera a una banda cualquiera, o sea que no hay concentración. En SPY el mismo número
va de 2.0x a 14.8x. La métrica se autodenuncia antes de moverse, que es exactamente lo que hacía
falta para que **"no hay muro" sea un resultado implementable** y no un número inventado.

Con la salvedad que hay que decir: **hay un solo evento de inestabilidad en el dataset.** Fijar un
umbral sobre una observación es el error que este research ya cometió con el 0.10–0.20 de la §28.
El umbral se declara cuando haya más eventos, no ahora.

## 2. Pero el borde casi nunca restringe

Comparando el borde externo de la banda contra un corte de delta 0.20 — o sea, preguntando si la
estructura empuja más afuera de lo que ya empujaba el delta:

| caso | borde | delta | xmed | xdisj | ¿ata? |
|---|---|---|---|---|---|
| SPY 09-18 CALL | 790.8 | **0.126** | 3.3x | 1.22x | **sí** |
| SPY 10-16 CALL | 800.7 | **0.174** | 2.1x | 1.32x | **sí** |
| SPY 10-16 PUT | 729.3 | 0.211 | 3.8x | 1.25x | no (al ras) |
| QQQ 10-16 CALL | 750.4 | 0.240 | 1.8x | 1.41x | no |
| QQQ 10-16 PUT | 669.6 | 0.234 | 3.0x | 1.04x | no |
| TSLA 10-16 CALL | 400.1 | 0.246 | 11.8x | 1.10x | no |
| QQQ 09-18 CALL | 734.4 | 0.258 | 1.3x | 1.24x | no |
| TSLA 09-18 CALL | 377.5 | 0.276 | 8.6x | 1.01x | no |
| TSLA 10-16 PUT | 324.9 | 0.282 | 15.8x | 2.46x | no |
| QQQ 09-18 PUT | 690.6 | 0.292 | 4.0x | 1.25x | no |
| TSLA 09-18 PUT | 335.0 | 0.308 | 5.8x | 1.93x | no |
| SPY 09-18 PUT | 753.2 | 0.322 | 14.2x | 1.54x | no |

**Dos de doce, y las dos son SPY del lado call.** En las otras diez el borde cae a delta 0.21–0.32,
es decir *más cerca del dinero* que donde la ventana de delta ya vendía. Confirma y extiende la
§61.6: no es sólo que el muro de put no restrinja, es que **casi ningún muro restringe**.

Notar que la fuerza del muro y su capacidad de restringir no tienen relación: TSLA 10-16 PUT es la
pared más nítida del dataset —43% del GEX del lado, `xmed` 15.8x, `xdisj` 2.46x, estable entre dos
días— y no ata, porque está a delta 0.28.

**Eso sugiere que el muro está siendo usado como el tipo de cosa equivocada.** Toda la definición lo
trata como un filtro que empuja más afuera. Los datos dicen que, si sirve para algo, es como un
**permiso para vender más cerca**: hay una pared entre el spot y el strike. La §3 mide qué valdría
ese permiso.

## 3. El premio de crédito existe, y es delta

Vender en el borde de la banda en vez de delta 0.15, mismo vencimiento, width 5, book en sesión:

| caso | borde: K / delta / crédito | delta 0.15: K / delta / crédito | × crédito |
|---|---|---|---|
| SPY 09-18 PUT | 753 / 0.322 / 1.03 | 732 / 0.152 / 0.40 | **2.57x** |
| TSLA 09-18 PUT | 335 / 0.308 / 1.40 | 315 / 0.147 / 0.60 | 2.33x |
| TSLA 09-18 CALL | 378 / 0.276 / 1.00 | 400 / 0.142 / 0.44 | 2.27x |
| QQQ 09-18 PUT | 690 / 0.284 / 0.99 | 668 / 0.151 / 0.46 | 2.15x |
| TSLA 10-16 PUT | 320 / 0.250 / 1.15 | 300 / 0.146 / 0.60 | 1.92x |
| TSLA 10-16 CALL | 405 / 0.224 / 0.65 | 425 / 0.155 / 0.35 | 1.86x |
| QQQ 09-18 CALL | 735 / 0.248 / 1.16 | 746 / 0.151 / 0.64 | 1.81x |
| QQQ 10-16 PUT | 669 / 0.229 / 0.76 | 645 / 0.145 / 0.44 | 1.73x |
| SPY 10-16 PUT | 729 / 0.211 / 0.57 | 714 / 0.151 / 0.39 | 1.46x |
| QQQ 10-16 CALL | 755 / 0.210 / 0.89 | 765 / 0.157 / 0.67 | 1.33x |
| SPY 09-18 CALL | 791 / 0.126 / 0.55 | 789 / 0.148 / 0.66 | 0.83x |

Casi el doble de crédito, consistente en los tres símbolos. **Y el control lo explica entero.**

El borde está a delta más alto, así que tiene que pagar más. La pregunta es si paga más *de lo que
le corresponde por su delta*. Se ajusta la eficiencia —`(crédito/width) / delta`, la métrica de
[`skew_por_lado.py`](../scripts/skew_por_lado.py)— como función suave del delta usando **sólo los
strikes lejos de la banda**, y se mide el residuo del borde:

```text
z del residuo:  -2.12  -1.00  +1.64  -4.36  +2.86  +2.19
                -1.22  +7.62  -0.62  +0.12  +1.07

z medio  +0.56 +/- 0.90  sobre 11 casos    (6 positivos, 5 negativos)
```

**Indistinguible de cero.** El borde de la banda no está por encima de la curva: los 1.86x de
crédito son exactamente lo que paga cualquier strike a ese delta, esté o no pegado a una pared de
gamma. El premio era estar a delta más alto, nada más.

Es la cuarta vez que la respuesta es *"eso es delta"*: `WD` (§43.2), `RequiredCredit` (§43.2),
`d_min × EM` (§0 de acá) y ahora el crédito.

**Pero acá el negativo no juega en contra.** Que el mercado no cobre distinto en el muro no dice que
el muro no funcione: dice que si funciona, **no está en el precio**. Un muro que frena el precio y
que nadie cotiza distinto es ventaja; un muro cotizado no serviría de nada. Lo que sí cierra es el
método — ver §5.

## 4. Sensibilidad al ancho de banda

El ancho `0.25 × EM*` es una elección. Barriéndolo de 0.15 a 0.40:

* **El borde externo se corre con el ancho por construcción**, porque la banda crece hacia afuera.
  En SPY 09-18 PUT va de 755.9 a 749.1 mientras el borde *interno* queda clavado en 760 — es
  aritmética, no inestabilidad.
* **Donde la banda se muda de lugar es en QQQ 10-16 PUT** (el borde salta 698 → 669 → 688 → 679) **y
  TSLA 09-18 CALL** (406 → 375 → 382). **Las dos estaban marcadas con `xdisj` de 1.04x y 1.01x** —
  el test de banda disjunta detecta la sensibilidad al ancho igual que detecta la inestabilidad
  temporal, con lo cual es un solo test para los dos modos de falla.

Queda como debilidad honesta que `W` es un parámetro libre que mueve el borde de la zona hasta ~7
puntos en SPY, y que su valor no sale de ningún lado todavía.

## 5. Qué NO prueba, y qué cierra

**No prueba nada sobre si el precio respeta la banda.** Ninguna de las cuatro mediciones toca eso, y
es la única pregunta que decide si GOT existe.

**Lo que sí cierra es el método.** Toda la información de estructura que hay en una captura
—distancia, Expected Move, ZGL, crédito— resultó ser delta medido de cuatro formas distintas. Los
precios de la foto no saben del muro (§3). **Una captura transversal no puede contener la
respuesta**, y más capturas transversales no van a moverla.

Con eso, la estrategia se reduce a una sola afirmación falsable, y no hay ninguna otra en pie:

> La probabilidad empírica de que el precio cruce el borde externo de una banda de gamma dominante
> es menor que el delta de ese borde.

Si es cierta, se vende a precio de delta 0.25 un riesgo de delta 0.18 y GOT tiene razón de ser. Si
es falsa, se vende delta 0.25 a precio justo y GOT es el edge test de RPF (§43.3) con más pasos.

**Y esa afirmación tiene un costo de muestra que hay que mirar antes de elegir cómo medirla.** El
borde cae a delta 0.21–0.32; distinguir una probabilidad real de 0.20 de una de 0.25 con dos errores
estándar pide del orden de **300 observaciones independientes**, donde una observación es un camino
de precio —un par (símbolo, vencimiento) sin solapamiento— y no un strike. Con SPY y QQQ y los
vencimientos regulares del bucle son unos 48 al año: **seis años**. Acumular capturas propias sobre
el universo de la §4 no es lento, es **imposible**.

## 6. Qué hacer

* **Aplicar a la §61.3:** su segunda condición (`d_min × EM`) no es estructural y hay que dejarlo
  escrito donde está definida, con la errata apuntando acá.
* **Aplicar a la §61.4:** el pedido de "umbral de dominancia" tiene una respuesta mejor que un
  umbral sobre el argmax — la banda, con `xmed` y `xdisj` como sus dos tests. El umbral numérico
  **no** se declara todavía: hay un solo evento de inestabilidad.
* **Aplicar a la §61.6:** la validación que "puede matar todo" está corrida y el resultado es que la
  zona **sí** es esencialmente delta, salvo SPY del lado call. No mata la estrategia, pero mueve la
  hipótesis: de *muro como restricción* a *muro como permiso*.
* **Aplicar a la §98:** el pendiente de backtest deja de ser un ítem más de la lista y pasa a ser la
  única pregunta abierta; y el "modo estudio" del README —capturas transversales, backtest fuera del
  camino crítico— queda contradicho por la §5.
* **Decidir el universo antes que cualquier calibración.** La aritmética de la §5 dice que la
  pregunta central es incontestable con dos símbolos. O se ensancha el universo a ~20 líquidos, o se
  compra historia de cadenas con open interest, o se acepta el negativo y GOT se pliega a RPF. Es
  una decisión de alcance, no técnica.
* **La pantalla de Sell Zone se puede construir igual**, mostrando dónde está la estructura, qué
  condición ata y si hay muro o no. Lo único que la v1 **no** puede afirmar es probabilidad
  favorable: esa etiqueta depende de las 300 observaciones.
