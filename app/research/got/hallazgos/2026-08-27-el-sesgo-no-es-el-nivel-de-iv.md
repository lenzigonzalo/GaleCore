# 2026-08-27 — El sesgo por lado no es el nivel de IV, y la pendiente entre patas explica dos de tres

**Verifica:** la frase de la [§43.5](../galecore-estrategia-got.md) que le puso mecanismo al sesgo
por lado — *"no es una propiedad del motor: es la pendiente local de la superficie de volatilidad,
atravesando un umbral que no la mira"*. Hasta ahora esa frase no se podía comprobar: el sesgo se
medía sobre **créditos**, y la superficie de IV se inferia de ellos. Desde que
`/App/Gex/Analysis` expone `callIV` / `putIV` por strike, se puede medir directamente.
**Datos:** los seis CSV de [`data/2026-08-27/`](../data/2026-08-27/), capturados entre las **15:17 y
las 15:24 ET** con el mercado abierto, sobre los dos vencimientos regulares del bucle de la §47.1
(2026-09-18, DTE 22; y 2026-10-16, DTE 50). Es la **primera captura con la superficie de IV en los
tres símbolos**: la anterior que la traía, `2026-08-25-t2/`, es solo SPY.
**Reproduce:** [`scripts/iv_por_lado.py`](../scripts/iv_por_lado.py) para las cuatro mediciones de
acá; [`scripts/skew_por_lado.py`](../scripts/skew_por_lado.py) para el sesgo de la §43.4.
**Veredicto:** el sesgo **reproduce por tercera vez** y con book vivo. Sobre el mecanismo, dos
resultados: el **nivel** de IV va al revés del sesgo en los tres símbolos —así que *"los puts valen
más"* no lo explica—, y la **pendiente entre las dos patas** lo explica limpio en SPY y QQQ pero
**tiene el signo equivocado en TSLA**, que es justo el símbolo de control. Lo que sí lo sigue en los
seis casos, casi uno a uno, es **cuánto delta abarca el spread de cada lado**, y ese cociente **no se
mueve con el ancho** — o sea que no es un artefacto del width 5. La frase de la §43.5 no queda
refutada, pero **su proxy natural sí**: la pendiente de dos puntos no reproduce el caso de control.

---

## 1. El sesgo reproduce, tercera captura

Cociente CALL/PUT del pago por unidad de delta, agregado por símbolo:

| Símbolo | 24-ago | 25-ago | **27-ago** |
|---|---|---|---|
| SPY | 1.77 | 1.80 | **1.77** |
| QQQ | 1.54 | 1.37 | **1.50** |
| TSLA | 0.65 | 0.65 | **0.64** |

Tres tandas, dos de ellas con book vivo. SPY y TSLA se mueven en el segundo decimal (0.03 y 0.01 de
rango sobre las tres); QQQ se mueve 0.13, que es grande pero cae justo por debajo del piso de ruido
día a día de 0.15 que midió [el hallazgo del 25](2026-08-25-el-sesgo-aguanta-con-book-vivo.md).
Ningún símbolo se acerca a cambiar de lado. El sesgo por lado es un hecho firme del dataset.

> Los agregados del 24 de SPY y QQQ promedian **tres** vencimientos, porque esa carpeta incluye el
> `2026-09-04`, que es el weekly que el bucle de la §47.1 no recorre (ver
> [el hallazgo](2026-08-24-el-4-sep-es-un-weekly.md)). Los del 25 y el 27 promedian los **dos**
> regulares. La comparación limpia es 25 contra 27; la columna del 24 va como referencia.
> Los valores publicados en la §43.5 —SPY 1.81, QQQ 1.57— son otro agregado más: el del weekly
> contra el 16-oct solamente.

## 2. El nivel de IV va al revés, en los tres símbolos

IV de cada lado al **mismo** |delta|, interpolada entre strikes vecinos:

