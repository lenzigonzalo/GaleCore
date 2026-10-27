# GOT Studio V5
## Estado integral de la estrategia de opciones — TSLA / SPY / QQQ / SKM

> **Versión:** 5.0 · **Recibido:** 2026-08-24 · **Estado:** Sell Zone definida (61); la hipótesis
> única **medida y falsa** (61.9). No queda ninguna hipótesis abierta.
>
> Documento **vivo**: se edita en el lugar y la historia la guarda git. Las versiones 1 a 4 están
> congeladas en [versiones/](versiones/).
>
> **Corregido el 2026-08-24.** Las tablas de CALL de las secciones 25 y 27 leían la columna
> `pcsCredit_w5` de los datasets en vez de `ccsCredit_w5`, sobrestimando el crédito del lado call
> entre 6x y 16x. Recalculado desde los datos, el **Hallazgo 3 se invirtió** y aparecieron tres
> consecuencias que no estaban vistas. Las secciones afectadas ya están reescritas y llevan su
> propia nota: **25**, **27**, **28**, **31**, **39**, **53**, **54**, **83** y **98**, más las
> **43.1 a 43.5** que son nuevas.
> Las tablas de PUT (secciones 24 y 26) se verificaron correctas y no se tocaron.
>
> De ahí salió además una decisión de diseño que va más allá de la corrección: `RequiredCredit`
> resultó ser un **piso de riesgo y no un test de ventaja**, y baja de rango a piso de viabilidad.
> El gate económico real pasa a ser un **edge test** —probabilidad implícita contra empírica— que
> todavía no está implementado. Ver **43.2** y **43.3**.
>
> **Flujo redibujado el 2026-08-24.** La sección **47** se rehízo entera para que el diagrama diga
> lo que esas decisiones dejaron: seis niveles en vez de cuatro filtros en serie, la ventana de
> delta como una sola variable con dos cotas, el edge test dibujado como el gate económico que
> falta, y una marca por bloque para que se vea cuánto del flujo está definido. Las secciones
> **48**, **84** y **88**, que dibujan el mismo flujo desde otro ángulo, quedaron con errata
> apuntando ahí. La **47.1**, nueva, fija el alcance del bucle —vencimientos **regulares** con
> DTE ≤ 60— y de ahí sale que el `2026-09-04` sobre el que se validó medio v5 es un weekly que ese
> alcance excluye.
>
> Verificación completa, tablas recalculadas y consecuencias en
> [el hallazgo del 2026-08-24](hallazgos/2026-08-24-credito-call-columna-equivocada.md).
> Reproducible con [`scripts/recheck_econ.py`](scripts/recheck_econ.py).
>
> ---
>
> **La Sell Zone quedó definida el 2026-08-25, y el camino para llegar a ella cambió de fondo.** La
> **61** es ahora la definición canónica: el procedimiento paso a paso está en la **61.7**, un
> ejemplo trabajado sobre SPY 16-Oct al final de esa misma sección, lo que se descartó y por qué en
> la **61.8**, y lo único que falta para poder afirmar ventaja en la **61.9**.
>
> Lo que cambió: **la zona tenía dos condiciones y una no era estructural.** `d_min × EM` da
> ρ = −1.0000 contra el delta sobre las doce combinaciones del dataset, o sea que era un corte de
> delta escrito de otra manera — el mismo defecto que la 43.2 le encontró a `WD`, sobre la variable
> que lo había reemplazado. Y el muro de la otra condición **no era un objeto medible**: un argmax
> sobre un strike no es una concentración, nunca pasa del 19% del GEX de su lado y salta $40 en 48
> minutos. Pasa a ser una **banda** con dos tests de dominancia, y **"no hay muro" es un resultado
> válido**.
>
> Con eso, `WD` (**18**, **19**, **56.2**) y POP como gate de probabilidad (**37**) salen de la
> definición y llevan errata; la **16** queda superada por la 61; la **98** se reescribió entera; y
> la **99** lleva la corrección más incómoda: **hoy GOT sí es, casi enteramente, `SELL DELTA X`** —
> el borde de la banda restringe en 3 de 12 casos, los tres en SPY.
>
> Lo que no cambió es que sigue habiendo una hipótesis viva, y ahora es **una sola** (61.9). El muro
> no restringe, pero tampoco está en el precio: no hay premio de crédito en su borde una vez
> descontado el delta. Si frena el precio, es ventaja no cotizada; y eso solo se mide observando
> `t → t+Δ`, con del orden de 300 observaciones independientes.
>
> Evidencia, tablas y reproducción en
> [el hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md).
> Reproducible con [`scripts/banda_de_gamma.py`](scripts/banda_de_gamma.py).
>
> ---
>
> **La banda se terminó de construir el 2026-08-26.** Los tres defectos de construcción que la
> **61.4** había dejado anotados sin arreglar se midieron, y dos de ellos eran el mismo: la pila de
> gamma que siempre hay en el dinero, entrando a un cálculo que mide alas. **La banda excluye ahora
> la zona del dinero** —`|K − spot| ≥ 0.15 × EM`, del pool entero— y con eso el borde deja de
> moverse entre tandas: **$1.3 de movimiento total contra $16.1**, sobre diez series. El tercer
> defecto —la ventana continua sobre una grilla discreta— es real, pero **su arreglo se midió y se
> rechazó**: anclar la ventana a la grilla muda el redondeo en vez de sacarlo y empeora lo que venía
> a mejorar.
>
> Dos cosas escritas el 25 quedan corregidas: el único evento de inestabilidad del dataset (QQQ
> 18-Sep CALL, $15 de salto) **era el defecto, no una meseta**, así que ya no hay ninguna falla
> observada contra la cual calibrar los umbrales de `xmed` y `xdisj`; y el `xdisj` de 1.01x del
> ejemplo 1 de la **61.7** medía el muro contra el dinero — con el dinero afuera da **1.49x**.
> Ningún borde se mueve y el conteo de 3 de 12 no cambia. Secciones tocadas: **61.4**, **61.7**,
> **61.8** y **98**.
>
> [El hallazgo del 2026-08-26](hallazgos/2026-08-26-los-tres-defectos-de-la-banda.md), sección 6 del
> mismo script.
>
> ---
>
> **El 2026-08-27 se midió el defecto que quedaba —el competidor contiguo— y el resultado se llevó
> puesto un test.** No es un caso de borde: en **8 de 12** combinaciones el competidor está a menos
> de un ancho de banda, y en dos a un dólar. Los dos parches obvios se rechazaron —el hueco mínimo
> no mide nada nuevo; dejar crecer la banda arregla el borde pero su parámetro tiene acantilados
> entre valores vecinos—, y buscando por qué fallaban los dos apareció el fondo del asunto:
> **`xdisj` compara masas, y "un muro o dos" es una pregunta sobre el valle que hay en el medio.**
>
> Lo mide **`xvalle`**, y con él **el dataset no tiene un solo valle en 12 combinaciones**: `xdisj`
> no tiene ningún positivo verdadero. Se cae con eso el "no hay muro" de TSLA 18-Sep CALL (ejemplo 2
> de la **61.7**), que era el único del dataset: entre sus dos "muros a $30" hay un estante con el
> 64% de la densidad de la banda.
>
> Y queda anotado, en su lugar, un defecto que no se había visto y **es de borde y no de veredicto**:
> si la concentración es más ancha que `W`, la ventana la parte y **el borde cae adentro del muro**
> — hasta $28 de strike. Secciones tocadas: **61.4**, **61.7**, **61.8** y **98**.
>
> [El hallazgo del 2026-08-27](hallazgos/2026-08-27-el-competidor-contiguo-y-xdisj.md), sección 7 del
> mismo script.
>
> ---
>
> **El 2026-08-28 se cerró la serie, y con un negativo que ordena todo lo demás.** El defecto de
> borde que había quedado —la concentración más ancha que `W`— se probó por las tres salidas
> posibles y ninguna cierra: crecer de a un strike **sí** arregla la inestabilidad que hundió al
> parche del 27 (el problema era el tamaño del paso, no la idea) pero ata el borde a `W` más fuerte;
> desacoplar la resolución lo deja a la par de hoy; y la **dual** —masa fija, ancho mínimo, la única
> construcción sin `W`— es mucho peor.
>
> Las tres fallan por lo mismo, y es lo que no estaba escrito: **el borde nunca fue sólido.** Sobre
> las 12 combinaciones, mover `W` un ±20% corre el delta del borde hasta **0.174**, con un
> `delta_max` de **0.20**. `W` no es el ancho de una ventana: **es quien decide si la banda ata**. Y
> con eso se corrige el *"el borde es sólido: 800"* de la **61.7**, que era una generalización desde
> el único ejemplo trabajado hasta ese momento.
>
> **El borde no se cierra antes de calibrar `W`, y `W` está del otro lado de la 61.9.** Secciones
> tocadas: **61.4**, **61.7**, **61.8** y **98**.
>
> [El hallazgo del 2026-08-28](hallazgos/2026-08-28-el-borde-le-debe-todo-a-W.md), sección 8 del
> mismo script.
>
> ---
>
> **La 61.9 se midió el 2026-08-28, y da que no. Con eso GOT queda cerrado.** Sobre **926
> observaciones de lado** —SPY, QQQ e IWM de 2013 a 2025, banda a DTE 45 por el procedimiento de la
> **61.7**—, el borde de la banda **no cruza menos que su delta: cruza +0.025 más**. Y contra la
> curva empírica `P(terminar más allá | delta, lado)` construida sobre 26.678 strikes del mismo
> dataset, el borde **no se distingue de un strike cualquiera**: +0.010, IC [−0.019, +0.040]. El
> efecto que la estrategia necesita (−0.07) queda excluido, y el negativo no depende de `W` —el
> parámetro que el hallazgo anterior había dejado como bloqueante— ni de la ventana: el holdout
> limpio 2013–2017 da lo mismo.
>
> Vale entonces la disyuntiva de la propia **61.9**: *"se vende delta 0.25 a precio justo y GOT es
> el edge test de la 43.3 con más pasos"*. **`buffer`, `delta_max` por régimen, los umbrales de
> `xmed` y `xvalle` y `W` dejan de tener sentido**: los cinco esperaban a esta medición para
> calibrarse, y no hay nada que calibrar. Lo que sobrevive es la maquinaria de medición y la curva
> empírica por lado, que son la mitad que le faltaba al edge test de la **43.3**.
>
> Secciones tocadas: **61.9** y **98**.
> [El hallazgo del 2026-08-28](hallazgos/2026-08-28-la-banda-no-predice.md), con la tabla de
> observaciones versionada en [`data/`](data/).
>
> *Fuera de esas secciones, el texto es el recibido el 2026-08-24 sin cambios de contenido. Se
> repararon además defectos de transcripción del archivo original: un fence sin cerrar que
> aplanaba los headings de las secciones 5.2 a 99, las tablas que habían quedado separadas por
> tabs, y un fragmento del script que generó el archivo pegado al final.*

**Fecha:** 24/08/2026  
**Estado:** Diseño avanzado / validación empírica en curso  
**Objetivo:** consolidar todo lo definido, probado y pendiente antes de cerrar la estrategia de GOT (GaleCore Options Trading Monitor).

---

# 1. Resumen ejecutivo

GOT evolucionó desde una estrategia relativamente simple de Put Credit Spreads hacia un **motor de decisión estructural y económico**, cuyo principio central es:

> **El mercado define dónde vender.  
> La option chain determina el candidato.  
> Las condiciones determinan cuándo alertar.**

La estrategia ya tiene una arquitectura bastante clara:

1. **Market Diagnostic**
2. **Market Structure**
3. **Sell Zones**
4. **Safety Strike / Candidate Generation**
5. **Real Option Chain Validation**
6. **Economic Validation**
7. **Candidate Ranking**
8. **Alert Engine**

La evolución más importante fue abandonar la idea de que un crédito mínimo fijo —por ejemplo `MinCredit = $80`— pueda funcionar de manera universal.

Los tests recientes con TSLA demostraron:

- un vencimiento corto puede tener una estructura excelente pero no pagar suficiente;
- un vencimiento largo puede ofrecer créditos aparentemente pequeños y seguir siendo económicamente atractivos;
- por lo tanto, el crédito debe evaluarse **relativamente al riesgo, DTE y distancia estructural**, no mediante un mínimo absoluto fijo;
- el Delta `0.10–0.20` **no quedó demostrado como ventana**: es el rango que se barrió, y lo que se observó es que la estructura corta arriba y la economía corta abajo, en un punto que depende del lado y del DTE (ver 28, corregida el 2026-08-24);
- el Delta `0.22` no necesariamente es malo: en los últimos tests fue eliminado principalmente por **Wall Distance**, lo que sugiere que el límite de Delta podría ser consecuencia de la estructura y no una regla artificial;
- la arquitectura final debería separar claramente **filtro estructural**, **filtro económico** y **ranking de candidatos**.

La estrategia está avanzada, pero todavía faltan definiciones importantes para poder considerarla cerrada y lista para backtesting sistemático.

---

# 2. Filosofía de la estrategia

## 2.1 Principio rector

GOT no debe intentar predecir hacia dónde irá el mercado.

La estrategia busca vender opciones en zonas donde:

- existe distancia suficiente respecto de la estructura de gamma;
- la probabilidad implícita de terminar ITM es suficientemente baja;
- el crédito compensa adecuadamente el riesgo asumido;
- existe liquidez suficiente;
- las condiciones generales del mercado permiten emitir una alerta.

No se busca:

- adivinar dirección;
- encontrar el strike que maximiza crédito;
- usar un score arbitrario;
- imponer un crédito mínimo absoluto;
- operar dentro de gamma walls.

---

# 3. Objetivo operativo de GOT V5

GOT V5 es conceptualmente un **sistema de detección y alerta**, no un sistema autónomo de ejecución.

Debe:

1. analizar el mercado;
2. identificar estructura;
3. construir zonas de venta;
4. generar candidatos;
5. validar estructura;
6. validar economía;
7. seleccionar/rankear candidatos;
8. emitir alerta cuando se cumplen las condiciones.

La ejecución queda fuera del motor.

La estrategia actual es **alerts-only**.

---

# 4. Instrumentos y estrategia base

La estrategia está pensada principalmente para índices y ETFs altamente líquidos, aunque se probó también sobre acciones.

Ejemplos utilizados:

- SPY
- QQQ
- TSLA
- SKM

La estructura de la estrategia debe ser suficientemente general como para no depender de un símbolo específico.

---

# 5. Tipo de operación

La operación base es un **credit spread definido**.

## 5.1 Put Credit Spread

Se vende un PUT OTM y se compra un PUT más lejano.

Ejemplo conceptual:

```text
Sell PUT K1
Buy  PUT K2

K2 < K1 < Spot

```

El riesgo máximo es:

```text
MaxLoss = Width - Credit

```

## 5.2 Call Credit Spread

Se vende un CALL OTM y se compra un CALL más lejano.

```text
Sell CALL K1
Buy  CALL K2

Spot < K1 < K2

```

Riesgo máximo:

```text
MaxLoss = Width - Credit

```
# 6. Parámetros históricos y evolución
## 6.1 Estrategia inicial

La primera versión utilizaba aproximadamente:

DTE ~45 días;

POP ~85%;

salida al 50% de beneficio;

Put Credit Spread;

crédito mínimo fijo;

ancho relativamente pequeño respecto del riesgo.

Se observó que la estrategia podía ser razonablemente consistente, pero con rentabilidad limitada.

# 7. Evolución hacia V2

Se abandonó la idea de depender de una predicción direccional.

La lógica se simplificó a:

```text
DEFINIR SAFETY DELTA
        ↓
IDENTIFICAR STRIKE
        ↓
CALCULAR ENTRY DELTA

```
Posteriormente se incorporaron gamma walls y estructura de mercado.

# 8. Parámetros duros que fueron considerados

En etapas anteriores se utilizaron:

Max Risk: $400

Min Credit: $80

POP >= 80%

Delta entre 0.10 y 0.20

no vender dentro de gamma walls

probar primero width de 1 strike

eventualmente permitir hasta 2 strikes

Estos parámetros no deben considerarse todos definitivos.

En particular:

MinCredit = $80 fue invalidado como parámetro universal.

# 9. V3 — arquitectura conceptual

La arquitectura V3 estableció:

Market Diagnostic
Métricas:

IV

IV Rank

IV Momentum

```text
RV

GEX

```

Gamma Regime

Z-score

EMA / trend

ZGL

Expected Move

Resultado:

```text
FAVORABLE
SELECTIVE
NO OPERATE

```
# 10. Market Diagnostic

El diagnóstico no decide directamente qué lado vender.

Su función es determinar si el entorno es:

FAVORABLE
Condiciones suficientemente buenas para buscar oportunidades normalmente.

SELECTIVE
Se permite buscar oportunidades, pero con filtros más exigentes.

NO OPERATE
No se generan alertas.

# 11. Directional Z-score

Se definió un diagnóstico direccional basado en candles.

La normalización utiliza la volatilidad implícita ATM convertida a volatilidad diaria.

Conceptualmente:

dailySigma = ivAtm / sqrt(252)
y el movimiento observado se compara contra dicha sigma.

Guardas:

```text
si candles < 6 → z = 0
si ivAtm <= 0 → z = 0

```
Umbrales:

|z| < 1.0

    Neutral

1.0 <= |z| < 1.5
    Moderate

|z| >= 1.5

    Extreme
Estos umbrales fueron definidos, pero todavía requieren validación estadística más amplia.

# 12. Market Structure

Una vez superado el diagnóstico, se obtiene:

Spot

ZGL

Call Wall

Put Wall

Net GEX

Expected Move

GEX por strike

# 13. Gamma Walls
## 13.1 Call Wall

Se definió como el strike donde existe la mayor concentración relevante de gamma positiva del lado CALL.

## 13.2 Put Wall

Se definió como el strike donde existe la mayor concentración relevante de gamma negativa del lado PUT.

La intención es utilizar las walls como zonas estructurales, no como niveles exactos de soporte/resistencia.

# 14. ZGL

ZGL es el nivel estructural central utilizado por GOT.

Debe utilizarse como referencia adicional para evaluar:

distancia del candidato;

relación entre Spot y estructura;

ubicación de Sell Zones;

contexto de gamma.

ZGL no debe utilizarse como un simple target de precio.

# 15. Expected Move

El Expected Move se utiliza como referencia de dispersión esperada.

Ejemplo:

Spot = 355.10
Expected Move = ±25.7
Esto produce un rango:

329.4 → 380.8
El Expected Move no es una garantía de precio ni un límite absoluto.

Es una referencia probabilística derivada de la volatilidad implícita.

# 16. Sell Zones

> **Superada el 2026-08-25.** La definición vigente es la **61**, y el procedimiento paso a paso la
> **61.7**. Lo de acá abajo quedó en dos cosas: `Strike < Put Wall` / `Strike > Call Wall` con el
> muro entendido como **un strike**, que no es un objeto medible (61.4), y una lista de siete
> validaciones "posteriores" que trataba como etapas en serie lo que resultó ser una sola variable
> —`WD`, delta, `d_min × EM` y `RequiredCredit` acotan todas el mismo eje (43.2, 61.3)—. Se
> conserva como historia del diseño.

Las Sell Zones convierten la estructura de mercado en zonas candidatas.

## 16.1 PUT Sell Zone

Generalmente:

Strike < Put Wall
Pero no todo strike debajo del Put Wall es automáticamente vendible.

Debe pasar:

distancia estructural;

delta;

crédito;

RequiredCredit;

POP;

liquidez;

riesgo máximo.

## 16.2 CALL Sell Zone

Generalmente:

Strike > Call Wall
Con las mismas validaciones posteriores.

# 17. Gamma Exclusion Zone

No se debe vender dentro de una gamma wall o demasiado cerca de ella.

Esto llevó al desarrollo de Wall Distance.

# 18. Wall Distance — definición

> **Descartada el 2026-08-25.** `WD` **no es una variable independiente**: dentro de un vencimiento
> es una cota de delta. Lo mostró la 43.2 comparándola con la ventana de delta, y lo confirmó la
> medición de ρ sobre `distancia/EM` — **−1.0000 exacto en las doce combinaciones** del dataset
> ([hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md), §0). El muro solo aporta
> un offset constante. La zona ya no la usa: ver 61.3 y la tabla de descartes de la 61.8.

