# 2026-08-28 — El borde no se puede arreglar antes de calibrar `W`, y `W` está del otro lado de la §61.9

**Qué se probó.** El defecto que quedó abierto el 27: si la concentración es más ancha que `W`, la
ventana la parte y **el borde cae adentro del muro**. Se probaron las tres salidas posibles —arreglar
el crecimiento, desacoplarlo de `W`, y una construcción que no necesite `W`— y **ninguna cierra**.
Buscando por qué, aparece que el problema no es el parche: es que **el borde nunca fue sólido**.

**Datos.** Las tres tandas de `data/`, 12 combinaciones símbolo × vencimiento × lado con el Expected
Move de la §15, y 10 series con dos o más tomas.

**Reproduce.** `banda_de_gamma.py`, sección 8 (`8a` a `8d`). Las secciones 0 a 7 siguen dando salida
byte-idéntica.

---

## Veredicto

| | Resultado |
|---|---|
| **Crecer de a un strike** en vez de por rebanadas | **Arregla la inestabilidad que hundió al parche del 27**, y por lejos: el borde entre tandas se mueve **0.3** en toda la franja `f` 0.65–0.45, contra 1.3 de no crecer y 29.8 / 20.4 / 11.2 de la versión por rebanadas |
| …pero el borde crecido ante `W` | **Peor: $16.6 contra $9.6.** `W` entra dos veces —la semilla y la referencia de densidad— así que crecer lo ata más fuerte, no lo libera |
| Desacoplar la resolución de `W` | Saca una de las dos: **$8.0, a la par de hoy y no mejor.** Lo que sigue moviéndose es la **semilla**, que es una ventana de ancho `W` |
| **La dual** — masa fija, ancho mínimo: la única sin `W` | **Rechazada.** El borde entre tandas se mueve **16 a 43** según `p`, contra 1.3 de hoy |
| **El fondo** | **El borde de hoy le debe a `W` hasta 0.174 de delta**, y `delta_max` es 0.20. `W` no es el ancho de una ventana: es quien decide si la banda ata |

---

## 1. El paso del crecimiento era el problema, no la idea

El parche del 27 crecía absorbiendo **una rebanada entera de ancho `W`** por vez. Es una decisión
gruesa, y se da vuelta entre dos fotos de la misma cadena — por eso su estabilidad oscilaba sin
orden al mover `f`. Absorbiendo **de a un strike**, con la densidad medida sobre el tramo de ancho
`W` más externo de la banda ya crecida:

```text
movimiento total del borde entre tandas, 10 series

  sin crecer      1.3
  rebanada 0.80  29.8      strike 0.90   18.2
  rebanada 0.70  20.4      strike 0.80   20.6
  rebanada 0.60   1.6      strike 0.70   16.3
  rebanada 0.55  11.2      strike 0.65    0.3
                           strike 0.60    0.3
                           strike 0.55    2.2
                           strike 0.50    2.1
                           strike 0.45    0.1
```

**Con `f` entre 0.65 y 0.45 el borde se mueve menos que sin crecer.** Y la región inestable ya no son
acantilados sueltos: es una franja contigua (`f ≥ 0.70`), que es donde la regla apenas crece y decide
por decimales. Es el comportamiento de un parámetro bien planteado, con su meseta.

Vale la pena dejarlo escrito porque **la receta queda lista**: cuando `W` se calibre, esto es lo que
hay que usar, y no hay que volver a descubrir por qué la versión por rebanadas fallaba.

## 2. Pero crecer ata el borde a `W` más fuerte, no menos

Rango del borde barriendo `W` de 0.15 a 0.40 EM:

| | medio | máximo |
|---|---|---|
| hoy | $9.6 | $30.6 |
| crecida | **$16.6** | $33.0 |
| crecida, con la resolución desacoplada de `W` | $8.0 | $30.6 |

`W` entra **dos veces** en la regla de crecimiento: fija la semilla *y* fija la ventana sobre la que
se mide la densidad de referencia. Sacando la segunda —midiendo la densidad sobre el paso de la
grilla donde vive el gamma, que en SPY y QQQ es $5 aunque se listen strikes de $1— el borde vuelve a
la par de hoy. Seis de los doce casos quedan prácticamente invariantes ($0.0 a $1.0).

