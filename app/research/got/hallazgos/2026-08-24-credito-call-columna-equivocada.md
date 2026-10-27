# 2026-08-24 — Las tablas de CALL del v5 leyeron la columna equivocada del dataset

**Verifica:** GOT v5, secciones 24 a 28 (Delta Sweep sobre TSLA) y el Hallazgo 3.
**Datos:** [`data/TSLA_gex_2026-09-04.csv`](../data/2026-08-24/TSLA_gex_2026-09-04.csv) y
[`data/TSLA_gex_2026-10-16.csv`](../data/2026-08-24/TSLA_gex_2026-10-16.csv), capturados con
[`research/gex-strikes.ps1`](../../gex-strikes.ps1) el 2026-08-24.
**Reproduce:** [`scripts/recheck_econ.py`](../scripts/recheck_econ.py).
**Veredicto:** las secciones 25 y 27 quedan **invalidadas**. El Hallazgo 3 se **invierte**.

---

## 1. Qué disparó la verificación

En un vertical de riesgo definido, `crédito / width` no puede superar aproximadamente el delta del
short leg — más precisamente está acotado por N(d2) del punto medio entre strikes, que para un short
delta 0.10 ronda 0.08. Las tablas de CALL del v5 daban valores de 0.62 a 0.69 con deltas de 0.10.
Eso es imposible bajo cualquier superficie de volatilidad.

Las de PUT, en cambio, pasaban la regla sin problema. La asimetría entre los dos lados era de ~8x, y
en la dirección contraria a la que produce el skew de un equity.

## 2. Diagnóstico

Los CSV traen **dos** columnas de crédito, en este orden:

```text
strike,callGEX_musd,putGEX_musd,netGEX_musd,callOI,putOI,callDelta,putDelta,
callBid,callAsk,putBid,putAsk,pcsCredit_w5,ccsCredit_w5
```

**Las tablas de CALL del v5 leyeron `pcsCredit_w5` en vez de `ccsCredit_w5`.** No es una
aproximación: los 12 valores coinciden dígito por dígito con la columna equivocada.

| v5 §27, 16 Oct CALL | Strike | `callDelta` del CSV | `pcsCredit_w5` (lo que se usó) | `ccsCredit_w5` (lo correcto) |
|---|---|---|---|---|
| $3.30 | 450 | .10977 ✓ | **3.30** | 0.21 |
| $3.25 | 445 | .11923 ✓ | **3.25** | 0.20 |
| $3.50 | 430 | .15690 ✓ | **3.50** | 0.35 |
| $3.40 | 425 | .17248 ✓ | **3.40** | 0.40 |
| $3.25 | 415 | .20640 ✓ | **3.25** | 0.55 |
| $3.10 | 410 | .22596 ✓ | **3.10** | 0.60 |

Idéntico en §25 (4 Sep CALL): 395→3.10, 392.5→2.50, 387.5→2.50, 382.5→2.70, 380→3.45. Los cinco son
la columna PCS.

Que dieran ~$3 tiene una explicación directa: en el strike 450 el `putDelta` es −0.94, así que el
vertical de **puts** está profundamente ITM y vale casi el ancho entero. Ese número nunca fue el
crédito de un call spread.

**El resto del dataset está bien.** Se verificó contra el CSV:

* las 11 filas de PUT de las §24 y §26 coinciden con `pcsCredit_w5` y `putDelta` — correctas;
* los muros: 4 Sep call wall 360 / put wall 345, y 16 Oct call wall 400 / put wall 330, todos
  confirmados como el extremo de `callGEX_musd` / `putGEX_musd` de su cadena;
* los WD de las cuatro tablas se reproducen de la fórmula con esos muros y el EM declarado.

El script de captura tampoco tiene el error: calcula las dos columnas bien, con bid del short contra
ask del long ([`gex-strikes.ps1`](../../gex-strikes.ps1), función `SpreadCredit`). El problema fue
de lectura, y lo facilitó que `pcsCredit_w5` viene **primero**: "la columna de crédito" es la del put
por defecto.

## 3. Recálculo

Con `ccsCredit_w5` y el modelo del v5 (`RRreq = 0.12 × sqrt(30/DTE) × WDFactor` interpolado,
`RequiredCredit = Width × RRreq/(1+RRreq)`, width 5):

### 4 Sep CALL — DTE 11, call wall 360, EM 25.7

| Strike | Delta | WD | Crédito real | Required | Cushion | Veredicto |
|---|---|---|---|---|---|---|
| 395 | .1057 | 1.362 | 0.29 | 0.72 | −59.8% | falla |
| 392.5 | .1188 | 1.265 | 0.33 | 0.72 | −54.2% | falla |
| 387.5 | .1502 | 1.070 | 0.47 | 0.72 | −34.8% | falla |
| 382.5 | .1893 | 0.875 | 0.63 | 0.74 | −14.7% | falla |
| 380 | .2121 | 0.778 | 0.69 | 0.75 | −8.3% | falla |