Wall Distance mide la separación del strike respecto de la gamma wall correspondiente, normalizada por Expected Move.

PUT
WD_put =
(PutWall - Strike) / ExpectedMove
CALL
WD_call =
(Strike - CallWall) / ExpectedMove
Ejemplo:

Put Wall = 330
Strike = 315
Expected Move = 59.7

WD = (330 - 315) / 59.7
   = 0.251
# 19. WD mínimo

> **Descartado el 2026-08-25**, junto con `WD` (ver la errata de la 18). `WD_min = 0.20` era un
> corte de delta con otro nombre, y por eso "todavía necesita validación histórica" nunca iba a
> poder cumplirse: no hay nada propio que validar. Lo que la zona declara hoy es un `delta_max`
> único, en delta, y una sola vez (61.3).

En los tests recientes se utilizó:

WD >= 0.20
como filtro estructural.

Interpretación:

```text
WD < 0.20 → demasiado cerca de wall → NO

WD >= 0.20 → estructuralmente permitido

```

Este valor todavía necesita validación histórica.

No debe considerarse definitivamente optimizado.

# 20. Safety Strike

Dentro de la Sell Zone se buscan strikes que:

estén fuera de gamma wall;

tengan Delta suficientemente bajo;

tengan distancia suficiente;

tengan crédito razonable;

tengan liquidez.

El Safety Strike no es necesariamente el strike con menor Delta.

Es el strike que logra un equilibrio aceptable entre:

Safety
+
Economics
# 21. Delta

Delta se utiliza como proxy de probabilidad de terminar ITM.

Para PUT:

putDelta < 0
Se trabaja con:

abs(putDelta)
Para CALL:

callDelta > 0
# 22. Entry Delta Window

La hipótesis histórica fue:

0.10 <= Delta <= 0.20
Posteriormente se decidió testear:

0.10
0.12
0.15
0.18
0.20
0.22
# 23. Resultado del Delta Sweep — TSLA

Se analizaron dos vencimientos:

4 Sep 2026
Spot: 355.10

DTE: 11

Net GEX: +$3B

ZGL: 353

Call Wall: 360

Put Wall: 345

Expected Move: ±25.7

16 Oct 2026
Spot: 356.70

DTE: 56

Net GEX: -$2B

ZGL: 364

Call Wall: 400

Put Wall: 330

Expected Move: ±59.7

# 24. Resultado — TSLA 4 Sep PUT

Candidatos aproximados:

| Target Delta | Strike | Actual Delta | WD | Credit |
|---|---|---|---|---|
| 0.10 | 325 | .0996 | .778 | $0.36 |
| 0.12 | 327.5 | .1172 | .681 | $0.43 |
| 0.15 | 330 | .1365 | .584 | $0.53 |
| 0.18 | 335 | .1832 | .389 | $0.76 |
| 0.20 | 337.5 | .2103 | .292 | $0.86 |
| 0.22 | 337.5 | .2103 | .292 | $0.86 |

Resultado:

Ningún candidato pasó el filtro económico.

Conclusión:

El problema del 4 Sep PUT no es encontrar el Delta correcto; el vencimiento simplemente no paga suficiente para el riesgo exigido por el modelo.

# 25. Resultado — TSLA 4 Sep CALL

> **Sección corregida el 2026-08-24.** La versión original leía la columna `pcsCredit_w5`
> del dataset en vez de `ccsCredit_w5`, con lo que los créditos estaban sobrestimados
> entre 6x y 11x, y concluía que todos los candidatos pasaban. Ver
> [el hallazgo](hallazgos/2026-08-24-credito-call-columna-equivocada.md).

Crédito del vertical de $5 del lado CALL, con el `RequiredCredit` que le corresponde a
cada candidato por DTE 11 y su WD:

| Target Delta | Strike | Actual Delta | WD | Credit | Required | Cushion | Resultado |
|---|---|---|---|---|---|---|---|
| 0.10 | 395 | .1057 | 1.362 | $0.29 | $0.72 | −59.8% | falla |
| 0.12 | 392.5 | .1188 | 1.265 | $0.33 | $0.72 | −54.2% | falla |
| 0.15 | 387.5 | .1502 | 1.070 | $0.47 | $0.72 | −34.8% | falla |
| 0.18 | 382.5 | .1893 | .875 | $0.63 | $0.74 | −14.7% | falla |
| 0.20 | 382.5 | .1893 | .875 | $0.63 | $0.74 | −14.7% | falla |
| 0.22 | 380 | .2121 | .778 | $0.69 | $0.75 | −8.3% | falla |

Resultado:

Ningún candidato pasó el filtro económico.

Conclusión:

Combinado con la sección 24, el 4 Sep **falla de los dos lados**: los cinco candidatos
PUT y los cinco CALL quedan por debajo de su `RequiredCredit`.

No es un vencimiento bueno de un lado y malo del otro. Es un DTE corto que no paga en
ninguno: con `DTEFactor = sqrt(30/11) = 1.65`, el modelo exige del orden de $0.72 a $0.90
sobre width 5, y la cadena de 11 días no lo ofrece a ningún delta razonable de ninguno de
los dos lados.

El comportamiento es además **monótono en la dirección esperada**: el Cushion mejora al
subir el delta (de −59.8% en 0.10 a −8.3% en 0.22), o sea que el candidato menos malo es
el más agresivo. Un vencimiento que solo se vuelve viable acercándose al spot no es un
vencimiento viable.
# 26. Resultado — TSLA 16 Oct PUT


| Target Delta | Strike | Actual Delta | WD | Credit |
|---|---|---|---|---|
| 0.10 | 295 | .1070 | .586 | $0.46 |
| 0.12 | 300 | .1253 | .503 | $0.50 |
| 0.15 | 305 | .1445 | .419 | $0.65 |
| 0.18 | 310 | .1674 | .335 | $0.75 |
| 0.20 | 315 | .1925 | .251 | $0.90 |
| 0.22 | 320 | .2196 | .168 | $1.00 |

Resultado:

```text
0.10 → pasa

0.12 → pasa

0.15 → pasa

0.18 → pasa

0.20 → pasa

0.22 → falla WD

```

Este fue uno de los resultados más importantes.

# 27. Resultado — TSLA 16 Oct CALL

> **Sección corregida el 2026-08-24.** La versión original leía la columna `pcsCredit_w5`
> del dataset en vez de `ccsCredit_w5`, con lo que los créditos estaban sobrestimados
> entre 6x y 16x, y concluía que pasaban cinco de seis. Ver
> [el hallazgo](hallazgos/2026-08-24-credito-call-columna-equivocada.md).

| Target Delta | Strike | Actual Delta | WD | Credit | Required | Cushion | Resultado |
|---|---|---|---|---|---|---|---|
| 0.10 | 450 | .1098 | .838 | $0.21 | $0.36 | −41.6% | falla |
| 0.12 | 445 | .1192 | .754 | $0.20 | $0.37 | −45.4% | falla |
| 0.15 | 430 | .1569 | .503 | $0.35 | $0.38 | −9.1% | falla |
| 0.18 | 425 | .1725 | .419 | $0.40 | $0.40 | −0.1% | empata |
| 0.20 | 415 | .2064 | .251 | $0.55 | $0.46 | +20.0% | **pasa** |
| 0.22 | 410 | .2260 | .168 | $0.60 | — | — | falla WD |

Resultado:

```text
0.10 → falla economico
0.12 → falla economico
0.15 → falla economico
0.18 → empata
0.20 → pasa
0.22 → falla WD
```

Conclusión:

**Acá sí aparece la asimetría entre lados**, pero al revés de lo que decía la versión
original: el mismo vencimiento pasa 5 de 6 del lado PUT (sección 26) y 1 de 6 del lado
CALL. Y no es un accidente de este vencimiento — es **skew**. A delta equivalente:

```text
put delta .1070 -> $0.46      call delta .1098 -> $0.21
put delta .1925 -> $0.90      call delta .2064 -> $0.55
```

Las puts pagan aproximadamente el doble que las calls equidistantes, que es el
comportamiento normal de la superficie de volatilidad de un equity.

Por lo tanto la unidad de evaluación sigue siendo:

Expiration × Side × Strike

pero el motivo cambia. El lado no importa porque un vencimiento sea caprichosamente mejor
de un lado; importa porque **la cadena cotiza los dos lados a precios distintos por la
misma probabilidad**. Eso tiene una consecuencia sobre el diseño del filtro económico que
se trata en la sección 43.

**Nota sobre el rango de delta.** El candidato que pasa es el de delta 0.2064 —el más
alto que sobrevive a WD—, y los de delta bajo fallan por economía. Del lado call la
ventana queda apretada por los dos extremos a la vez: la estructura elimina los deltas
altos y la economía elimina los bajos. Del lado put, con DTE 56, los deltas bajos pasan
sin problema. La ventana de delta **no es la misma de los dos lados**, que es otra forma
de ver lo mismo.

# 28. Conclusión del Delta Sweep

El test NO demuestra que:

0.10–0.20
sea una ley universal.

Lo que demuestra es algo más interesante:

El límite superior de la ventana no es una regla de delta: es la estructura.

En particular:

Delta 0.22
    ↓
mayor crédito
    ↓
menor WD
    ↓
puede ser eliminado por Wall Distance
Por eso no conviene imponer todavía:

MaxDelta = 0.20
como regla fundamental.

> **Revisado el 2026-08-24.** La versión original afirmaba que *"la zona 0.10–0.20 aparece
> naturalmente como una región robusta"*. Con los créditos de CALL corregidos esa
> afirmación **no se sostiene tal cual**, porque descansaba en que los seis candidatos CALL
> del 4 Sep y cinco de los seis del 16 Oct pasaran. Ninguno de esos dos hechos es cierto.

Lo que queda demostrado, más acotado:

- **El límite superior sí sale de la estructura.** El delta 0.22 cae por WD en los cuatro
  sweeps, de los dos lados y en los dos vencimientos. Ese es el hallazgo firme.
- **El límite inferior lo pone la economía, y no es simétrico.** Del lado PUT con DTE 56 el
  delta 0.10 pasa cómodo (+21.5%); del lado CALL, con el mismo vencimiento y el mismo WD
  mínimo, falla por −41.6%. La misma ventana de delta no rinde igual de los dos lados.
- **Con DTE corto no hay ventana en absoluto.** En el 4 Sep no pasa nada, a ningún delta,
  de ningún lado.

O sea que `0.10–0.20` no es una región robusta observada: es el rango que se barrió. Lo
que se observó es que la estructura corta arriba y la economía corta abajo, y que dónde
corta abajo depende del lado y del DTE. La ventana efectiva es una consecuencia, no un
parámetro — que es la tesis de la sección 93, ahora con menos evidencia a favor de la que
se creía tener.

# 29. Nueva hipótesis de Delta

La hipótesis actual más sólida es:

Core Candidate Window
0.10 <= Delta <= 0.20
Extended Candidate Window
Explorar:

0.20 < Delta <= 0.25
siempre que el candidato pase:

WD >= WD_min
Credit >= RequiredCredit
POP >= POP_min
Liquidity >= Liquidity_min
Risk <= MaxRisk
Así, Delta 0.22 no se rechaza arbitrariamente.

Se rechaza si la estructura lo hace inviable.

# 30. Crédito — evolución conceptual

El parámetro:

MinCredit = $80
queda descartado como regla universal.

Motivo:

Un crédito nominal de $80 puede ser:

excelente en un vencimiento largo;

insuficiente en otro;

demasiado exigente en un DTE corto;

irrelevante dependiendo del width y riesgo.

Por lo tanto, el crédito debe ser relativo.

# 31. RequiredCredit

La estrategia evolucionó hacia:

Credit >= RequiredCredit
en lugar de:

Credit >= MinCredit
El RequiredCredit depende de:

width;

DTE;

Wall Distance;

requerimiento base de retorno.

> **Ojo con el rol de esto (decidido el 2026-08-24, ver 43.2 y 43.3).** `RequiredCredit`
> **no es el gate económico de la estrategia.** Traducido a `Credit/Width` resulta ser un
> umbral de probabilidad risk-neutral de pérdida, o sea un **piso de riesgo**: exigir más
> crédito es exigir más riesgo. No mide ventaja en ningún punto.
>
> Queda como **piso de viabilidad** —¿paga comisiones, slippage y el capital
> inmovilizado?—, que es una pregunta legítima pero secundaria. El gate económico real es
> el edge test de la sección 43.3, que todavía no está implementado.

# 32. Modelo conceptual de RequiredCredit

Se utiliza:

BaseRR = 0.12
y:

DTEFactor = sqrt(30 / DTE)
Luego se ajusta por Wall Distance.

La intención es:

```text
DTE corto → exigir mayor compensación;

DTE largo → permitir menor crédito absoluto;

menor WD → exigir mayor compensación;

mayor WD → aceptar menor compensación.

```

# 33. WDFactor utilizado en los tests

Tabla de referencia:

| WD | WDFactor |
|---|---|
| 0.20 | 1.20 |
| 0.30 | 1.10 |
| 0.40 | 1.00 |
| 0.50 | 0.95 |
| 0.75 | 0.90 |
| >= 1.00 | 0.85 |

Interpolación entre puntos.

La intención es que el modelo reconozca que una posición más alejada de la wall requiere menor compensación relativa.

# 34. Fórmula de RR requerido

El requerimiento conceptual parte de:

RRreq = BaseRR × DTEFactor × WDFactor
Luego:

RequiredCredit =
Width × RRreq / (1 + RRreq)
Esta formulación convierte un retorno requerido sobre el capital en un crédito mínimo compatible con ese retorno.

# 35. Cushion

El Cushion mide cuánto supera el crédito real al mínimo económico requerido.

Cushion =
(Credit - RequiredCredit)
/
RequiredCredit
Interpretación:

Cushion < 0
    crédito insuficiente

Cushion = 0
    exactamente requerido

Cushion > 0
    crédito superior al mínimo económico
Ejemplo:

Credit = 0.90
RequiredCredit = 0.48

Cushion =
(0.90 - 0.48) / 0.48
= +87.5%
# 36. Importante: Cushion no debe ser el único ranking

Un candidato con Cushion enorme puede estar:

demasiado cerca del wall;

demasiado cerca del Spot;

con Delta elevado;

con liquidez mediocre.

Por eso:

Cushion es un indicador económico, no el criterio único de selección.

# 37. POP

> **Acotada el 2026-08-25.** La sección ya avisaba que delta y "probabilidad real de éxito" no son
> lo mismo. La medición del 25 va más lejos y conviene dejarlo escrito acá: **POP, delta, Expected
> Move y densidad risk-neutral son el mismo objeto** — la distribución implícita en los precios, que
> es por construcción aquella bajo la cual ningún strike es favorable. Un `POP >= 80%` es un
> `delta <= 0.20` con otro nombre, y **no puede ser el gate de "probabilidad estructuralmente
> favorable"**: eso solo puede salir de la brecha contra la probabilidad **empírica** (el edge test
> de la 43.3) o del open interest, que no es un precio (61.8, 61.9).

POP continúa siendo una validación.

Parámetro histórico:

POP >= 80%
Debe mantenerse como filtro hasta completar más tests.

La relación aproximada utilizada conceptualmente es:

POP ≈ 1 - abs(Delta)
para una opción individual, aunque GOT debe utilizar el POP calculado por el chain/provider si está disponible.

No debe confundirse:

Delta
con:

probabilidad real de éxito del spread
Son relacionados pero no idénticos.

# 38. Width

Se había establecido:

probar width de 1 strike primero;

permitir hasta 2 strikes.

Width no debe ser necesariamente fijo.

Debe evaluarse porque:

Width
↓
Max Risk
↓
RequiredCredit
cambian conjuntamente.

Una futura versión debe comparar:

Width 1
Width 2
Width 3
...
según disponibilidad de strikes y riesgo máximo.

# 39. Max Risk

Parámetro histórico:

MaxRisk = $400
Debe validarse.

Para un spread:

MaxLoss = Width - Credit
por contrato, multiplicado por 100:

MaxLossUSD =
(Width - Credit) × 100
El candidato debe cumplir:

MaxLossUSD <= MaxRisk
si el MaxRisk se mantiene como límite absoluto.

> **Medido el 2026-08-24: con width 5 sobre TSLA, este filtro elimina absolutamente todo.**
> El maxloss de los 22 candidatos de los dos datasets va de $409 a $480 — ninguno entra en
> $400, incluidos los cinco del 16 Oct PUT que pasan economía y el de la sección 54.
>
> No es que los candidatos sean malos: es que `MaxRisk` en dólares y `Width` en strikes se
> calibraron por separado. En un subyacente de $355 el width de $5 ya produce un maxloss
> por encima del límite antes de mirar el crédito. Las salidas son ir a width 2.5 —y ahí
> el crédito se parte, así que todo el Cushion se recalcula— o mover el riesgo a un
> porcentaje del capital como plantea la sección 72.
>
> Esto convierte a `MaxRisk = $400` en el filtro **más restrictivo de los tres**, y hasta
> el recálculo nadie lo había notado porque se lo evaluaba después del económico y sobre
> candidatos que ya venían filtrados. Ver el Hallazgo 9.

> **Extendido el 2026-08-25: no es de TSLA, y no es un problema de calibración.**
>
> Sobre la tanda en sesión —tres símbolos, los dos vencimientos regulares del bucle, los dos
> lados, los tres objetivos de delta— **pasa 1 de 36 candidatos**. El maxloss va de $395 a
> $480. El único que entra es SPY `2026-10-16` del lado CALL, con $395 y **delta 0.215**: o
> sea que el único candidato que sobrevive a `MaxRisk` es uno que el techo de `WD` ya había
> descartado. Reproducible con
> [`scripts/maxloss_por_candidato.py`](scripts/maxloss_por_candidato.py).
>
> Y la aritmética muestra que **el umbral no tiene un valor bueno**, solo anchos donde es
> vacuo y anchos donde es letal. Con un ancho `w`, la pérdida máxima posible es `w × 100`:
>
> | Width | Qué hace `MaxRisk = $400` |
> |---|---|
> | 1.0 | maxloss máximo posible $100 — **no puede rechazar nada** |
> | 2.5 | maxloss máximo posible $250 — **no puede rechazar nada** |
> | 5.0 | exige `Credit/Width ≥ 0.20` → delta del short **≥ ~0.20** |
> | 10.0 | exige `Credit/Width ≥ 0.60` → delta del short **≥ ~0.60** |
>
> El paso de "no rechaza nada" a "exige delta 0.20" ocurre en `w = 4`, sin nada gradual en el
> medio. Y del lado donde corta, lo que impone es **un piso de delta** —porque `Credit/Width`
> no supera aproximadamente el delta del short leg— que compite de frente con el techo que le
> pone `WD`. Los dos filtros terminan pidiendo cosas contrarias sobre la misma variable, que
> es el mismo error de estructura que la 43.2 encontró entre `RequiredCredit` y `WD`.
>
> Por eso `MaxRisk` no se recalibra: **un límite en dólares absolutos no expresa el riesgo que
> uno quiere tomar**, es una consecuencia del ancho y del precio del subyacente. La salida es
> la de la 72 — riesgo como porcentaje del capital.

# 40. Liquidez

Todavía falta cerrar formalmente el filtro de liquidez.

El chain proporciona:

Bid

Ask

OI

Call OI

Put OI

Pero todavía no está completamente definida una regla GOT como:

minimum OI
maximum spread %
minimum bid
minimum volume
minimum liquidity score
Esto es una de las definiciones pendientes importantes.

# 41. Bid/Ask y crédito

El crédito utilizado debe estar basado en una metodología consistente.

No debe mezclarse:

mid;

bid;

ask;

crédito teórico;

crédito real de ejecución.

Debe definirse un estándar.

Una alternativa conservadora:

SpreadCredit =
ShortOptionBid - LongOptionAsk
Una alternativa más optimista:

SpreadCredit =
ShortOptionMid - LongOptionMid
GOT debe decidir cuál utiliza como:

filtro;

visualización;

alerta.

La recomendación actual es separar:

Indicative Credit
Conservative Credit
y utilizar el conservador para validar.

# 42. Market Regime

El Net GEX se utiliza para determinar el régimen gamma.

Conceptualmente:

Net GEX > 0
    positive gamma regime

Net GEX < 0
    negative gamma regime
Pero todavía falta definir exactamente cómo el régimen debe modificar:

WD mínimo;

Delta permitido;

RequiredCredit;

