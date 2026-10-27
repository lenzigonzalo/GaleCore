# Estrategia GOT V3

**Documento canónico de especificación funcional, matemática y técnica**

**Versión:** 3.0  
**Estado:** Consolidación de diseño  
**Fecha:** 2026-08-04  
**Proyecto:** GALECORE — Options Trading Monitor  
**Archivo:** `Estrategia_GOT_v3.md`

---

# 1. Propósito del documento

Este documento define de forma integral la estrategia GOT V3 (GaleCore Options Trading Monitor), incluyendo sus reglas de análisis de mercado, selección de oportunidades, bloqueo de oportunidades, monitoreo de Entry Delta, generación de alertas, persistencia, concurrencia e infraestructura de notificaciones.

El documento constituye la **fuente canónica de verdad** de la estrategia GOT V3. Cualquier implementación posterior del backend, frontend, base de datos, WebSocket o sistema de notificaciones deberá respetar estas definiciones, salvo que una nueva versión de la estrategia las modifique explícitamente.

La V3 se concibe como una evolución de las versiones anteriores, simplificando el alcance operativo y separando claramente:

1. Diagnóstico del mercado.
2. Determinación de elegibilidad.
3. Descubrimiento de oportunidades.
4. Congelamiento de la oportunidad.
5. Monitoreo dinámico del Entry Delta.
6. Emisión de una alerta cuando el mercado alcanza la condición de entrada.

---

# 2. Definición fundamental de GOT V3

GOT V3 es una **estrategia de alertas para opciones**.

GOT V3 **NO ejecuta operaciones**.

GOT V3 **NO abre posiciones**.

GOT V3 **NO administra posiciones abiertas**.

GOT V3 **NO contempla, por ahora, reglas de cierre, ajuste, rolling, stop loss o profit taking de una posición**.

La responsabilidad de GOT V3 termina cuando detecta que una oportunidad previamente identificada alcanzó su condición de Entry Trigger y genera la alerta correspondiente.

La ejecución de la operación queda completamente fuera del alcance de la V3 y será responsabilidad del usuario o de un componente futuro.

La estrategia se puede resumir conceptualmente como:

```text
Analizar el mercado
        ↓
Determinar si el entorno es elegible
        ↓
Buscar una oportunidad estructural
        ↓
Congelar la oportunidad
        ↓
Esperar que el mercado se acerque al punto definido
        ↓
Monitorear Entry Delta en tiempo real
        ↓
Detectar Entry Trigger
        ↓
Generar alerta
        ↓
Mostrar alerta destacada en la UI
        ↓
Enviar alerta a usuarios predefinidos de Telegram
```

La filosofía central es:

> **GOT V3 no persigue al mercado. Define previamente dónde quiere encontrar una oportunidad y espera a que el mercado llegue a ese punto.**

---

# 3. Alcance de la estrategia

GOT V3 puede analizar una lista de símbolos.

Ejemplos:

- SPY
- QQQ
- IWM
- AAPL
- MSFT
- NVDA
- TSLA
- Otros símbolos que dispongan de datos suficientes de precio, volatilidad y opciones.

La estrategia no depende conceptualmente de un único símbolo.

Cada símbolo es procesado de forma independiente, aunque el motor de procesamiento puede ejecutar el análisis de varios símbolos en paralelo.

La estrategia tampoco depende de una predicción explícita de dirección de mercado para decidir si debe operar.

El `Directional Z-Score` forma parte del diagnóstico del mercado, pero no constituye por sí mismo una orden de compra o venta ni un `Market Bias` obligatorio para seleccionar la estructura.

---

# 4. Flujo general de procesamiento

Dada una lista de símbolos:

```text
Lista de Symbols
       │
       ▼
Procesar Symbol 1
       │
       ▼
Procesar Symbol 2
       │
       ▼
Procesar Symbol N
```

Para cada símbolo se ejecuta el siguiente pipeline:

```text
1. Obtener Market Data
        ↓
2. Construir Market Snapshot
        ↓
3. Ejecutar Market Diagnostic
        ↓
4. Ejecutar Market Eligibility
        ↓
5. Si NO es elegible → finalizar análisis del símbolo
        ↓
6. Obtener expirations regulares válidas
        ↓
7. Calcular Gamma Walls
        ↓
8. Evaluar estructuras candidatas
        ↓
9. Evaluar PCS
        ↓
10. Evaluar CCS
        ↓
11. Evaluar IC
        ↓
12. Seleccionar oportunidades válidas
        ↓
13. Aplicar Opportunity Lock
        ↓
14. Persistir Opportunity
        ↓
15. Persistir Opportunity Legs
        ↓
16. Crear Monitoring Subscriptions
        ↓
17. Iniciar monitoreo Entry Delta
```

El proceso de Discovery no ejecuta operaciones.

El resultado del Discovery es una o más oportunidades persistidas en estado `WAITING` y listas para ser monitoreadas.

---

# 5. Separación de responsabilidades

GOT V3 se divide conceptualmente en las siguientes capas:

```text
MARKET DATA
    ↓
MARKET DIAGNOSTIC
    ↓
MARKET ELIGIBILITY
    ↓
OPPORTUNITY DISCOVERY
    ↓
OPPORTUNITY LOCK
    ↓
ENTRY DELTA MONITORING
    ↓
ENTRY TRIGGER
    ↓
ALERT ENGINE
    ↓
NOTIFICATION DELIVERY
```

Cada capa tiene una responsabilidad específica.

## 5.1 Market Data

Obtiene los datos necesarios para el análisis.

Incluye, según disponibilidad:

- Precio spot.
- Candles históricos.
- IV ATM.
- IV Rank.
- IV Momentum.
- VIX.
- VIX 9D.
- VIX 30D.
- GEX.
- GEX por strike.
- Open Interest.
- Opciones disponibles.
- Bid.
- Ask.
- Delta.
- Gamma.
- Expirations.

## 5.2 Market Diagnostic

Describe el estado del mercado.

No decide por sí solo si una operación es válida.

## 5.3 Market Eligibility

Determina si el entorno de mercado cumple las condiciones mínimas para continuar con el proceso de Discovery.

## 5.4 Opportunity Discovery

Busca estructuras concretas de opciones que cumplan las reglas de GOT V3.

## 5.5 Opportunity Lock

Congela todos los parámetros necesarios para que una oportunidad no cambie mientras está siendo monitoreada.

## 5.6 Entry Delta Monitoring

Observa el comportamiento del Delta de la opción short en tiempo real.

## 5.7 Alert Engine

Detecta el momento exacto en que se cumple el Entry Trigger.

## 5.8 Notification Delivery

Distribuye la alerta a:

- Interfaz de usuario.
- Usuarios predefinidos de Telegram.

---

# 6. Market Diagnostic

