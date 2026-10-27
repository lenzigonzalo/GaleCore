# 2026-08-27 — El competidor contiguo no es un caso de borde, y arreglarlo destapa que `xdisj` mide otra cosa

**Qué se probó.** El único defecto de la §61.4 que quedó abierto el 26: cuando el competidor
disjunto es la **cola de la propia banda**, `xdisj` compara el muro contra sí mismo, da bajo, y
castiga a una concentración ancha por ser ancha.

**Datos.** Las tres tandas de `data/`, 12 combinaciones símbolo × vencimiento × lado en la tanda del
25 con el Expected Move de la §15, y 10 series con dos o más tomas para la estabilidad temporal.

**Reproduce.** `banda_de_gamma.py`, sección 7 (`7a` a `7f`). Las secciones 0 a 6 siguen dando salida
byte-idéntica.

```bash
PYTHONIOENCODING=utf-8 python research/got/scripts/banda_de_gamma.py
```

---

## Veredicto

| | Resultado |
|---|---|
| ¿Cuánto pasa? | **8 de 12** competidores están a menos de un ancho de banda; dos, a un dólar. No es un caso de borde: es el caso normal |
| **Parche A** — exigirle al competidor un hueco de `g` anchos | **Rechazado.** Sube `xdisj` en 9 de 12 casos, pero lo que sube es aritmética: no mide nada nuevo, y el único caso que preserva intacto resulta ser un falso negativo |
| **Parche B** — dejar crecer la banda sobre la masa contigua | **Rechazado.** Es el único que arregla el **borde**, y movería la restricción de 3 a 5 de 12 — pero su parámetro tiene acantilados entre valores vecinos |
| **El diagnóstico** | **`xdisj` no mide lo que dice medir.** "Un muro o dos" es una pregunta sobre el **valle** que hay en el medio, no sobre el cociente de dos masas. Medido, **el dataset no tiene un solo valle**: `xdisj` no tiene ningún positivo verdadero |

---

## 1. Cuánto pasa: es el caso normal

Separación entre la banda y el competidor que define `xdisj`, en anchos de banda:

```text
0.08   0.11   0.32   0.39   0.44   0.56   0.61   0.82  |  1.43   1.45   2.48   2.75
                8 de 12 a menos de UN ancho            |   los cuatro que sí están lejos
```

Dos de ellos —TSLA 16-Oct PUT y QQQ 18-Sep PUT— están a **un dólar** de la banda. **El competidor
típico no es otro muro: es el borde de afuera del mismo.**

## 2. Parche A — exigir un hueco, y por qué no alcanza

El competidor tiene que estar separado de la banda por `g` anchos de banda:

| | `g=0` | `g=0.5` | `g=1.0` | `g=2.0` |
|---|---|---|---|---|
| QQQ 18-Sep PUT | 1.24x | 1.28x | **2.36x** | 3.15x |
| QQQ 16-Oct PUT | 1.05x | **1.89x** | 2.47x | 3.64x |
| SPY 16-Oct CALL | 1.50x | 1.50x | **2.93x** | 5.68x |
| TSLA 18-Sep CALL | 1.01x | 1.01x | 1.01x | 1.01x |

Funciona en el sentido trivial: aleja al competidor hasta que deja de ser la cola. Su única defensa
era que **el verdadero positivo del dataset sobrevive** —TSLA 18-Sep CALL no se mueve con ningún
hueco, porque sus dos concentraciones están a 2.5 anchos—.

**Esa defensa se cayó en la sección 5 de este mismo hallazgo:** TSLA 18-Sep CALL tampoco es un
verdadero positivo. El parche conserva intacto un falso negativo, que es lo peor que puede hacer.

## 3. Parche B — crecer la banda, que es el único que toca el borde

**Y acá aparece la parte del problema que la §61.4 no había visto.** Si la concentración es más
ancha que `W`, la ventana la parte y se queda con la mitad de adentro — **entonces el borde cae
DENTRO del muro**, que es exactamente lo que la §17 dice que no hay que hacer. El competidor
contiguo no es sólo un veredicto mal medido: es la señal de que el borde está mal puesto.

La banda crece hacia afuera mientras la rebanada contigua tenga al menos `f` de la densidad de la
banda **original** —la referencia tiene que ser fija: contra la banda ya crecida el criterio se
afloja solo y el crecimiento se dispara a bandas de 5 a 9 anchos—. Con `f = 0.60`:

```text
QQQ  18-Sep PUT    691-700  ->  682-700   x2     borde 691 -> 682
QQQ  18-Sep CALL   725-734  ->  725-752   x3     borde 734 -> 752
TSLA 18-Sep CALL   368-377  ->  368-405   x4     borde 377 -> 405
                                                 los otros nueve no crecen
```