diagnóstico;

ranking.

No debería convertirse en una predicción direccional.

# 43. Market Bias

Decisión importante ya tomada:

GOT no debe depender de un Market Bias direccional para decidir PUT vs CALL.

El sistema debe poder evaluar ambos lados.

Puede utilizar diagnóstico para modificar selectividad, pero no debe decir:

```text
Bullish → solo PUT
Bearish → solo CALL

```
sin una validación independiente.

## 43.1 Pero el modelo actual sí tiene un sesgo, y entra por la puerta de atrás

> **Agregado el 2026-08-24**, a partir del recálculo de las secciones 25 y 27.

La decisión de arriba es sobre el **diagnóstico**: GOT no elimina un lado por una
predicción direccional. Eso se sostiene.

Lo que apareció al corregir los datos es que el sesgo se cuela igual, por el filtro
económico:

```text
RequiredCredit = f(Width, DTE, WD)
```

Ninguno de los tres argumentos sabe de qué lado de la cadena está el strike. El umbral es
**simétrico**. Pero la superficie de volatilidad **no lo es**: por skew, en un equity las
puts pagan del orden del doble que las calls equidistantes (sección 27). Aplicar un umbral
simétrico a un mercado asimétrico produce un sesgo estructural hacia el PUT.

Y no es teórico. En los datos de TSLA, con el mismo vencimiento, el mismo `WD_min` y el
mismo `RequiredCredit`:

```text
16 Oct PUT  -> pasan 5 de 6
16 Oct CALL -> pasa  1 de 6
```

**Con esta calibración GOT es un vendedor de puts de hecho**, aunque evalúe los dos lados
como manda esta sección. El sesgo no viene de una opinión sobre el mercado —que es lo que
la sección prohíbe— sino de un umbral que ignora de qué lado está mirando.

## 43.2 Qué es realmente `RequiredCredit`

> **Decidido el 2026-08-24.**

Antes de elegir cómo corregir el sesgo hay que ver qué está midiendo el filtro, porque eso
cambia cuál es la respuesta.

En un vertical, el crédito es el valor risk-neutral del spread. Dividido por el ancho:

```text
Credit / Width = perdida esperada risk-neutral, como fraccion del ancho
```

Es un número entre 0 y 1 que crece con el delta del short leg, y es **la probabilidad que
el mercado le pone a que la operación salga mal**. Traducido el `RequiredCredit` a esas
unidades:

```text
Credit / Width >= RRreq / (1 + RRreq)
```

| Caso | `Credit/Width` requerido |
|---|---|
| DTE 11, WD 0.30 | 0.179 |
| DTE 11, WD 0.60 | 0.156 |
| DTE 56, WD 0.30 | 0.088 |
| DTE 56, WD 0.60 | 0.076 |

De donde salen **dos conclusiones que no estaban vistas**:

**1. El filtro económico es un piso de riesgo, no un test de ventaja.** Dice: *tomá solo
operaciones donde el mercado asigne al menos 7.6% a 17.9% de probabilidad de perder*.
Exigir más crédito es exigir más riesgo, porque en un spread el retorno se compra con
probabilidad de pérdida. No mide edge en ningún momento — mide cuánto riesgo se está
tomando, y pide un mínimo.

**2. Con `WD_min` arriba, el motor entero es una banda de delta.** `WD` decrece
monótonamente con el delta y `Credit/Width` crece con el delta, así que:

```text
WD >= WD_min              -> techo de delta  (estructura)
Credit >= RequiredCredit  -> piso  de delta  (economia)
```

Los dos filtros que la sección 48 presenta como niveles distintos —Structural Gate y
Economic Gate— son, dentro de un vencimiento, **cotas de la misma variable**. Eso explica
la sección 28 sin misterio: la ventana de delta no emerge de nada, es la intersección de
dos cotas sobre delta.

## 43.3 La decisión

**Ninguna de las tres salidas planteadas, porque las tres contestan la pregunta
equivocada.** Preguntar si el umbral debe ser simétrico entre lados presupone que el
umbral mide lo correcto, y no lo mide de ningún lado.

Lo que se hace:

**a. `RequiredCredit` baja de rango: pasa a ser un piso de viabilidad, no el gate
económico.** La pregunta que sí contesta legítimamente es *¿esta operación paga las
comisiones, el slippage y el capital inmovilizado?*. Para eso **se queda simétrico**,
porque es una restricción del negocio y no una afirmación sobre el mercado: al bróker le
da igual de qué lado de la cadena está el strike.

**b. El gate económico de verdad es un test de edge**, que hoy no existe:

```text
P(perdida) implicita en el credito     <- lo que cobra el mercado
        vs
P(perdida) empirica de ese (lado, delta, DTE)   <- lo que pasa en realidad

edge = la diferencia
```

Eso es el VRP, y es **lo único que puede decir si la operación gana plata**. Es lo que RPF
ya hace con su tabla POP calibrada, y lo que a GOT le falta por completo.

**c. Con el edge test, la pregunta del skew se disuelve en vez de contestarse.** Un test
que compara probabilidad implícita contra probabilidad empírica **es side-aware por
construcción y sin un solo parámetro nuevo**: si las calls pagan menos a delta igual pero
también fallan menos a delta igual, el edge se empareja solo; y si pagan menos y fallan lo
mismo, el lado call queda descartado por los datos y no por una constante que alguien
eligió. El skew deja de necesitar tratamiento explícito porque queda absorbido en el lado
empírico de la comparación.

Por eso la salida 2 —un `BaseRR` por lado— es la peor de las tres: hornea la forma de una
superficie de volatilidad dentro de una constante, donde nadie la va a volver a mirar.

## 43.4 Qué NO se hace, y por qué

**No se declara put-only, y no se toca ningún parámetro todavía.** El motivo es que toda la
evidencia del sesgo viene de **un símbolo, un día, dos vencimientos** — y de un símbolo con
una superficie atípica.

TSLA tiene demanda especulativa de calls que le levanta el ala derecha; SPY y QQQ, que son
el universo declarado en la sección 4, tienen put skew fuerte y ala de call plana o
declinante. Son formas distintas. La asimetría medida acá:

```text
TSLA: (Credit/Width) / delta  ->  PUT ~0.72-0.94   CALL ~0.34-0.67
```

no es trasladable, y calibrar un parámetro por lado con esta muestra sería exactamente lo
que la sección 81 prohíbe: *optimizar sobre un único símbolo y considerarlo definitivo*.

**Predicción falsable, para hacer antes que cualquier otra cosa:** correr el mismo sweep
sobre SPY y QQQ. Si el sesgo es de la superficie de TSLA y no del modelo, la brecha entre
lados tiene que ser **marcadamente menor** que la de arriba. Si en cambio se repite igual
en los tres, entonces es del modelo y hay que atacarlo antes del backtest.

Es barato: es el mismo `gex-strikes.ps1` con otro símbolo.

> **Corrido el mismo día. La predicción se quedó corta: el signo se invierte.**
>
> Midiendo cuánto paga cada lado por unidad de delta, `(Credit/Width) / |delta|`, sobre los
> mismos dos vencimientos en los tres símbolos:
>
> | Símbolo | Vencimiento | PUT | CALL | CALL/PUT |
> |---|---|---|---|---|
> | SPY | 2026-09-04 · weekly | 0.53 | 0.89 | **1.69** |
> | SPY | 2026-10-16 · regular | 0.49 | 0.95 | **1.92** |
> | QQQ | 2026-09-04 · weekly | 0.55 | 0.88 | **1.60** |
> | QQQ | 2026-10-16 · regular | 0.54 | 0.84 | **1.53** |
> | TSLA | 2026-09-04 · weekly | 0.78 | 0.61 | **0.79** |
> | TSLA | 2026-10-16 · regular | 0.90 | 0.46 | **0.51** |
>
> Promediando los dos vencimientos de cada símbolo: SPY **1.81**, QQQ **1.57**, TSLA **0.65**.
> Es el par de números que citan la 43.5 y el README, y sale de esta tabla.
>
> **La tabla va por vencimiento y no por símbolo, y eso es el arreglo de un defecto real.**
> Hasta el 2026-08-25 esta sección mostraba solo los tres promedios, y el promedio **depende de
> qué archivos hay en la carpeta**: `skew_por_lado.py` levanta todos los CSV que encuentra. El
> `2026-09-18` se capturó al final del mismo día 24, después de escrita la tabla, así que correr
> hoy el script sobre su propia carpeta da SPY 1.77 y QQQ 1.54 — no porque cambiara ningún dato,
> sino porque cambió el denominador. Un número publicado que no se reproduce corriendo lo que dice
> que lo produjo es un número que nadie puede auditar. Por vencimiento, cada fila es de un archivo
> y no se mueve.
>
> Y de paso deja a la vista lo que el promedio escondía: **la mitad de la muestra es un weekly**,
> que el bucle de la 47.1 no recorre. La dirección no cambia —los seis cocientes van para el mismo
> lado— pero el número exacto de SPY y QQQ se apoya mitad y mitad en un tipo de contrato que la
> estrategia no opera.
>
> Reproducible, fila por fila, con:
>
> ```bash
> python research/got/scripts/skew_por_lado.py 2026-08-24
> ```
>
> En el universo declarado el filtro económico simétrico **sesga hacia CALL**, no hacia PUT.
> Verificado también con mid en vez de bid/ask, para descartar el horario de captura.
> Detalle y mecanismo en
> [el hallazgo](hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md).
>
> Refuerza esta sección más de lo que se esperaba: la salida 2 —un `BaseRR` por lado
> calibrado sobre TSLA— no habría sido un parámetro subóptimo, habría tenido **el signo
> cambiado** para los símbolos que la estrategia opera.

> **Recapturado en sesión el 2026-08-25. El sesgo aguanta, y el pendiente queda cerrado.**
>
> Quedaba la objeción de que SPY y QQQ se habían cotizado **después del cierre**, con un book más
> ancho que castiga de manera despareja al crédito conservador. La recaptura va entre las 10:09 y
> las 10:23 ET, con el mercado abierto, sobre los dos vencimientos **regulares** del bucle:
>
> | Símbolo | Vencimiento | 24-ago · post-cierre | 25-ago · en sesión |
> |---|---|---|---|
> | SPY | 2026-09-18 | 1.69 | **1.73** |
> | SPY | 2026-10-16 | 1.92 | **1.87** |
> | QQQ | 2026-09-18 | 1.47 | **1.36** |
> | QQQ | 2026-10-16 | 1.53 | **1.38** |
> | TSLA | 2026-10-16 | 0.51 | **0.56** |
> | TSLA | 2026-09-18 | — | **0.73** |
>
> El book se ajustó en los cuatro casos de SPY y QQQ —4.7% → 4.3%, 3.4% → 2.4%, 1.9% → 1.6%,
> 1.2% → 1.0%— y el sesgo no se movió de signo ni de escala. **La objeción del horario queda
> descartada.**
>
> Dos cosas más, que no se buscaban. **El cociente oscila hasta 0.15 de un día para el otro** en el
> mismo símbolo y vencimiento, así que ninguna calibración sobre esta métrica puede reclamar
> precisión más fina que eso. Y **la banda de quotes truncó la primera captura de TSLA**: con el
> ±12% que alcanza para SPY, los tres objetivos de delta cayeron en el mismo strike y el cociente
> se leyó 0.67 en vez de 0.56. Detalle en
> [el hallazgo](hallazgos/2026-08-25-el-sesgo-aguanta-con-book-vivo.md).

## 43.5 Estado interino

> **Reescrita el 2026-08-24**, unas horas después de la versión original. Esa versión decía
> que GOT queda *"put-biased por construcción, y declarado"*, y era falso: se había medido
> sobre TSLA, cuya superficie va al revés que la del universo declarado. Ver
> [el hallazgo](hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md).

> **Errata del 2026-08-27 — el mecanismo, no el hecho.** Lo que esta sección afirma sobre *qué*
> pasa sigue en pie: el sesgo reproduce por tercera vez (SPY 1.77, QQQ 1.50, TSLA 0.64) y su
> dirección depende del símbolo. Lo que no se sostiene como está escrito es el **mecanismo**. Con
> la IV por strike ya medible, el **nivel** de IV resulta ir al revés del sesgo en los tres
> símbolos, y la **pendiente entre las dos patas del vertical** —que es la lectura operativa de
> *"la pendiente local de la superficie"*— explica SPY y QQQ pero **tiene el signo equivocado en
> TSLA**, el caso de control. Lo que sí sigue al sesgo en los seis casos es cuánto delta abarca el
> spread de cada lado, y no es un artefacto del ancho. La frase de abajo no está refutada, pero su
> proxy natural sí. Ver
> [el hallazgo](hallazgos/2026-08-27-el-sesgo-no-es-el-nivel-de-iv.md).

Hasta que exista el edge test:

* **GOT tiene un sesgo por lado, y su dirección depende del símbolo.** Sobre SPY y QQQ
  favorece al CALL (entre 1.5x y 1.9x por unidad de delta según el vencimiento, ver la tabla
  de la 43.4); sobre TSLA favorece al PUT. No es
  una propiedad del motor: es la pendiente local de la superficie de volatilidad,
  atravesando un umbral que no la mira.
* **Por eso el sesgo no se declara como constante ni se corrige con un factor.** No hay un
  número que declarar — cambia por símbolo, por vencimiento y en el tiempo. Se deja a la
  vista y se mide.
* Toda corrida mide **frecuencia de oportunidades por lado y por símbolo**, nunca agregada.
  Un motor que emite 90% de un lado y lo reporta como "12 alertas" está escondiendo el dato
  principal, y agregando los símbolos el sesgo de uno cancela el del otro y desaparece de la
  vista.
* **Los dos lados se siguen evaluando y registrando siempre.** Es la muestra que después
  calibra el edge test. Apagar un lado ahora garantiza no tener nunca con qué decidir si
  había que apagarlo — y como se vio, el lado que parecía descartable era el equivocado.
* **Las calibraciones se hacen sobre SPY y QQQ**, que es el universo de la sección 4. TSLA
  queda como caso de control: es útil tener un símbolo con la superficie invertida para
  detectar exactamente esta clase de error.

# 44. Alert Engine

La versión actual está pensada como alert-only.

El motor monitorea:

Entry Delta;

chain;

estructura;

condiciones;

aparición de candidato válido.

Cuando aparece una oportunidad:

ALERT
La alerta debe incluir como mínimo:

símbolo;

Spot;

vencimiento;

DTE;

side;

short strike;

long strike;

Delta;

WD;

Credit;

RequiredCredit;

Cushion;

POP;

Max Risk;

Call Wall;

Put Wall;

ZGL;

Expected Move;

Market Diagnostic;

motivo de aprobación.

# 45. Alertas por WebSocket

El sistema ya contempla monitoreo de Entry Delta mediante streaming/websocket.

La idea es:

Market Data
    ↓
Update Chain
    ↓
Recalculate Candidate
    ↓
Run Validations
    ↓
Candidate appears valid
    ↓
Alert
La alerta no implica ejecución.

# 46. Telegram

V3 estableció alertas destacadas en pantalla y envío a usuarios de Telegram.

La arquitectura debe evitar enviar repetidamente la misma alerta mientras el candidato permanece válido.

Debe existir una lógica de:

New Candidate
Candidate Changed
Candidate Invalidated
Candidate Re-entered
Esto todavía necesita formalización.

# 47. Flujo completo

> **Redibujado el 2026-08-24.** El dibujo anterior tenía `Credit >= RequiredCredit` como el filtro
> económico y `WD >= WD_min` como un filtro estructural independiente, uno después del otro. Las
> dos cosas se cayeron el mismo día: `RequiredCredit` no es el gate económico sino un piso de
> riesgo (43.2), y los dos filtros no son etapas independientes — dentro de un vencimiento son las
> **dos cotas de la misma variable**, el delta (43.2). Tenía además `MaxRisk` como una etapa suelta,
> cuando está acoplado a `Width` y con la calibración de hoy elimina el 100% de los candidatos (39).
> Se redibuja para que el diagrama diga lo que la estrategia decidió — **incluido lo que le falta**.

Marcas del diagrama: `[OK]` definido · `[~]` provisional o sin calibrar · `[ ]` no implementado ·
`[X]` reprobado con la calibración actual.

```text
                         MARKET DATA
              cadena + GEX + spot + IV                    [~] freshness sin definir (68)
                              |
                              v
   NIVEL 1 - MARKET GATE                        ¿el entorno permite buscar operaciones?
        MARKET DIAGNOSTIC                                 [~] z-score provisional (83)
        FAVORABLE  /  SELECTIVE  /  NO OPERATE            [ ] SELECTIVE sin cerrar (64)
                              |                           [ ] NO OPERATE sin cerrar (65)
            NO OPERATE -------+ corta acá
                              |
                              v
   POR CADA VENCIMIENTO REGULAR CON DTE <= 60   alcance inicial: sin weeklies,
        el bucle abre ACÁ, antes de la          sin 0DTE. Son 2 por símbolo el
        estructura (61.1)                       90% de los días (1 a 3)
                              |
                              v
   NIVEL 2 - ESTRUCTURA DEL VENCIMIENTO         ¿dónde estaría permitido vender?
        netGEX   ZGL   CALL WALL   PUT WALL   EM          [OK] régimen = signo(netGEX)
        TODO del vencimiento, NADA del agregado:               del vencimiento (61.1)
        los muros del agregado caen pegados al            [~] muro sin umbral de
        spot -- son el pin de hoy, no la pared                 dominancia (61.4, 66)
        del mes (61.1)                                    [~] ZGL: banda muerta sin
                              |                               calibrar (62.1)
                              v
        SELL ZONE del lado = pasar el muro  Y  d_min x EM
        ata la más restrictiva, no son etapas             [~] buffer y d_min sin
        en serie (61.3)                                       calibrar (61.3)
                              |                           [ ] la zona podría ser
                              |                               redundante con el delta,
                              |                               y del lado put HOY lo es
                              |                               (61.6) <-- puede matar todo
                              v
               +--------------+--------------+
               |                             |
               v                             v
             PUT                           CALL           los dos lados SIEMPRE (43.5)
               |                             |            se miden por separado,
               +--------------+--------------+            nunca agregados
                              |
                              v
   NIVEL 3 - LA VENTANA DE DELTA                una sola variable, dos cotas (43.2)

        delta  0.05 ------------------------------------------------> 0.35
                      [ piso ]                    [ techo ]
                      Credit >= RequiredCredit    WD >= WD_min
                      viabilidad del negocio:     estructura: distancia al muro
                      comisiones, slippage,       en unidades de Expected Move
                      capital inmovilizado
                      [OK] simétrico entre        [~] WD_min = 0.20 provisional
                           lados, a propósito         (es el corte que decide, 98)
                      [~] sin calibrar (43.3)

        banda vacía -> no hay candidato en ese (vencimiento, lado). No es un error.
                              |
                              v
   NIVEL 4 - CALIDAD DE LA OPCIÓN               ¿el candidato es ejecutable?
        OI   bid/ask   liquidez   slippage                [ ] sin definir (40, 41, 69)
                              |
                              v
   NIVEL 5 - RIESGO Y ANCHO                     el limite en dolares es funcion
        MaxLoss = (Width - Credit) x 100         del ancho, no del riesgo que
        MaxLoss <= MaxRisk                       uno quiere tomar
                              |                           [OK] la formula del MaxLoss
                              |                           [X] MaxRisk 400: con width 5
                              |                               pasa 1 de 36, con width
                              |                               <= 4 no rechaza nada (39)
                              |                           [ ] riesgo como % del capital (72)
                              v
   NIVEL 6 - EDGE TEST                          ¿la operación tiene ventaja?
                                                          <-- EL GATE ECONÓMICO
        P(pérdida) implícita en el crédito  =  Credit / Width
                            vs
        P(pérdida) empírica de ese (lado, delta, DTE)
        edge = implícita - empírica  >  0                 [ ] NO IMPLEMENTADO (43.3)
                              |                           [ ] falta la tabla empírica
                              v
        RANK CANDIDATES                                   [ ] sin criterio cerrado (49-51)
                              |
                              v
        BEST CANDIDATE
                              |
                              v
        ALERT    new | changed | invalidated | re-entered [ ] sin formalizar (46)
        alerts-only: la alerta no implica ejecución
                              |
                              v
        REGISTRO de frecuencia por lado y por símbolo (43.5)
```