El v5 decía que **todos** pasaban. No pasa ninguno.

### 16 Oct CALL — DTE 56, call wall 400, EM 59.7

| Strike | Delta | WD | Crédito real | Required | Cushion | Veredicto |
|---|---|---|---|---|---|---|
| 450 | .1098 | 0.838 | 0.21 | 0.36 | −41.6% | falla |
| 445 | .1192 | 0.754 | 0.20 | 0.37 | −45.4% | falla |
| 430 | .1569 | 0.503 | 0.35 | 0.38 | −9.1% | falla |
| 425 | .1725 | 0.419 | 0.40 | 0.40 | −0.1% | empata |
| 415 | .2064 | 0.251 | 0.55 | 0.46 | **+20.0%** | **pasa** |
| 410 | .2260 | 0.168 | 0.60 | — | — | falla WD |

El v5 decía que pasaban cinco de seis. Pasa uno.

Las tablas de PUT (§24 y §26) se recalcularon también y **dan igual que en el v5**: los cinco
candidatos del 4 Sep fallan por economía, y los del 16 Oct pasan salvo el 320 que cae por WD.

## 4. Consecuencias

### 4.1 El Hallazgo 3 no se cae: se invierte

El v5 concluye que *"el mismo DTE puede tener un lado excelente y otro malo"*, y de ahí saca
`Expiration ≠ Trade Quality`. Con los datos corregidos:

* **4 Sep (DTE 11): falla de los dos lados.** 5 puts fallan, 5 calls fallan.
* **16 Oct (DTE 56): bien del lado put** (5 de 6) **y mal del lado call** (1 de 6).

No hay evidencia de asimetría por vencimiento. Lo que hay es que **el DTE corto no paga de ningún
lado**, lo cual refuerza el Hallazgo 2 en vez de contradecirlo. `Expiration × Side × Strike` sigue
siendo razonable como unidad de evaluación, pero perdió la evidencia que lo sostenía.

### 4.2 Aparece el put skew, que es lo que confirma que ahora el dato está bien

Con los créditos correctos, en 16 Oct a delta equivalente:

```text
put delta .1070 -> $0.46      call delta .1098 -> $0.21
put delta .1925 -> $0.90      call delta .2064 -> $0.55
```

Las puts pagan aproximadamente el doble que las calls equidistantes, que es el skew normal de un
equity. El dato viejo mostraba lo contrario — calls pagando 8x más que puts — que es lo que no podía
existir.

### 4.3 GOT es put-only de facto con esta calibración

`RequiredCredit` es **simétrico**: depende de width, DTE y WD, y ninguno de los tres sabe de qué lado
de la cadena está el strike. La superficie de vol **no** es simétrica. Resultado: el lado call
arranca con una desventaja estructural de ~2x en crédito a delta igual y casi nunca llega al umbral.

Eso choca con la **§43**, donde el v5 decide explícitamente que GOT evalúa ambos lados y no se sesga
por dirección. Con los números reales sí está sesgado — no por una predicción direccional, sino por
un umbral simétrico aplicado a un mercado asimétrico. Hay que elegir a conciencia: o
`RequiredCredit` reconoce el skew, o GOT es un vendedor de puts y conviene asumirlo.

### 4.4 Con `MaxRisk = $400` y width 5 no queda ningún candidato

El maxloss de **los 22 candidatos de ambos datasets** va de $409 a $480. Ninguno entra en $400,
incluidos los cinco puts del 16 Oct que pasan economía — y el candidato estrella de la §54 (strike
315, maxloss $410).

Aplicando los tres filtros duros juntos (`WD ≥ 0.20`, `Credit ≥ RequiredCredit`,
`MaxLoss ≤ MaxRisk`), **el conteo de candidatos válidos en ambos datasets es cero**. `MaxRisk`
absoluto y `Width` en strikes están mal acoplados para un subyacente de precio alto: hay que ir a
width 2.5 (y ahí el crédito se parte, así que el Cushion cambia) o soltar el límite absoluto en
favor de un % del capital, como plantea la §72.

## 5. Qué queda en pie del v5

Sin tocar: la eliminación del `MinCredit` fijo, el efecto del DTE sobre el crédito requerido,
`RequiredCredit` y `Cushion` como conceptos, y todo el análisis del lado put.

Para reescribir: §25, §27, el Hallazgo 3, y la §43 a la luz de 4.3.
