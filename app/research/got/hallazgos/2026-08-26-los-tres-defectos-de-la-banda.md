# 2026-08-26 — Los tres defectos de construcción de la banda: dos son uno solo, y el tercero no se arregla como decía

**Qué se probó.** Los tres defectos de construcción que la §61.4 dejó anotados el 25 por la noche,
con la condición que ella misma puso: *"cambiar cómo se construye la banda es cambiar la
definición, y el arreglo hay que medirlo antes de escribirlo"*.

**Datos.** Las tres tandas de `data/` — `2026-08-24`, `2026-08-25` y `2026-08-25-t2` —, 12
combinaciones símbolo × vencimiento × lado en la tanda del 25 y 10 series con dos o más tomas para
la estabilidad temporal. Todo con el **Expected Move de la §15**, no con el proxy `EM*`: es la
lección del hallazgo de la noche anterior.

**Reproduce.** `banda_de_gamma.py`, sección 6 (`6a` a `6f`). Las secciones 0 a 5 quedaron intactas
a propósito: siguen reproduciendo los números publicados, y esa reproducibilidad es la que deja ver
qué movió el arreglo.

```bash
PYTHONIOENCODING=utf-8 python research/got/scripts/banda_de_gamma.py
PYTHONIOENCODING=utf-8 python research/got/scripts/banda_de_gamma.py 2026-08-25-t2
```

---

## Veredicto

| Defecto | Arreglo probado | Resultado |
|---|---|---|
| **2** — el competidor disjunto puede ser la pila del dinero | excluir la zona del dinero del pool | **Adoptado.** `xdisj` de SPY 16-Oct CALL: 1.01x → **1.49x**, sin mover el borde |
| **3** — el muro mismo puede ser la pila del dinero | el mismo | **Adoptado, y es el más caro de los tres.** El único salto de banda del dataset —QQQ 18-Sep CALL, $14.9— se reduce a **$0.1** |
| **1** — la ventana es continua y la grilla no | anclar la ventana a un número entero de escalones | **Rechazado por medición.** Triplica la inestabilidad que venía a arreglar |

**Los defectos 2 y 3 son el mismo defecto** —la pila de gamma del dinero entrando a un cálculo que
mide alas— y se arreglan con un solo cambio. **El 1 es real como diagnóstico y falso como problema:**
lo que hacía que decidiera veredictos era el defecto 2.

---

## 1. Los defectos 2 y 3: la pila del dinero

### El cambio

La banda, su competidor, la ventana mediana y el total del lado se calculan sobre los strikes con
`|K − spot| ≥ m × EM`. Un solo parámetro, aplicado al **pool** y no solo al competidor — que es lo
que el tercer defecto pedía.

### Cuánto excluir: la medición manda 0.10–0.15 EM

El barrido de `m` sobre las 12 combinaciones (§6c) y sobre la estabilidad temporal (§6d):

| | `m=0.00` | `m=0.10` | **`m=0.15`** | `m=0.25` | `m=0.35` |
|---|---|---|---|---|---|
| movimiento del borde entre tandas, total (10 series) | 16.1 | **1.3** | **1.3** | 10.3 | 31.2 |
| bordes que se mueven dentro de la tanda (de 12) | — | 0 | 0 | 3 | 4 |
| `xdisj` que cambian más de 0.10x (de 12) | — | 0 | 1 | 4 | 7 |
| SPY 16-Oct CALL (t2), el caso del ejemplo 1 | 1.01x | 1.31x | **1.49x** | 1.61x | 1.95x |

**Hasta 0.15 EM la exclusión no mueve ningún borde y arregla lo que tiene que arreglar. De 0.25 en
adelante empieza a comerse bandas legítimas** —tres bordes se corren, uno de ellos $10—, y eso se
paga en lo único que la banda vino a comprar: en `m = 0.25` el borde de QQQ 18-Sep PUT salta $9.1
entre tandas porque el strike 700 —el más grande de su banda— queda adentro un día y afuera el
otro, según de qué lado del corte caiga el spot. El arreglo tiene su propio filo, y **es filo del lado de arriba, no del de abajo**.

Se adopta **`m = 0.15 EM`**, con el rango 0.10–0.15 medido y la advertencia de que arriba de 0.25 el
parámetro cambia de signo. No es un umbral fijado sobre una observación —es el óptimo de una
superficie de 12 casos × 5 valores— pero tampoco está calibrado: es el valor que no rompe nada en
este dataset.

