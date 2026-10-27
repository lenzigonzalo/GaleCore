Secuencia completa de decisión GOT
MERCADO
   │
   ▼
1. MARKET DIAGNOSTIC
   │
   ▼
2. MARKET STRUCTURE
   │
   ▼
3. SELL ZONES
   │
   ▼
4. SAFETY STRIKE
   │
   ▼
5. CHAIN CANDIDATES
   │
   ▼
6. ENTRY DELTA 10–20%
   │
   ▼
7. CREDIT
   │
   ▼
8. POP
   │
   ▼
9. RISK / MAX LOSS
   │
   ▼
10. LIQUIDITY / EXECUTION
   │
   ▼
11. BEST CANDIDATE
   │
   ▼
12. ALERT

Pero hay una precisión importante: no necesariamente debemos evaluar todo secuencialmente en tiempo real. Algunas cosas son filtros estructurales, otras son filtros de cadena y otras son condiciones dinámicas. Vamos paso por paso.

1. MARKET DIAGNOSTIC
Pregunta

¿El mercado está en un contexto donde GOT puede buscar ventas de prima?

No elegimos todavía PUT, CALL ni IC.

Evaluamos:

IV
IV Rank
IV Momentum
RV
GEX
régimen gamma
Z-score
tendencia/EMA
ZGL
Expected Move

El resultado podría ser:

FAVORABLE
SELECTIVE
NO OPERATE

Esto es un filtro general, no una señal de entrada.

2. MARKET STRUCTURE

Ahora preguntamos:

¿Dónde están las zonas que estructuralmente nos interesa vender?

Acá entran principalmente:

Spot
ZGL
Put Wall
Call Wall
Gamma concentration
Expected Move
±1σ
régimen de GEX.

Por ejemplo:

                    +1σ 808
                       │
                 CALL WALL 790
                       │
                    SPY 769
                    ZGL 764
                       │
                    -1σ 725
                       │
                 PUT WALL 625

Todavía no elegimos una opción.

Estamos construyendo el mapa.

3. SELL ZONES

Transformamos la estructura en zonas operables.

Por ejemplo:

PUT SELL ZONE
720–730
CALL SELL ZONE
805–815

Y también definimos:

GAMMA EXCLUSION ZONES

Por ejemplo:

Call Wall 790
→ zona prohibida alrededor del wall

Put Wall 625
→ zona prohibida alrededor del wall

La pregunta es:

¿En qué región del mercado estamos dispuestos a vender?

4. SAFETY STRIKE

Ahora sí bajamos de una zona a strikes concretos.

Por ejemplo:

PUT SELL ZONE

730
725
720
715

El motor identifica cuáles son estructuralmente válidos.

Para cada strike evalúa:

distancia al spot
posición respecto de ZGL
posición respecto de ±1σ
distancia a gamma walls
gamma local
régimen gamma
restricciones estructurales.

Resultado:

730 → STRUCTURAL PASS
725 → STRUCTURAL PASS
720 → STRUCTURAL PASS
715 → STRUCTURAL PASS

Pero todavía no significa que podamos venderlos.

5. CHAIN CANDIDATES

Ahora conectamos estructura con la cadena real.

Para cada strike candidato obtenemos:

bid
ask
mid
delta
gamma
IV
volumen
open interest
DTE
spread
etc.

Y construimos las estructuras posibles.

Por ejemplo:

725 / 715 PCS
720 / 710 PCS
715 / 705 PCS

Ahora sí estamos hablando de operaciones reales.

6. ENTRY DELTA: 10–20%

Esta es la condición que acabamos de decidir mantener.

Para el short strike:

0.10 <= |Delta| <= 0.20
¿Qué estamos preguntando?

¿El strike que estructuralmente elegimos está dentro de una distancia/probabilidad de riesgo que consideramos aceptable?

No estamos diciendo que Delta determine el POP.

Y tampoco estamos diciendo que Delta determine el crédito.

Es simplemente una restricción adicional.

Ejemplo:

730 PUT → Delta .22 → FAIL
725 PUT → Delta .17 → PASS
720 PUT → Delta .13 → PASS
715 PUT → Delta .09 → FAIL

Entonces quedan:

725
720
7. CREDIT