El Market Diagnostic es el conjunto de indicadores que describen el contexto actual del mercado.

No utiliza un sistema de scoring.

No suma puntos.

No asigna un puntaje total.

Cada indicador mantiene su propio significado.

Los indicadores definidos son:

1. Directional Z-Score.
2. GEX Skew.
3. Trend EMA.
4. RV Regime.
5. VIX.
6. VIX Term Structure.
7. IV Rank.
8. IV Momentum.
9. GEX.
10. Spot vs ZGL.

---

# 7. Directional Z-Score

## 7.1 Objetivo

Medir el movimiento reciente del precio en relación con la volatilidad implícita ATM expresada como sigma diaria.

## 7.2 Datos necesarios

Se requieren:

- Al menos 6 candles.
- IV ATM mayor que cero.

Si hay menos de 6 candles o `ivAtm <= 0`, el resultado es `0`.

## 7.3 Cálculo

Se compara el cierre de la última vela con el cierre de la vela ubicada cinco posiciones antes.

Conceptualmente:

```text
Return5D = Close[t] / Close[t-5] - 1
```

La IV anualizada se convierte en volatilidad diaria:

```text
DailySigma = IV_ATM / sqrt(252)
```

El Z-Score utilizado por GOT V3 es:

```text
DirectionalZScore = Return5D / DailySigma
```

Equivalentemente:

```text
DirectionalZScore =
    (Close[t] / Close[t-5] - 1)
    /
    (IV_ATM / sqrt(252))
```

## 7.4 Importante sobre la escala

Este valor divide un retorno de aproximadamente 5 días por una sigma de 1 día.

Por lo tanto, el valor resultante está expresado en unidades de sigma diaria y es aproximadamente `sqrt(5)` veces mayor que un Z-Score correctamente normalizado a una ventana de cinco días.

Esto **no se considera un bug de GOT V3**.

Es la fórmula declarada por la estrategia.

Por ejemplo, un valor absoluto de `1.5` debe interpretarse teniendo en cuenta esta escala.

Aproximadamente:

```text
1.5 sigma diaria
≈
0.67 sigma de una ventana de 5 días
```

## 7.5 Clasificación

Los umbrales definidos son:

```text
neutral_z = 1.0
extreme_z = 1.5
```

Reglas:

```text
|Z| < 1.0
    → neutral

1.0 ≤ |Z| < 1.5
    → bullish_moderate / bearish_moderate

|Z| ≥ 1.5
    → bullish_extreme / bearish_extreme
```

La dirección se determina por el signo:

```text
Z > 0 → bullish
Z < 0 → bearish
```

---

# 8. GEX Skew

## 8.1 Objetivo

Describir la distribución relativa de la exposición gamma positiva y negativa.

GOT V3 utiliza `GEX Skew` en lugar de `gex_sign`.

## 8.2 Razón

El antiguo `gex_sign` no resulta útil como clasificación porque la capa macro de elegibilidad exige `GEX >= 0`.

Por lo tanto, el signo de GEX no permite distinguir correctamente la estructura interna del mercado.

El análisis se realiza mediante el `skewRatio`.

## 8.3 Clasificación

```text
skewRatio > 0.6
    → call_dominant

skewRatio < 0.4
    → put_dominant

0.4 ≤ skewRatio ≤ 0.6
    → symmetric
```

Si el denominador utilizado para calcular el ratio es cero:

```text
GEX Skew = symmetric
```

## 8.4 Interpretación visual

### call_dominant

```text
call wall domina — soporte estructural arriba
```

### put_dominant

```text
put wall domina — soporte estructural abajo
```

### symmetric

```text
GEX simétrico — ancla equilibrada
```

El panel puede mostrar el `skewRatio` crudo redondeado a tres decimales.

---

# 9. Gamma Walls

## 9.1 Definición

GOT V3 define dos tipos principales de Gamma Wall:

- Call Wall.
- Put Wall.

La definición se basa en la concentración de exposición gamma neta por strike.

## 9.2 Call Wall

El `Call Wall` es el strike que presenta la mayor concentración de gamma positiva neta.

Formalmente:

```text
CallWall = strike con máximo GEX neto positivo
```

## 9.3 Put Wall

El `Put Wall` es el strike que presenta la mayor concentración de gamma negativa neta en valor absoluto.

Formalmente:

```text
PutWall = strike con mínimo GEX neto
```

o equivalentemente:

```text
PutWall = strike con máximo |GEX negativo|
```

## 9.4 Alcance de vencimientos

Los Gamma Walls utilizados por GOT V3 deben calcularse considerando la cadena completa de opciones disponible para el mercado analizado, es decir, **todos los vencimientos y strikes disponibles**, y no únicamente el vencimiento específico de la oportunidad.

Esto es importante porque los Gamma Walls representan una estructura global del posicionamiento gamma del mercado.

El vencimiento seleccionado para la oportunidad es una dimensión diferente.

Por lo tanto:

```text
GEX / Gamma Walls
    → todos los vencimientos disponibles

Opportunity / Structure
    → vencimiento específico seleccionado
```

---

# 10. Trend EMA

## 10.1 Objetivo

Describir la tendencia relativa del precio mediante EMA 20 y EMA 50.

## 10.2 Requisito

Se requieren al menos 50 candles.

Si no se cumple:

```text
Trend EMA = unavailable
```

## 10.3 Cálculo

La EMA utiliza:

```text
k = 2 / (N + 1)
```

La semilla inicial es la SMA de las primeras `N` velas.

Se calculan:

```text
EMA20
EMA50
```

## 10.4 Banda muerta

Se define una banda muerta de `0.2%`.

```text
abs(EMA20 - EMA50) / EMA50 < 0.002
    → neutral
```

Si no se encuentra dentro de la banda:

```text
EMA20 > EMA50
    → up

EMA20 < EMA50
    → down
```

---

# 11. RV Regime

## 11.1 Objetivo

Comparar la volatilidad realizada reciente con una ventana de mayor duración.

## 11.2 Cálculo

Se utilizan retornos logarítmicos de la misma serie de precios.

Se calculan:

```text
RV10
RV30
```

La varianza es muestral y divide por:

```text
window - 1
```

## 11.3 Requisito

Se requieren al menos 31 candles.

## 11.4 Clasificación

```text
RV10 > RV30
    → high
    → vol en expansión

RV10 ≤ RV30
    → low
    → vol en contracción
```

No existe banda muerta.

Cualquier diferencia, incluso mínima, puede cambiar la clasificación.

---

# 12. VIX

La primera condición de Market Eligibility es:

```text
VIX < 30
```

Interpretación:

```text
VIX < 30
    → condición favorable

VIX ≥ 30
    → mercado no elegible
```

El valor exacto se conserva en el Market Snapshot.

---