**Tres cosas que este dibujo dice y el anterior no.**

**1. Los niveles 3 y 6 no son el mismo tipo de cosa, aunque los dos hablen de plata.** El nivel 3
es un piso sobre el delta: pide crédito suficiente para que la operación tenga sentido como
negocio, y por eso es simétrico entre lados. El nivel 6 no es una tercera cota sobre el delta —
es la única etapa del flujo que **mira afuera de la cadena de hoy**. Todo lo que va del nivel 2 al
5 se deriva de la cadena que se acaba de bajar; el edge test necesita un dato que la cadena no
tiene, que es qué pasó históricamente con ese lado, ese delta y ese DTE. De ahí que sea el último
gate y no un ajuste de los anteriores, y de ahí que sea el único que puede decir si la operación
gana plata.

**2. La ventana de delta no emerge: se construye.** Dibujar `WD >= WD_min` y
`Credit >= RequiredCredit` como dos filtros en serie hacía parecer que la banda de delta 0.10–0.20
de la sección 28 era un descubrimiento. No lo es — es la intersección de un techo y un piso
puestos sobre el mismo eje. Dibujarlos sobre una sola recta es lo que impide volver a leer esa
banda como un resultado, y es lo que anticipa que barrer `WD_min` y `Delta_max` por separado va a
dar una superficie degenerada.

**3. El flujo se recorre por `(símbolo, vencimiento regular ≤ 60 DTE, lado)` y las salidas no se
suman.** La bifurcación PUT/CALL está arriba de todo a propósito: los dos lados se evalúan y se
registran siempre, y el conteo de alertas se reporta desagregado. Agregado, el sesgo de un símbolo
cancela el del otro y desaparece justo el dato que hay que mirar (43.5).

## 47.1 El alcance inicial del bucle

> **Definido el 2026-08-24.**

El flujo recorre, por símbolo, sus **vencimientos regulares con DTE ≤ 60**. Es un alcance de
arranque y no una decisión cerrada: el tratamiento del DTE sigue abierto (56.5, 57), y de paso
este corte deja sin evaluar el bucket `61–90` que la 56.5 lista. Quedan afuera los **weeklies** y
el **0DTE**.

"Regular" es el vencimiento estándar mensual —el tercer viernes—, que es lo que Tastytrade devuelve
como `expiration-type: "Regular"`; los demás son `Weekly`, `Quarterly` o `Mini`. Reproducible con
[`scripts/vencimientos_regulares.py`](scripts/vencimientos_regulares.py).

**El bucle es corto: son 2 vencimientos por símbolo el 90% de los días**, 1 el 4.4% y 3 el 5.5%
(medido sobre 365 días de observación consecutivos). Con el universo de calibración de la 43.5
—SPY y QQQ— y los dos lados, una corrida evalúa del orden de **ocho combinaciones**, no cientos.
Eso tiene dos caras: hace barata la corrida transversal, y hace que la frecuencia de oportunidades
por lado y por símbolo se mida sobre una muestra chica. Con ocho celdas, un cero no es evidencia de
nada, y una corrida por día tarda meses en acumular estadística. Es un argumento fuerte a favor de
la captura periódica antes que de la captura puntual.

> **Revertido el 2026-08-25.** Este párrafo decía que la estructura salía del **agregado** de
> `/App/Gex/Analysis` —muros, ZGL y GEX— y que eso era deliberado: el muro como propiedad del
> mercado y no del vencimiento. La medición del día siguiente lo tumbó. **Los muros del agregado
> están pegados al spot**: en SPY, con spot 764.59, el call wall del agregado cae en 766.0 y el
> put wall en 765.0 con spot 765.17, porque los vencimientos cercanos concentran su open interest
> en el dinero y en el agregado son mayoría. El agregado no describe las paredes del mes, describe
> el pin de hoy. (Las cifras de la primera versión de esta nota salían de una cadena que incluía un
> contrato vencido; ver la corrección en la 61.1.)
>
> **La estructura sale del vencimiento**, entonces, igual que el Expected Move. Detalle y decisión
> en la 61.1; qué queda haciendo el ZGL, en la 62.

Lo que sí queda en pie de la versión anterior es la asimetría de alcance: el 0DTE y los weeklies
**siguen entrando** al `netGEX` que la pestaña GEX muestra y al agregado que el endpoint devuelve,
aunque no generen candidatos ni aporten estructura. Conviene tenerlo declarado para no volver a
leer un número del agregado como si describiera al vencimiento que se opera.

**El Expected Move es lo que obliga a que el bucle sea por vencimiento.** `WD = (muro − spot)/EM`
necesita un EM, y el EM es `spot × IV_atm × sqrt(t)`: **no está definido para el agregado**, que no
tiene un `t` — así lo declara el JSON de GEX, que deja esa fila vacía a propósito en vez de
rellenarla con el vencimiento más cercano. El muro es el mismo para todos los vencimientos; el WD
de ese mismo muro, no. Es el mecanismo por el que dos vencimientos con idéntica estructura dan
ventanas de delta distintas, que es exactamente lo que mostraron los datasets del 16 Oct y el 4 Sep
(53 a 55).

**Ojo con la base empírica del v5: el 4 Sep es un weekly.** El sweep de delta que sostiene las 24
a 28 corrió sobre `2026-09-04` (DTE 11) y `2026-10-16` (DTE 53–56). El segundo es el tercer viernes
de octubre y entra al bucle; **el primero es el primer viernes de septiembre, o sea un weekly, y
este alcance lo excluye**. El tercer viernes de ese mes era el 18.

Eso no invalida nada de lo medido: el contraste DTE 11 contra DTE 53 sigue mostrando lo que muestra
sobre el crédito requerido, y el error de columna del hallazgo del 24 se corrigió sobre los dos por
igual. Tampoco deja el DTE corto fuera de alcance —un regular también pasa por DTE 11—. Lo que sí
significa es que un weekly y un mensual al mismo DTE no son intercambiables donde importa: open
interest, bid/ask y slippage.

**Buena parte de eso ya se reparó, y conviene tener claro qué queda.** Desde el 2026-08-25 hay una
tanda entera sobre vencimientos **regulares** y con el mercado abierto —`data/2026-08-25/`, los dos
del bucle: `2026-09-18` (DTE 24) y `2026-10-16` (DTE 52), en los tres símbolos—. El sesgo por lado
de la 43.4, que era lo más apoyado en la muestra contaminada, quedó medido sobre regulares y
sostuvo signo y escala.

**Lo que sigue colgado del weekly es el extremo corto.** El vencimiento corto de la tanda nueva
está a DTE 24, no a DTE 11: la afirmación de la 28 —*"con DTE corto no hay ventana en absoluto"*—
sigue descansando entera en un contrato que el flujo no recorre. Y replicarla tiene una
particularidad de calendario: como los regulares son mensuales, para verlos a DTE 11 hay que
capturar once días antes de un tercer viernes. Para el `2026-09-18` eso cae el **7 de septiembre**,
que es Labor Day y no se opera, así que el tiro más cercano es el 8 (DTE 10) o el 4 (DTE 14). No es
una captura que se pueda hacer cualquier día: hay que esperar la ventana.

Detalle, alcance de la contaminación y qué medir para separarlo, en
[el hallazgo del weekly](hallazgos/2026-08-24-el-4-sep-es-un-weekly.md); la tanda que lo reparó a
medias, en [el del book vivo](hallazgos/2026-08-25-el-sesgo-aguanta-con-book-vivo.md).

**Lo que el diagrama deja a la vista es cuánto falta.** De los seis niveles hay uno definido
(el 2), dos provisionales (1 y 3), uno vacío (4), uno reprobado con su calibración actual (5), y
el que decide si esto gana plata sin implementar (6). El flujo no está incompleto en los bordes:
le falta el centro.

# 48. Arquitectura de decisión recomendada

> **Errata del 2026-08-24.** Estos cuatro niveles quedaron superados por el flujo redibujado de la
> sección 47, que tiene seis. Dos cambios de fondo: el **Nivel 4 — Economic Gate** de acá no es un
> gate económico (`RequiredCredit` es un piso de riesgo, 43.2) y el gate económico real —el edge
> test— no figura en esta lista; y los niveles 2 y 4 **no son independientes**: dentro de un
> vencimiento son el techo y el piso de la misma variable, el delta (43.2). Se deja el texto como
> registro de la arquitectura que se pensó primero.

La lógica debe dividirse en cuatro niveles.

Nivel 1 — Market Gate
Pregunta:

¿El entorno permite buscar operaciones?

Resultado:

```text
FAVORABLE
SELECTIVE
NO OPERATE

```
Nivel 2 — Structural Gate
Pregunta:

¿Dónde está permitido vender?

Utiliza:

Put Wall;

Call Wall;

ZGL;

Expected Move;

GEX;

WD.

Nivel 3 — Option Gate
Pregunta:

¿Qué opciones concretas cumplen?

Utiliza:

Delta;

POP;

OI;

bid/ask;

credit;

width;

max risk.

Nivel 4 — Economic Gate
Pregunta:

¿La compensación justifica el riesgo?

Utiliza:

RequiredCredit;

Cushion.

# 49. Candidate Ranking

Esta es probablemente la pieza conceptual más importante que falta cerrar.

Después de todos los filtros puede haber múltiples candidatos válidos.

Ejemplo:

Delta .12
WD .75
Credit .50

Delta .15
WD .50
Credit .65

Delta .18
WD .33
Credit .75

Delta .20
WD .25
Credit .90
Todos pueden pasar.

GOT necesita decidir:

¿Cuál es el mejor?

No alcanza con:

maximum credit
ni con:

maximum cushion
ni con:

minimum delta
Debe existir una función de utilidad o ranking.

# 50. No usar un "score" arbitrario

Una decisión filosófica importante del proyecto fue evitar sistemas de scoring arbitrarios.

Por lo tanto, el ranking debería preferentemente derivarse de variables económicamente interpretables:

WD;

Cushion;

Delta;

POP;

Max Risk;

liquidity.

La futura función debería ser transparente.

# 51. Posible criterio de ranking

Una hipótesis a probar:

Primero ordenar por seguridad estructural:

WD
Luego exigir economía mínima:

Cushion >= CushionMin
Y dentro de los candidatos económicamente aceptables seleccionar el de mejor relación:

Credit / RequiredCredit
o una métrica similar.

Otra alternativa:

maximize Cushion
subject to WD >= WD_min
and POP >= POP_min
and Risk <= MaxRisk
Esto debe probarse.

# 52. Una posible nueva métrica

Podría estudiarse:

EconomicEfficiency =
Credit / MaxLoss
o:

RequiredReturnCoverage =
Credit / RequiredCredit
La segunda es particularmente útil porque ya está alineada con la filosofía del modelo.

# 53. Qué se demostró con los datasets TSLA

> **Hallazgo 3 reescrito el 2026-08-24** y agregados el 8, 9 y 10. Ver
> [el hallazgo](hallazgos/2026-08-24-credito-call-columna-equivocada.md).

Hallazgo 1
El crédito absoluto no sirve como regla universal.

Hallazgo 2
DTE modifica radicalmente el crédito necesario.

Hallazgo 3
Un DTE corto puede no pagar de ningún lado.

En el 4 Sep (DTE 11) fallan los cinco candidatos PUT y los cinco CALL. La versión original
de este hallazgo decía lo contrario —*"el mismo DTE puede tener un lado excelente y otro
malo"*— y salía de las tablas de CALL con la columna equivocada. Corregido, no agrega una
dimensión nueva sino que refuerza al 2: lo que manda es el DTE, no el lado.

Hallazgo 4
Delta no determina por sí solo la calidad.

Hallazgo 5
Wall Distance puede eliminar un candidato económicamente atractivo.

Hallazgo 6
Un crédito bajo puede ser válido si:

DTE alto
+
WD alto
+
RequiredCredit bajo
Hallazgo 7
Un crédito relativamente alto puede ser insuficiente si:

DTE corto
+
WD menos favorable

Hallazgo 8
El lado sí importa, pero por skew y no por estructura.

En el 16 Oct pasan 5 de 6 candidatos PUT y 1 de 6 CALL. A delta equivalente, las puts
pagan aproximadamente el doble que las calls. Eso no es una propiedad de ese vencimiento:
es la asimetría normal de la superficie de volatilidad de un equity. Consecuencia de
diseño en la sección 43.1.

Hallazgo 9
Los tres filtros duros juntos pueden dejar cero candidatos.

Aplicando `WD >= 0.20`, `Credit >= RequiredCredit` y `MaxLoss <= MaxRisk` a la vez, **los
22 candidatos de los dos datasets quedan afuera**. Los cinco puts del 16 Oct que pasan
economía violan `MaxRisk = $400`, incluido el de la sección 54. Un filtro que nunca
dispara es indistinguible de uno mal calibrado hasta que se cuenta cuántas veces dispara.

Hallazgo 10
Los parámetros de riesgo no son independientes de la escala del subyacente.

`MaxRisk` está en dólares y `Width` en strikes. En un subyacente de $355, el width mínimo
de la cadena ya produce un maxloss por encima del límite. Los dos parámetros hay que
calibrarlos juntos, o expresar el riesgo como fracción del capital (sección 72).
# 54. Ejemplo clave — 16 Oct PUT

Strike 315
Delta ≈ 0.1925
WD ≈ 0.251
Credit = $0.90
El crédito parece pequeño nominalmente.

Pero:

RequiredCredit ≈ $0.48
Por lo tanto:

Cushion ≈ +89%
Conclusión:

$0.90 no es "poco" en términos de esta operación.

> **Verificado el 2026-08-24 contra el dataset.** El crédito y el delta son correctos
> (`pcsCredit_w5` = 0.90, `putDelta` = −0.1925), y el Cushion recalculado da +96.4% con la
> interpolación exacta del `WDFactor` — el +89% del texto usaba un `RequiredCredit` de
> $0.48 contra los $0.4584 que da la tabla de la sección 33. La conclusión no cambia.
>
> **Pero este candidato no es operable con los parámetros actuales**: su maxloss es
> `(5 − 0.90) × 100 = $410`, por encima de `MaxRisk = $400`. Sigue siendo el mejor ejemplo
> de por qué el crédito tiene que ser relativo, que es para lo que está esta sección, pero
> no es un trade que el motor pudiera proponer hoy. Ver la sección 39 y el Hallazgo 9.

# 55. Ejemplo clave — 4 Sep PUT

Strike 337.5
Delta ≈ 0.2103
WD ≈ 0.292
Credit = $0.86
Aunque el crédito sea mayor que en el ejemplo anterior:

RequiredCredit ≈ $0.96
Entonces:

Cushion < 0
Conclusión:

$0.86 puede ser insuficiente.

Esto demuestra definitivamente por qué MinCredit = $80 no puede ser universal.

# 56. Qué NO está cerrado todavía
## 56.1 RequiredCredit

La estructura actual es prometedora, pero debe validarse sobre muchos más:

símbolos;

DTE;

regimes;

widths;

WD.

## 56.2 WD mínimo

> **Sin objeto desde el 2026-08-25.** El sweep que pide esta sección no se puede correr: `WD_min` y
> `Delta_max` son cotas de la misma variable (43.2), así que barrerlos por separado da una
> superficie degenerada. `WD` salió de la definición — ver la errata de la 18 y la tabla de la 61.8.
> Lo que hoy se barre es un `delta_max` único, y no antes de resolver la 61.9.

Actualmente:

WD_min = 0.20
Es un parámetro razonable, pero todavía no probado estadísticamente.

Debe testearse:

0.10
0.15
0.20
0.25
0.30
0.40
y medir:

frecuencia de oportunidades;

retorno;

drawdown;

tasa de éxito.

## 56.3 Delta Window

Debe testearse más ampliamente:

0.05
0.08
0.10
0.12
0.15
0.18
0.20
0.22
0.25
0.30
No asumir de antemano que 0.20 es el límite.

## 56.4 Width

Debe probarse:

1 strike
2 strikes
3 strikes
4 strikes
respetando Max Risk.

## 56.5 DTE

Debe determinarse qué rangos son económicamente eficientes.

Por ejemplo:

7–14
15–21
22–30
31–45
46–60
61–90
El modelo de RequiredCredit debe comportarse correctamente en todos.

# 57. Falta definir el tratamiento de DTE

Actualmente existe un factor:

sqrt(30 / DTE)
Pero falta comprobar si esa relación es realmente la correcta.

Podría resultar que:

sqrt()
sea demasiado agresiva o demasiado suave.

Esto debe validarse empíricamente.

# 58. Falta definir la relación Width / RequiredCredit

El modelo actual utiliza:

RequiredCredit =
Width × RRreq / (1 + RRreq)
Esto es razonable conceptualmente.

Pero debe probarse si el retorno requerido debe mantenerse proporcional al width.

# 59. Falta definir el efecto de gamma regime

Hay que estudiar:

Positive GEX
¿Conviene:

menor WD?

Delta más alto?

RequiredCredit menor?

Negative GEX
¿Conviene:

mayor WD?

Delta más bajo?

RequiredCredit mayor?

Esto debe salir del backtest, no de una intuición.

# 60. Falta definir el efecto de Expected Move

Actualmente Expected Move normaliza WD.

Debe verificarse:

si el EM diario/total correcto es el utilizado;

cómo tratar expirations con EM muy grande;

si EM debe ser bidireccional;

si debe usarse EM implícito puro o una medida ajustada.

# 61. Sell Zones

**Esta sección es la definición canónica de la Sell Zone.** La 16 es su versión original y quedó
superada; la 18 y la 19 definen `WD`, que salió de la zona. El procedimiento paso a paso está en la
**61.7**, lo que se descartó y por qué en la **61.8**, y lo único que falta para poder afirmar
ventaja en la **61.9**.

> **Reescrita el 2026-08-25 a la mañana.** Antes decía que `PUT < PutWall` / `CALL > CallWall` era
> "demasiado simple para ser la versión definitiva" y listaba seis preguntas abiertas. Las
> mediciones de ese día contestaron tres y reformularon las otras.
>
> **Reescrita otra vez el 2026-08-25 a la tarde**, y esta vez el cambio es de fondo: de las dos
> condiciones que la versión de la mañana puso en la 61.3, **una no era estructural** —`d_min × EM`
> tiene ρ = −1.0000 contra el delta— y el muro de la otra **no era un objeto medible**, porque un
> argmax sobre un strike no es una concentración. La zona pasa a definirse por una **banda** de
> gamma con dos tests de dominancia, más un `delta_max` que se declara por lo que es: un piso de
> riesgo, no una segunda lectura de la estructura. Las 61.3 a 61.6 están reescritas y las 61.7 a
> 61.9 son nuevas. Evidencia y reproducción en
> [el hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md).

## 61.1 Las dos decisiones de alcance

**La estructura sale del VENCIMIENTO, no del agregado.** Es un cambio respecto de lo que la 47.1
había fijado el día anterior, y lo fuerza la medición: los muros del agregado están pegados al
spot.

```text
SPY   spot 765.17   callWall 766.0   putWall 765.0   (15 vencimientos agregados)
QQQ   spot 709.39   callWall 710.0   putWall 700.0
TSLA  spot 352.05   callWall 360.0   putWall 340.0
```

En SPY el muro de call queda **$0.83 arriba** del spot y el de put **$0.17 abajo**: una zona
construida sobre eso no separa nada. Los vencimientos cercanos concentran su open interest en el
dinero, y en el agregado son mayoría —quince vencimientos, de los cuales once están dentro de los
20 DTE—, así que el argmax cae ahí. **El agregado no describe dónde están las paredes del mes;
describe dónde está el pin de hoy.**

> **Corregido el 2026-08-25 por la tarde.** La primera versión de este párrafo decía que el muro de
> call quedaba a $1.41 y el de put a $0.59, y atribuía la causa a que *"el 0DTE aporta −462.8 B de
> los −1253.6 B del agregado"*. Esos números salieron de una cadena que **incluía un contrato
> vencido**: Tastytrade devolvía el `2026-08-24` —un weekly de lunes que ya había expirado— con
> `days-to-expiration: 0`, y el backend le creía. Ese "0DTE" era el contrato muerto, y su gamma
> entraba al agregado.
>
> Con la cadena corregida el 0DTE verdadero de SPY aporta **+130.3 B**, o sea que el signo del
> aporte también estaba invertido: la explicación de la primera versión no era una imprecisión, era
> otra cosa. **La conclusión no cambia** —los muros del agregado siguen pegados al spot, ahora
> incluso más— pero el mecanismo es la concentración de OI en el dinero de los cercanos, y no un
> 0DTE que arrastra el neto hacia abajo.
>
> El defecto está arreglado: `GammaExposureHandler.NormalizeExpirations` recalcula el DTE contra la
> fecha de hoy en ET y descarta los vencidos, congelado por `GammaExposureExpirationTests`. Detalle
> de por qué el campo del proveedor no es confiable —estaba mal en SPY y TSLA y bien en QQQ **en el
> mismo minuto**— en el comentario de esa función.