Ahora preguntamos:

¿La recompensa económica es suficiente?

Ejemplo:

725/715 → Credit $84
720/710 → Credit $68

Si:

Minimum Credit = $80

entonces:

725/715 → PASS
720/710 → FAIL

Esto es importante:

Delta no reemplaza Credit.

Un candidato puede tener una delta perfecta y aun así ser descartado porque la prima es demasiado baja.

8. POP

Ahora:

¿La probabilidad estimada de éxito de la estructura cumple nuestro mínimo?

Por ejemplo:

725/715
POP = 83%

Si:

Minimum POP = 80%

→ PASS.

La POP se evalúa sobre la operación completa, no solamente sobre el short strike.

Esto es importante para no confundir:

Delta ≈ probabilidad de ITM del short

con:

POP = probabilidad estimada de éxito del spread

Son cosas diferentes.

9. RISK / MAX LOSS

Ahora:

¿El riesgo absoluto de la operación está dentro de nuestro límite?

Para un PCS:

Max Loss =
Width - Credit

Ejemplo:

Width = $10
Credit = $0.84

Max Loss = $9.16

Por contrato:

$916

Si nuestro límite fuera:

Max Risk = $1,000

→ PASS.

Si fuera:

Max Risk = $800

→ FAIL.

10. LIQUIDITY / EXECUTION

Ahora preguntamos:

¿Podemos realmente ejecutar esta operación a un precio razonable?

Evaluamos:

bid/ask del spread
bid/ask de cada leg
Open Interest
volumen
spread relativo
disponibilidad de cotización
calidad del mercado.

Por ejemplo:

725/715

OI        ✓
Volume    ✓
Spread    ✓
Quotes    ✓

→ PASS.

Si tenemos:

Bid/Ask = 0.60 / 1.10

podría ser:

→ FAIL.

No importa que todo lo demás sea perfecto.

11. Ahora aparece el candidato válido

Después de todos los filtros tenemos algo como:

STRUCTURE       ✓
DELTA 10–20     ✓
CREDIT          ✓
POP             ✓
MAX LOSS        ✓
LIQUIDITY       ✓

Entonces:

CANDIDATE = VALID

Pero puede haber más de uno.

12. ¿Cómo elegimos EL MEJOR?

Acá mantendría nuestra decisión anterior:

No scoring.

Primero eliminamos todos los candidatos que no cumplen.

Después buscamos el mejor candidato dentro del conjunto válido.

Para una misma zona y mismo tipo de estrategia, mi primera regla sería:

Elegir el candidato que maximiza el crédito, siempre que no sacrifique ninguna condición estructural, probabilística, de riesgo o liquidez.

Pero hay una consideración:

Si dos candidatos cumplen todo:

725/715
Credit = $84
POP = 83%

720/710
Credit = $82
POP = 86%

725 tiene más crédito, pero 720 tiene mayor protección.

Entonces no necesariamente podemos decir simplemente "mayor crédito".

Ahí usaría dominancia y luego una regla estructural.

13. Regla de selección que me gusta más

Primero:

1. Eliminar dominados.

Si A tiene:

más crédito
igual o mejor POP
igual o menor riesgo
igual o mejor liquidez
igual o mejor estructura

que B:

→ B desaparece.

Si queda uno:

ese es el BEST CANDIDATE.

Si quedan varios no dominados:

2. Preferir el strike más cercano al límite estructural seguro.

Porque nuestra filosofía es:

vender lo más cerca posible del mercado sin abandonar la zona de seguridad.

Esto maximiza la prima disponible sin aumentar arbitrariamente el riesgo.

14. Y acá ocurre algo muy importante con el tiempo

El proceso no termina cuando encontramos el Safety Strike.

El candidato entra en:

WATCH

Por ejemplo:

SPY = 769

Safety Strike = 725 PUT

Delta = .11
Credit = $52
POP = 89%

STATUS = WATCH

El mercado se mueve.

15. El candidato se actualiza dinámicamente

Supongamos:

SPY = 742

Delta = .15
Credit = $70
POP = 86%

Ahora:

Structure ✓
Delta ✓
Credit ✗
POP ✓
Risk ✓
Liquidity ✓

Todavía:

WATCH / ARMED

No hay entrada.

Después:

SPY = 736

Delta = .17
Credit = $84
POP = 83%
Risk = ✓
Liquidity = ✓

Ahora:

Structure ✓
Delta ✓
Credit ✓
POP ✓
Risk ✓
Liquidity ✓

Entonces:

ENTRY ALERT
16. Esto nos da tres estados muy claros
WATCH

El candidato existe, pero todavía no cumple todas las condiciones.

ARMED

Está entrando en la zona donde puede producirse la entrada y estamos monitoreándolo activamente.

ENTRY ALERT

Todas las condiciones están simultáneamente satisfechas.

17. ¿Qué puede invalidar el candidato?

En cualquier momento puede cambiar la estructura.

Por ejemplo:

Call Wall cambia
Put Wall cambia
ZGL cambia
Expected Move cambia
GEX cambia
SPY se mueve significativamente

Entonces debemos recalcular.

Si el Safety Strike deja de ser estructuralmente válido:

INVALIDATED

Y volvemos a:

MARKET STRUCTURE
       ↓
SELL ZONE
       ↓
SAFETY STRIKE
       ↓
...
18. Entonces la máquina completa queda así
                    MARKET
                       │
                       ▼
              MARKET DIAGNOSTIC
                       │
             ┌─────────┴─────────┐
             │                   │
          NO OPERATE          CONTINUE
                                 │
                                 ▼
                       MARKET STRUCTURE
                                 │
                                 ▼
                            SELL ZONES
                                 │
                                 ▼
                          SAFETY STRIKES
                                 │
                                 ▼
                        REAL OPTION CHAIN
                                 │
                                 ▼
                         DELTA 10–20%
                                 │
                         ┌───────┴───────┐
                         │               │
                        FAIL            PASS
                         │               │
                       DISCARD        CREDIT
                                         │
                                  ┌──────┴──────┐
                                  │             │
                                 FAIL         PASS
                                  │             │
                               DISCARD         POP
                                                │
                                         ┌──────┴──────┐
                                         │             │
                                        FAIL         PASS
                                         │             │
                                      DISCARD         RISK
                                                       │
                                                ┌──────┴──────┐
                                                │             │
                                               FAIL         PASS
                                                │             │
                                             DISCARD       LIQUIDITY
                                                              │
                                                       ┌──────┴──────┐
                                                       │             │
                                                      FAIL         PASS
                                                       │             │
                                                    DISCARD      VALID
                                                                    │
                                                                    ▼
                                                            BEST CANDIDATE
                                                                    │
                                                                    ▼
                                                                  WATCH
                                                                    │
                                                          conditions evolve
                                                                    │
                                                                    ▼
                                                              ENTRY ALERT
19. Y hay una distinción que me parece fundamental para la V3

Tenemos dos motores diferentes:

Structural Engine

Decide:

WHERE

¿Dónde queremos vender?

Utiliza:

GEX
Gamma Walls
ZGL
Expected Move
estructura de precio.
Candidate Engine

Decide:

WHICH

¿Cuál es la mejor operación disponible en esa zona?

Utiliza:

Delta 10–20%
Credit
POP
Max Loss
Risk
Liquidity.
Alert Engine

Decide:

WHEN

¿Cuándo están todas las condiciones simultáneamente satisfechas?

Esto es lo que genera la alerta.

20. La filosofía final

Creo que ahora GOT puede resumirse de una manera mucho más precisa:

El mercado define dónde queremos vender.

La Delta 10–20% limita la probabilidad/proximidad del short strike que estamos dispuestos a aceptar.

La cadena real determina si la operación tiene suficiente recompensa, probabilidad, riesgo y liquidez.

El sistema selecciona el mejor candidato que sobrevive a todos los filtros.

La evolución del mercado determina cuándo todas esas condiciones coinciden y se genera la alerta.

Y lo más importante:

no hay ningún paso que diga "quiero un PCS".

Primero encontramos una zona de venta. Después vemos qué estructura —PCS, CCS o IC— puede ocupar esa zona y sobrevivir a todas las restricciones.

Eso deja a GOT como un verdadero motor de selección de oportunidades, y no como un sistema que simplemente busca una estrategia predeterminada.