| Símbolo | \|d\| 0.10 | \|d\| 0.20 | \|d\| 0.30 | sesgo de crédito |
|---|---|---|---|---|
| SPY | 1.65 / 1.69 | 1.33 / 1.32 | 1.16 / 1.12 | **1.77 a favor del CALL** |
| QQQ | 1.43 / 1.46 | 1.21 / 1.22 | 1.07 / 1.07 | **1.50 a favor del CALL** |
| TSLA | 0.95 / 0.93 | 0.95 / 0.93 | 0.94 / 0.92 | **0.64 a favor del PUT** |

(cada celda es `putIV / callIV` en los dos vencimientos)

SPY y QQQ tienen el put **mucho** más caro a delta igualado —hasta 1.69x— y sin embargo el lado que
paga más por unidad de delta es el **call**. TSLA tiene el call más caro (0.93) y paga más el
**put**. El signo está invertido en los seis casos.

**Esto mata la lectura ingenua**, que es la que uno hace por defecto mirando un skew: *"el put vale
más, entonces vender puts paga más"*. No: el nivel de IV no dice quién paga mejor por unidad de
riesgo. Vale la pena que quede escrito porque es la conclusión que cualquiera saca de un gráfico de
smile, y es la contraria a la verdadera.

## 3. La pendiente entre patas: explica SPY y QQQ, falla en TSLA

El crédito de un vertical no sale del nivel de IV sino de la **diferencia entre las dos patas**,
porque se vende una y se compra la otra. `IV(comprada) − IV(vendida)`, con el short en delta ~0.20 y
ancho 5:

| Símbolo | Vencimiento | PUT ΔIV | CALL ΔIV | sesgo real |
|---|---|---|---|---|
| QQQ | 2026-09-18 | +0.0069 | −0.0025 | 1.50 → CALL |
| QQQ | 2026-10-16 | +0.0052 | −0.0014 | 1.50 → CALL |
| SPY | 2026-09-18 | +0.0074 | −0.0030 | 1.77 → CALL |
| SPY | 2026-10-16 | +0.0058 | −0.0019 | 1.77 → CALL |
| TSLA | 2026-09-18 | +0.0048 | +0.0038 | **0.64 → PUT** |
| TSLA | 2026-10-16 | +0.0037 | +0.0026 | **0.64 → PUT** |

En SPY y QQQ el mecanismo se ve perfecto: la pata comprada del put es **más cara** (+0.006/+0.007 de
IV, o sea que la protección se paga y resta crédito) y la del call es **más barata** (−0.002/−0.003,
se retiene crédito). Eso da el sesgo a CALL y lo explica sin residuo.

**En TSLA la pendiente apunta al mismo lado que en los ETF** —el put pierde +0.0048 contra +0.0038
del call— mientras el sesgo real está invertido. Las dos alas de TSLA suben yendo OTM (es una
sonrisa, no un skew monótono), y la del put sube un poco más. Con ese dato, la pendiente predice un
sesgo a CALL **débil**; lo que se mide es un sesgo a PUT **fuerte**.

O sea: la columna "el put pierde más" da `True` en las seis filas, y el sesgo cambia de signo en dos
de ellas. **La pendiente de dos puntos no es el mecanismo**, o al menos no es todo el mecanismo.

Esto contradice, en su parte operativa, lo que ya estaba escrito en el docstring de
`skew_por_lado.py`: *"con put skew monótono la pendiente le RESTA crédito al put credit spread y le
SUMA al call credit spread; con el ala de call levantada, al revés"*. La primera mitad se confirma;
**la segunda no** — TSLA tiene el ala de call levantada y la pendiente entre patas no se da vuelta.

## 4. Lo que sí lo sigue: cuánto delta abarca el spread

Desglosando la métrica de la §43.4 lado por lado aparece el término que se mueve con ella. `abarca`
es `delta(short) − delta(long)`, el delta que cubre el vertical:

| Símbolo | Venc. | lado | d_short | d_long | abarca | cred/W | (c/W)/d |
|---|---|---|---|---|---|---|---|
| SPY | 09-18 | put | 0.198 | 0.161 | **0.037** | 0.110 | 0.555 |
| SPY | 09-18 | call | 0.205 | 0.136 | **0.069** | 0.190 | 0.928 |
| TSLA | 09-18 | put | 0.191 | 0.153 | **0.038** | 0.160 | 0.839 |
| TSLA | 09-18 | call | 0.191 | 0.161 | **0.030** | 0.120 | 0.628 |