### Defecto 2 — qué tan contaminado estaba el test

`dcomp` = distancia del competidor al spot, en EM. Con la construcción publicada:

| Caso | `dcomp` | `xdisj` publicado | `xdisj` con `m = 0.15` |
|---|---|---|---|
| SPY 16-Oct CALL (t2) | **0.01 EM** | **1.01x** | **1.49x** |
| SPY 16-Oct CALL (mañana) | 0.12 EM | 1.33x | 1.50x |
| QQQ 16-Oct CALL | 0.14 EM | 1.43x | 1.44x |
| QQQ 16-Oct PUT | 0.16 EM | 1.05x | 1.05x |
| SPY 16-Oct PUT | 0.18 EM | 1.27x | 1.27x |

**El caso del ejemplo 1 de la §61.7 es el peor posible:** su competidor arrancaba en el strike 766
con el spot en 765.45 — a **un centavo de Expected Move**. El 1.01x que hizo escribir *"dos
concentraciones empatadas"* comparaba el muro de call contra el dinero.

Los otros dos (QQQ 16-Oct PUT y SPY 16-Oct PUT) siguen con el competidor cerca a `m = 0.15` y sólo
se despegan a 0.25 — que es donde el parámetro empieza a costar. Queda así: **el arreglo no limpia
los cinco casos, limpia los dos peores sin romper nada.**

### Defecto 3 — el muro que era el dinero

La §61.4 lo anotó sobre el **argmax** de QQQ 18-Sep del 24-ago: `SelectCallWall` devolvió 710 con el
spot en 708.02. Medido, **la banda tenía el mismo problema y con peores consecuencias**:

```text
QQQ 2026-09-18 CALL          spot        banda          borde
  24-ago  publicado         708.02    710.0-719.5      719.5     <- la banda ES el dinero
  25-ago  publicado         711.73    725.0-734.4      734.4
                                                       ------
                                       el borde se movió $14.9

  24-ago  con m = 0.15      708.02    725.0-734.5      734.5
  25-ago  con m = 0.15      711.73    725.0-734.4      734.4
                                                       ------
                                       el borde se movió $0.1
```

**Es la única serie del dataset que se movió, y deja de moverse.** Las dos tandas ven la misma
banda: 725–734.

Y esto **corrige la explicación del hallazgo de la noche anterior**, que atribuyó el salto a que el
call de QQQ es una meseta de 720 a 750. La meseta existe —`xmed` 1.2–1.4x, el más bajo del dataset,
y sigue siendo la lectura correcta de esa forma— pero **no es lo que movió la banda**. Lo que la
movió fue que el 24 el máximo estaba en el dinero. Con el dinero afuera, una meseta con `xmed` 1.2x
se quedó quieta entre dos fotos separadas por medio día y $3.7 de spot.

Es una corrección que importa más allá de QQQ: la §61.4 usa esa serie como **la única evidencia de
inestabilidad del dataset**, y es de donde sale que `xmed` avisa antes de fallar. El aviso sigue
valiendo como descripción —una meseta no es un muro— pero **ya no hay ningún evento de
inestabilidad que un umbral de `xmed` tenga que atrapar**: el único que había era este, y era otra
cosa.

### Lo que NO cambia

**Ningún borde se mueve** en las 12 combinaciones con `m = 0.15`, y el conteo de la §61.3 —*ata la
banda en 3 de 12*— **queda igual** (§6f). Confirma lo que la §61.4 había anticipado sin poder
probarlo: los defectos afectan al veredicto, no al borde.

TSLA 18-Sep CALL —el "no hay muro" legítimo, con sus dos concentraciones a $30 y el spot lejos de
las dos— sigue dando `xdisj` **1.01x** con el dinero afuera. El arreglo no se lleva puesto al
verdadero positivo.

---

## 2. El defecto 1: real como diagnóstico, rechazado como arreglo

### El diagnóstico se confirma, y es peor de lo que la §61.4 decía

Midiendo la **holgura** —a qué distancia del borde quedó el primer strike excluido, en escalones de
la grilla— sobre las 12 combinaciones (§6a):

```text
6 de 12 bandas dejan afuera un strike a menos de un cuarto de escalón.
2 de ellas lo dejan afuera por 0.02 escalones: dos centavos de un strike de un dólar.
```

