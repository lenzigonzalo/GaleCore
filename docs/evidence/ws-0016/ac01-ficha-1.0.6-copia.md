# Cobro de prima de varianza en SPY a 30–45 días con riesgo definido — spy_prima_varianza_30_45d 1.0.6

Check: VALID_WITH_DECLARED_GAPS · hash `sha256:2dee43e45ddc…` · crítica: revisar · aprobada: no

**Para qué:** Cobrar parte de la prima de varianza de SPY vendiendo put spreads de riesgo definido escalonados en el tiempo (hasta 10 abiertos, como mucho una entrada cada 24 horas), y generar en SHADOW data de muchas posiciones reales antes de cualquier evaluación económica.

**Hipótesis:** La volatilidad implícita de los puts de SPY supera en promedio a la realizada (prima de varianza): quien vende seguro contra caídas cobra por asumir ese riesgo. → Resultado esperado positivo después de costos frente al efectivo, con muchas ganancias chicas y pérdidas grandes poco frecuentes.

**Falla si:** La realizada supera a la implícita dentro de la ventana (shocks de volatilidad; la investigación de contexto propone shocks de tasa real como disparador a probar); Eventos idiosincráticos del índice dentro de la ventana (resultados de MSFT, AAPL, NVDA; NVDA dos días antes de un vencimiento de noviembre); El put comprado se lleva la mayor parte de la prima (pendiente del skew) y los costos de cruzar el spread consumen el resto; El stop a 2× cristaliza pérdidas en caídas que después revierten

## Parámetros

| Parámetro | Valor | Unidad | Rango razonable | Depende de | Qué lo fundaría | Estado | Reglas |
|---|---|---|---|---|---|---|---|
| VIX máximo para entrar | 30 | puntos | 25–35 | régimen de volatilidad | VIX en las entradas SHADOW que terminaron en stop contra las que no | sin fundar | E2 |
| Delta del put vendido | −0,16 ± 0,04 | delta | −0,10 a −0,25 | DTE y pendiente del skew | frecuencia con que SHADOW toca el strike vendido | sin fundar | C2 |
| DTE de entrada | 30–45 (el más cercano a 37) | días | 21–60 | theta contra gamma | resultado por tramo de DTE en SHADOW | sin fundar | C2 |
| Ancho | 5 | USD | 2–10 | riesgo máximo del perfil (500 USD) | crédito/ancho en la cadena de GaleCore al entrar | sin fundar | C3 |
| Crédito mínimo | 0,10 | USD | 0,10–1,00 | ancho y costo de cruzar el spread | bid/ask real de entrada y salida | sin fundar | C4 |
| Riesgo máximo por operación | 500 | USD | hasta 500 | perfil v7: 5 % de 10.000 USD | el perfil vigente (límite del owner) | sin fundar | R1 |
| Posiciones abiertas máximas | 10 | posiciones | 1–10 | riesgo sumado contra el drawdown del perfil (1.500 USD) | decisión del owner para testing | decisión del owner | R3 |
| Espera entre entradas | 1440 | minutos | 1440–10080 | escalonar vencimientos | decisión del owner para testing | decisión del owner | R4 |
| Stop | 200 | % del crédito | 150–300 | crédito y ancho | pérdidas cerradas por stop y si revirtieron después | sin fundar | X1 |
| Objetivo | 50 | % del crédito | 40–75 | tiempo en posición | días hasta el objetivo y resultado en SHADOW | sin fundar | X2 |
| Salida por tiempo | 21 | DTE | 14–28 | gamma cerca del vencimiento | pérdidas entre 21 DTE y el vencimiento si se dejara correr | sin fundar | X3 |

## Gestión

| Paso | Tipo | Disparador | Acción | Lo ejecuta GaleCore |
|---|---|---|---|---|
| G1 | stop | en cada ciclo, pérdida a mid ≥ 2× el crédito cobrado | cerrar la posición (precedencia 1) | sí |
| G2 | target | en cada ciclo, valor del spread ≤ 50 % del crédito | cerrar la posición (precedencia 2) | sí |
| G3 | time | DTE ≤ 21 | cerrar la posición (precedencia 3) | sí |
| G4 | roll | cualquier situación | nada: sin ajustes ni roll | sí |
| G5 | kill_switch | pérdida acumulada sobre el límite del owner | pausar entradas nuevas; las abiertas siguen con G1–G3 | no (hueco declarado) |
| G6 | review | cada operación cerrada | revisión del seguimiento: regla que cerró, resultado contra lo esperado | no aplica |