Sigue valiendo lo que la 47.1 dice sobre el `Expected Move` —no está definido para el agregado,
que no tiene un `t`—, y ahora hay una segunda razón, más fuerte, para bajar todo al vencimiento:
el agregado tampoco sirve para los muros.

**El régimen lo decide el SIGNO DEL `netGEX` del vencimiento.** Cuando esa lectura y la de
`spot` contra `ZGL` se contradicen, gana el signo. Ver la 62 para qué queda haciendo el ZGL.

## 61.2 La zona estructural tiene un solo borde

Es una consecuencia de separar estructura de economía, y conviene tenerla explícita: **la
estructura fija el borde INTERNO de la zona** —lo más cerca del spot que se puede vender— y no
tiene nada que decir sobre el externo. Vender más lejos siempre es estructuralmente mejor y
económicamente peor; el borde externo lo pone el crédito, que es el nivel 3 del flujo.

Buscar un "borde externo estructural" es buscar algo que no existe.

## 61.3 La definición

> **Reescrita el 2026-08-25 por la tarde.** La versión de la mañana ponía **dos** condiciones sobre
> el mismo eje —pasar el muro y separarse `d_min × EM`— y advertía contra tratarlas como etapas en
> serie. El defecto era más grave: **la segunda no es una condición estructural**. Medida sobre las
> doce combinaciones símbolo × vencimiento × lado, `distancia/EM` tiene **ρ = −1.0000 exacto**
> contra el delta. Dentro de un vencimiento `EM` es una constante, así que `distancia/EM` es una
> transformación afín del strike y ordena la cadena igual que el delta, al revés. `d_min × EM` es
> un corte de delta escrito de otra manera. Ver
> [el hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md), §0.

Para un `(vencimiento, lado)`:

```text
ZONA PUT   =  { K  :  K <= bordeExterno(bandaPut)  - buffer   Y   |delta(K)| <= delta_max }
ZONA CALL  =  { K  :  K >= bordeExterno(bandaCall) + buffer   Y   |delta(K)| <= delta_max }

sin banda dominante en ese lado:   ZONA = { K : |delta(K)| <= delta_max }
```

**Y las dos condiciones no son de la misma naturaleza, aunque vivan sobre el mismo eje:**

* **La banda de gamma es la única condición estructural.** Sale del open interest, que es
  posicionamiento y no precio, y por eso puede contener información que la cadena no tiene. Es lo
  que define la 61.4.
* **`delta_max` no es estructura: es el piso de riesgo.** Es lo que hacían `WD_min`, `d_min × EM` y
  la ventana de delta — las tres son la misma variable (43.2 y el hallazgo del 25). Se declara una
  sola vez, en delta, y no se disfraza de tres cosas distintas.
* **`buffer`** — cuánto hay que pasarse del borde de la banda. Sin calibrar.

**Ata la más restrictiva de las dos**, y cuál ata **se registra**: es el dato que dice si la
estructura aportó algo en esta evaluación o si el candidato salió de un corte de delta. Medido
sobre el dataset, ata la banda en **3 de 12** casos (61.6).

**El régimen modula `delta_max`, no la banda.** Con `netGEX < 0` los dealers amplifican y el muro
es peor defensa, así que el delta máximo admitido baja. Con `netGEX > 0` puede subir. Cuánto, sin
calibrar — y sin observar: las capturas del dataset son **todas** de gamma negativa (62.4).

## 61.4 El muro es una banda, no un strike

> **Reescrita el 2026-08-25 por la tarde.** La versión de la mañana medía la calidad del argmax
> —concentración y dominancia contra el segundo candidato— y pedía **un umbral de dominancia sobre
> el argmax**. La medición de la tarde dice que el problema no es el umbral sino el argmax:
> preguntarle a una distribución cuál es su strike más alto es la pregunta equivocada cuando lo que
> importa es dónde está acumulado el gamma. Ver
> [el hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md), §1.

`SelectCallWall` es un **argmax sobre un solo strike**: el de mayor `CallGEX` por encima del spot
con `NetGEX > 0`. Nada en esa definición pide que sea una concentración, y no lo es — nunca pasa
del 19% del GEX de su lado, y la dominancia contra el segundo candidato baja hasta **1.00x**. En
SPY 16-Oct el "Call Wall 790" le gana al 797 por un 2%, con los dos a $7 de distancia. Eso predice
que salta, y salta: el call wall de QQQ 09-18 estuvo en 750 a las 10:12 ET y en 710 a las 11:00 ET
del mismo día.

**La banda arregla eso.** El muro de un lado es la ventana de strikes de ancho `W` que maximiza la
suma de `|GEX|` de ese lado **entre los strikes que están fuera de la zona del dinero** (`|K − spot|
≥ 0.15 × EM`, ver más abajo), y la referencia para la zona es su **borde externo** — el más lejos
del spot.

Con `W = 0.25 × EM`, el mismo SPY 16-Oct del ejemplo de arriba:

| | argmax | dominancia | banda | % del lado | borde |
|---|---|---|---|---|---|
| CALL | 790 | **1.02x** | 790–800 | 33.1% | 800 |
| PUT | 730 | 1.32x | 730–740 | 22.9% | 730 |

El argmax es inservible y la banda concentra un tercio del gamma del lado. Y es **estable donde el
argmax no lo era**: en tres tomas repartidas en dos días —24-ago al cierre, 25-ago a las 10:12 y a
las 12:00— la banda de call se movió entre 34.5% y 36.7% sin cambiar de lugar.

### La banda tiene que pasar dos tests para contar como muro

Que sea la ventana más densa no la hace una concentración. Hacen falta los dos:

* **`xmed`** — la banda contra la ventana **mediana** del mismo lado. Si es ~1x, la "banda más
  densa" es una banda cualquiera y no hay nada acumulado.
* **`xdisj`** — la banda contra la mejor ventana **disjunta**. Si es ~1x, hay dos concentraciones
  empatadas y no hay *un* muro.

Los dos, porque se rompen distinto: TSLA 09-18 CALL da `xmed` 8.6x y `xdisj` 1.01x — muy
concentrado, en dos lugares a la vez.

> **Corregido el 2026-08-27: el segundo test es `xvalle`, no `xdisj`.** El cociente de dos masas no
> puede contestar "un muro o dos" —dos masas iguales pegadas son una losa, y con un valle en el
> medio son dos muros—, y medido sobre las 12 combinaciones **`xdisj` no tiene un solo positivo
> verdadero**, el TSLA de este párrafo incluido. Ver el nodo "El competidor contiguo" más abajo.

**Cuando no pasan, la respuesta correcta es "no hay muro"** — no un argmax inestable. La zona queda
definida solo por `delta_max`, que es una degradación limpia. Hoy el sistema siempre devuelve un
muro; eso es lo que hay que cambiar.

**El umbral numérico no se declara, y desde el 2026-08-26 hay menos apoyo que antes para
declararlo.** La versión de esta sección escrita el 25 decía que los dos tests *"detectan las dos
formas de inestabilidad"* y se apoyaba en un solo evento: la banda de QQQ 09-18 CALL, que saltó $15
entre tandas y era la única con `xmed` de 1.3–1.5x. **Ese evento no era inestabilidad de la banda:
era la banda parada sobre la pila del dinero**, y con la zona del dinero afuera la serie no se mueve
($0.1). O sea que **no queda ninguna falla observada contra la cual calibrar un umbral** — fijar un
corte sobre cero observaciones es peor todavía que el error del 0.10–0.20 de la 28. Lo que sí se
declara es que el umbral existe y que su ausencia es un resultado válido.

`W` queda como parámetro libre, y mueve el borde: barrido de 0.15 a 0.40 EM corre el borde hasta ~7
puntos en SPY. Parte de eso es aritmética —la banda crece hacia afuera— pero no todo, y no hay
todavía nada que fije su valor.

> **Medido sobre las 12 combinaciones el 2026-08-28, y es mucho peor que ese "~7 puntos en SPY":**
> el borde se corre **$9.6 en promedio y hasta $30.6**, y en delta hasta **0.174** con sólo ±20% de
> `W`. Con `delta_max = 0.20`, eso significa que `W` decide si la banda ata. Ver "El borde es una
> función de `W`" más abajo.

### Los dos tests no son redundantes, y hay una prueba de cada lado

Los tres ejemplos de la 61.7 dan la evidencia simétrica, y conviene tenerla junta porque es lo que
justifica pagar el costo de dos tests en vez de uno:

| | `xmed` | `xdisj` | quién avisa |
|---|---|---|---|
| TSLA 18-Sep CALL | 8.3x — parece sólido | **1.01x** | `xdisj`: dos muros a $30 |
| QQQ 18-Sep CALL | **1.4x** | 1.26x — pasaría cualquier umbral | `xmed`: es una meseta |

> **Corregido otra vez el 2026-08-27.** De las dos filas, la de TSLA ya no dice lo que decía: sus
> "dos muros a $30" tienen un estante entre medio con el 64% de la densidad de la banda, así que
> `xdisj` no estaba avisando de nada — estaba pesando dos pedazos del mismo estante. Lo que queda en
> pie de esta tabla es la fila de QQQ: `xmed` ve una forma que `xdisj` no ve. Que hagan falta **dos**
> tests sigue valiendo; que el segundo sea `xdisj`, no.

La lectura de la forma sí sigue valiendo: QQQ tiene una meseta y `xmed` es lo único que la ve.

> **Corregido el 2026-08-26.** Este nodo decía además que QQQ 18-Sep era *"la única serie del
> dataset que se movió"* y que *"el único aviso previo fue su `xmed`"*, o sea que trataba el `xmed`
> bajo como predictor de inestabilidad. **La causa del salto era otra**: el 24-ago la banda estaba
> parada sobre el dinero (spot 708.02, banda 710–719.5). Sacando la zona del dinero, esa meseta con
> `xmed` 1.2x **no se mueve** entre las dos tandas. La meseta es real; que avise de algo, no está
> demostrado.

### La banda excluye la zona del dinero

> **Escrito el 2026-08-25 por la noche como tres defectos de construcción sin arreglar; medido y
> resuelto el 2026-08-26.** Dos de los tres resultaron ser el mismo defecto y se arreglan con un
> solo cambio; el tercero es real como diagnóstico, pero su arreglo —anclar la ventana a la
> grilla— **se midió y se rechazó**. Evidencia y reproducción en
> [el hallazgo del 2026-08-26](hallazgos/2026-08-26-los-tres-defectos-de-la-banda.md).

**La banda, su competidor, la ventana mediana y el total del lado se calculan sobre los strikes con
`|K − spot| ≥ m × EM`, con `m = 0.15`.** La pila de gamma que siempre hay en el dinero no es un
muro: es el pin. Dejarla adentro contaminaba el cálculo por dos lados a la vez.

* **El competidor disjunto podía ser la pila del dinero.** En SPY 16-Oct CALL el `xdisj` de 1.01x
  —el que hizo escribir *"dos concentraciones empatadas"*— salía de comparar la banda 790–800 contra
  **766–776, con el spot en 765.45**: el competidor arrancaba a **0.01 EM** del spot. Con la zona
  del dinero afuera, ese mismo caso da **1.49x** y el borde no se mueve.
* **La banda misma podía ser la pila del dinero.** En QQQ 18-Sep del 24-ago, con el spot en 708.02,
  el argmax devolvió **710** y la banda quedó en **710–719.5**. Al día siguiente la banda estaba en
  725–734: **$14.9 de salto**. Con la zona del dinero afuera las dos tandas ven la misma banda
  —725–734— y el borde se mueve **$0.1**.

**Ese segundo punto es el más caro de los tres, porque era el único evento de inestabilidad del
dataset** y se cae entero. Medido sobre las diez series con más de una toma, el movimiento total del
borde entre tandas pasa de **16.1 a 1.3**.

**`m` no está calibrado, está medido.** Hasta 0.15 EM la exclusión no mueve ningún borde de las 12
combinaciones; de 0.25 en adelante empieza a comerse bandas legítimas, y ahí **cambia de signo**: el
corte le pasa por encima al strike más grande de una banda, que queda adentro un día y afuera el
otro según dónde esté el spot, y el movimiento total sube a 10.3. El arreglo tiene su propio filo,
del lado de arriba.

**Lo que no cambia:** ningún borde de las 12 combinaciones se mueve, el conteo de restricción sigue
en **3 de 12**, y TSLA 18-Sep CALL —el "no hay muro" legítimo, con dos concentraciones a $30 y el
spot lejos de las dos— sigue dando 1.01x. El arreglo no se lleva puesto al verdadero positivo.

### La ventana sigue siendo continua, y anclarla a la grilla se probó y es peor

El diagnóstico es correcto, y más extendido de lo que se creía: **6 de 12 bandas dejan afuera un
strike a menos de un cuarto de escalón de la grilla, y dos de ellas por 0.02 escalones** — dos
centavos de un strike de un dólar. En SPY 16-Oct CALL, con `W = 9.8` la banda llega a 799.8 y deja
afuera el 800; con `W = 10.6` lo incluye, y el `xdisj` pasa de 1.01x a 1.22x.

**Pero anclar la ventana a un número entero de escalones no arregla eso: muda el redondeo.** De
*"qué strike cae adentro"* pasa a *"cuántos escalones mide la ventana"*, y el segundo es más grueso
— en TSLA, con la grilla entre 2.5 y 10, un escalón es la mitad de la banda. Medido contra un cambio
**vacío** de `W` (±10%), el swing del veredicto sube de 3.8% a 13.5%, y el borde entre tandas no
mejora (16.1 → 15.0). Anclar a la grilla *donde vive el gamma* —en SPY 16-Oct un strike de $1 carga
el 10% del gamma de uno de $5— recupera el swing pero empeora el borde a 41.0.

**Y una vez sacada la zona del dinero, el defecto deja de decidir.** El mismo SPY 16-Oct CALL, ante
la misma perturbación de `W`:

```text
construcción de antes    xdisj  1.01 - 1.22x    <- cruza cualquier umbral
con la zona del dinero afuera   1.49 - 1.62x    <- no cruza ninguno
```

El strike 800 sigue entrando y saliendo por centavos, y sigue moviendo la composición de la banda
(33.1% del lado contra 41.2%). Lo que ya no mueve es el veredicto: lo que hacía que decidiera era el
competidor contaminado. Con 12 casos eso es una observación y no una demostración, pero alcanza para
lo que hay que decidir: **el defecto 1 no justifica cambiar la definición, y su arreglo la empeora.**

### El competidor contiguo, y por qué `xdisj` no sirve

> **Anotado el 2026-08-25 como la tercera lectura de un `xdisj` bajo; medido el 2026-08-27, y el
> resultado se lleva puesto el test.** Los dos parches obvios se rechazaron, y buscando por qué
> fallaban los dos apareció que el problema no es el competidor: es la pregunta que `xdisj` hace.
> Evidencia en [el hallazgo del 2026-08-27](hallazgos/2026-08-27-el-competidor-contiguo-y-xdisj.md).

**El competidor contiguo no es un caso de borde: es el caso normal.** En **8 de 12** combinaciones
el competidor que define `xdisj` está a menos de **un** ancho de banda, y en dos de ellas a **un
dólar**. El competidor típico no es otro muro — es el borde de afuera del mismo.

**`xdisj` compara masas, y "un muro o dos" es una pregunta sobre el valle.** Dos masas iguales sin
nada entre ellas son una losa ancha; dos masas iguales con un valle entre ellas son dos muros.
`xdisj` no puede distinguirlas porque no mira el medio. Lo que lo mira es **`xvalle`**: la densidad
de la rebanada más vacía que entra entera entre la banda y su competidor, relativa a la densidad de
la banda.

Medido sobre las 12 combinaciones, **el dataset no tiene un solo valle**: ocho casos son contiguos
—no hay lugar ni para una rebanada— y los otros cuatro dan 0.28, 0.53, 0.64 y 0.74. O sea que
**`xdisj` no tiene un solo positivo verdadero**: todos sus valores bajos son la banda contra su
propia cola o contra un estante sin hueco.

**Y ahí cae el ejemplo 2 de la 61.7.** TSLA 18-Sep CALL era el "no hay muro" del dataset: `xmed`
8.3x, `xdisj` 1.01x, dos concentraciones a $30. Pero entre ellas no hay una sola ventana de 9 puntos
que baje del **64%** de la densidad de la banda. No son dos muros con un valle: es un estante de $35
con ondulaciones, y el 1.01x decía "medí dos pedazos del mismo estante y pesan igual".

Las tres lecturas de un `xdisj` bajo quedan así:

| El competidor está… | Ejemplo | Qué significa |
|---|---|---|
| pegado al spot | SPY 16-Oct CALL — 766–776 con spot 765.45 | **arreglado el 26**: la zona del dinero ya no entra |
| contiguo a la banda | QQQ 18-Sep PUT — 681–690 contra 691–700 | una losa ancha partida en dos por el tamaño de la ventana |
| lejos, en el ala | TSLA 18-Sep CALL — 400–409 contra 367–377 | **tampoco son dos muros**: `xvalle` 0.64, no hay valle |

### El borde es una función de `W`, y `W` no está calibrado

> **Anotado el 2026-08-27 como "la concentración es más ancha que `W`"; medido el 2026-08-28, y el
> defecto resultó ser más grande que su enunciado.** Se probaron las tres salidas —arreglar el
> crecimiento, desacoplarlo de `W`, y una construcción sin `W`— y ninguna cierra, por la misma
> razón: **el borde nunca fue sólido**. Evidencia en
> [el hallazgo del 2026-08-28](hallazgos/2026-08-28-el-borde-le-debe-todo-a-W.md).

El enunciado sigue siendo cierto: **si la concentración es más ancha que `W`, la ventana la parte y
el borde cae DENTRO del muro** —lo que la 17 dice que no se hace—, y vale hasta **$28 de strike**
(TSLA 18-Sep CALL: 377 contra 405). Pero es un caso particular de algo más general:

**El borde de hoy, sin ningún parche, es una función del ancho de banda.** Barriendo `W` sobre las
12 combinaciones, y medido en delta —que es la unidad en la que el borde se compara contra
`delta_max = 0.20`—:

| rango de `W` | borde: medio | máximo | delta: medio | máximo |
|---|---|---|---|---|
| 0.15 – 0.40 EM (el rango que esta sección declara libre) | $9.6 | $30.6 | 0.062 | **0.154** |
| 0.20 – 0.30 EM (±20%) | $6.2 | $31.6 | 0.042 | **0.174** |
| 0.225 – 0.275 EM (±10%) | $2.7 | $6.9 | 0.019 | 0.072 |

**Mover `W` un ±20% corre el delta del borde hasta 0.174, con un presupuesto de 0.20.** `W` no es el
ancho de una ventana: **es quien decide si la banda ata**, que es el número con el que la 61.6 juzga
si la estructura aporta algo.

**Las tres salidas, medidas:**

* **Crecer de a un strike** en vez de por rebanadas **arregla la inestabilidad** que hundió al parche
  del 27 — el borde entre tandas se mueve **0.3** con `f` entre 0.65 y 0.45, contra 1.3 de no crecer.
  El defecto de ese parche no era la idea: era el tamaño del paso. **Pero ata el borde a `W` más
  fuerte** ($16.6 contra $9.6), porque `W` entra dos veces: la semilla y la referencia de densidad.
* **Desacoplar la resolución** —medir la densidad sobre el paso de la grilla donde vive el gamma—
  saca una de las dos y deja el borde **a la par de hoy, no mejor** ($8.0). Lo que sigue moviéndose
  es la **semilla**, que es una ventana de ancho `W`: en un estante de $35 cae en otro lugar según
  `W`. Ningún refinamiento del crecimiento arregla una semilla que se muda.