# 13. VIX Term Structure

Se compara:

```text
VIX 9D
VIX 30D
```

La condición positiva es:

```text
VIX9D < VIX30D
```

Esto representa una estructura temporal no invertida en el corto plazo.

Si:

```text
VIX9D ≥ VIX30D
```

la condición no es elegible.

---

# 14. IV Rank

GOT V3 requiere que el IV Rank se encuentre en el rango:

```text
25 ≤ IV Rank ≤ 65
```

El objetivo es evitar entornos donde la volatilidad implícita sea demasiado baja o excesivamente elevada para el perfil buscado.

---

# 15. IV Momentum

La condición positiva es:

```text
IV Momentum > 12%
```

La interpretación es que existe suficiente movimiento relativo de la volatilidad implícita para considerar el entorno adecuado para la estrategia.

---

# 16. GEX

La condición macro es:

```text
GEX ≥ 0
```

Esto significa que el entorno global de exposición gamma debe ser no negativo.

Este requisito también explica por qué `gex_sign` fue eliminado como indicador principal y reemplazado por `GEX Skew`.

---

# 17. Spot vs ZGL

La condición definida es:

```text
Spot > ZGL
```

El objetivo es exigir que el precio spot se encuentre por encima del nivel ZGL definido por el modelo.

---

# 18. Market Eligibility

Market Eligibility es una capa de filtrado macro.

Las condiciones positivas definidas son:

```text
VIX < 30
VIX9D < VIX30D
25 ≤ IV Rank ≤ 65
IV Momentum > 12%
GEX ≥ 0
Spot > ZGL
```

La regla conceptual es:

```text
Si todas las condiciones obligatorias se cumplen
    → MARKET ELIGIBLE

Si alguna condición obligatoria falla
    → MARKET NOT ELIGIBLE
```

El Market Diagnostic puede seguir mostrando todos los indicadores aunque el mercado sea no elegible.

La falta de elegibilidad detiene el proceso de Opportunity Discovery para ese símbolo.

No se crean nuevas oportunidades para ese símbolo en ese ciclo.

---

# 19. Market Snapshot

Cada ciclo de análisis genera una fotografía del estado del mercado.

El Snapshot puede contener:

- Spot.
- VIX.
- VIX9D.
- VIX30D.
- IV ATM.
- IV Rank.
- IV Momentum.
- GEX.
- GEX positivo.
- GEX negativo.
- GEX Skew Ratio.
- Call Wall.
- Put Wall.
- ZGL.
- Directional Z-Score.
- EMA20.
- EMA50.
- EMA Trend.
- RV10.
- RV30.
- RV Regime.
- Market Eligibility.
- Motivo de elegibilidad/no elegibilidad.

El Snapshot es una fotografía histórica.

No debe modificarse después de persistirse.

---

# 20. DTE y expirations

GOT V3 trabaja con vencimientos regulares.

No se utilizan vencimientos arbitrarios generados artificialmente.

La selección de vencimientos debe considerar los expirations regulares disponibles dentro de la ventana objetivo definida por la estrategia.

La ventana de trabajo general es aproximadamente:

```text
30–50 DTE
```

La selección concreta debe priorizar vencimientos regulares que se encuentren dentro de dicha ventana.

El DTE utilizado para una oportunidad es el DTE real entre la fecha de análisis y la fecha de vencimiento seleccionada.

No se debe forzar artificialmente un vencimiento para obtener exactamente 40 o cualquier otro número.

El sistema debe trabajar con el vencimiento real disponible que mejor cumpla la ventana configurada.

---

# 21. Opportunity Discovery

Una vez que el mercado es elegible, GOT V3 busca oportunidades en tres estructuras fijas:

1. PCS — Put Credit Spread.
2. CCS — Call Credit Spread.
3. IC — Iron Condor.

No existe una decisión de Market Bias que obligue a elegir una sola estructura.

Las estructuras son evaluadas de manera independiente.

La estrategia busca oportunidades estructurales basadas en:

- Gamma Walls.
- Safety Delta.
- Liquidez.
- Crédito disponible.
- Riesgo definido.
- Condición económica mínima.

---

# 22. Safety Delta

El Safety Delta representa la posición defensiva o de seguridad desde la cual se construye la oportunidad.

La opción short debe seleccionarse en una zona que cumpla el criterio de seguridad definido por la estrategia, considerando:

- Delta.
- Distancia respecto a Gamma Walls.
- Liquidez.
- Estructura del mercado.

La definición concreta de Safety Delta debe permanecer parametrizable en la configuración de GOT V3.

El Safety Delta no es el Entry Delta.

La distinción fundamental es:

```text
Safety Delta
    → define dónde se construye la oportunidad

Entry Delta
    → define cuándo se genera la alerta
```

---

# 23. Entry Delta

El Entry Delta es la variable dinámica utilizada para determinar el momento de generación de la alerta.

La ventana de entrada definida inicialmente es:

```text
0.15 ≤ |Delta| ≤ 0.20
```

El sistema no ejecuta la posición al entrar en esta ventana.

El sistema genera una alerta.

El usuario decide posteriormente si desea ejecutar la operación.

---

# 24. Entry Trigger

GOT V3 utiliza una filosofía de `wait for the market to come to us`.

La oportunidad se identifica primero.

Luego se congela.

Después se espera que el Delta de la opción short alcance la zona de Entry Delta.

La condición principal es:

```text
PreviousDelta > EntryDeltaMax
AND
EntryDeltaMin ≤ CurrentDelta ≤ EntryDeltaMax
```

Con valores por defecto:

```text
PreviousDelta > 0.20
AND
0.15 ≤ CurrentDelta ≤ 0.20
```

Ejemplo válido:

```text
0.22 → 0.19
```

Genera Entry Trigger.

---

# 25. Salto sobre la Entry Zone

Si el Delta pasa directamente de un valor superior a la zona a un valor inferior a la zona:

```text
0.22 → 0.14
```

GOT V3 **NO genera alerta**.

La razón es que el sistema nunca observó el Delta dentro de la zona:

```text
0.15 ≤ Delta ≤ 0.20
```

GOT V3 no interpola ni supone que el Delta pasó por valores que no fueron observados.

Esta regla evita falsos triggers.

---

# 26. Datos discontinuos del WebSocket

El WebSocket puede entregar datos con intervalos variables.

Por ejemplo:

```text
0.22

[sin datos durante varios segundos]

0.14
```

GOT V3 no puede afirmar que el Delta pasó por `0.20`, `0.19`, `0.18`, etc.

Por lo tanto:

```text
No se genera alerta.
```

La estrategia trabaja únicamente con valores realmente observados.

---

# 27. Persistencia del Delta

El sistema debe mantener:

```text
PreviousDelta
CurrentDelta
LastMarketDataAt
```