El cociente CALL/PUT de `abarca` contra el cociente CALL/PUT de la métrica, en los seis:

| Símbolo | Venc. | abarca C/P | métrica C/P |
|---|---|---|---|
| SPY | 09-18 | 1.85 | 1.70 |
| SPY | 10-16 | 1.79 | 1.83 |
| QQQ | 09-18 | 1.52 | 1.52 |
| QQQ | 10-16 | 1.48 | 1.47 |
| TSLA | 09-18 | 0.79 | 0.71 |
| TSLA | 10-16 | 0.74 | 0.57 |

Se siguen casi uno a uno, **incluido el cambio de signo de TSLA**. El sesgo por lado es, en lo
medible, la asimetría en la velocidad con que cae el delta hacia afuera en cada lado de la cadena.

### El control: no es el width 5

La sospecha obvia es que sea un artefacto de haber fijado el ancho en $5, que sobre TSLA a $355 y
40% de IV cubre mucho menos distribución que sobre SPY. Barriendo el ancho:

| Símbolo | Venc. | W=5 | W=10 | W=15 | W=20 |
|---|---|---|---|---|---|
| QQQ | 09-18 | 1.52 | 1.51 | 1.49 | — |
| QQQ | 10-16 | 1.48 | 1.49 | 1.48 | 1.48 |
| SPY | 09-18 | 1.85 | 1.78 | 1.68 | 1.58 |
| SPY | 10-16 | 1.79 | 1.77 | 1.74 | 1.69 |
| TSLA | 10-16 | 0.74 | 0.75 | 0.75 | 0.77 |

Plano en QQQ y TSLA, con una deriva suave en SPY (1.85 → 1.58 cuadruplicando el ancho, que es menos
que la distancia entre símbolos). **No es el ancho.**

## 5. Qué queda

**Confirmado:**
* El sesgo por lado, tercera medición independiente. La §43.5 no se toca en lo que afirma sobre
  *qué* pasa.
* Que el sesgo es del símbolo y no del motor, con TSLA invirtiéndolo.

**Refutado:**
* Que el **nivel** de IV explique el sesgo. Va al revés en los tres símbolos.
* Que la **pendiente entre patas** lo explique en general. Explica SPY y QQQ; falla en el signo
  sobre el caso de control, que es exactamente el que la §43.5 usó para descubrir el error del 24.

**Abierto:**
* Cuál es el mecanismo completo. `abarca` lo sigue uno a uno pero es una **reexpresión** de la misma
  métrica, no una explicación: dice *dónde* está la asimetría (en la caída del delta), no *por qué*
  la caída del delta es asimétrica de esa forma en cada símbolo. Ese "por qué" sale de la forma de la
  superficie, y con dos puntos no alcanza para verlo.
* Una medición de la pendiente sobre **más de dos puntos** —la curvatura del ala, no su recta— es lo
  que seguiría. No se hace acá porque no hay contra qué calibrarla: seis observaciones y un solo
  símbolo invertido.

**Consecuencia práctica, y es la útil:** como `abarca` sale de la columna de delta sola, el sesgo por
lado **se puede medir sin cotizar la cadena**. Hoy la medición necesita el barrido de quotes, que es
lo caro y lo que obliga a acertarle a la banda por símbolo. Si se confirma sobre más capturas, el
diagnóstico de sesgo baja de un barrido con `-WithQuotes` a leer una columna que ya viene en todas
las capturas, incluidas las viejas.

## 6. Alcance

Un día, tres símbolos, dos vencimientos, medido a un solo delta objetivo (0.20). El barrido de ancho
es el único control que lleva. **No es una calibración de nada** y no toca la §61.9, que sigue siendo
el único pendiente bloqueante. Es lo que una captura transversal sí puede contestar según el
criterio del README: si un parámetro se comporta distinto por símbolo y lado.
