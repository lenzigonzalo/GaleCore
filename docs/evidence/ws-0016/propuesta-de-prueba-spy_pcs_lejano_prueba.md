# Propuesta nueva de prueba del agente — `strategy:spy_pcs_lejano_prueba/1.0.0` (08/10)

Ajuste del contrato autorizado por el owner (08/10): «una propuesta nueva de prueba, elaborada por el agente a partir del perfil y los datos disponibles». Recorrido desde cero; **no se aprobó ni se desplegó**. Las elecciones (10Δ, plantilla 1.0.3, una posición) son del agente; la única decisión del owner queda pendiente.

Investigación: `research:2026-10-08-spy-pcs-lejano-prueba` · contexto: `evidence:2026-10-08-historia-spy-1500` · perfil: `profile:v8` · spec: `spy_pcs_lejano_prueba.json` (fuera de GaleCore: el runtime no la carga).

Comandos de esta sesión:

- `"python -B -m galecore_ai.adapters.cli" strategy check --spec C:\Users\lenzi\OneDrive\Escritorio\GaleCore\GaleCore-AI\docs\evidence\ws-0016\spy_pcs_lejano_prueba.json < {...}` → exit 0
- `"python -B -m galecore_ai.adapters.cli" strategy save --spec C:\Users\lenzi\OneDrive\Escritorio\GaleCore\GaleCore-AI\docs\evidence\ws-0016\spy_pcs_lejano_prueba.json --prompt "WS-0016: propuesta nueva de prueba, elaborada por el agente a partir del perfil y los datos disponibles (ajuste del contrato autorizado por el owner el 08/10); no se aprueba ni se despliega" < {...}` → exit 0
- `"python -B -m galecore_ai.adapters.cli" strategy critique --ref strategy:spy_pcs_lejano_prueba/1.0.0 < {...}` → exit 0
- `"python -B -m galecore_ai.adapters.cli" strategy sheet --ref strategy:spy_pcs_lejano_prueba/1.0.0` → exit 0

## Ficha (salida de `strategy sheet`, sin editar)

# Prueba: put spread de SPY a 10 delta, 30-45 días — spy_pcs_lejano_prueba 1.0.0

Check: VALID_WITH_DECLARED_GAPS · hash `sha256:15b148ab7951920135bca113ec8f118e76d078e295f9366f9d013fa08f546aa7` · crítica: revisar · aprobada: no

**Para qué:** Propuesta de prueba del agente (WS-0016) para recorrer el método desde cero con el perfil y los datos del 08/10. No es una idea del owner y no se aprueba ni se despliega.

**Hipótesis:** La implícita de SPY supera a la realizada (08/10: 15,3 % contra 9,9 %); un put vendido más lejano cobra parte de esa prima con menos probabilidad de tocar el strike. → Resultado esperado positivo después de costos frente al efectivo, con muchas ganancias chicas y pérdidas grandes poco frecuentes.

**Falla si:** La realizada supera a la implícita dentro de la ventana (shocks de volatilidad; la investigación de contexto propone shocks de tasa real como disparador a probar); Eventos idiosincráticos del índice dentro de la ventana (resultados de MSFT, AAPL, NVDA; NVDA dos días antes de un vencimiento de noviembre); El put comprado se lleva la mayor parte de la prima (pendiente del skew) y los costos de cruzar el spread consumen el resto; El stop a 2× cristaliza pérdidas en caídas que después revierten

## Parámetros

| Parámetro | Valor | Unidad | Rango razonable | Depende de | Qué lo fundaría | Estado | Reglas |
|---|---|---|---|---|---|---|---|
| VIX máximo | 30 | puntos | 25–35 | régimen de volatilidad | distribución del VIX en entradas SHADOW con stop | sin fundar | E2 |
| Delta del put vendido | −0,10 ± 0,03 | delta | −0,10 a −0,25 | DTE y skew | frecuencia de toque del strike en SHADOW | sin fundar | C2 |
| DTE | 30–45 | días | 21–60 | theta y gamma | resultado por tramo de DTE en SHADOW | sin fundar | C2 |
| Ancho | 5 | USD | 2–10 | riesgo máximo del perfil | crédito/ancho en la cadena de GaleCore | sin fundar | C3 |
| Crédito mínimo | 0,10 | USD | 0,10–1,00 | ancho y comisiones | costos reales de entrada | sin fundar | C4 |
| Riesgo máximo por operación | 500 | USD | hasta 500 | perfil (5 % del capital) | límite del perfil vigente | sin fundar | R1 |
| Stop | 200 | % del crédito | 150–300 | ancho y crédito | pérdidas cerradas por stop en SHADOW | sin fundar | X1 |
| Objetivo | 50 | % del crédito | 40–75 | tiempo en posición | resultado por objetivo en SHADOW | sin fundar | X2 |
| Salida por tiempo | 21 | DTE | 14–28 | gamma cerca del vencimiento | pérdidas tardías en SHADOW | sin fundar | X3 |

## Gestión

| Paso | Tipo | Disparador | Acción | Lo ejecuta GaleCore |
|---|---|---|---|---|
| G1 | stop | pérdida a mid ≥ 2× crédito, en cada ciclo | cerrar la posición | sí |
| G2 | target | valor del spread ≤ 50 % del crédito | cerrar la posición | sí |
| G3 | time | DTE ≤ 21 | cerrar la posición | sí |
| G4 | roll | cualquiera | nada: sin ajustes ni roll | sí (lo hace siempre) |
| G5 | kill_switch | pérdida acumulada sobre el límite del owner | pausar entradas | no (hueco declarado) |