Esto permite evaluar el crossing.

Sin embargo, no es necesario persistir cada tick del WebSocket en SQL Server.

El estado de alta frecuencia debe mantenerse en memoria.

SQL Server se utiliza para persistencia de estado relevante y recuperación.

La arquitectura recomendada es:

```text
WebSocket
    ↓
In-Memory Monitoring State
    ↓
Entry Trigger Evaluator
    ↓
Persistencia únicamente en eventos importantes
```

Eventos importantes:

- Inicio del monitoreo.
- Cambio de estado.
- Trigger.
- Error.
- Reconexión.
- Heartbeat periódico.

Después de un reinicio, si no se dispone de un `PreviousDelta` confiable, el sistema debe esperar datos suficientes para establecer un nuevo estado antes de evaluar un crossing.

---

# 28. Credit / Width

Una regla que inicialmente se evaluó fue:

```text
Credit / Width ≥ 1/3
```

Esta regla fue descartada como requisito obligatorio de GOT V3.

La razón es que puede resultar excesivamente restrictiva en deltas bajos y eliminar oportunidades reales que, aun siendo económicamente válidas, no cumplen una relación fija de un tercio del ancho.

Por lo tanto:

```text
Credit / Width ≥ 1/3
```

**NO es un filtro obligatorio de V3.**

---

# 29. Crédito mínimo económico

GOT V3 incorpora una condición económica mínima basada en el DTE.

La idea es evitar oportunidades cuyo crédito sea tan bajo que no resulte razonable mantener riesgo definido durante el período restante.

La regla simplificada adoptada es:

```text
Minimum Credit = 1 USD × DTE
```

Por lo tanto:

```text
Credit ≥ DTE
```

Ejemplos:

```text
30 DTE → Credit mínimo = $30
40 DTE → Credit mínimo = $40
45 DTE → Credit mínimo = $45
50 DTE → Credit mínimo = $50
```

Esta regla reemplaza el intento de utilizar directamente el rendimiento de un Treasury 10Y multiplicado por DTE, que se consideró demasiado permisivo y menos intuitivo para la primera versión.

El valor de `$1 por día de DTE` debe ser configurable en el sistema, pero el valor de referencia de V3 es:

```text
DailyMinimumCredit = $1
```

La comparación se realiza sobre el crédito conservador disponible para la estructura.

---

# 30. Conservative Credit

Para evaluar el crédito, GOT V3 debe utilizar una valoración conservadora de la estructura.

En términos generales:

```text
Credit = ingreso neto esperado por la venta de la estructura
```

Para una evaluación conservadora, se debe evitar utilizar precios demasiado optimistas.

La implementación concreta deberá definir el cálculo con Bid/Ask según la estructura y la liquidez disponible.

El principio es:

> La oportunidad debe ser económicamente válida utilizando un crédito razonablemente ejecutable, no un crédito teórico basado exclusivamente en el mid price.

La regla mínima será:

```text
ConservativeCredit ≥ MinimumCredit
```

---

# 31. PCS — Put Credit Spread

La estructura es:

```text
SELL PUT
BUY PUT
```

Ambas opciones pertenecen al mismo vencimiento.

El short put representa la opción cuyo Delta será monitoreado.

El long put define el riesgo máximo.

El crédito es:

```text
Credit = ShortPutPremium - LongPutPremium
```

El ancho es:

```text
Width = ShortPutStrike - LongPutStrike
```

El riesgo máximo teórico es:

```text
MaxLoss = Width - Credit
```

La oportunidad es válida si cumple las reglas de:

- Safety Delta.
- Gamma Wall.
- Liquidez.
- Crédito mínimo.
- Estructura válida.

---

# 32. CCS — Call Credit Spread

La estructura es:

```text
SELL CALL
BUY CALL
```

Ambas opciones pertenecen al mismo vencimiento.

El short call representa la opción cuyo Delta será monitoreado.

El long call define el riesgo máximo.

El crédito es:

```text
Credit = ShortCallPremium - LongCallPremium
```

El ancho es:

```text
Width = LongCallStrike - ShortCallStrike
```

El riesgo máximo es:

```text
MaxLoss = Width - Credit
```

---

# 33. IC — Iron Condor

La estructura está compuesta por dos spreads:

```text
BUY PUT
SELL PUT
SELL CALL
BUY CALL
```

Todas las opciones pertenecen al mismo vencimiento.

El IC combina:

```text
Put Credit Spread
+
Call Credit Spread
```

El crédito total es la suma de ambos créditos.

El riesgo máximo se determina por el lado de mayor ancho menos el crédito total.

El sistema debe evaluar la estructura completa y sus componentes.

El monitoreo de Entry Delta debe definirse de forma independiente para los short legs.

La V3 debe evitar generar una alerta duplicada por el mismo IC si ambos lados alcanzan la zona de entrada.

Una única Opportunity IC puede generar como máximo una Alert.

---

# 34. Opportunity Lock

Cuando una oportunidad cumple todos los requisitos, GOT V3 la congela.

El Lock debe conservar:

- Symbol.
- Expiration.
- DTE inicial.
- Structure Type.
- Call Wall.
- Put Wall.
- ZGL.
- Short Strike.
- Long Strike.
- Safety Delta.
- Entry Delta Min.
- Entry Delta Max.
- Initial Credit.
- Conservative Credit.
- Minimum Credit.
- Width.
- Max Loss.
- Daily Minimum Credit.
- Market Snapshot de creación.

Una vez creada la Opportunity:

```text
El mercado puede cambiar.
La Opportunity no se modifica.
```

El objetivo es evitar que una oportunidad inicialmente detectada sea redefinida dinámicamente mientras se espera el trigger.

---

# 35. Opportunity Identity

Para V3, una oportunidad se identifica funcionalmente por:

```text
Symbol
+
Expiration
+
StructureType
```

Mientras exista una oportunidad en estado:

```text
WAITING
```

o:

```text
ALERTED
```

no debe crearse otra oportunidad equivalente para el mismo símbolo, vencimiento y estructura.

La regla es:

```text
WAITING
    → bloquea duplicados

ALERTED
    → bloquea duplicados

EXPIRED
    → libera

INVALIDATED
    → libera

CANCELLED
    → libera
```

La intención es evitar múltiples alertas sobre la misma oportunidad lógica.

---

# 36. Estados de Opportunity

Estados definidos:

```text
WAITING
ALERTED
EXPIRED
INVALIDATED
CANCELLED
```

## WAITING

La oportunidad fue descubierta y está esperando que se produzca el Entry Trigger.

## ALERTED

El Entry Trigger ocurrió y la alerta fue generada.

GOT V3 termina su responsabilidad operativa sobre esa oportunidad.

## EXPIRED

El vencimiento ya no permite continuar el monitoreo.

