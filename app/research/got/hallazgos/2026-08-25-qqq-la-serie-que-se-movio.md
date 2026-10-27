# 2026-08-25 (noche) — QQQ 18-Sep: la serie que se movió, y por qué los dos tests no son redundantes

**Verifica:** QQQ 18-Sep '26 corrido por el procedimiento de la [§61.7](../galecore-estrategia-got.md)
para agregarlo como tercer ejemplo trabajado. Es **la única serie del dataset cuya banda cambió entre
tandas**, así que es la prueba de si `xmed` y `xdisj` avisan antes de fallar.
**Datos:** [`data/2026-08-24/QQQ_gex_2026-09-18.csv`](../data/2026-08-24/) (post-cierre) y
[`data/2026-08-25/QQQ_gex_2026-09-18.csv`](../data/2026-08-25/) (10:12–10:15 ET, book vivo).
**Reproduce:** [`scripts/banda_de_gamma.py`](../scripts/banda_de_gamma.py) — sección 1 para el
movimiento entre tandas, sección 5 para el detalle del 25 con el EM de la §15.
**Veredicto:** los tests **avisan**, pero **avisa uno solo y no siempre el mismo**. Acá el aviso lo
dio `xmed` (1.4x, el más bajo del dataset) mientras `xdisj` daba 1.26x, que cualquier umbral
razonable dejaría pasar — el espejo exacto de TSLA 18-Sep CALL, donde avisó `xdisj` con 1.01x y
`xmed` daba 8.3x. **Es la evidencia de que los dos tests no son redundantes.** Aparecen además un
tercer defecto de construcción (el argmax puede caer en el strike del dinero) y una tercera lectura
de `xdisj` bajo que las notas de esta misma noche no tenían.

---

## 1. Qué se movió

`spot 710.60 · ATM IV 0.1971 · DTE 24 · Net GEX −58.4 B · ZGL 709.00 · EM ±35.9 · W 9.0`

| | tanda | argmax | dom | banda | xmed | xdisj | borde | delta |
|---|---|---|---|---|---|---|---|---|
| **CALL** | 24-ago | 710 | 1.50x | 710–719 | **1.6x** | 1.28x | 719 | 0.382 |
| | 25-ago | **750** | **1.01x** | **725–734** | **1.4x** | 1.26x | 734 | 0.258 |
| PUT | 24-ago | 700 | 2.18x | 691–700 | 5.2x | 1.15x | 691 | 0.326 |
| | 25-ago | 700 | 2.31x | 691–700 | 5.6x | 1.24x | 691 | 0.292 |

El put no se movió un strike. El call sí: **el argmax saltó $40 y la banda $15**, con el spot
moviéndose $3.7. La banda amortigua —$15 contra $40— pero no salva.

## 2. Por qué: es una meseta, no un muro

GEX de call del 25, de mayor a menor:

```text
750   16.349        730   16.184        740   14.224
725   12.792        720   11.419        760    8.325
```

De 720 a 750 el gamma es un estante plano. **`xmed` 1.4x es exactamente eso**: cualquier ventana de
9 puntos en esa zona vale casi lo mismo, así que la banda es el argmax de una superficie chata y se
mueve sin que nada estructural cambie.

Es el significado operativo de `xmed`, y no estaba escrito así en la §61.4: **`xmed` cerca de 1 no
dice "banda débil", dice "no hay banda — hay meseta"**.

## 3. El tercer defecto: el argmax puede ser el strike del dinero

El 24-ago, con el spot en **708.02**, `SelectCallWall` devolvió **710** — $2 arriba — con 21.314 de
GEX, ganándole a toda la cadena.

No es el competidor disjunto el contaminado por la pila del dinero, como en SPY 16-Oct: **es el muro
mismo**. Un argmax que puede caer a $2 del spot no es referencia para nada, y es una segunda razón
—independiente— para excluir la zona del dinero de la construcción de la banda, y no solo de su
competidor.

## 4. La tercera lectura de un `xdisj` bajo

El put es estable y su banda es 691–700; su mejor competidor disjunto es **681–690**, que es
**contiguo**. No son dos muros: es una sola concentración ancha cortada en dos por el tamaño de la
ventana, y `xdisj` está comparando el muro contra su propia cola.

Con esto van tres significados distintos de un `xdisj` bajo:

| El competidor está… | Ejemplo | Qué significa |
|---|---|---|
| pegado al spot | SPY 16-Oct CALL | el test no midió nada |
| lejos, en el ala | TSLA 18-Sep CALL | dos muros reales; "no hay muro" es correcto |
| contiguo a la banda | **QQQ 18-Sep PUT** | **una sola losa ancha partida en dos** |

El tercero empuja al revés que los otros dos: baja el `xdisj` de una concentración ancha, que es
justo lo que uno querría encontrar.

## 5. La Sell Zone que sale

```text
PUT  SELL ZONE   K <= 677   ata el DELTA   delta 0.196 · 0.97 EM · c/w 0.128
CALL SELL ZONE   K >= 741   ata el DELTA   delta 0.192 · 0.81 EM · c/w 0.170
```

**Ningún lado ata**, consistente con el conteo de 3 de 12 (los tres SPY). El call paga más al mismo
delta —0.170 contra 0.128—, que es el sesgo de QQQ de la §43.5: 1.57x a favor del call.

## 6. Qué NO prueba

* **Es un solo evento de inestabilidad**, el mismo del hallazgo de la mañana. Que `xmed` lo haya
  anticipado es alentador, no una calibración: sigue sin haber con qué fijar el umbral.
* **La captura del 24-ago no tiene log versionado**, así que su `spot` sale interpolado de la curva
  de delta y la comparación usa el EM del 25 para las dos tandas. Es post-cierre, además, por eso
  todos los créditos salen de la del 25.
* **No dice nada sobre si la banda predice.** Sigue siendo la §61.9.

## 7. Qué hacer

* **Aplicado ya:** la §61.7 ganó el ejemplo 3 y la §61.4 lleva la tabla de los dos tests con su
  evidencia simétrica, el tercer defecto y las tres lecturas de `xdisj`.
* **Excluir la zona del dinero de la construcción de la banda**, no solo del competidor. Cuál es el
  radio es un parámetro más que hay que medir antes de escribir.
* **Tratar el competidor contiguo distinto del disjunto lejano.** Hoy `xdisj` los mezcla.
* **Versionar el log de cada captura.** La del 24-ago obligó a interpolar el spot y a prestarle el
  EM de otro día — barato de evitar.
