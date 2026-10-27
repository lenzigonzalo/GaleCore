# 2026-08-24 — El 2026-09-04 es un weekly, y el bucle de la §47.1 no lo recorre

**Verifica:** el alcance definido ese mismo día en la [§47.1](../galecore-estrategia-got.md) —el
flujo recorre los vencimientos **regulares** con DTE ≤ 60— contra los vencimientos sobre los que
está construida la evidencia del v5.
**Datos:** ninguno. Es una cuenta de calendario contra una definición, no una medición sobre
mercado. Los vencimientos en cuestión son los de [`data/2026-08-24/`](../data/2026-08-24/).
**Reproduce:** [`scripts/vencimientos_regulares.py`](../scripts/vencimientos_regulares.py).
**Veredicto:** de los dos vencimientos capturados, el `2026-10-16` es regular y el `2026-09-04`
**no**: es el primer viernes de septiembre, un weekly. El tercer viernes de ese mes era el 18. Todo
lo que el v5 concluyó sobre DTE corto está medido sobre un tipo de contrato que el flujo, como
quedó definido, nunca evalúa.

---

## 1. La comprobación

"Regular" es el vencimiento estándar mensual —el tercer viernes—, que es lo que Tastytrade devuelve
como `expiration-type: "Regular"`; los demás son `Weekly`, `Quarterly` o `Mini`. El JSON de GEX pide
`["Regular", "Weekly"]` dentro de sus 60 DTE, así que la captura trajo los dos tipos sin
distinguirlos, y el nombre del archivo tampoco lo dice.

```text
2026-09-04   WEEKLY    (tercer viernes de septiembre: 2026-09-18)
2026-10-16   REGULAR   (tercer viernes de octubre:    2026-10-16)
```

## 2. Cuántos vencimientos entran en el bucle

La misma cuenta, mirada desde 365 días de observación consecutivos:

| Vencimientos en el bucle | Días | % | Ejemplo |
|---|---|---|---|
| 1 | 16 | 4.4% | 2026-09-19 → 2026-10-16 (27d) |
| **2** | **329** | **90.1%** | 2026-08-24 → 2026-09-18 (25d), 2026-10-16 (53d) |
| 3 | 20 | 5.5% | 2026-11-16 → 2026-11-20 (4d), 2026-12-18 (32d), 2027-01-15 (60d) |

Con el universo de calibración de la §43.5 —SPY y QQQ— y los dos lados, **una corrida son ocho
combinaciones** el 90% de los días.

## 3. Qué queda apoyado en el weekly

Todo lo que el v5 dice sobre DTE corto sale del `2026-09-04`, porque es el único vencimiento corto
que se capturó:

* **§24 y §25** — los sweeps de PUT y CALL del 4 Sep. El 4 Sep falla de los dos lados, a todo delta.
* **§28** — *"con DTE corto no hay ventana en absoluto"*. Descansa enteramente en ese sweep.
* **§53** — el hallazgo de que el DTE modifica radicalmente el crédito necesario tiene un solo
  punto en el extremo corto.
* **§55** — el ejemplo clave que demuestra que `MinCredit = $80` no puede ser universal
  (strike 337.5, crédito $0.86 contra `RequiredCredit` $0.96).
* **§43.2** — las dos filas `DTE 11` de la tabla de `Credit/Width` requerido.
* **§43.4 y §43.5** — el sesgo por lado se midió sobre dos vencimientos por símbolo; uno de los
  dos es este.

El `2026-10-16` es regular y no está afectado. Los ejemplos y sweeps del 16 Oct —§26, §27, §54— se
sostienen tal cual.

## 4. Qué NO invalida

**Nada de lo medido está mal.** Los números del 4 Sep son correctos —fueron recalculados en el
[hallazgo del crédito CALL](2026-08-24-credito-call-columna-equivocada.md) junto con los del 16
Oct— y las conclusiones económicas que dependen del **contraste** entre un DTE corto y uno largo
siguen mostrando lo que muestran. Que `RequiredCredit` crezca con `sqrt(30/DTE)` y que por eso un
vencimiento corto necesite mucho más crédito por unidad de ancho es una propiedad de la fórmula,
no del contrato que se usó para ilustrarla.

**Y el DTE corto no queda fuera de alcance.** Un vencimiento regular también pasa por DTE 11 —
mirando desde el 7 de septiembre, el regular del 18 está a 11 días. El bucle sí ve DTE cortos; lo
que no ve es *este* contrato.

## 5. Qué sí cambia

**La evidencia del extremo corto viene de un contrato que el flujo no opera, y los dos no son
intercambiables.** Un weekly y un mensual al mismo DTE difieren en open interest —el mensual
concentra mucho más—, y de ahí en spread bid/ask y en profundidad del book. GOT toma tres
decisiones que dependen justamente de eso: el crédito (la §41 todavía no fija el estándar, pero la
alternativa conservadora que plantea —bid del short contra ask del long— es sensible al spread), la
calidad de la opción del Nivel 4 (§40, OI y bid/ask) y el slippage (§69). Ninguna de las tres se
puede trasladar de un tipo de contrato al otro sin medirlo.

La afirmación más expuesta es la de la **§28**: *"con DTE corto no hay ventana en absoluto"*. Si un
mensual a DTE 11 tiene un book más ajustado, el crédito conservador sube y la conclusión podría no
repetirse. Hoy está sostenida por un solo vencimiento del tipo equivocado.

**Y hay un sesgo de muestra de segundo orden en el sesgo por lado.** La medición de la §43.5 —SPY
1.81, QQQ 1.57, TSLA 0.65— promedia dos vencimientos por símbolo, uno de los cuales es el weekly.
Si la pendiente de la superficie difiere entre tipos de contrato, la mitad de esa muestra está
midiendo algo que el flujo no va a encontrar. El cociente del 16 Oct solo (SPY 1.92, QQQ 1.53) va
en la misma dirección, así que **la conclusión no cambia de signo** — pero el número exacto sí
depende de qué se promedió.

## 6. Qué hacer

* **La recaptura que pide la §43.4 va sobre vencimientos regulares.** Ya está anotado en el
  pendiente de la §98. Al 2026-08-24 el bucle de SPY y QQQ son `2026-09-18` (25d) y `2026-10-16`
  (53d) — o sea que el 16 Oct se reusa y lo que hay que sumar es el 18 Sep.
* **Comparar el mismo DTE entre tipos de contrato**, que es lo que contesta si la §28 se sostiene:
  capturar un regular a DTE ~11 y confrontarlo con el weekly del 4 Sep. Es barato y es la única
  medición que separa "DTE corto no paga" de "el weekly no paga".
* **Registrar el tipo de vencimiento en la captura.** Ni el nombre del CSV ni el CSV lo dicen, y
  por eso esto sobrevivió a dos hallazgos. `data/README.md` ya marca cuál es cuál en la tanda del
  24; lo que falta es que el script lo emita.
* **`recheck_econ.py` tiene el 4 Sep hardcodeado** con su muro y su EM. Si la evidencia se muda a
  regulares, ese script queda apuntando a un vencimiento fuera del bucle. No es urgente —sigue
  reproduciendo el hallazgo que reproduce— pero hay que decidir si se amplía o se congela.
