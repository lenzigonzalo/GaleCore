# 2026-08-24 — El sesgo por lado se invierte en SPY y QQQ

**Verifica:** la predicción de la sección 43.4 — el sesgo put-only medido sobre TSLA,
¿es del modelo o de la superficie de TSLA?
**Datos:** los seis CSV de [`data/2026-08-24/`](../data/2026-08-24/), capturados el 2026-08-24 con
[`research/gex-strikes.ps1`](../../gex-strikes.ps1) sobre los mismos dos vencimientos
(2026-09-04, DTE 11; y 2026-10-16, DTE 53–56) para los tres símbolos.
**Reproduce:** [`scripts/skew_por_lado.py`](../scripts/skew_por_lado.py).
**Veredicto:** la predicción era que la brecha entre lados sería **menor** en SPY y QQQ.
Es **peor que eso: cambia de signo**. En el universo declarado, el filtro económico
simétrico sesga hacia **CALL**, no hacia PUT. La sección 43.5 queda invalidada.

---

## 1. La métrica

Cuánto paga cada lado por unidad de probabilidad:

```text
(Credit / Width) / |delta del short leg|
```

`Credit/Width` es la pérdida esperada risk-neutral como fracción del ancho (§43.2) y
`delta` es la probabilidad de terminar ITM. Si los dos lados dieran lo mismo, un umbral
económico simétrico sería neutral entre lados. **La diferencia entre lados es el sesgo.**

## 2. Resultado

Promedio sobre los deltas objetivo 0.10, 0.15 y 0.20:

| Símbolo | PUT | CALL | CALL/PUT | Lectura |
|---|---|---|---|---|
| **SPY** | 0.53 / 0.49 | 0.89 / 0.95 | **1.69 / 1.92** | el call paga ~80% más |
| **QQQ** | 0.55 / 0.54 | 0.88 / 0.84 | **1.60 / 1.53** | el call paga ~57% más |
| **TSLA** | 0.78 / 0.90 | 0.61 / 0.46 | **0.79 / 0.51** | el call paga ~35% menos |

(los dos valores de cada celda son 2026-09-04 y 2026-10-16)

Los tres símbolos son consistentes consigo mismos en los dos vencimientos, y **SPY y QQQ
están del lado opuesto de 1.0 que TSLA**. No es ruido: son cuatro mediciones por dirección.

## 3. No es un artefacto del horario ni del bid/ask

TSLA se capturó en sesión (11:57 y 12:35 ET); SPY y QQQ post-cierre (17:2x ET). Para
descartar que el ensanchamiento del book explique algo, se recalculó todo con **mid** en
vez de bid del short contra ask del long:

| Símbolo · vto | CALL/PUT bid-ask | CALL/PUT mid | bid-ask medio |
|---|---|---|---|
| SPY 2026-09-04 | 1.69 | 1.67 | 6.3% |
| SPY 2026-10-16 | 1.92 | 1.86 | 3.4% |
| QQQ 2026-09-04 | 1.60 | 1.50 | 3.0% |
| QQQ 2026-10-16 | 1.53 | 1.40 | 1.2% |
| TSLA 2026-09-04 | 0.79 | 0.78 | 14.6% |
| TSLA 2026-10-16 | 0.51 | 0.57 | 7.7% |

El resultado no se mueve. Y el book de SPY/QQQ post-cierre está **más ajustado** (1.2%–6.3%)
que el de TSLA en plena sesión (7.7%–14.6%), así que el sesgo por horario, de haberlo,
juega en contra de la conclusión y no a favor.

## 4. El mecanismo

Lo confirma la forma de la superficie, medida sobre el delta solo — cuánto hay que alejarse
del spot para llegar al mismo |delta| de cada lado (ratio call/put; vol plana ≈ 1.0):

```text
SPY 0.73   QQQ 0.79   AAPL 1.03   TSLA 1.23   SKM 1.23
```

SPY y QQQ tienen **put skew monótono**: el ala de put carga más IV, y hay que ir más lejos
del lado put para bajar a delta 0.10. TSLA tiene el **ala de call levantada**.

Lo que mueve el crédito de un vertical no es el *nivel* de IV sino su **pendiente** entre
los dos strikes, porque el spread vende uno y compra el otro:

* **Put credit spread**: vende el menos OTM, **compra el más OTM**. Con put skew el que se
  compra es el que tiene más IV → la pendiente **resta** crédito.
* **Call credit spread** sobre esa misma superficie: vende el caro y compra el barato → la
  pendiente **suma** crédito.

En TSLA, con el ala de call levantada, pasa exactamente al revés.

**Matiz que importa:** esto vale para el *spread*, no para la opción suelta. Un put desnudo
sí cobra la IV alta del ala; el spread no, porque la compra. Como GOT es solo riesgo
definido, lo que manda es la pendiente y no el nivel.

## 5. Qué significa en deltas concretos

El filtro económico, traducido a un delta mínimo (§43.2), sobre SPY a DTE 53 con WD 0.30
—donde `RequiredCredit` exige `Credit/Width ≥ 0.088`:

```text
lado PUT   ->  0.088 / 0.49  =  delta minimo 0.18
lado CALL  ->  0.088 / 0.95  =  delta minimo 0.093
```

El mismo umbral, sobre el mismo símbolo y el mismo vencimiento, obliga a vender **al doble
de delta** del lado put que del lado call. Ese es el sesgo, cuantificado.

## 6. Consecuencias

### 6.1 La sección 43.5 queda invalidada

Decía que GOT es *"put-biased por construcción, y declarado"*. Es falso para el universo
declarado en la sección 4: sobre SPY y QQQ el sesgo es hacia **CALL**. Lo que se declaró
como una propiedad del motor era una propiedad de TSLA.

### 6.2 Refuerza fuertemente la decisión de la 43.3

Un `BaseRR` por lado calibrado sobre los datos de TSLA —la salida 2, que se descartó—
habría quedado **exactamente al revés** para los símbolos que la estrategia realmente opera.
No habría sido un parámetro subóptimo: habría sido un parámetro con el signo cambiado,
horneado en una constante donde nadie lo iba a volver a mirar.

### 6.3 Y agrega un argumento que no estaba

El sesgo **no es una constante que se pueda calibrar**, ni siquiera por símbolo. Es una
función de la pendiente local de la superficie de volatilidad, que cambia por símbolo, por
vencimiento y en el tiempo. Ningún parámetro estático lo captura.

Eso deja al edge test de la §43.3 no como la opción más elegante de tres, sino como **la
única que puede funcionar**: comparar probabilidad implícita contra empírica absorbe la
pendiente sea cual sea, sin que nadie tenga que medirla ni mantenerla.

### 6.4 Sobre el universo de prueba

TSLA no es representativo del universo de GOT y no debería seguir siendo el símbolo con el
que se valida. Sirve como caso de control —es útil tener un símbolo con la superficie al
revés— pero las calibraciones se hacen sobre SPY y QQQ, que es lo que la sección 4 declara.

## 7. Qué queda pendiente

* Recapturar SPY y QQQ **en sesión** para confirmar con book vivo. La evidencia de que el
  horario no afecta (§3) es fuerte, pero es una medición post-cierre.
* Medir el mismo cociente sobre más símbolos y más fechas: hoy son tres símbolos y un día.
* La dirección del sesgo en SPY/QQQ (hacia call) no dice que vender calls sea *rentable* —
  dice que el filtro actual las prefiere. Si eso es edge o es selección adversa lo contesta
  el edge test, no esta medición.