## INVALIDATED

La oportunidad dejó de ser válida por una condición de negocio definida por el sistema.

La V3 debe especificar posteriormente cuáles son exactamente las condiciones de invalidación automática.

## CANCELLED

La oportunidad fue cancelada manualmente o por una acción administrativa.

---

# 37. Opportunity State Machine

Flujo principal:

```text
             ┌───────────┐
             │  WAITING  │
             └─────┬─────┘
                   │
          ┌────────┼────────┐
          │        │        │
          ▼        ▼        ▼
       TRIGGER   EXPIRE   CANCEL
          │        │        │
          ▼        ▼        ▼
       ALERTED  EXPIRED  CANCELLED
          
WAITING
   │
   └── INVALIDATION → INVALIDATED
```

`ALERTED`, `EXPIRED`, `INVALIDATED` y `CANCELLED` son estados terminales de la oportunidad en V3.

---

# 38. Opportunity Legs

Cada Opportunity está compuesta por uno o más legs.

PCS:

```text
SHORT PUT
LONG PUT
```

CCS:

```text
SHORT CALL
LONG CALL
```

IC:

```text
SHORT PUT
LONG PUT
SHORT CALL
LONG CALL
```

Cada leg conserva:

- Leg Role.
- Option Type.
- Strike.
- Option Symbol.
- Delta en creación.
- Bid en creación.
- Ask en creación.

---

# 39. Monitoring Subscription

El monitoreo se realiza sobre los legs short.

La relación recomendada es:

```text
Opportunity
    ↓
OpportunityLeg
    ↓
MonitoringSubscription
```

No se debe duplicar `OpportunityId` en `MonitoringSubscription`, ya que la Opportunity se puede obtener mediante el leg.

Esto evita inconsistencias referenciales.

Cada `OpportunityLeg` monitoreado tiene una única `MonitoringSubscription`.

---

# 40. Estados de MonitoringSubscription

Estados:

```text
CREATED
STARTING
ACTIVE
DEGRADED
RECONNECTING
TRIGGERED
STOPPED
FAILED
```

## CREATED

La suscripción existe, pero todavía no fue iniciada.

## STARTING

El sistema está estableciendo conexión y suscripción.

## ACTIVE

El WebSocket está funcionando correctamente y se reciben datos.

## DEGRADED

Existe una condición de degradación o pérdida parcial de datos.

## RECONNECTING

El sistema está intentando restablecer la conexión.

## TRIGGERED

El Entry Trigger fue detectado.

## STOPPED

El monitoreo fue detenido.

## FAILED

La suscripción no puede continuar correctamente y requiere reintento o intervención.

---

# 41. Monitoring State Machine

```text
CREATED
    ↓
STARTING
    ↓
ACTIVE
    │
    ├─────────────┐
    │             │
    ▼             ▼
DEGRADED      TRIGGERED
    │
    ▼
RECONNECTING
    │
    ▼
ACTIVE

ACTIVE
    ↓
STOPPED

STARTING / RECONNECTING
    ↓
FAILED
```

---

# 42. Alert Engine

El Alert Engine es responsable exclusivamente de detectar el momento de entrada.

No ejecuta órdenes.

No modifica posiciones.

No calcula cierres.

Su función es:

```text
CurrentDelta
+
PreviousDelta
+
EntryDeltaZone
```

y determinar si ocurrió el Entry Trigger.

---

# 43. Alert

Una Alert representa un evento histórico:

> La Opportunity alcanzó su Entry Trigger.

La Alert debe ser inmutable.

Debe conservar:

- OpportunityId.
- TriggeredAt.
- Trigger Delta.
- Entry Delta Min.
- Entry Delta Max.
- Symbol.
- Structure.
- Spot.
- Credit.
- Conservative Credit.
- VIX.
- IV Rank.
- IV Momentum.
- GEX.
- GEX Skew.
- Call Wall.
- Put Wall.

La alerta representa una fotografía del mercado en el momento del trigger.

---

# 44. Una Opportunity produce como máximo una Alert

La regla es:

```text
1 Opportunity
    ↓
0 o 1 Alert
```

Se implementa mediante una restricción única:

```text
UNIQUE(OpportunityId)
```

Esto protege contra:

- Eventos duplicados del WebSocket.
- Reintentos.
- Procesamiento concurrente.
- Reconexiones.
- Race conditions.

---

# 45. Alert Delivery

Una Alert representa el evento.

Una `AlertDelivery` representa el intento de entregar dicho evento a un destinatario.

Ejemplo:

```text
Alert #100
   │
   ├── UI
   │
   ├── Telegram User A
   │
   ├── Telegram User B
   │
   └── Telegram User C
```

Cada entrega tiene estado independiente.

Estados:

```text
PENDING
PROCESSING
SENT
FAILED
```

---

# 46. Telegram

Cuando se genera una alerta, el sistema debe enviar la notificación a usuarios predefinidos de Telegram.

Los destinatarios deben ser configurables.

El sistema debe permitir activar o desactivar destinatarios.

Una misma alerta no debe generar múltiples entregas lógicas al mismo destinatario.

La unicidad es:

```text
AlertId
+
DeliveryChannel
+
RecipientId
```

---

# 47. Alerta visual en la UI

La alerta generada debe aparecer destacada en la pantalla principal.

La UI debe permitir identificar claramente:

- Símbolo.
- Estructura.
- Vencimiento.
- DTE original.
- Strike short.
- Strike long.
- Entry Delta observado.
- Credit.
- Conservative Credit.
- Call Wall.
- Put Wall.
- Spot.
- Momento de alerta.

La alerta debe ser visualmente diferenciada de:

- Oportunidades en espera.
- Oportunidades no elegibles.
- Datos de diagnóstico.
- Alertas históricas.

La implementación visual será definida en la especificación de frontend.

---

# 48. Outbox Pattern

La distribución de alertas utiliza un patrón Outbox.

El objetivo es garantizar que una alerta persistida no se pierda si el servidor falla antes de enviar la notificación.

Flujo:

```text
WebSocket
    ↓
Entry Trigger
    ↓
SQL Transaction
    ├── Create Alert
    ├── Opportunity → ALERTED
    ├── Monitoring → TRIGGERED
    └── Create OutboxEvent
    ↓
COMMIT
    ↓
Notification Worker
    ├── SignalR
    └── Telegram
```

La alerta y el evento Outbox deben persistirse en la misma transacción.

---

# 49. Outbox Event

Un `OutboxEvent` representa un evento interno pendiente de procesamiento.

Campos conceptuales:

- Id.
- EventType.
- AggregateType.
- AggregateId.
- Payload.
- Status.
- AttemptCount.
- AvailableAt.
- ProcessedAt.
- LastError.
- CreatedAt.