* **La dual** —masa fija `p`, ancho mínimo—, que es la única construcción que no necesita `W`, es
  **mucho peor**: el borde entre tandas se mueve de 16 a 43 según `p`, contra 1.3. Sacar `W` cambia
  el filo de lugar, de "qué strike entra en la ventana" a "qué strike completa la masa", y el segundo
  es peor.

**Conclusión: el borde no se cierra antes de calibrar `W`, y `W` está del otro lado de la 61.9.** La
receta del crecimiento queda escrita para cuando se pueda —de a un strike, `f` 0.65–0.45, resolución
desacoplada— y no se aplica hasta entonces.

## 61.5 Lo que las mediciones ya contestaron

De las seis preguntas de la versión original:

* **"cuánto debe separarse de wall"** — sigue abierta, es el `buffer`.
* **"relación con Expected Move"** — **cerrada, y negativa.** El EM no aporta un eje: normalizar por
  EM da el mismo orden que el delta (61.3). El EM se sigue usando, pero como **escala del ancho de
  banda**, no como condición.
* **"relación con ZGL" y "si la zona puede cruzar ZGL"** — ver la 62. La respuesta corta es que hoy
  la cruzan las seis capturas, así que no puede ser una condición de rechazo.
* **"cómo tratar wall muy cercana al Spot"** — ya no es un caso especial: si el borde de la banda
  cae a delta mayor que `delta_max`, ata `delta_max` y la banda no aporta. Es lo que pasa en 10 de
  12 casos.
* **"cómo tratar wall muy lejana"** — tampoco: ata la banda, y `delta_max` no aporta.

## 61.6 La validación que podía matar todo — corrida, y el resultado mueve la hipótesis

> **Reescrita el 2026-08-25 por la tarde.** La versión de la mañana planteaba el test y adelantaba
> evidencia preliminar "incómoda" del lado put. El test está corrido sobre las doce combinaciones y
> el resultado es más fuerte y menos malo de lo que parecía. Ver
> [el hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md), §2 y §3.

El test era: **si la zona resulta ser una función monótona del delta, GOT no agrega nada sobre
"vendé delta 0.15"**. Dos mediciones lo contestan.

**Primera: el borde de la banda restringe en 3 de 12 casos**, y **los tres son SPY** (call a delta
0.136 y 0.174; put a 0.188). En los otros nueve el borde cae a **delta 0.22–0.33**, o sea *más cerca
del dinero* que donde la ventana de delta ya vendía. No es sólo que el muro de put no restrinja —
casi ningún muro restringe.

> **Corregido el 2026-08-25 por la noche.** Este conteo decía **2 de 12**, "los dos SPY del lado
> call". Estaba medido con el proxy `EM*` del script y no con el Expected Move de la 15, que es el
> que manda el paso 3 del procedimiento. Con el EM correcto, SPY 16-Oct PUT también ata —su banda
> pasa de 729–740 a 724–734, y el borde de delta 0.211 a 0.188— y el conteo es 3. Once de doce no se
> mueven y la lectura no cambia. Detalle en
> [el hallazgo de esa noche](hallazgos/2026-08-25-el-test-de-banda-depende-del-EM.md).
>
> **Revisado el 2026-08-26:** el conteo **sobrevive** al arreglo de la construcción de la 61.4. Con
> la zona del dinero excluida ningún borde de las doce combinaciones se mueve, así que sigue siendo
> 3 de 12 y los mismos tres. Los defectos afectaban al veredicto de "hay muro", no a dónde cae el
> borde.

Y la fuerza del muro no tiene nada que ver con eso: TSLA 16-Oct PUT es la pared más nítida de todo
el dataset —43% del GEX del lado, `xmed` 15.8x, `xdisj` 2.46x, estable entre dos días— y no ata,
porque está a delta 0.28.

**Segunda: no hay premio de crédito en el borde.** Vender en el borde de la banda paga entre 1.33x y
2.57x lo que paga delta 0.15 — pero el borde *está* a delta más alto. Descontando el delta con un
ajuste de la eficiencia `(crédito/width)/delta` construido con los strikes lejos de la banda, el
residuo del borde da **z medio +0.56 ± 0.90 sobre 11 casos**, indistinguible de cero. El mercado
cobra en el muro exactamente lo mismo que en cualquier strike del mismo delta.

> **Errata del 2026-08-27 — el veredicto se sostiene, el `± 0.90` no es una barra de error.** Los
> once z tienen desvío **2.98** cuando un z bien normalizado tendría ~1: cinco de once superan
> \|z\|>2 (se esperaría medio caso) y dos superan \|z\|>3 (se esperaría 0.03). El `sd` con el que se
> normaliza —el desvío de los residuos del ajuste cuadrático— subestima la incertidumbre en el
> strike del borde, así que cada \|z\| está inflado y el `± 0.90`, que es el error estándar de esa
> serie, no se puede leer como "0.56 sigmas de cero". **Esto no da vuelta el veredicto: lo
> refuerza.** Si los z están inflados, el premio verdadero es todavía menor que +0.56; sacando los
> dos outliers queda +0.32 ± 0.54 sobre nueve casos, y el reparto de signos sigue siendo 6 contra 5.
> Lo que hay que dejar de hacer es citar el `± 0.90` como si midiera la precisión de la estimación.

**Las dos juntas mueven la hipótesis, no la matan.** Si el muro estuviera restringiendo, sería un
filtro; si el mercado le cobrara un premio, ya estaría descontado. Lo que dicen los datos es otra
cosa:

> El muro no es un filtro que empuja más afuera. Si sirve para algo, es un **permiso para vender más
> cerca** — hay una pared entre el spot y el strike — y ese permiso **no está en el precio**.

Un muro que frena el precio y que nadie cotiza distinto es ventaja. Uno cotizado no serviría de
nada. Pero el permiso **invierte el costo de equivocarse**: como filtro, un muro inexistente sólo
te hacía vender más lejos de lo necesario; como permiso, un muro que no aguanta es plata perdida.

**Por eso la definición de la 61.3 se queda con la lectura conservadora** —la banda como cota, `ata
la más restrictiva`— y la lectura de permiso queda declarada como hipótesis **no implementada**. Lo
que la habilita está en la 61.9.

## 61.7 El procedimiento

Cómo se llega a una Sell Zone, en orden. Cada paso dice de dónde sale y qué pasa si falla.

**1 · Elegir el vencimiento.** Regular, DTE ≤ 60 (47.1). **Nunca el agregado**: sus muros quedan
pegados al spot —$0.83 y $0.17 en SPY— porque el argmax cae donde el open interest de los cercanos
se concentra en el dinero, y además el agregado no tiene un `t` con el cual definir el EM (61.1).

**2 · Leer el régimen.** Signo del `netGEX` **de ese vencimiento**. Si contradice la lectura de
`spot` contra `ZGL`, gana el signo; el ZGL es un nivel, no un interruptor (62.1). Con
`|spot − ZGL| < ε × EM` el ZGL no dice nada — banda muerta, `ε` sin calibrar.

**3 · Calcular el EM del vencimiento.** `spot × atmIv × sqrt(dte/365)` (15). Se usa **solo** para
fijar el ancho de banda del paso 4. No es una condición de la zona (61.3).

**4 · Encontrar la banda de gamma, por lado.** Ventana de ancho `W = 0.25 × EM` que maximiza la suma
de `|GEX|` del lado, sobre los strikes del lado correspondiente del spot **y fuera de la zona del
dinero** — `|K − spot| ≥ 0.15 × EM`, que también sale del cálculo del competidor, de la mediana y
del total del lado (61.4). Sin eso, el muro puede ser la pila de gamma del dinero, o medirse contra
ella.

**5 · Decidir si esa banda es un muro.** `xmed` —¿hay algo acumulado?— y **`xvalle`** —¿es uno o son
dos?— (61.4). Si no pasan, **el resultado es "no hay muro" en ese lado** y se salta al paso 7 con la
zona definida solo por `delta_max`. Umbrales sin declarar, y sin nada contra qué declararlos: el
dataset no tiene ni una inestabilidad ni un valle. **`xdisj` quedó descartado el 2026-08-27**: mide
el cociente de dos masas, que no contesta la pregunta.

**6 · Tomar el borde externo de la banda** — el extremo más lejos del spot — y correrlo por
`buffer`. Ese es el borde estructural de la zona. Sin calibrar.

**7 · Aplicar `delta_max`**, el piso de riesgo, modulado por el régimen del paso 2. Sin calibrar.

**8 · La zona es la intersección, y se registra cuál condición ató.** Es el dato que distingue un
candidato que salió de la estructura de uno que salió de un corte de delta.

**9 · Lo que la zona NO afirma.** Distancia, sí. Cuál condición ata, sí. Cuánto paga cada lado, sí.
**Probabilidad estructuralmente favorable, no** — eso depende de la 61.9 y hoy no está medido.

### Ejemplo 1 — SPY 16-Oct '26: el borde es estable, el veredicto todavía no

> **Corregido el 2026-08-25 por la noche.** La primera versión de este ejemplo daba el lado call
> como *"ata la ESTRUCTURA"* con `xdisj 1.31x`, y ese número estaba calculado con el `EM*` del
> script —el proxy de 1 sigma— en vez de con el Expected Move de la 15, que es el que este mismo
> procedimiento manda usar en el paso 3. Con el EM real el `xdisj` de ese lado da **1.01x**. La
> conclusión se invierte y el ejemplo pasa a ilustrar otra cosa: los dos defectos del test de banda
> que la 61.4 tiene ahora anotados.
>
> **Actualizado el 2026-08-26.** Los números de abajo son los de la construcción **de antes**, con
> la zona del dinero adentro. Con el paso 4 como quedó definido —el dinero afuera— el lado call da
> `xdisj` **1.49x** contra 772–782, el mismo borde 799.8 y 33.1% del lado: deja de ser un empate. El
> competidor 766–776 que producía el 1.01x arrancaba a **0.01 EM** del spot. El lado put no se mueve.

`spot 765.45 · ATM IV 0.1351 · DTE 52 · Net GEX −54.7 B · ZGL 764.27 · EM ±39.0 · W 9.8`

```text
PUT    banda 724.2-734.0   19.5% del lado   xmed 3.4x   xdisj 1.23x contra 748-758
       borde 724.2 -> delta 0.184, 1.06 EM        delta_max 0.20 -> K 727 (delta 0.197)

CALL   banda 790.0-799.8   26.6% del lado   xmed 1.6x   xdisj 1.01x contra 766-776 (!)
       borde 799.8 -> delta 0.172, 0.88 EM        delta_max 0.20 -> K 800 (delta 0.172)
```

**El borde del lado call es sólido: 800.** Barriendo el ancho de banda de 0.15 a 0.40 EM se mueve
entre 798.6 y 800.9 — el paso 6 devuelve el mismo número siempre.

> **Corregido el 2026-08-28: eso vale para este lado, no para el dataset.** Es el tercero más estable
> de los doce ($3.0 de rango). El promedio es **$9.6** y TSLA 18-Sep CALL se corre **$30.6** con el
> mismo barrido. La solidez del borde se generalizó desde el único ejemplo trabajado hasta ese
> momento; medida, no se sostiene (61.4).

**Lo que no era sólido es el paso 5**, y este caso es el que lo mostró. El `xdisj` del lado call
saltaba de **1.01x a 1.22x** con un cambio del 8% en `W`, porque a `W = 9.8` la banda llega a 799.8 y
**deja afuera el strike 800**, que solo vale un 6.5% del lado. Y el competidor que producía ese 1.01x
era la banda **766–776, pegada al spot**.

**Los dos se midieron el 2026-08-26 y sólo uno era el problema** (61.4). Sacando la zona del dinero
del cálculo, este lado da 1.49x y ante el mismo ±10% de `W` se queda entre **1.49x y 1.62x**: el
strike 800 sigue entrando y saliendo por centavos, pero ya no decide nada. Anclar la ventana a la
grilla —que era el arreglo propuesto para eso— se probó y empeora las dos cosas que importan.

Lo que el ejemplo sí deja, y no depende del test:

* El lado call paga **0.164** de crédito por unidad de ancho a delta 0.172, contra **0.108** a delta
  0.197 del put. Más lejos y paga más — el sesgo por lado de la 43.4 (SPY 1.81x a favor del call)
  apareciendo concreto, y coincidiendo con la asimetría del ZGL de la 62.3.
* El `spot − ZGL` es `+0.030 EM`: banda muerta, el ZGL no dice nada acá.

### Ejemplo 2 — TSLA 18-Sep '26: el "no hay muro" que no era, y del otro lado un muro que no restringe

> **Reinterpretado el 2026-08-27, y esta vez se cae el veredicto.** Este ejemplo era *"el primer 'no
> hay muro' del dataset trabajado de punta a punta"*. Medido con `xvalle`, **entre las dos
> concentraciones no hay valle**: ninguna ventana de 9 puntos entre 377 y 400 baja del **64%** de la
> densidad de la banda. No son dos muros a $30 — es un **estante de $35 con ondulaciones**, y el
> `xdisj` de 1.01x estaba pesando dos pedazos del mismo estante. Los números de abajo son correctos;
> la conclusión que sacaban, no. Ver
> [el hallazgo del 2026-08-27](hallazgos/2026-08-27-el-competidor-contiguo-y-xdisj.md).

`spot 351.11 · ATM IV 0.4152 · DTE 24 · Net GEX −3.0 B · ZGL 352.42 · EM ±37.4 · W 9.3`

```text
PUT    banda 335.7-345.0   28.8% del lado   xmed 6.1x   xdisj 1.93x contra 321-330
       borde 335.7 -> delta 0.308, 0.41 EM        delta_max 0.20 -> K 320 (delta 0.180)
       -> ata el DELTA

CALL   banda 367.5-376.8   16.9% del lado   xmed 8.3x   xdisj 1.01x contra 400-409
       -> xvalle 0.64: NO hay valle. Es UN estante de 370 a 405, mas ancho que W
       -> ata el DELTA
```

**A diferencia del ejemplo 1, acá los dos veredictos son robustos:** con `W` de 9.3 o de 9.95 las
bandas, los `xmed` y los `xdisj` no se mueven ni en el segundo decimal. Es el caso limpio.

**Lo que la pantalla muestra como `Call Wall 400` no es una pared, y el argmax no lo ve:**

```text
400    1.296 M    OI 18.945     banda 400.0-409.3  =  16.8% del lado
370    1.115 M    OI  9.628     banda 367.5-376.8  =  16.9% del lado
```

El argmax eligió 400 porque le gana a 370 por un 16%. Si hubiera elegido 370, la zona se corría $30.
**Ese empate se leyó como "dos concentraciones" y era una sola:** el gamma corre de 370 a 405 sin
hueco —370, 380, 390 y 400 llevan 1115, 819, 765 y 1296— y las dos "bandas" son sus dos puntas. La
lectura correcta no es "no hay muro": es que **hay un estante más ancho que `W`, y la ventana lo
está partiendo**. El borde que sale de tomar sólo la punta de adentro, 377, queda **$28 adentro** de
donde el estante termina (405). Eso es el defecto de borde que la 61.4 dejó abierto.

**El lado put tiene un muro real que igual no sirve de cota.** `xdisj 1.93x` y `xmed 6.1x`: pasa los
dos tests con holgura, y el competidor está afuera en el ala, no pegado al spot. Pero su borde cae en
**335.7, delta 0.308**, y el corte de delta 0.20 cae en **320**: el muro queda $16 *adentro* de donde
ya se vendía. Ata el delta.

Es la ilustración exacta de lo que mide la 61.6: **la fuerza del muro y su capacidad de restringir no
tienen relación.** Este put wall es de los más nítidos del dataset y no restringe nada.

Y es el mejor candidato que produjo cualquiera de los dos ejemplos **bajo la lectura de permiso** que
la 61.6 deja sin implementar: vender el 335 con esos 9 puntos de gamma encima paga **0.280** por
unidad de ancho, contra 0.120 a delta 0.147. Más del doble. Es exactamente el trade que no se puede
tomar hasta que la 61.9 esté medida, porque es ahí donde equivocarse cuesta plata.

Dos salvedades del caso: es la **única** toma de este vencimiento, así que no hay test de estabilidad
temporal; y TSLA no es universo de calibración (4) sino el caso de control — tener un símbolo con la
superficie invertida es lo que hace visibles estos errores. El sesgo por lado se ve acá también, y al
revés que en SPY: el put paga 0.150 a delta 0.180 contra 0.120 a delta 0.192 del call.


### Ejemplo 3 — QQQ 18-Sep '26: el único que se movió, y por qué

`spot 710.60 · ATM IV 0.1971 · DTE 24 · Net GEX −58.4 B · ZGL 709.00 · EM ±35.9 · W 9.0`

Es la única serie del dataset cuya banda cambió entre tandas, así que es la prueba de si los tests
avisan. La comparación entre tandas la imprime la sección 1 del script; el detalle del 25, la 5:

> **Reinterpretado el 2026-08-26.** La tabla y los números de abajo son correctos y siguen siendo
> los de la construcción de antes, pero **la explicación del salto que este ejemplo daba era la
> equivocada**. No se movió porque sea una meseta: se movió porque el 24-ago la banda estaba parada
> sobre el dinero. Ver el cierre del ejemplo.

| | tanda | argmax | dom | banda | xmed | xdisj | borde | delta |
|---|---|---|---|---|---|---|---|---|
| **CALL** | 24-ago | 710 | 1.50x | 710–719 | **1.6x** | 1.28x | 719 | 0.382 |
| | 25-ago | **750** | **1.01x** | **725–734** | **1.4x** | 1.26x | 734 | 0.258 |
| PUT | 24-ago | 700 | 2.18x | 691–700 | 5.2x | 1.15x | 691 | 0.326 |
| | 25-ago | 700 | 2.31x | 691–700 | 5.6x | 1.24x | 691 | 0.292 |

El put no se movió un strike. El call sí: **el argmax saltó $40 y la banda $15**, con el spot
moviéndose $3.7. **La banda amortigua pero no salva.**

**El único de los dos tests que quedó bajo fue `xmed` — 1.4x, el más bajo del dataset — y `xdisj` no
dio ninguna señal**: 1.26x y 1.28x, que cualquier umbral razonable dejaría pasar. Es el caso
simétrico del ejemplo 2, donde el bajo fue `xdisj` con `xmed` en 8.3x. **Ninguno de los dos ve lo
que ve el otro**, y esto es la evidencia; que además *avisen* de un salto es otra cosa, y es
justamente lo que se cayó el 26.

**La forma es una meseta, y eso sí es real.** El GEX de call del 25:

```text
750   16.349        730   16.184        740   14.224
725   12.792        720   11.419        760    8.325
```

De 720 a 750 el gamma es un estante plano. Por eso `xmed` da 1.4x: cualquier ventana de 9 puntos en
esa zona vale casi lo mismo. **La banda 725–734 no describe una concentración: describe dónde cayó
el máximo de una superficie chata.**

**Pero lo que movió la banda fue el dinero, no la meseta.** Con el spot en 708.02, el 24-ago el
argmax devolvió **710** —$2 arriba— con 21.314 de GEX, y la banda quedó en **710–719.5**: las dos
sobre la pila de gamma que siempre hay en el dinero. Sacando esa zona del cálculo, el 24-ago ve la
banda **725–734.5** y el 25-ago la ve en 725–734.4 — **el borde se mueve $0.1 en vez de $14.9**, con
la meseta intacta y el `xmed` igual de bajo.

Es la evidencia que cambió la 61.4 el 2026-08-26: la meseta es una descripción correcta de la forma
y **no era la causa del salto**. Una banda con `xmed` 1.2x se quedó quieta entre dos fotos separadas
por medio día y $3.7 de spot, en cuanto dejó de estar parada sobre el dinero.

La Sell Zone que sale:

```text
PUT  SELL ZONE   K <= 677      ata el DELTA
                 banda 691-700 estable, pero a delta 0.292 y con competidor CONTIGUO
                 delta 0.196 · 0.97 EM · 677/672 credito 0.64 · c/w 0.128

CALL SELL ZONE   K >= 741      ata el DELTA
                 xmed 1.4x: meseta de 720 a 750 (el salto de $15 entre tandas era el dinero)
                 delta 0.192 · 0.81 EM · 741/746 credito 0.85 · c/w 0.170
```

Ningún lado ata, consistente con el conteo de 3 de 12. Y el call paga más al mismo delta —0.170
contra 0.128— que es el sesgo de QQQ de la 43.5: 1.57x a favor del call.