**Pero no mejor que hoy, y el peor caso no se mueve.** TSLA 18-Sep CALL sigue con $30.6 de rango,
porque lo que se corre ahí no es dónde para el crecimiento: es **dónde arranca**. La semilla es la
ventana de ancho `W` más densa, y en un estante de $35 esa ventana cae en un lugar distinto según
`W`. Ningún refinamiento del crecimiento arregla una semilla que se muda.

## 3. La única construcción sin `W` es peor

Si el problema es `W`, la salida obvia es no tener `W`. La **dual** lo hace: en vez de fijar el ancho
y maximizar la masa, fija la masa `p` y minimiza el ancho. El ancho lo pondría la cadena, y una
concentración ancha no quedaría truncada.

```text
movimiento total del borde entre tandas, 10 series

  hoy (W fijo)    1.3
  dual p=0.30    16.0
  dual p=0.40    27.0
  dual p=0.50    23.0
  dual p=0.60    43.0
```

**Sacar `W` no sale gratis: cambia el filo de lugar.** De *"qué strike entra en la ventana"* pasa a
*"qué strike completa la masa"*, y el segundo es mucho peor — la masa se completa con el strike
marginal, que cambia entre fotos.

## 4. El fondo: el borde nunca fue sólido

Las tres salidas fallan por la misma razón, y es una que no estaba escrita. **El borde de hoy —sin
ningún parche— es una función de `W`**, y `W` es un parámetro libre que la §61.4 declara sin
calibrar. Medido sobre las 12 combinaciones, en dólares y en delta, que es la unidad en la que el
borde se compara contra `delta_max = 0.20`:

| rango de `W` | borde: medio | máximo | **delta: medio** | **máximo** |
|---|---|---|---|---|
| 0.15 – 0.40 EM (el rango libre de la §61.4) | $9.6 | $30.6 | 0.062 | **0.154** |
| 0.20 – 0.30 EM (±20%) | $6.2 | $31.6 | 0.042 | **0.174** |
| 0.225 – 0.275 EM (±10%) | $2.7 | $6.9 | 0.019 | 0.072 |

**Mover `W` un ±20% corre el delta del borde hasta 0.174, con un presupuesto de riesgo de 0.20.** O
sea que `W` no es un detalle de resolución: **es quien decide si la banda ata o no ata**, que es
justamente el número que la §61.6 usa para juzgar si la estructura aporta algo (3 de 12).

### Y eso corrige una afirmación de la §61.7

El ejemplo 1 dice, sobre SPY 16-Oct CALL: *"El borde del lado call es sólido: 800. Barriendo el ancho
de banda de 0.15 a 0.40 EM se mueve entre 798.6 y 800.9 — el paso 6 devuelve el mismo número
siempre."*

**Es cierto para ese caso y falso para el dataset.** Ese lado es el tercero más estable de los doce
($3.0 de rango). El promedio es $9.6 y TSLA 18-Sep CALL se mueve $30.6. La solidez del borde se
generalizó desde el único ejemplo que había trabajado hasta entonces.

---

## 5. Qué queda

**El borde no se puede cerrar antes de calibrar `W`.** Y `W` no se puede calibrar antes de la §61.9 —
es exactamente lo que dice el `README`: *"calibrar `buffer`, `delta_max`, el ancho de banda o los
umbrales de dominancia antes de esa decisión es afinar números que no significan nada si la hipótesis
es falsa"*. Este hallazgo le agrega un caso concreto y medido a esa lista, y el más caro: **no es que
`W` esté sin afinar, es que `W` manda sobre el resultado.**

Lo que sí queda cerrado:

* **La receta del crecimiento**, lista para cuando `W` se calibre: de a un strike, `f` entre 0.65 y
  0.45, con la resolución desacoplada de `W`.
* **La dual está descartada**, y con ella la esperanza de sacarse `W` de encima.
* **La §61.7 pierde su "el borde es sólido"**, que era una generalización desde un caso.

Y una consecuencia que no es técnica: de los cuatro defectos que la §61.4 fue acumulando, **tres
terminaron en el mismo lugar** — la zona del dinero se arregló, pero el anclaje, `xdisj` y ahora el
borde se cayeron todos contra parámetros que no se pueden calibrar sin la §61.9. La maquinaria
transversal sigue contestando lo que sabe contestar —si un filtro es vacuo, si dos son redundantes,
si algo es estable— y ya contestó todo lo que podía.