## Riesgo contra el perfil (profile:v8)

| Qué | Esta versión | Límite del perfil (% × capital) | |
|---|---|---|---|
| Pérdida máxima por operación (1 contrato) | 500 USD (tope de la spec; el runtime no abre por encima) | 500 USD (5 %) | dentro |
| Peor caso sumado | 500 USD (1 posiciones × pérdida máxima) | 5.000 USD (50 %) | dentro |

- Kill switch: G5 — lo ejecuta GaleCore: no (hueco declarado)
- Abierto hoy en SHADOW: 1.822 USD en riesgo en 4 posiciones; entra riesgo nuevo por 3.178 USD (GaleCore, 2026-10-08T15:07:47.9230512Z)

## Estructuras para la misma tesis (cadena real, hoy)

SPY 775.12 · vencimiento 2026-11-13 (36 DTE) · GaleCore 2026-10-08T15:07:47.9993994Z. Crédito y breakeven por acción; el resto en USD por contrato; escenarios = P&L.

| Estructura | Crédito (por acción) | Riesgo máx. | Capital | Breakeven | Prob. tocar (0-1) | Δ | Γ | θ/día | Vega/punto | gap -5% | gap -3% | gap +3% | gap +5% | vol +5 pts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PCS | 0.25 | 475.0 | 475.0 | 719.75 | 0.2 | 1.21 | -0.0471 | 0.66 | -3.9 | -91.93 | -43.28 | 17.92 | 22.4 | -19.61 |

- PCS: ejecutable hoy
- CCS: no ejecutable hoy — no hay strike para la call comprada cerca de 818
- Iron condor: no ejecutable hoy — no hay strike para la call comprada cerca de 818
- Esperar: ejecutable hoy — no abre posición: sin crédito ni riesgo
- Supuesto: PCS: el constructor del runtime con delta -0.1 ± 0.03, ancho 5, DTE 30-45, sin crédito mínimo
- Supuesto: CCS: espejo en calls (mismo vencimiento, delta en valor absoluto y ancho); IC = PCS + CCS
- Supuesto: griegas y escenarios: Black-Scholes con la IV de cada pata, tasa 0, sin dividendos; salto de vol = +5 puntos
- Supuesto: probabilidad de tocar ≈ 2 × delta (valor absoluto) del strike vendido; en IC, la suma, tope 1
- Supuesto: crédito y breakevens en puntos del subyacente por acción; riesgo, capital, griegas y P&L en USD por contrato (×100)

## Lo que GaleCore no ejecuta

- E3: Entrar sólo si la implícita a 30 días supera a la realizada a 20 sesiones (IV30/RV20 > 1). — El MetricResolver sólo resuelve precio de cotización, último trade y GEX neto; no hay IV30 ni vol realizada como métrica. Queda fuera de la spec: se registra en el seguimiento y se prueba en la reproducción histórica como variante con nombre propio.
- E4: No abrir un spread cuyo vencimiento quede a dos días hábiles o menos de un resultado de MSFT, AAPL o NVDA o de un anuncio del FOMC. — El runtime no tiene calendario de eventos. Queda fuera de la spec; el seguimiento marca las posiciones que atraviesan un evento. Soportarlo requiere un dato operacional en GaleCore.
- S2: Dimensionar por riesgo: cantidad de contratos tal que el riesgo máximo sea un porcentaje fijo del capital. — El runtime SHADOW no dimensiona (siempre 1 contrato) y compara el riesgo contra un net liq que en SHADOW es nulo. Fuera de la spec hasta PAPER.
- R2: Límite de pérdida acumulada o drawdown que pausa entradas (kill switch). — El runtime no mide heat ni drawdown para pausar. En SHADOW lo vigila el seguimiento; fuera de la spec.
- M2: No evaluar en feriados de NYSE. — El runtime sólo excluye sábados y domingos. En un feriado las cotizaciones quedan viejas y el control de frescura bloquea; el efecto es el mismo, pero la regla no existe como tal.

## Decisiones pendientes del owner

- ¿Sigue esta prueba (10Δ) o queda como ejercicio del método? — recomendación: Dejarla como ejercicio hasta tener la reproducción histórica de la variante; no aprobarla.

## Crítica

**Veredicto:** revisar

**Por qué no:**
- con IV rank 15 el crédito a 10Δ puede no llegar al mínimo y la estrategia casi no entra
- la pérdida máxima por contrato casi no baja (ancho 5 menos un crédito menor) mientras el crédito cae

**Qué falta:**
- reproducción histórica de la variante 10Δ (hoy no hay ninguna)
- costos reales: con crédito bajo, el bid/ask pesa más sobre el resultado

**Sesgos:**
- un solo día de contexto, con IV rank 15 (volatilidad baja)
- la variante sale de mirar la tabla de hoy: es una historia ajustada al dato del día

**Explicación alternativa:** menos pérdidas a 10Δ puede ser sólo menos exposición: el mismo resultado se obtiene con el 16Δ y menos capital, sin que la distancia agregue edge

**Se apaga si:**
- dos stops seguidos
- el crédito medio cobrado queda por debajo del mínimo de la spec

**Tras cada operación cerrada:** comparar la salida con la regla que la disparó y el crédito cobrado con el del 16Δ ese día