Salvedades: la captura del 24-ago no tiene log versionado, así que su `spot` sale interpolado de la
curva de delta y la comparación usa el EM del 25 para las dos; y esa tanda es post-cierre, por eso
los créditos salen todos de la del 25.


## 61.8 Lo que quedó descartado, y por qué

Lo que estuvo dentro de la definición de Sell Zone y **ya no entra**. Se deja escrito porque el
costo de este research fue redescubrir cuatro veces la misma cosa:

| Descartado | Dónde vivía | Por qué |
|---|---|---|
| `WD` y `WD_min = 0.20` | 18, 19 | Dentro de un vencimiento es una cota de delta (43.2). El muro solo aporta un offset constante |
| `d_min × EM` como condición | 61.3, versión de la mañana | ρ = −1.0000 contra el delta en las 12 combinaciones. Es un corte de delta |
| El muro como argmax de un strike | 13, 61.4 versión de la mañana | No es una concentración (≤19% del lado) y salta. Reemplazado por la banda |
| Anclar la banda a un número entero de escalones de la grilla | 61.4, versión del 25 a la noche | Muda el redondeo en vez de sacarlo: swing del veredicto 3.8% → 13.5% y borde entre tandas 16.1 → 15.0. El defecto que venía a arreglar deja de decidir sacando la zona del dinero |
| **`xdisj` como segundo test de la banda** | 61.4, del 25 al 27 | Compara masas, y "un muro o dos" es una pregunta sobre el **valle**. Sobre 12 combinaciones no tiene un solo positivo verdadero: sus valores bajos son la banda contra su propia cola (8) o contra un estante sin hueco (4). Lo reemplaza `xvalle` |
| Exigirle al competidor un hueco de `g` anchos de banda | — | Sube `xdisj` sin medir nada nuevo, y deja intacto el único caso que preservaba —que resultó ser un falso negativo (27/08) |
| Dejar crecer la banda sobre la masa contigua | — | Es el único que arregla el **borde** y llevaría la restricción a 5 de 12, pero su parámetro tiene acantilados entre valores vecinos: el movimiento del borde da 1.3 / 29.8 / 20.4 / 1.6 / 1.6 / 11.2 barriendo `f` (27/08) |
| `PUT < PutWall` / `CALL > CallWall` a secas | 16 | Con el muro como argmax no restringe nada; con la banda, restringe en 3 de 12 |
| El ZGL como borde o condición de rechazo | 61 versión original | Las seis capturas lo cruzan del lado put: rechazaría todo, siempre (62.2) |
| Un "borde externo estructural" | — | No existe. La estructura fija el borde interno; el externo lo pone el crédito (61.2) |
| El crédito como evidencia de que el muro paga | — | No hay premio: z medio +0.56 ± 0.90 descontando el delta |
| El agregado de la cadena como fuente de muros | 47.1 | Sus muros quedan pegados al spot y no tiene `t` para el EM (61.1) |
| POP / probabilidad implícita como "probabilidad favorable" | 37 | EM, delta, POP y densidad risk-neutral son **el mismo objeto**: la distribución bajo la cual ningún strike es favorable |

La última fila es la que más ordena, y conviene tenerla explícita: **ninguna métrica derivada de los
precios de las opciones puede producir una probabilidad favorable.** Sólo quedan dos fuentes
posibles de ventaja — el open interest, que es posicionamiento y no precio, y la brecha entre la
distribución implícita y la empírica, que es el edge test de la 43.3 y ya pertenece a RPF.

## 61.9 Lo único que falta, y qué cuesta — MEDIDO, Y DA QUE NO

> **Cerrada el 2026-08-28, en negativo.** Todo lo que sigue en esta sección se escribió cuando la
> hipótesis no se podía medir. Se midió: **926 observaciones de lado** sobre SPY, QQQ e IWM de
> 2013 a 2025, banda a DTE 45 con el procedimiento de la 61.7. El resultado no es "no se pudo
> confirmar" — es que **el borde de la banda cruza MÁS que su delta** (+0.025, IC [−0.005, +0.053])
> y, contra un strike cualquiera del mismo delta y del mismo lado, **no aporta nada**: +0.010, IC
> [−0.019, +0.040]. El efecto que la estrategia necesita —vender delta 0.25 a riesgo de delta 0.18,
> o sea −0.07— queda **excluido**. No depende de `W` (0.20 / 0.25 / 0.30 EM dan +0.014 / +0.010 /
> +0.006) ni de la ventana: el holdout limpio 2013–2017, que el backtesting nunca tocó, da +0.011.
>
> **Vale entonces la disyuntiva que esta misma sección dejó escrita:** *"si es falsa, se vende delta
> 0.25 a precio justo y GOT es el edge test de la 43.3 con más pasos"*. Con eso no queda ninguna
> hipótesis abierta en GOT, y la pregunta de plataforma se resuelve en su salida 3 — plegar GOT al
> edge test de RPF. Ver
> [el hallazgo del 2026-08-28](hallazgos/2026-08-28-la-banda-no-predice.md), que además deja
> versionada la tabla de observaciones y la curva empírica `P(terminar más allá | delta, lado)`.
>
> Dos correcciones de arrastre a lo que sigue: la muestra que la errata del 27 anunciaba estaba
> **inflada ~15%** (463 ciclos y no 532 — el filtro de mensuales atrapaba weeklies), y el delta
> resulta estar **bien calibrado en el agregado y muy mal por lado**, lo cual le pone una condición
> a cómo se puede plantear el edge test de la 43.3.

Con lo anterior, toda la estrategia se reduce a **una sola afirmación falsable**, y no queda ninguna
otra en pie:

> La probabilidad empírica de que el precio cruce el borde externo de una banda de gamma dominante
> es menor que el delta de ese borde.

Si es cierta, se vende a precio de delta 0.25 un riesgo de delta 0.18 y GOT tiene razón de existir.
Si es falsa, se vende delta 0.25 a precio justo y GOT es el edge test de la 43.3 con más pasos.

**Ninguna captura transversal puede contestarla.** Toda la información de estructura que hay en una
foto —distancia, EM, ZGL, crédito— resultó ser delta medido de cuatro formas, y los precios de la
foto no saben del muro. Hace falta observar `t → t+Δ`.

**Y el tamaño de muestra decide el alcance del proyecto, no al revés.** El borde cae a delta
0.21–0.32; distinguir una probabilidad real de 0.20 de una de 0.25 con dos errores estándar pide del
orden de **300 observaciones independientes**, donde una observación es un camino de precio —un par
(símbolo, vencimiento) sin solapamiento— y no un strike. Con el universo de la 4 son unos 48 al
año: **seis años**. Acumular capturas propias sobre dos símbolos no es lento, es imposible.

Las tres salidas, y hay que elegir una antes de calibrar `buffer`, `delta_max`, `W` o los umbrales
de `xmed` y `xdisj` — porque ninguno de esos números significa nada si la afirmación de arriba es
falsa:

1. **Ensanchar el universo** a ~20 símbolos líquidos: ~480 observaciones al año, cierra en menos de
   un año. Choca con el universo de la 4.
2. **Comprar historia de cadenas con open interest** sobre un universo ancho: contesta en semanas,
   cuesta dinero.
3. **Aceptar el negativo** y plegar GOT al edge test de RPF. Es el resultado por defecto si no se
   elige ninguna de las otras dos.

> **Errata del 2026-08-27 — la salida 2 ya está pagada, y esta sección deja de estar bloqueada
> por datos.** `research/data/` tiene cadenas EOD de **SPY, QQQ e IWM de 2013 a 2025** con
> `open_interest`, `gamma`, `delta` e `implied_volatility` por strike y por día: todo lo que la
> banda de la §61.4 necesita para reconstruirse históricamente. Son **532 ciclos** (símbolo,
> vencimiento mensual) con resultado observable = **1064 observaciones de lado**, contra las ~300
> que pide el párrafo de arriba, y con **2013–2017 sin tocar** por la ventana OOS que el
> backtesting declaró agotada. El "seis años" y el "acumular capturas propias es imposible" se
> escribieron sin saber que la historia estaba en la máquina.
>
> **Y hay que arreglar el enunciado antes de medirlo.** "Cruzar" y "delta" no miden lo mismo: el
> delta aproxima P(terminar ITM), no P(tocar), y para un proceso sin deriva P(tocar) ≈ 2 ×
> P(terminar más allá). Medida como toque contra delta, la hipótesis sale falsa por construcción.
> La lectura coherente con el resto de la §61 —y con `pop_obs_*.parquet`, que usa `itm`— es
> **terminar más allá**. Fijarlo por escrito es el paso 1.
>
> Ojo con el reparo de la §5 del hallazgo: `research/data/` está **gitignoreado**, así que los
> datos no viajan con el repo y una sesión futura que solo lea el código va a volver a concluir
> que la historia hay que comprarla. Ver
> [el hallazgo](hallazgos/2026-08-27-la-historia-ya-existe.md).


# 62. ZGL y muro: qué hace cada uno

> **Reescrita el 2026-08-25.** Antes pedía "reglas explícitas" para los distintos órdenes
> posibles de `spot`, `ZGL` y `PutWall`, tratándolos como casos a enumerar. La medición mostró
> que no son casos: uno de esos órdenes es el estado normal, y el ZGL no estaba haciendo el
> trabajo que se le atribuía.

## 62.1 El ZGL deja de ser el árbitro del régimen

Con la decisión de la 61.1 —el régimen lo da el signo del `netGEX` del vencimiento— el ZGL deja
de ser un interruptor y pasa a ser **un nivel**: un precio de la cadena, como los muros.

El motivo es que como interruptor no era confiable. Sobre el agregado, las dos lecturas se
contradecían en 2 de 3 símbolos. Bajadas al vencimiento, las contradicciones que quedan son
todas empates técnicos:

| | netGEX | ZGL | spot − ZGL | por signo | por ZGL | |
|---|---|---|---|---|---|---|
| SPY 09-18 | −164.8 | 765.94 | −1.35 | negativa | negativa | coinciden |
| SPY 10-16 | −56.5 | 764.40 | **+0.19** | negativa | positiva | a 0.00 EM |
| QQQ 09-18 | −67.6 | 709.00 | **+0.20** | negativa | positiva | a 0.01 EM |
| QQQ 10-16 | −25.9 | 708.85 | **+0.35** | negativa | positiva | a 0.01 EM |
| TSLA 09-18 | −3.4 | 352.42 | −1.64 | negativa | negativa | coinciden |
| TSLA 10-16 | −3.2 | 364.07 | −13.29 | negativa | negativa | coinciden |

Las tres discrepancias son casos donde el spot está a **0.00–0.01 EM del ZGL**. Eso no es una
contradicción entre dos indicadores: es un empate, y el ZGL simplemente no tiene resolución ahí.

**Corolario: hay una banda muerta alrededor del ZGL** donde su lectura no significa nada. Mientras
`|spot − ZGL| < ε x EM`, el ZGL no dice de qué lado está el mercado. `ε` sin calibrar, pero los
datos sugieren que es bastante más que 0.01.

Y conviene tener registrado de dónde venía la contradicción grande: **TSLA daba `netGEX` agregado
+13.4 B (positiva) y −3.4 B en su 09-18 (negativa)**. Era un artefacto del agregado, no un
desacuerdo entre indicadores. La decisión de bajar al vencimiento se lleva puesto el problema.

## 62.2 El orden "muro de put debajo del ZGL" es el estado normal

La versión anterior planteaba `PutWall > ZGL` y `CallWall < ZGL` como casos a resolver. Medido:

| | spot | ZGL | putWall | |
|---|---|---|---|---|
| SPY 09-18 | 764.59 | 765.94 | 760.0 | debajo del ZGL, a 0.23 EM |
| SPY 10-16 | 764.59 | 764.40 | 730.0 | debajo del ZGL, a 0.87 EM |
| QQQ 09-18 | 709.20 | 709.00 | 700.0 | debajo del ZGL, a 0.25 EM |
| QQQ 10-16 | 709.20 | 708.85 | 700.0 | debajo del ZGL, a 0.16 EM |
| TSLA 09-18 | 350.78 | 352.42 | 340.0 | debajo del ZGL, a 0.33 EM |
| TSLA 10-16 | 350.78 | 364.07 | 330.0 | debajo del ZGL, a 0.61 EM |

**Seis de seis.** Una regla del tipo *"la zona no puede cruzar el ZGL"* rechazaría todos los puts,
siempre. No es una condición de rechazo: es la geometría normal de la cadena, y era previsible —
el ZGL tiende a quedar cerca del spot y el muro de put está por definición más abajo.

## 62.3 Lo que el ZGL sí aporta, y es asimétrico entre lados

Con gamma negativa **debajo** del ZGL y positiva **arriba**, el nivel funciona distinto según el
lado que se vende:

* **Vendiendo puts**, el precio cae *hacia* la gamma negativa. El camino al strike va de la zona
  amortiguada a la amplificada — el ZGL es una **trampa**, y el muro que está del otro lado es
  una defensa débil.
* **Vendiendo calls**, el precio sube *hacia* la gamma positiva. El camino al strike cruza a la
  zona que amortigua — el ZGL juega **a favor**, y el muro del otro lado es una defensa más
  creíble.

**Pero eso solo aplica cuando el spot está claramente de un lado.** Con `spot ≤ ZGL` —que es el
caso de las seis capturas— el mercado ya está en la zona amplificada por abajo y la "trampa" del
lado put ya se cruzó: el ZGL no agrega nada y lo que ata es `d_min x EM`.

Esta asimetría **apunta en la misma dirección que el sesgo por lado medido en la 43.4** —SPY y QQQ
pagan más del lado call— y también en la misma dirección que la 61.6, donde el muro solo restringe
del lado call. Tres cosas apuntando al mismo lado no es una demostración: es una coincidencia que
hay que testear, porque las tres podrían ser la misma cosa vista de tres ángulos, o dos
independientes y una casualidad.

## 62.4 Qué queda sin definir

* `ε`, el ancho de la banda muerta del ZGL.
* Si el régimen `netGEX > 0` merece un tratamiento distinto del actual: **las seis capturas del 25
  son de gamma negativa**, así que el lado positivo del interruptor no está observado. No hay dato
  sobre el régimen que la estrategia declararía más favorable.

# 63. Falta definir cuándo evaluar PUT y CALL

La recomendación actual:

Evaluar ambos lados siempre.

El Market Diagnostic puede cambiar la severidad de los filtros, pero no debería eliminar un lado únicamente por una predicción direccional.

# 64. Falta definir Selective Mode

SELECTIVE todavía necesita reglas concretas.

Por ejemplo podría exigir:

WD >= 0.30
en lugar de:

WD >= 0.20
o:

Cushion >= +20%
Pero esto todavía debe probarse.

# 65. Falta cerrar NO OPERATE

Debe existir una lista inequívoca de hard stops.

Ejemplos potenciales:

IV inválida
DTE fuera de rango
chain incompleta
wall no confiable
EM inválido
liquidez insuficiente
MaxRisk excedido
ningún candidato válido
market diagnostic extreme
# 66. Falta definir calidad de Gamma Wall

No toda wall tiene la misma calidad.

Debe evaluarse:

magnitud de GEX;

concentración;

distancia respecto del segundo máximo;

OI;

estabilidad temporal.

Un posible concepto futuro:

WallStrength
pero debe evitarse convertirlo automáticamente en un score opaco.

# 67. Falta validar estabilidad temporal

Un candidato puede aparecer durante segundos y desaparecer.

GOT necesita definir:

MinimumPersistence
Ejemplo conceptual:

candidate valid for N seconds
antes de emitir alerta.

También:

re-entry cooldown
para evitar spam.

# 68. Falta definir "freshness" del chain

Una alerta debe saber:

timestamp structure
timestamp option quote
timestamp spot
No debería comparar datos de momentos muy diferentes.

# 69. Falta definir ejecución realista

Aunque GOT sea alerts-only, el modelo debe aproximar ejecución real.

Debe probar:

Bid/Ask
Mid
Slippage
Commission
Fees
El crédito económico debe ser neto de costes si se busca evaluar rentabilidad real.

# 70. Falta definir salida

La estrategia original tenía:

Exit at 50% profit
Pero la versión V5 todavía no tiene cerrada la lógica de salida.

Debe definirse:

profit target;

stop loss;

expiration management;

DTE exit;

adjustment/no adjustment;

early close;

gamma wall movement;

alert de invalidación.

# 71. Falta definir gestión después de entrada

Aunque GOT inicialmente sea alerts-only, para backtesting debemos saber qué sucede después.

Hay que definir:

Entry
    ↓
Monitor
    ↓
Exit condition
Sin esto no existe un backtest completo de estrategia.

# 72. Falta definir capital allocation

El parámetro histórico:

MaxRisk = $400
puede ser demasiado absoluto.

Para generalizar entre símbolos convendría estudiar:

RiskPerTrade = % del capital
y eventualmente:

MaxPortfolioRisk
# 73. Falta definir correlación

Si GOT detecta simultáneamente:

SPY PUT;

QQQ PUT;

TSLA PUT;

no son tres riesgos independientes.

En una futura versión debería existir:

portfolio exposure
aunque no sea necesario para V5.

# 74. Backtesting necesario

Antes de cerrar la estrategia hay que construir un dataset histórico con:

Spot;

DTE;

IV;

IV Rank;

RV;

GEX;

walls;

ZGL;

Expected Move;

option chain;

bid/ask;

OI;

Delta;

spreads;

subsequent price path.

# 75. Backtest mínimo recomendado

Separar por:

Símbolo

```text
SPY
QQQ
TSLA
AAPL

```
otros
DTE
7–14
15–30
31–45
46–60
61–90
Gamma regime
positive
negative
neutral
Side

```text
PUT
CALL

```
Delta
0.05–0.10
0.10–0.15
0.15–0.20
0.20–0.25
0.25–0.30
# 76. Métricas que debe medir el backtest

No solamente win rate.

Debe medir:

Win Rate
Loss Rate
Average Credit
Average RequiredCredit
Average Cushion
Average WD
Average Delta
Average DTE
Average MaxLoss
Return on Risk
Return on Capital
Profit Factor
Expectancy
Max Drawdown
Average Holding Time
Tail Losses
También:

Opportunity Frequency
porque una estrategia puede ser excelente pero generar muy pocas oportunidades.

# 77. Expectancy

Una métrica fundamental:

Expectancy =
WinRate × AvgWin
-
LossRate × AvgLoss
Debe calcularse después de costes.

# 78. Profit Factor

ProfitFactor =
GrossProfit / GrossLoss
Es más útil que mirar solamente win rate.

# 79. Sensitivity Analysis

Cada parámetro importante debe someterse a sensibilidad:

WD_min
Delta_min
Delta_max
DTE range
BaseRR
MaxRisk
Width
POP_min
Liquidity thresholds
El objetivo es detectar si la estrategia funciona únicamente con un número exacto.

Si:

WD = 0.20
funciona bien pero:

WD = 0.21
colapsa, probablemente estamos overfitting.

Buscamos regiones robustas.

# 80. Robustez

La estrategia debería ser estable ante pequeñas variaciones.

Ejemplo:

DeltaMax = 0.20
debería producir resultados similares a:

DeltaMax = 0.21
0.22
0.23
siempre que la estructura siga controlando el riesgo.

# 81. Lo que NO debemos hacer

No debemos:

optimizar todos los parámetros sobre el mismo dataset;

elegir el mejor parámetro y considerarlo definitivo;

usar un único símbolo;

usar solamente un régimen;

usar solamente un vencimiento;

mirar solamente win rate;

ignorar slippage;

ignorar bid/ask;

elegir strikes retrospectivamente;

introducir parámetros después de ver resultados sin hacer out-of-sample.

# 82. Walk-forward

La validación final debería ser:

```text
TRAIN
    ↓
CALIBRATE
    ↓
VALIDATE
    ↓
OUT-OF-SAMPLE

```
Los parámetros se calibran en un período y se prueban en otro.

# 83. Parámetros actualmente definidos / provisionales