Y **la restricción de la §61.3 pasa de 3 de 12 a 5 de 12**: los dos bordes que se corren caen a
delta 0.110 y 0.122, muy adentro del corte de 0.20. Eso es justo lo que la §99 le reclama a GOT —que
la estructura restrinja algo más que un corte de delta—.

**Se rechaza igual, por el parámetro.** Movimiento total del borde entre tandas, barriendo `f`:

| `f` | 0.90 | 0.80 | 0.70 | 0.65 | 0.60 | 0.55 | 0.50 | 0.45 |
|---|---|---|---|---|---|---|---|---|
| movimiento | 1.3 | **29.8** | **20.4** | 1.6 | 1.6 | **11.2** | 2.0 | 2.0 |

**Sube y baja sin orden.** No es que `f = 0.60` sea malo: es que está entre dos acantilados y que
0.55 —cinco centésimas más abajo— multiplica la inestabilidad por siete. Un parámetro así no se
calibra con 12 casos; es el mismo motivo por el que el 26 se rechazó el anclaje a la grilla.

El mecanismo es claro: en un estante plano, que la regla absorba una rebanada más o no depende de
decimales, y entre dos fotos la decisión se da vuelta. QQQ 18-Sep CALL —la meseta— aporta $19.1 de
los $29.8.

## 4. Los dos parches inflan `xdisj` por construcción

Vale anotarlo junto porque es la pista que lleva a la sección 5. **A** aleja al competidor hasta que
deja de competir; **B** se lo come. Los dos suben el número sin agregar una sola observación nueva
sobre la cadena. Cuando dos arreglos independientes mejoran una métrica sin medir nada nuevo, lo que
está mal no es lo que se está arreglando: es la métrica.

## 5. El diagnóstico: `xdisj` mide el cociente y la pregunta es el valle

`xdisj` compara **la masa** de la banda contra **la masa** de la mejor ventana disjunta, y de ahí
concluye "hay un muro" o "hay dos empatados". Pero dos masas iguales **sin nada entre ellas** son
una losa ancha, y dos masas iguales **con un valle entre ellas** son dos muros. `xdisj` no puede
distinguirlas, porque no mira el medio.

`xvalle` sí: la densidad de la rebanada más vacía que entra **entera** entre la banda y su
competidor, relativa a la densidad de la banda. Sobre las 12 combinaciones:

```text
Valles de verdad (xvalle < 0.25):  0 de 12

   8 casos    contiguos: no hay lugar ni para una rebanada. No es un valle de cero --
              es que no hay valle, y son un solo objeto.
   4 casos    con lugar, y sin valle: 0.28, 0.53, 0.64 y 0.74 de la densidad de su banda.

  El valle más profundo de todo el dataset tiene el 28% de la densidad de su banda.
```

**Y ahí cae el ejemplo 2 de la §61.7.** TSLA 18-Sep CALL era *"el primer 'no hay muro' del dataset
trabajado de punta a punta"*: `xmed` 8.3x, `xdisj` 1.01x, dos concentraciones a $30 una de otra.
Pero entre esas dos concentraciones hay un estante con el **64%** de la densidad de la banda:

```text
370   1115      375    406      380    819      385    238
390    765      395    255      400   1296      405    263
```

Entre las dos "concentraciones" no hay una sola ventana de 9 puntos que baje del **64%** de la
densidad de la banda. **No son dos muros con un valle entre medio: es un estante de $35 con
ondulaciones.** El 1.01x no decía "dos muros empatados",
decía "medí dos pedazos del mismo estante y pesan igual" — que es lo que uno esperaría.

**Conclusión: `xdisj` no tiene un solo positivo verdadero en el dataset.** Todos sus valores bajos
son la banda contra su propia cola (10 casos) o contra un estante sin hueco (2 casos). No es que
haga falta un umbral mejor: hace falta otra pregunta.

---

## 6. Qué queda

* **`xvalle` reemplazaría a `xdisj`**, y es barato — sale de los mismos datos. Pero **tampoco se
  puede calibrar**: con cero valles observados no hay contra qué fijar el umbral. Es la misma
  situación que dejó el hallazgo del 26 con `xmed`, y por la misma razón de fondo: el dataset no
  tiene fallas que atrapar.
* **El borde sigue mal puesto cuando la concentración es más ancha que `W`.** Es el hallazgo
  incómodo de esta ronda: no es un problema de veredicto, es de dónde se vende, y vale hasta $28 de
  strike (TSLA 18-Sep CALL: 377 contra 405). Crecer lo arregla y no es adoptable. Queda abierto, y
  ahora anotado como problema de borde y no de test.
* **`W` sigue sin calibrar**, y este hallazgo agrega una razón para que importe: si `W` es más
  angosto que las concentraciones reales, el borde queda sistemáticamente adentro del muro.
* **Nada de esto toca la §61.9.**