No era el caso de SPY: **es la mitad del dataset**.

### El arreglo propuesto no arregla

Anclar la ventana a un número entero de escalones de la grilla local, medido contra un cambio
**vacío** de `W` (±10%, el mismo 8% que en SPY movía el veredicto):

| Construcción | swing medio de `xdisj` | máximo | casos > 20% | movimiento del borde entre tandas |
|---|---|---|---|---|
| publicada | **3.8%** | 15.0% | 0/12 | 16.1 |
| anclada | 13.5% | 53.9% | 3/12 | 15.0 |
| sin ATM (`m=0.15`) | 6.3% | 21.9% | 1/12 | **1.3** |
| las dos | 17.4% | 89.1% | 3/12 | 7.0 |

**El anclaje no saca el redondeo: lo muda.** De *"qué strike cae adentro de la ventana"* pasa a
*"cuántos escalones mide la ventana"*, y el segundo redondeo es más grueso — en TSLA, donde la
grilla va de 2.5 a 10, un escalón es la mitad de la banda, así que `W` cruzando un punto medio la
mueve entera. Empeora las dos cosas que importa que no empeoren.

Hubo una versión intermedia que además se equivocaba sola: el paso de la grilla se estimaba en un
vecindario medido **en dólares con radio `W`**, así que el ancho anclado dependía de `W` dos veces
y volvía a moverse por nada. Corregido a un vecindario de 10 escalones —cantidad, no dólares—, el
resultado de arriba es el del anclaje bien hecho. También se probó anclar a la **grilla donde vive
el gamma** en vez de a la listada (en SPY 16-Oct un strike de $1 carga en promedio el **10%** del gamma de
uno de $5 del lado put, y el 24% del lado call: el gamma vive en una empalizada de $5 aunque se
listen strikes de $1). Recupera el swing —6.5%,
como la construcción publicada— pero paga el borde entre tandas: **41.0 sin exclusión, 11.0 con
ella**, contra 1.3 sin anclar. Las tres variantes pierden.

### Y una vez sacado el dinero, el defecto deja de decidir

El caso que motivó todo, SPY 16-Oct CALL de la tanda t2, ante el mismo ±10% de `W`:

```text
construcción publicada      xdisj  1.01 - 1.22x     <- cruza cualquier umbral
con m = 0.15                xdisj  1.49 - 1.62x     <- no cruza ninguno
```

El strike 800 sigue entrando y saliendo por 24 centésimas de escalón, y sigue moviendo la
composición de la banda (33.1% del lado contra 41.2%). **Lo que ya no mueve es el veredicto.** Con
el competidor limpio, `xdisj` se queda en una franja que ningún umbral razonable parte.

Con 12 casos eso es una observación, no una demostración. Pero alcanza para lo que hay que decidir
hoy: **el defecto 1 no justifica cambiar la definición**, y su arreglo, medido, la empeora.

### Un bug que apareció de arrastre, y que sí se arregló

Con la banda anclada a la grilla, los bordes caen sobre strikes — y ahí se vio que el test de
disjunción comparaba **intervalos** (`hi <= lo`) en vez de conjuntos de strikes. Un competidor que
toca la banda en su borde comparte ese strike. En QQQ 18-Sep PUT el "competidor" 700–708 contenía el
700, que es el strike **más grande** de la banda 692–700: el muro estaba compitiendo contra sí
mismo. Arreglado — disjunta ahora es *sin ningún strike en común*. No mueve ningún número publicado
(en la construcción continua los bordes casi nunca caen sobre un strike), pero era un error latente.

---

## 3. Lo que queda abierto

* **El competidor contiguo** —la tercera lectura de un `xdisj` bajo, de la §61.4— no lo toca nada de
  esto. Una losa ancha partida en dos por el tamaño de la ventana sigue compitiendo contra su propia
  cola. QQQ 18-Sep PUT: banda 691–700 contra 681–690.
* **Los umbrales de `xmed` y `xdisj` siguen sin declararse**, y ahora con menos apoyo que antes: el
  único evento de inestabilidad del dataset resultó ser el defecto 3. No hay ninguna falla observada
  contra la cual calibrar.
* **`m` no está calibrado**, sólo medido: 0.15 EM es lo que no rompe nada acá.
* **Nada de esto toca la §61.9**, que es la única pregunta que decide si GOT existe.