Estados:

```text
PENDING
PROCESSING
PROCESSED
FAILED
```

---

# 50. Recuperación del Outbox

Si el servidor falla después de crear la alerta:

```text
Alert = existe
OutboxEvent = PENDING
```

Al reiniciar:

```text
Notification Worker
    ↓
Encuentra PENDING
    ↓
Procesa
```

La alerta no se pierde.

---

# 51. Idempotencia

GOT V3 debe garantizar idempotencia en los puntos críticos.

## Opportunity

Una única Opportunity activa por:

```text
Symbol + Expiration + StructureType
```

mientras el estado sea `WAITING` o `ALERTED`.

## Alert

Una única Alert por:

```text
OpportunityId
```

## Monitoring

Una única MonitoringSubscription por:

```text
OpportunityLegId
```

## Delivery

Una única entrega lógica por:

```text
AlertId + Channel + RecipientId
```

---

# 52. Concurrencia en Discovery

Dos procesos pueden descubrir simultáneamente la misma oportunidad.

Ejemplo:

```text
Worker A → Opportunity válida
Worker B → Opportunity válida
```

Ambos pueden intentar insertar.

La base de datos debe actuar como última barrera mediante índice único.

El flujo es:

```text
A → INSERT → OK

B → INSERT
      ↓
UNIQUE VIOLATION
      ↓
Tratar como duplicado
```

No es necesario bloquear toda la tabla.

La restricción única garantiza consistencia.

---

# 53. Concurrencia en Alert

Dos eventos del WebSocket pueden llegar casi simultáneamente:

```text
Event A → Trigger
Event B → Trigger
```

Ambos pueden intentar crear una alerta.

La base de datos garantiza:

```text
UNIQUE(OpportunityId)
```

Solo una operación puede crear la Alert.

El segundo proceso debe tratar el conflicto como:

```text
Alert already exists
```

No debe generar una segunda notificación.

---

# 54. Problema de entrega externa

Telegram es un sistema externo.

Puede ocurrir:

```text
Telegram recibe mensaje
        ↓
Servidor se cae
        ↓
Estado no llega a SENT
```

Al reiniciar puede existir un reintento.

Esto puede provocar un duplicado externo.

La V3 debe aceptar esta posibilidad técnica, porque Telegram no garantiza una operación transaccional distribuida con SQL Server.

El objetivo es garantizar:

```text
At-least-once delivery
```

con deduplicación lógica interna.

---

# 55. Modelo de datos

Las entidades principales son:

```text
Symbols
MarketSnapshots
Opportunities
OpportunityLegs
MonitoringSubscriptions
Alerts
AlertDeliveries
AlertRecipients
OutboxEvents
```

Relación:

```text
Symbols
    │
    ├── MarketSnapshots
    │
    └── Opportunities
            │
            └── OpportunityLegs
                    │
                    └── MonitoringSubscriptions

Opportunities
    │
    └── Alerts
            │
            └── AlertDeliveries

Alerts
    │
    └── OutboxEvents
```

---

# 56. Tabla Symbols

Representa los instrumentos configurados para análisis.

Campos principales:

```text
Id
Symbol
DisplayName
IsActive
CreatedAt
UpdatedAt
```

`Symbol` es único.

---

# 57. Tabla MarketSnapshots

Representa la fotografía del mercado.

Campos principales:

```text
Id
SymbolId
SnapshotAt
Spot
Vix
Vix9D
Vix30D
IVAtm
IVRank
IVMomentum
Gex
GexPositive
GexNegative
GexSkewRatio
CallWall
PutWall
Zgl
DirectionalZScore
Ema20
Ema50
EmaTrend
Rv10
Rv30
RvRegime
MarketEligibility
MarketEligibilityReason
CreatedAt
```

Los snapshots son históricos e inmutables.

---

# 58. Tabla Opportunities

Representa la oportunidad congelada.

Campos principales:

```text
Id
SymbolId
MarketSnapshotId
Expiration
DteAtCreation
StructureType
Status
CallWall
PutWall
Zgl
SafetyDelta
EntryDeltaMin
EntryDeltaMax
InitialCredit
ConservativeCredit
MinimumCredit
Width
MaxLoss
DailyMinimumReturnRate
CreatedAt
AlertedAt
ExpiredAt
InvalidatedAt
CancelledAt
```

`StructureType`:

```text
PCS
CCS
IC
```

---

# 59. Tabla OpportunityLegs

Representa los contratos individuales.

Campos principales:

```text
Id
OpportunityId
LegRole
OptionType
Strike
OptionSymbol
DeltaAtCreation
BidAtCreation
AskAtCreation
CreatedAt
```

`LegRole`:

```text
SHORT
LONG
```

`OptionType`:

```text
PUT
CALL
```

---

# 60. Tabla MonitoringSubscriptions

Representa el monitoreo de un leg.

Campos principales:

```text
Id
OpportunityLegId
MonitoringType
Status
PreviousDelta
CurrentDelta
LastMarketDataAt
WebSocketConnectionId
LastError
CreatedAt
StartedAt
StoppedAt
```

No debe almacenar redundante `OpportunityId`.

La Opportunity se obtiene mediante:

```text
MonitoringSubscription
    → OpportunityLeg
    → Opportunity
```

---

# 61. Tabla Alerts

Representa el evento de Entry Trigger.

Campos principales:

```text
Id
OpportunityId
TriggeredMonitoringSubscriptionId
Symbol
StructureType
TriggerSide
TriggerType
TriggerDelta
EntryDeltaMin
EntryDeltaMax
TriggeredAt
Spot
Credit
ConservativeCredit
Vix
IVRank
IVMomentum
Gex
GexSkewRatio
CallWall
PutWall
CreatedAt
```

La Alert es inmutable.

---

# 62. Tabla AlertDeliveries

Representa cada entrega.

Campos principales:

```text
Id
AlertId
DeliveryChannel
RecipientId
Status
AttemptCount
LastAttemptAt
DeliveredAt
LastError
CreatedAt
```

Canales:

```text
TELEGRAM
UI
```

---

# 63. Tabla AlertRecipients

Representa los destinatarios configurados.

Campos:

```text
Id
Name
TelegramChatId
IsActive
CreatedAt
```

---

# 64. Tabla OutboxEvents

Representa eventos pendientes de distribución.

Campos:

```text
Id
EventType
AggregateType
AggregateId
Payload
Status
AttemptCount
AvailableAt
ProcessedAt
LastError
CreatedAt
```

---

# 65. Índices críticos

## Symbols

```text
UNIQUE(Symbol)
```

## MarketSnapshots

```text
(SymbolId, SnapshotAt DESC)
```

## Opportunities

```text
UNIQUE(SymbolId, Expiration, StructureType)
WHERE Status IN ('WAITING', 'ALERTED')
```