## Lo que GaleCore no ejecuta

- E3: Entrar sólo si la implícita a 30 días supera a la realizada a 20 sesiones (IV30/RV20 > 1). — El MetricResolver sólo resuelve precio de cotización, último trade y GEX neto; no hay IV30 ni vol realizada como métrica. Queda fuera de la spec: se registra en el seguimiento y se prueba en la reproducción histórica como variante con nombre propio.
- E4: No abrir un spread cuyo vencimiento quede a dos días hábiles o menos de un resultado de MSFT, AAPL o NVDA o de un anuncio del FOMC. — El runtime no tiene calendario de eventos. Queda fuera de la spec; el seguimiento marca las posiciones que atraviesan un evento. Soportarlo requiere un dato operacional en GaleCore.
- S2: Dimensionar por riesgo: cantidad de contratos tal que el riesgo máximo sea un porcentaje fijo del capital. — El runtime SHADOW no dimensiona (siempre 1 contrato) y compara el riesgo contra un net liq que en SHADOW es nulo. Fuera de la spec hasta PAPER.
- R2: Límite de pérdida acumulada o drawdown que pausa entradas (kill switch). — El runtime no mide heat ni drawdown para pausar. En SHADOW lo vigila el seguimiento; fuera de la spec.
- M2: No evaluar en feriados de NYSE. — El runtime sólo excluye sábados y domingos. En un feriado las cotizaciones quedan viejas y el control de frescura bloquea; el efecto es el mismo, pero la regla no existe como tal.

## Decisiones pendientes del owner

- R3 permite hasta 5.000 USD de riesgo sumado y el drawdown del perfil es 1.500 USD: ¿vale así para testing? — recomendación: Sí para SHADOW (no hay plata real); antes de PAPER hace falta el kill switch R2 o bajar R3.

## Crítica

**Veredicto:** revisar

**Por qué no:**
- Un gap de −5 % pega en todas las posiciones a la vez y el stop a 2× no protege en un gap: la pérdida puede superar varias veces el crédito.
- Sin E3 ni E4 la estrategia no distingue prima sobrepagada en un entorno neutro de prima alta por un riesgo latente, que es justo la historia en la que el owner dice que funciona (proyecto, 04/10).

**Qué falta:**
- Costos reales: SHADOW llena a mid, así que el resultado no descuenta cruzar el spread al entrar y al salir.
- Los dos filtros que definen la tesis (E3 prima sobrepagada IV30/RV20 > 1 y E4 sin eventos en la ventana) no los ejecuta el runtime: lo que corre es vender puts siempre que el VIX esté debajo de 30.
- Kill switch ejecutable (R2): con 10 posiciones el riesgo sumado llega a 5.000 USD contra un drawdown del perfil de 1.500 USD.

**Sesgos:**
- Período sin shock: la muestra SHADOW arranca el 30/09 y no incluye un salto de volatilidad.
- Diez posiciones de SPY escalonadas no son diez observaciones independientes: comparten el mismo riesgo de gap.

**Explicación alternativa:** Si SHADOW gana, puede ser por delta (SPY subió) y no por la prima de varianza: el resultado tiene que separarse en delta contra theta/vega antes de atribuirlo a la hipótesis.

**Se apaga si:**
- Pérdida sumada de las operaciones cerradas ≥ 1.500 USD (drawdown del perfil).
- Dos stops en la misma semana.
- Volatilidad realizada de 20 sesiones por encima de la implícita a 30 días durante 5 sesiones seguidas.

**Tras cada operación cerrada:** Por cada cierre: qué regla lo cerró, resultado contra lo esperado, cuánto vino de delta y cuánto de theta/vega, si atravesó un dato (CPI, FOMC, resultados) y si E3 o E4 lo hubieran filtrado.