| Parámetro | Estado |
|---|---|
| Alerts-only | Definido |
| No Market Bias obligatorio | Definido |
| Put/Call evaluation | Definido — ambos lados siempre; el sesgo por lado **depende del símbolo** (43.5) |
| Simetría del filtro económico entre lados | **Resuelto** (43.3): se queda simétrico, porque baja a piso de viabilidad |
| RequiredCredit como gate económico | **Reprobado** (43.2): es un piso de riesgo, no un test de ventaja |
| Edge test (implícita vs empírica) | **Decidido, no implementado** — el gate económico real (43.3) |
| Market Diagnostic | Definido conceptualmente |
| Z-score thresholds | Provisional |
| ZGL | Definido |
| Gamma Walls | Definido |
| Sell Zones | Definido conceptualmente |
| WD formula | Definido |
| WD_min = 0.20 | Provisional |
| Delta core 0.10–0.20 | Provisional |
| Delta extended ~0.25 | Hipótesis |
| MinCredit fijo | Descartado |
| RequiredCredit | Definido conceptualmente |
| BaseRR = 0.12 | Provisional |
| DTEFactor sqrt(30/DTE) | Provisional |
| WDFactor | Provisional |
| Cushion | Definido |
| POP >= 80% | Provisional |
| MaxRisk $400 | **Reprobado, y no por su valor** — con width 5 pasa 1 de 36 candidatos, y ese cae fuera de la ventana de delta; con width ≤ 4 no puede rechazar nada (39) |
| Width | Pendiente de optimización — **acoplado a MaxRisk**, no se calibra solo |
| Liquidity | Pendiente |
| Slippage | Pendiente |
| Exit | Pendiente |
| Candidate Ranking | Pendiente |
| Persistence | Pendiente |
| Portfolio risk | Futuro |

# 84. Arquitectura recomendada para cerrar V5

> **Errata del 2026-08-24.** La cadena de módulos se sostiene como descomposición, pero dos de sus
> piezas cambiaron de contenido con el flujo redibujado de la sección 47: `StructuralValidator` y
> `EconomicValidator` no son dos filtros en serie sino las dos cotas de la ventana de delta (43.2),
> y el gate económico de verdad —el edge test— **no tiene módulo en esta lista**. Necesita uno
> propio, con la tabla de probabilidad empírica por (lado, delta, DTE) como dependencia; es el
> análogo del `pop_calibration.json` de RPF.

La versión final debería tener estos módulos:

MarketDataProvider
        ↓
MarketDiagnosticEngine
        ↓
MarketStructureEngine
        ↓
SellZoneEngine
        ↓
CandidateGenerator
        ↓
StructuralValidator
        ↓
OptionValidator
        ↓
EconomicValidator
        ↓
CandidateRanker
        ↓
AlertEngine
# 85. Candidate Generator

Debe generar candidatos a partir de una ventana Delta:

0.10
0.12
0.15
0.18
0.20
0.22
0.25
No necesariamente usar todos en producción.

La función es explorar el espacio.

# 86. Structural Validator

Debe verificar:

correct side
inside Sell Zone
outside Gamma Exclusion Zone
WD >= WD_min
y eventualmente:

ZGL relationship
Expected Move relationship
WallStrength
# 87. Option Validator

Debe verificar:

Delta

```text
POP
OI

```
Bid
Ask
Spread
Width
MaxRisk
# 88. Economic Validator

> **Errata del 2026-08-24.** Lo que describe esta sección es el **piso de viabilidad**, no el gate
> económico: `Credit >= RequiredCredit` resultó ser un piso de riesgo y no un test de ventaja
> (43.2). El validador económico de verdad compara probabilidad implícita contra empírica y
> todavía no está especificado (43.3, nivel 6 de la sección 47).

Debe calcular:

DTEFactor
WDFactor
RRreq
RequiredCredit
Cushion
y validar:

Credit >= RequiredCredit
# 89. Candidate Ranker

Debe tomar únicamente candidatos que hayan pasado todos los hard filters.

Después debe seleccionar el mejor balance entre:

Safety
+
Economics
+
Liquidity
Esto debe ser transparente.

# 90. Alert Engine

Una alerta solamente debe emitirse cuando:

Market Gate = PASS
AND
Structural Gate = PASS
AND
Option Gate = PASS
AND
Economic Gate = PASS
AND
Candidate Ranker = candidate
# 91. Estado conceptual actual

La estrategia puede resumirse actualmente así:

```text
MARKET
  │
  ├── Diagnostic
  │
  ▼
STRUCTURE
  │
  ├── Spot
  ├── ZGL
  ├── Call Wall
  ├── Put Wall
  ├── GEX
  └── Expected Move
  │
  ▼
SELL ZONES
  │
  ├── PUT
  └── CALL
  │
  ▼
CANDIDATES
  │
  └── Delta 0.10–0.25
  │
  ▼
STRUCTURAL FILTER
  │
  └── WD >= threshold
  │
  ▼
OPTION FILTER
  │
  ├── POP
  ├── Liquidity
  ├── Width
  └── Max Risk
  │
  ▼
ECONOMIC FILTER
  │
  ├── RequiredCredit
  └── Cushion
  │
  ▼
RANK
  │
  ▼
ALERT

```
# 92. Mi opinión sobre el estado de la estrategia

Estamos mucho más cerca de una estrategia cerrada que al comienzo.

La parte más importante ya está resuelta conceptualmente:

GOT no debe buscar simplemente opciones con alto crédito.

Debe buscar:

opciones estructuralmente seguras cuyo crédito sea suficiente para compensar el riesgo específico de esa oportunidad.

Eso es una diferencia fundamental.

La combinación:

Wall Distance
+
RequiredCredit
+
Cushion
es probablemente la parte más original y más prometedora de la estrategia.

# 93. La principal hipótesis que queda por demostrar

La gran pregunta ahora ya no es:

"¿Qué Delta usamos?"

La pregunta correcta es:

¿Existe una región estable de WD × Delta × DTE donde el retorno esperado sea consistentemente positivo?

Si la respuesta es sí, GOT habrá encontrado una verdadera estructura de decisión.

El Delta podría entonces ser una consecuencia del equilibrio entre:

probabilidad
vs
distancia estructural
vs
compensación
y no una regla arbitraria.

# 94. Qué haría antes de declarar GOT V5 cerrada

Orden recomendado:

Test 1 — RequiredCredit
Validar:

BaseRR
DTEFactor
WDFactor
Test 2 — WD Sweep
Probar:

0.10
0.15
0.20
0.25
0.30
0.40
Test 3 — Delta Sweep
Probar:

0.05 → 0.30
Test 4 — Width Sweep
Probar diferentes widths.

Test 5 — Liquidity
Definir filtros de ejecución realista.

Test 6 — Candidate Ranking
Resolver cómo elegir entre varios candidatos válidos.

Test 7 — Exit
Definir la mecánica de salida.

Test 8 — Backtest
Aplicar la estrategia completa.

Test 9 — Walk-forward
Separar calibración de validación.

Test 10 — Stress Test
Evaluar:

gap;

volatility expansion;

gamma flip;

wall movement;

spread widening;

sudden delta movement.

# 95. Definición provisional de GOT V5

Hasta completar esos tests, la definición más sólida es:

GOT identifica zonas estructuralmente favorables mediante gamma walls, ZGL y Expected Move; genera candidatos de spreads de crédito dentro de esas zonas; utiliza Delta como variable de búsqueda y no como único criterio; descarta candidatos demasiado próximos a las gamma walls mediante Wall Distance; calcula un RequiredCredit dinámico según width, DTE y distancia estructural; exige que el crédito real supere dicho requerimiento; y finalmente selecciona el mejor candidato mediante una lógica transparente de ranking antes de emitir una alerta.

# 96. Decisión estratégica más importante hasta ahora

Queda descartado conceptualmente:

MinCredit = $80
y también debería evitarse que la estrategia quede definida como:

Delta = 0.15
o incluso:

Delta = 0.10–0.20
como regla aislada.

La arquitectura que emerge de los datos es:

```text
STRUCTURE
    ↓
SAFETY
    ↓
ECONOMICS
    ↓
RANKING

```
El Delta es una variable dentro de ese proceso.

# 97. Próximo objetivo

El próximo trabajo debería ser convertir esta definición conceptual en una tabla de especificación matemática completa, donde cada variable tenga:

nombre;

input;

fórmula;

unidad;

rango;

default;

hard filter / soft filter;

comportamiento ante null;

comportamiento ante datos faltantes;

prioridad dentro del flujo.

Después de eso, podemos implementar un backtest engine de V5 y empezar a medir la estrategia de manera objetiva.

# 98. Estado final al 25/08/2026

> **Actualizada el 2026-08-25 por la tarde.** La versión anterior era el corte al 24/08. Las cuatro
> mediciones sobre la banda de gamma movieron ítems entre las listas, agregaron una categoría
> —lo **descartado por medición**, que antes se mezclaba con lo reprobado— y, sobre todo, cambiaron
> la naturaleza del pendiente: dejó de ser una lista de calibraciones para pasar a ser **una sola
> pregunta**, con un costo de muestra que decide el alcance del proyecto. Ver
> [el hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md).

## Definido

Filosofía; estructura general; Market Diagnostic; GEX y su lectura por vencimiento; ZGL como nivel
(62.1); Expected Move; **la Sell Zone (61), con su procedimiento en la 61.7**; el muro como banda
con dos tests de dominancia (61.4); delta como variable de búsqueda y como piso de riesgo único;
Max Risk conceptual; Cushion; alerts-only; arquitectura de streaming y alertas; eliminación de
`MinCredit` fijo.

## Validado

* La **banda de gamma es estable** donde el argmax no lo era, y **con la zona del dinero excluida lo
  es en las 10 series** con dos o más tomas: el movimiento total del borde entre tandas es **$1.3**
  contra $16.1 de la construcción anterior (hallazgo del 26/08). La única serie que se movía era la
  única cuya banda estaba parada sobre el dinero.
* **`xmed` mide la forma** —si hay algo acumulado o la banda es una banda cualquiera— y es lo único
  que ve una meseta: QQQ 18-Sep CALL da 1.4x contra 2.0x–14.8x del resto. Lo que **no** está
  validado es que *avise* de una inestabilidad futura: el único evento que sostenía esa lectura
  resultó ser un defecto de construcción (61.4).
* **`xdisj` no valida nada, y salió** (27/08). El segundo test tiene que preguntar por el **valle**,
  no por el cociente de dos masas. Su reemplazo, `xvalle`, tampoco está calibrado — con cero valles
  observados no hay contra qué.
* La **asimetría PUT/CALL por skew**, no por estructura, con signo propio de cada símbolo
  (Hallazgo 8, hallazgo del 24/08, confirmado con book vivo el 25/08 sobre los dos vencimientos
  regulares del bucle, con los seis cocientes conservando signo y escala).
* `RequiredCredit` dinámico; DTE como factor económico; diferencias entre vencimientos; posibilidad
  de aceptar créditos nominalmente pequeños en DTE largos; rechazo de créditos mayores que no
  compensan el riesgo.

## Descartado por medición

Lo que estaba en la definición y salió porque se midió que no aportaba. La tabla completa, con
dónde vivía cada uno, está en la **61.8**:

* **`WD` y `WD_min`** — cota de delta, no variable propia (43.2, y ρ = −1.0000 el 25/08).
* **`d_min × EM` como condición de zona** — ρ = −1.0000 contra el delta en las doce combinaciones.
  El EM sobrevive como **escala del ancho de banda**, no como condición.
* **El muro como argmax de un strike** — no es una concentración (≤19% del lado, dominancia hasta
  1.00x) y salta. Reemplazado por la banda.
* **Anclar la banda a un número entero de escalones de la grilla** — era el arreglo propuesto para
  el primero de los tres defectos de la 61.4, y medido empeora el swing del veredicto (3.8% → 13.5%)
  sin mejorar el borde entre tandas (hallazgo del 26/08).
* **`xdisj` como segundo test de la banda** — mide el cociente de dos masas y la pregunta es el
  valle. Cero positivos verdaderos en 12 combinaciones; lo reemplaza `xvalle` (hallazgo del 27/08).
  Con él se cae el "no hay muro" de TSLA 18-Sep CALL, que era el único del dataset.
* **El hueco mínimo al competidor** y **el crecimiento de la banda sobre la masa contigua** — los
  dos parches al competidor contiguo. El primero no mide nada nuevo; el segundo arregla el borde
  pero su parámetro tiene acantilados entre valores vecinos (ídem). **Revisado el 28/08:** el
  crecimiento **de a un strike** sí es estable —el defecto era el tamaño del paso, no la idea— pero
  ata el borde a `W` más fuerte, así que tampoco entra.
* **La banda dual** —masa fija, ancho mínimo—, que era la única construcción sin `W`: el borde entre
  tandas se mueve de 16 a 43 contra 1.3 (hallazgo del 28/08).
* **El ZGL como condición de rechazo** — las seis capturas lo cruzan del lado put (62.2).
* **El crédito como evidencia de que el muro paga** — no hay premio: descontando el delta, el
  residuo del borde da z medio **+0.56**, indistinguible de cero, con 6 casos positivos y 5
  negativos. El `± 0.90` que acompañaba a esa cifra salió de la §61.5 el 27/08: los z están
  sobredispersos 3x, así que el descarte se apoya en el reparto de signos y no en esa barra.
* **POP como gate de probabilidad favorable** — es delta con otro nombre (37).

## Reprobado o invalidado

* `0.10–0.20` como región robusta de delta: era el rango barrido, no un resultado (28).
* `MaxRisk` $400 como límite en dólares absolutos: con width 5 pasa 1 de 36 candidatos y ese cae
  fuera de la ventana de delta; con width ≤ 4 no puede rechazar nada (39, Hallazgo 9, extensión del
  25/08).
* `RequiredCredit` como gate económico: es un piso de riesgo, no un test de ventaja (43.2).
* Structural Gate y Economic Gate como niveles independientes: dentro de un vencimiento son las dos
  cotas de la misma variable, el delta (43.2).

## Decidido, falta implementar

* `RequiredCredit` baja a piso de viabilidad y se queda simétrico entre lados (43.3).
* El gate económico real es un **edge test**: probabilidad implícita contra empírica (43.3).
* El skew no lleva tratamiento explícito — queda absorbido por el edge test (43.3).
* El sesgo por lado depende del símbolo, no del motor: se mide, no se declara (43.5).
* **"No hay muro" como resultado válido** de la evaluación de un lado (61.4). Hoy el sistema siempre
  devuelve uno.
* **Registrar cuál condición ató** en cada candidato — banda o `delta_max` (61.3). Es lo que
  distingue un candidato estructural de un corte de delta.
* **La banda excluye la zona del dinero** — `|K − spot| ≥ 0.15 × EM`, del pool entero y no sólo del
  competidor (61.4, hallazgo del 26/08).

## Pendiente

> **Reescrito el 2026-08-28: ya no hay un pendiente bloqueante, porque se midió y dio que no.**
> Esta lista decía que la 61.9 bloqueaba a todos los demás y que antes de calibrar nada había que
> elegir entre ensanchar el universo, comprar historia o aceptar el negativo. **Se eligió la
> segunda —la historia ya estaba pagada— y el resultado es el tercero.** Ver
> [el hallazgo del 2026-08-28](hallazgos/2026-08-28-la-banda-no-predice.md).

**La hipótesis única está medida y es falsa** (61.9). Sobre 926 observaciones de lado, el borde de
la banda cruza **+0.025 más** que su delta, y contra un strike cualquiera del mismo delta y del
mismo lado aporta **+0.010** [−0.019, +0.040]. Es robusto a `W` (0.20/0.25/0.30 EM), a la ventana
(el holdout limpio 2013–2017 da +0.011) y al subgrupo donde la banda efectivamente ata (+0.013).

**Con eso, lo que esta lista tenía como "pendiente de calibrar" deja de ser pendiente y pasa a no
tener sentido.** Los umbrales de `xmed` y `xvalle`, el ancho de banda `W`, el `buffer` y el
`delta_max` modulado por régimen esperaban todos a esta medición. Calibrarlos ahora sería afinar una
construcción que está medida y no informa.

**`W` es el caso ejemplar, y por el lado inverso al que quedó anotado el 28/08 a la mañana.** Ese
día se cerró que `W` decide si la banda ata —mover un ±20% corre el delta del borde hasta 0.174 con
un presupuesto de 0.20— y que por eso el borde no se podía cerrar antes de calibrarlo. Medida la
61.9, `W` no cambia el veredicto en ningún valor: **`W` decide dónde cae el borde y no cambia que el
borde no informa**, que es también la explicación de por qué nunca hubo contra qué calibrarlo.

Sobreviven, y **no dependen de GOT**:

* la tabla de probabilidad empírica por lado, delta y DTE que alimenta el edge test (43.3) — ahora
  medida sobre 26.678 strikes, con el descubrimiento de que **la brecha implícita-empírica es
  direccional**: el delta está bien calibrado en el agregado y muy mal por lado, así que un edge
  test sobre deltas agrupados da cero por cancelación;
* **la maquinaria de medición** (`banda_historica.py` + `medir_61_9.py`), reusable tal cual para
  cualquier pregunta de la forma *"¿este nivel predice algo que el delta no prediga?"*;
* pasar el riesgo a un porcentaje del capital (72);
* liquidez y slippage.

Quedan **cerrados sin resolver**, porque ya no tienen para qué resolverse: el borde y su defecto de
ancho (61.4), el umbral de `xvalle` —cero valles en 12—, el régimen `netGEX > 0` sin observar
(62.4), la banda de quotes por símbolo y el ruido de la hora de captura (hallazgo del 25/08).


# 99. Conclusión

> **Corregida el 2026-08-25.** Esta sección afirmaba que *"GOT ya no es SELL DELTA 0.15"* y que la
> estrategia estaba *"suficientemente madura para pasar a formalización matemática + backtesting
> sistemático"*. Las mediciones del 25 dicen lo contrario en las dos cosas:
>
> * **Hoy sí es, casi enteramente, `SELL DELTA X`.** `WD`, `d_min × EM`, `RequiredCredit` y POP
>   resultaron ser todos el mismo eje, y el borde de la banda de gamma restringe en **3 de 12**
>   casos. Lo que la estrategia agrega sobre un corte de delta es, medido, dos casos de SPY del lado
>   call.
> * **El backtest no es la etapa que sigue: es la única etapa.** No queda ninguna otra pregunta
>   abierta que una captura pueda contestar, y calibrar cualquier parámetro antes de la 61.9 es
>   afinar números que no significan nada si esa hipótesis es falsa.
>
> **Corregida otra vez el 2026-08-28, y esta vez cierra.** El backtest se corrió: la 61.9 está
> medida sobre 926 observaciones de lado y **es falsa**. Las dos correcciones de arriba quedan
> confirmadas y se vuelven definitivas — GOT **es** `SELL DELTA X`, y no en el sentido de que le
> falte madurar: el borde de la banda no se distingue de un strike cualquiera de su mismo delta y
> su mismo lado (+0.010, IC [−0.019, +0.040]), incluso en los 229 casos donde la estructura
> restringe. Lo que la estrategia agregaba sobre un corte de delta era, medido, **nada**.
>
> Queda entonces lo que la 61.9 misma anticipó para este caso: **GOT es el edge test de la 43.3 con
> más pasos**, así que no justifica prefijo, JSON, pestaña ni switch propios. Se pliega a RPF. Lo
> que se lleva consigo no es poco —la curva empírica `P(terminar más allá | delta, lado)` y la
> maquinaria que la produjo son la mitad que le faltaba a ese edge test— pero es una contribución a
> RPF, no una estrategia.
> Ver [el hallazgo del 2026-08-28](hallazgos/2026-08-28-la-banda-no-predice.md).
>
> Lo que sí sobrevive de esta sección es su última frase, y ahora con evidencia detrás: los
> parámetros tienen que ser consecuencia de la estructura y de la economía. El problema es que
> **falta demostrar que la estructura tiene alguna consecuencia.**

GOT ya no es simplemente:

SELL OTM OPTION
ni:

SELL DELTA 0.15
La estrategia evolucionó hacia:

```text
FIND STRUCTURAL SAFETY
        ↓
FIND ECONOMIC COMPENSATION
        ↓
SELECT BEST TRADE

```
Y el descubrimiento más importante de los últimos tests es:

El mercado determina la distancia que podemos permitirnos. El DTE determina cuánto crédito necesitamos. La cadena determina qué candidato existe.

El objetivo final de GOT debería ser que los parámetros sean consecuencia de la estructura y de la economía, y no números arbitrarios.

La estrategia está suficientemente madura para pasar de la etapa de "diseño conceptual" a la etapa de formalización matemática + backtesting sistemático.
