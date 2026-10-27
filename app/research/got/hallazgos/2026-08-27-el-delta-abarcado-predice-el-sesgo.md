# 2026-08-27 (noche) — El delta abarcado predice el sesgo por lado, y no necesita cotizar la cadena

**Verifica:** la consecuencia práctica que dejó abierta
[el hallazgo de esta tarde](2026-08-27-el-sesgo-no-es-el-nivel-de-iv.md) — el delta que abarca el
vertical de cada lado seguía al sesgo uno a uno sobre las seis observaciones del día, pero eso podía
ser coincidencia de una captura. ¿Aguanta sobre todo el dataset?
**Datos:** las **cuatro** carpetas de [`data/`](../data/) — `2026-08-24/`, `2026-08-25/`,
`2026-08-25-t2/` y `2026-08-27/` —, 22 pares (símbolo, vencimiento) sobre tres símbolos, tres días,
y vencimientos regulares **y** el weekly del 4-sep. Las tres primeras no tienen `callIV`/`putIV`,
y no hace falta: esta medición usa la columna de delta y la de crédito, que están en todas.
**Reproduce:** [`scripts/iv_por_lado.py`](../scripts/iv_por_lado.py), sección 5. Barre todas las
carpetas por su cuenta, sin argumento.
**Veredicto:** **aguanta, y con margen.** Correlación **+0.9796** sobre 22 observaciones, error
absoluto medio 0.106, y —lo que importa para usarlo como diagnóstico— **22 de 22 coinciden en de qué
lado del 1 caen**, o sea que el proxy nunca se equivoca de lado favorecido. El sesgo por lado se
puede medir **sin el barrido de quotes**.

---

## 1. La comparación

`abarca C/P` es el cociente CALL/PUT del delta que cubre un vertical de ancho 5 con el short en
delta ~0.20; sale de la columna de delta sola. `métrica C/P` es el mismo cociente sobre
`(crédito/ancho)/|delta|`, que es la métrica de la §43.4 y necesita bid/ask de las cuatro patas.

| Captura | Símbolo | Vencimiento | abarca C/P | métrica C/P | dif |
|---|---|---|---|---|---|
| 2026-08-24 | QQQ | 2026-09-04 | 1.48 | 1.53 | +0.04 |
| 2026-08-24 | QQQ | 2026-09-18 | 1.54 | 1.44 | −0.09 |
| 2026-08-24 | QQQ | 2026-10-16 | 1.56 | 1.56 | +0.00 |
| 2026-08-24 | SPY | 2026-09-04 | 1.74 | 1.70 | −0.03 |
| 2026-08-24 | SPY | 2026-09-18 | 1.96 | 1.64 | **−0.31** |
| 2026-08-24 | SPY | 2026-10-16 | 1.86 | 1.87 | +0.01 |
| 2026-08-24 | TSLA | 2026-09-04 | 0.76 | 0.81 | +0.06 |
| 2026-08-24 | TSLA | 2026-10-16 | 0.72 | 0.57 | −0.15 |
| 2026-08-25 | QQQ | 2026-09-18 | 1.54 | 1.33 | −0.21 |
| 2026-08-25 | QQQ | 2026-10-16 | 1.50 | 1.33 | −0.18 |
| 2026-08-25 | SPY | 2026-09-18 | 1.89 | 1.68 | −0.21 |
| 2026-08-25 | SPY | 2026-10-16 | 1.94 | 1.82 | −0.12 |
| 2026-08-25 | TSLA | 2026-09-18 | 0.71 | 0.76 | +0.04 |
| 2026-08-25 | TSLA | 2026-10-16 | 0.74 | 0.61 | −0.12 |
| 2026-08-25-t2 | SPY | 2026-09-18 | 1.86 | 1.70 | −0.16 |
| 2026-08-25-t2 | SPY | 2026-10-16 | 1.96 | 1.80 | −0.16 |
| 2026-08-27 | QQQ | 2026-09-18 | 1.52 | 1.44 | −0.08 |
| 2026-08-27 | QQQ | 2026-10-16 | 1.48 | 1.47 | −0.02 |
| 2026-08-27 | SPY | 2026-09-18 | 1.85 | 1.67 | −0.17 |
| 2026-08-27 | SPY | 2026-10-16 | 1.79 | 1.74 | −0.04 |
| 2026-08-27 | TSLA | 2026-09-18 | 0.79 | 0.75 | −0.04 |
| 2026-08-27 | TSLA | 2026-10-16 | 0.74 | 0.66 | −0.08 |

**n = 22 · r = +0.9796 · error absoluto medio 0.106 · 22 de 22 del mismo lado del 1.**

Las 22 incluyen el weekly del 4-sep, que el bucle de la §47.1 no recorre. Se dejó adentro a
propósito: acá no se está midiendo el mercado sino si un proxy sigue a otra medición, y para eso
tres observaciones más son tres observaciones más.

## 2. El desvío es sistemático, y se sabe de dónde viene

La diferencia no está centrada: **17 de 22 son negativas**, con media firmada **−0.092**. La métrica
queda por debajo del proxy casi siempre, y en un símbolo por vez la brecha es estable.

Eso es lo esperable y no un defecto: el crédito del CSV es **conservador** —bid del short contra ask
del long en las dos patas—, así que le descuenta a la métrica un ancho de book que el delta no
paga. Por eso el proxy no reemplaza a la métrica como número; la reemplaza como **diagnóstico de qué
lado paga más**, que es para lo que se usa. La confirmación es la fila de 22/22: el descuento del
book baja el nivel y no cambia el lado.

Consistente con esto, el desvío es mayor en la tanda del 25 (−0.21, −0.18, −0.21, −0.12) que en la
del 27 (−0.08, −0.02, −0.17, −0.04): son horas distintas de la sesión y libros de distinto ancho.

## 3. Para qué sirve

El barrido de quotes es la parte cara y frágil de una captura:

* es lo que tarda —el GEX vuelve en 60s y las quotes de 124 legs en el resto—,
* es lo que obliga a acertarle a `-QuoteBandPct` **por símbolo**, y errarle arruina la captura sin
  avisar (el caso de TSLA con banda 12 del 25, en `descartado-banda12/`),
* y es lo que ata la medición a tener mercado abierto para que el book valga algo.

El delta viene en el CSV **siempre**, incluidas las capturas viejas, y sale del mismo barrido de GEX
que ya se hace. O sea que el diagnóstico de sesgo por lado deja de necesitar `-WithQuotes`.

**Lo que NO se puede hacer con el proxy:** cualquier cosa que necesite el nivel del crédito —el
`RequiredCredit` como piso de viabilidad (§43.3), el edge test cuando exista, y el control de premio
de la §61.5—. Para todo eso el crédito sigue haciendo falta. El proxy contesta *qué lado paga más*,
no *cuánto paga*.

## 4. Alcance

22 observaciones, 3 símbolos, 3 días, un solo delta objetivo (0.20) y un solo ancho (5). La
correlación es alta pero los 22 puntos son **tres nubes** —una por símbolo— y buena parte de la
correlación es la separación entre símbolos, no la variación dentro de cada uno. Lo que está
firmemente medido es la fila de 22/22: el proxy nunca se equivoca de lado. Que además ordene bien
*dentro* de un símbolo está sugerido pero no probado con esta muestra.

No toca la §61.9 ni ninguna definición de la Sell Zone. Es economía de la medición, no estructura.