## OpportunityLegs

```text
(OpportunityId)
```

## MonitoringSubscriptions

```text
UNIQUE(OpportunityLegId)
```

## Alerts

```text
UNIQUE(OpportunityId)
```

## AlertDeliveries

```text
UNIQUE(AlertId, DeliveryChannel, RecipientId)
```

## OutboxEvents

Índice sobre:

```text
(Status, AvailableAt)
```

---

# 66. Transacción de Entry Trigger

Cuando el WebSocket detecta un trigger:

```text
BEGIN TRANSACTION

1. Leer Opportunity.

2. Verificar Status = WAITING.

3. Crear Alert.

4. Si UNIQUE(OpportunityId) falla:
       La alerta ya existe.
       Finalizar.

5. Cambiar Opportunity:
       WAITING → ALERTED

6. Cambiar MonitoringSubscription:
       ACTIVE → TRIGGERED

7. Crear OutboxEvent:
       ALERT_CREATED

8. Crear AlertDeliveries.

COMMIT
```

La operación debe ser atómica.

---

# 67. Flujo completo de persistencia

```text
DISCOVERY
    ↓
Create MarketSnapshot
    ↓
Market Diagnostic
    ↓
Market Eligibility
    ↓
Find Candidate
    ↓
Check Active Opportunity
    │
    ├── EXISTS → Ignore
    │
    └── NOT EXISTS
            ↓
      Create Opportunity
            ↓
      Create OpportunityLegs
            ↓
      Create MonitoringSubscriptions
            ↓
      Commit
```

---

# 68. Flujo de monitoreo

```text
Monitoring Worker
      ↓
Load WAITING Opportunities
      ↓
Load MonitoringSubscriptions
      ↓
Connect WebSocket
      ↓
Subscribe Options
      ↓
Receive Delta
      ↓
Update In-Memory State
      ↓
Evaluate Trigger
```

---

# 69. Flujo de alerta

```text
Trigger Detected
      ↓
BEGIN TRANSACTION
      ↓
Create Alert
      ↓
Opportunity → ALERTED
      ↓
Monitoring → TRIGGERED
      ↓
Create OutboxEvent
      ↓
Create AlertDeliveries
      ↓
COMMIT
      ↓
Notification Worker
      ├── UI / SignalR
      └── Telegram
```

---

# 70. Arquitectura lógica recomendada

```text
MarketDataService
        ↓
MarketDiagnosticService
        ↓
MarketEligibilityService
        ↓
OpportunityDiscoveryService
        ↓
OpportunityLockService
        ↓
MonitoringService
        ↓
EntryTriggerService
        ↓
AlertService
        ↓
NotificationService
```

Responsabilidades:

## MarketDiagnosticService

Calcula indicadores del diagnóstico.

## MarketEligibilityService

Evalúa condiciones macro.

## OpportunityDiscoveryService

Busca oportunidades PCS, CCS e IC.

## OpportunityLockService

Congela la oportunidad.

## MonitoringService

Administra WebSocket y suscripciones.

## EntryTriggerService

Evalúa Entry Delta.

## AlertService

Crea la alerta única.

## NotificationService

Distribuye mediante SignalR y Telegram.

---

# 71. Persistencia y Dapper

Para el backend .NET 8 existente se recomienda mantener Dapper como mecanismo de acceso a datos.

No es necesario introducir Entity Framework únicamente para GOT V3.

Repositorios principales:

```text
IMarketSnapshotRepository
IOpportunityRepository
IOpportunityLegRepository
IMonitoringSubscriptionRepository
IAlertRepository
IAlertDeliveryRepository
IOutboxRepository
IAlertRecipientRepository
```

Operaciones críticas:

```text
CreateOpportunityIfNotExistsAsync
CreateAlertIfNotExistsAsync
CreateOutboxEventAsync
ClaimPendingOutboxEventsAsync
MarkOutboxProcessedAsync
```

---

# 72. Workers recomendados

La implementación puede dividirse en Workers especializados:

```text
DiscoveryWorker
MonitoringWorker
OutboxWorker
NotificationWorker
CleanupWorker
```

## DiscoveryWorker

Analiza símbolos y crea oportunidades.

## MonitoringWorker

Mantiene suscripciones WebSocket.

## OutboxWorker

Recupera eventos pendientes.

## NotificationWorker

Entrega alertas.

## CleanupWorker

Gestiona limpieza de datos históricos según políticas futuras.

---

# 73. Recuperación después de reinicio

Si el servidor se reinicia:

1. Cargar Opportunities `WAITING`.
2. Cargar OpportunityLegs.
3. Cargar MonitoringSubscriptions.
4. Reconstruir conexiones WebSocket.
5. Reanudar monitoreo.
6. Cargar OutboxEvents pendientes.
7. Reanudar notificaciones.

Las oportunidades `ALERTED` no deben volver a monitorearse.

Las oportunidades `EXPIRED`, `INVALIDATED` y `CANCELLED` tampoco.

---

# 74. Principio de recuperación

GOT V3 debe poder reiniciarse sin perder:

- Opportunities.
- Alerts.
- Outbox Events.
- Alert Deliveries.

El estado de alta frecuencia del WebSocket puede reconstruirse.

La persistencia de SQL Server representa la verdad durable del sistema.

---

# 75. Qué ocurre si el mercado deja de ser elegible

Una vez creada una Opportunity `WAITING`, el Market Diagnostic original no se modifica.

El hecho de que posteriormente:

```text
VIX ≥ 30
```

o:

```text
GEX < 0
```

no invalida automáticamente la oportunidad en V3, salvo que se implemente explícitamente una regla de invalidación futura.

Esto es importante porque el `Market Snapshot` representa el contexto en el momento del Discovery.

La Opportunity está congelada.

Por lo tanto:

```text
Market Eligibility
    → decide si crear Opportunity

Opportunity Lock
    → congela la oportunidad

Monitoring
    → espera Entry Trigger
```

No existe en V3 una reevaluación continua del Market Eligibility como requisito obligatorio.

---

# 76. Qué ocurre si cambia el crédito

Una vez bloqueada la Opportunity:

```text
El crédito original queda congelado.
```

El sistema puede mostrar posteriormente el crédito actual si dispone de datos en tiempo real, pero el criterio económico que validó la creación de la oportunidad no se modifica.

La alerta representa el trigger de la oportunidad original.

La V3 no reconfigura automáticamente strikes para adaptarse a cambios de crédito.

---

# 77. Qué ocurre si cambia el Gamma Wall

El Gamma Wall utilizado en el Discovery queda congelado dentro de la Opportunity.

Los Gamma Walls del mercado pueden cambiar posteriormente.

GOT V3 no mueve automáticamente los strikes de la oportunidad.

La filosofía es:

```text
Detectar
    ↓
Congelar
    ↓
Esperar
```

No:

```text
Detectar
    ↓
Modificar continuamente
```

---

# 78. Filosofía de operación

GOT V3 implementa una filosofía de paciencia.

El sistema no busca perseguir el precio.

No busca ejecutar inmediatamente una estructura simplemente porque el mercado es elegible.

La secuencia es:

```text
El mercado ofrece una estructura
        ↓
GOT la identifica
        ↓
GOT la congela
        ↓
El mercado evoluciona
        ↓
GOT espera
        ↓
El Delta alcanza la Entry Zone
        ↓
GOT alerta
```

Esto separa claramente:

```text
WHERE
```

de:

```text
WHEN
```

`Safety Delta` y la estructura definen principalmente el **dónde**.

`Entry Delta` define principalmente el **cuándo**.

---

# 79. Lo que GOT V3 NO hace

La V3 no contempla:

- Ejecución automática.
- Envío de órdenes a un broker.
- Apertura de posiciones.
- Cierre de posiciones.
- Profit target.
- Stop loss.
- Rolling.
- Ajustes.
- Gestión de posiciones abiertas.
- Gestión de portfolio.
- Position sizing.
- Asignación de capital.
- Portfolio risk management.
- Rebalanceo.

Estas funcionalidades podrán ser objeto de futuras versiones.

---

# 80. Futuras extensiones

Quedan explícitamente fuera de V3, para estudiar posteriormente:

1. Gestión de posiciones.
2. Cierre automático al 50% de beneficio.
3. Stop loss.
4. Rolling.
5. Ajustes dinámicos.
6. Revalidación continua de Market Eligibility.
7. Repricing dinámico de oportunidades.
8. Position sizing.
9. Gestión de capital.
10. Optimización avanzada del Entry Delta dentro de la ventana 0.15–0.20.
11. Análisis de crédito dinámico.
12. Evaluación de slippage.
13. Modelos estadísticos de calidad de ejecución.
14. Backtesting completo.
15. Ejecución automática.

---

# 81. Resumen de reglas congeladas

## Market Diagnostic

```text
Directional Z-Score
    < 1.0 absoluto → neutral
    1.0–1.5 → moderate
    ≥ 1.5 → extreme
```

```text
GEX Skew
    > 0.6 → call_dominant
    < 0.4 → put_dominant
    resto → symmetric
```

```text
EMA
    diferencia relativa < 0.2% → neutral
    EMA20 > EMA50 → up
    EMA20 < EMA50 → down
```

```text
RV
    RV10 > RV30 → high
    RV10 ≤ RV30 → low
```

## Market Eligibility

```text
VIX < 30
VIX9D < VIX30D
25 ≤ IV Rank ≤ 65
IV Momentum > 12%
GEX ≥ 0
Spot > ZGL
```

## Gamma Walls

```text
Call Wall
= mayor concentración de gamma positiva neta

Put Wall
= mayor concentración de gamma negativa neta en valor absoluto
```

Los Gamma Walls consideran la cadena completa de vencimientos y strikes disponibles.

## Structures

```text
PCS
CCS
IC
```

## DTE

```text
Ventana objetivo: aproximadamente 30–50 DTE
```

Se utilizan vencimientos regulares disponibles.

## Credit

```text
Credit / Width ≥ 1/3
```

No es requisito obligatorio.

## Minimum Credit

```text
MinimumCredit = $1 × DTE
```

El crédito conservador debe ser igual o superior al mínimo.

## Entry Delta

```text
0.15 ≤ |Delta| ≤ 0.20
```

## Entry Trigger

```text
PreviousDelta > 0.20
AND
0.15 ≤ CurrentDelta ≤ 0.20
```

## Direct Jump

```text
0.22 → 0.14
```

No alerta.

## Opportunity

```text
1 Opportunity
→ máximo 1 Alert
```

## Alert Delivery

```text
UI
+
Telegram
```

## Strategy Scope

```text
Alertas únicamente.
Sin ejecución.
Sin gestión de posiciones.
Sin cierres.
```

---

# 82. Flujo maestro definitivo

El funcionamiento completo de GOT V3 queda resumido en:

```text
┌──────────────────────────┐
│      LISTA SYMBOLS       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│      MARKET DATA         │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│   MARKET DIAGNOSTIC      │
│                          │
│ Z-Score                  │
│ GEX Skew                 │
│ EMA Trend                │
│ RV Regime                │
│ VIX                      │
│ Term Structure           │
│ IV Rank                  │
│ IV Momentum              │
│ GEX                      │
│ Spot vs ZGL              │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│   MARKET ELIGIBILITY     │
└────────────┬─────────────┘
             │
       ┌─────┴─────┐
       │           │
   NOT ELIGIBLE  ELIGIBLE
       │           │
       ▼           ▼
      FIN    ┌───────────────┐
             │   DISCOVERY   │
             │               │
             │ PCS           │
             │ CCS           │
             │ IC            │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │ OPPORTUNITY   │
             │     LOCK      │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │   WAITING     │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │ ENTRY DELTA   │
             │  MONITORING   │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │ ENTRY TRIGGER │
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │     ALERT     │
             └───────┬───────┘
                     │
              ┌──────┴──────┐
              │             │
              ▼             ▼
         SIGNALR/UI      TELEGRAM
```

---

# 83. Principio final de GOT V3

La estrategia GOT V3 puede resumirse en una única idea:

> **GOT analiza el mercado, espera condiciones estructurales adecuadas, identifica una oportunidad con riesgo definido, congela sus parámetros y espera pacientemente a que el mercado alcance el Entry Delta deseado. Cuando el mercado llega, GOT no opera: alerta.**

La estrategia, por diseño, separa cuatro conceptos:

```text
DIAGNOSTIC
¿Qué está pasando en el mercado?

ELIGIBILITY
¿El entorno es aceptable?

DISCOVERY
¿Qué oportunidad estructural existe?

TRIGGER
¿Cuándo el mercado llegó a nuestro punto?
```

El sistema finaliza su responsabilidad en:

```text
TRIGGER
    ↓
ALERT
```

A partir de ese momento, la decisión de ejecución pertenece al usuario o a una futura capa de ejecución que no forma parte de GOT V3.

---

# 84. Estado del documento

Este documento consolida el diseño de GOT V3 definido hasta el momento.

Las futuras modificaciones deberán generar una nueva versión formal:

```text
GOT V3.1
GOT V3.2
GOT V4
```

No se deben modificar silenciosamente las reglas de este documento durante la implementación.

Toda modificación de una regla matemática, umbral, estructura, criterio de elegibilidad, Entry Trigger o máquina de estados deberá documentarse como cambio de versión.

**FIN DEL DOCUMENTO — GOT V3**
