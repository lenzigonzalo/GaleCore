# Caso de uso E2E — Desarrollar una estrategia de opciones sobre SPY

> **Status under architecture v5:** `TARGET_APPROVED` as a long-term product direction and `DEFERRED` for implementation. This use case does not belong to Phase 3, does not define the current host adapter and cannot override `GaleCore-AI-arquitectura-v5.md` or `P0-CONTRACTS.md`.

**Escenario:** experiencia final de GaleCore + GaleCore-AI + GaleCore Work.

**Nombres:** ?Work? en este documento significa exclusivamente **GaleCore Work**, una experiencia propia futura del frontend. No significa ChatGPT Work ni afirma compatibilidad con ese host. El backend de sesiones de GaleCore Work y un runtime autónomo de modelos son responsabilidades separadas.

**Objetivo:** mostrar, con palabras simples, cómo una idea del usuario se transforma en una estrategia investigada, probada y operable de forma controlada.

**Alcance:** recorrido de producto completo. No implica que todas estas funciones estén implementadas hoy.
**Naturaleza:** caso de uso y diseño conceptual; no autoriza implementación.

---

## 1. El pedido del usuario

El usuario abre **Work** dentro de GaleCore y escribe:

> Quiero desarrollar una estrategia en SPY con opciones, que genere retorno estable, alta probabilidad de éxito y bajo riesgo, garantizando profit bajo pero estable y reduciendo pérdidas.

A primera vista parece un pedido claro, pero todavía no define una estrategia ejecutable.

Expresa deseos razonables:

- operar SPY con opciones;
- priorizar estabilidad;
- buscar una probabilidad de éxito alta;
- limitar el riesgo y las pérdidas;
- aceptar retornos moderados a cambio de mayor consistencia.

También contiene una condición que ningún sistema serio puede prometer:

> No se puede garantizar profit.

GaleCore no debería rechazar toda la idea ni fingir que puede cumplir esa garantía. Debe transformarla en una pregunta investigable:

> ¿Podemos diseñar una estrategia de riesgo definido sobre SPY que, bajo supuestos realistas, muestre retornos moderados, pérdidas controladas y un comportamiento suficientemente estable en distintos períodosí

Ese cambio —de una promesa imposible a un objetivo medible— es el comienzo del trabajo.

---

## 2. Qué recibe finalmente el usuario

El resultado no es solamente una respuesta de chat ni una estrategia inventada en una conversación.

Work crea un proyecto de estrategia y muestra un espacio de trabajo similar a este:

```text
Desarrollo de estrategia — SPY Stable Income

Proyecto: SPY Stable Income
Estado actual: SHADOW VALIDATION

Objetivo
  Retorno moderado y consistente con riesgo definido

Propuesta actual
  Put Credit Spread sobre SPY — versión candidata 0.4

Evidencia
  ✓ Backtest inicial
  ✓ Costos y slippage incluidos
  ✓ Prueba fuera de muestra
  ✓ Sensibilidad de parámetros
  ◐ 42 operaciones SHADOW observadas
  ✗ Muestra SHADOW mínima todavía no alcanzada

Resultados principales
  Tasa de operaciones ganadoras: 73%
  Retorno esperado por operación: positivo
  Retorno sobre capital: 5.1%
  Benchmark de corto plazo: 4.4%
  Drawdown máximo observado: 8.4%
  Mayor pérdida por operación: limitada por construcción
  Dependencia de contexto: desempeño débil con volatilidad muy baja

Riesgos conocidos
  - Una alta tasa de aciertos no evita pérdidas grandes ocasionales.
  - El resultado empeora cerca de eventos extraordinarios.
  - La evidencia todavía no habilita PAPER.

Próximo paso recomendado
  Continuar SHADOW durante 30 operaciones adicionales.

[Abrir estrategia] [Ver propuesta] [Ver experimentos] [Comparar versiones] [Continuar SHADOW]
```

El resultado también puede ser:

```text
INSUFFICIENT_EVIDENCE
```

o incluso:

```text
NO VIABLE STRATEGY FOUND
```

Eso no representa un error del sistema. Evitar desplegar una estrategia débil es un resultado valioso.

---

## 3. Recorrido completo

```text
USER REQUEST
      ↓
WorkSession
      ↓
StrategyProject
      ↓
StrategyObjective
      ↓
Feasibility / contradiction analysis
      ↓
Benchmark y costo de oportunidad
      ↓
Recuperación de evidencia previa
      ↓
Preguntas de investigación
      ↓
Hipótesis y StrategyProposal
      ↓
Plan de experimentos
      ↓
Experimentos determinísticos en GaleCore
      ↓
Evaluación contra objetivo, benchmark, riesgo,
robustez y eficiencia de capital
      ↓
Resultado:
  OBJECTIVE_CONFLICT
  INSUFFICIENT_EVIDENCE
  NOT_ECONOMICALLY_ATTRACTIVE
  NO_VIABLE_STRATEGY
  CANDIDATE
      ↓
Si existe candidato: revisión humana y StrategySpec
      ↓
Validación de GaleCore y despliegue SHADOW
      ↓
Outcome evidence y evaluación
      ↓
Nueva propuesta / revisión de hipótesis
      ↓
Posible propuesta de mejora metodológica
      ↓
PAPER y eventualmente LIVE, sólo si existe evidencia suficiente
```

En las secciones siguientes se explica qué parte interviene en cada paso, qué es y qué aporta.

---

## 4. Paso 1 — Work convierte el pedido en un trabajo durable

### Qué es Work

Work es una sección del frontend de GaleCore donde el usuario puede desarrollar trabajos mediante lenguaje natural.

No es solamente un chat. Una conversación de Work puede contener:

- mensajes;
- tareas;
- gráficos;
- propuestas;
- experimentos;
- resultados;
- archivos;
- decisiones;
- preguntas abiertas;
- solicitudes de aprobación.

### Qué hace en este caso

Cuando el usuario envía el pedido, GaleCore crea una sesión:

```text
WorkSession: Desarrollo de estrategia SPY Stable Income
```

Dentro de ella se irán guardando todas las etapas del desarrollo.

Work también crea o vincula un **StrategyProject**:

```text
StrategyProject: SPY Stable Income
├── StrategyObjective
├── WorkSessions[]
├── StrategyProposals[]
├── Experiments[]
├── Findings[]
├── StrategySpecs[]
├── Deployments[]
├── StrategyInstances[]
└── Evaluations[]
```

`WorkSession != StrategyProject`.

Una WorkSession es una sesión concreta de trabajo. El StrategyProject representa el desarrollo completo de la estrategia y sobrevive a muchas sesiones:

```text
WorkSession 1 → idea y objetivo inicial
WorkSession 2 → revisión de resultados fuera de muestra
WorkSession 3 → análisis de 50 trades SHADOW
WorkSession 4 → investigación de un período problemático
```

GaleCore es dueño del StrategyProject porque es estado durable del producto. El proyecto enlaza artefactos operacionales y cognitivos sin cambiar el owner original de cada uno.

### Qué aporta

- El trabajo no desaparece al cerrar el navegador.
- Puede continuar durante días o meses.
- Los resultados no quedan repartidos entre chats y archivos aislados.
- El usuario puede volver y saber qué se probó, qué se descartó y qué falta.
- Varias sesiones pueden continuar el mismo proyecto sin reconstruir su historia.

### Qué ve el usuario

```text
Entendí que querés desarrollar una estrategia de opciones sobre SPY que priorice:

1. riesgo definido;
2. retorno moderado;
3. consistencia;
4. alta frecuencia de resultados positivos;
5. pérdidas limitadas.

No es posible garantizar ganancias. Voy a tratar “profit estable” como un objetivo
que debe validarse con evidencia y no como una condición asegurada.
```

---

## 5. Paso 2 — El Harness organiza el trabajo de la IA

### Qué es el Harness

El Harness es la infraestructura interna de GaleCore-AI que organiza cómo trabaja la inteligencia.

El usuario no necesita conocerlo ni interactuar directamente con él.

Su función es conseguir que la IA:

- comprenda el contexto;
- use conocimiento apropiado;
- siga un proceso disciplinado;
- consulte datos reales;
- no invente capacidades o resultados;
- produzca resultados estructurados;
- deje trazabilidad.

### Qué hace en este caso

El Harness prepara el trabajo:

```text
Contexto
  SPY + opciones + desarrollo de estrategia

Conocimiento necesario
  opciones, credit spreads, riesgo, estadística y overfitting

Proceso requerido
  protocolo de desarrollo y validación de estrategias

Capacidades necesarias
  datos de SPY, option chains, backtesting y métricas

Resultado esperado
  StrategyProposal, no una respuesta libre sin estructura
```

### Qué aporta

Sin Harness, el resultado dependería demasiado de lo que el modelo recuerde preguntar en esa conversación.

Con Harness, preguntas fundamentales son obligatorias:

- ¿De dónde debería surgir el edge?
- ¿Cómo se mediría?
- ¿Qué podría invalidarlo?
- ¿Se incluyeron costos y slippage?
- ¿Hay suficientes operacionesí
- ¿Funciona fuera del período usado para diseñarlo?
- ¿Cómo se comporta en escenarios adversosí

### Cómo selecciona el modelo

El agente no debe tener un proveedor o modelo obligatorio. En el modo interactivo, el host determina su modelo. Sólo si una aplicación propia necesita ejecución autónoma se considerarán estas piezas, actualmente DEFERRED:

```text
Model Gateway
├── Model Registry
├── Routing Policy
└── Provider Adapters
```

El **Model Registry** describe los modelos disponibles mediante perfiles:

```text
ModelProfile
├── provider y model_id/version
├── capacidad de razonamiento
├── ventana de contexto
├── soporte de tools
├── clase de costo y latencia
├── política de datos permitida
└── disponibilidad
```

La **Routing Policy** elige un perfil según la tarea:

```text
Resolver una intención simple → modelo rápido y económico
Sintetizar research            → modelo con razonamiento fuerte
Criticar readiness             → modelo fuerte e independiente cuando corresponda
Resumir resultados             → modelo económico
```

Cada ejecución conserva `model_provider`, `model_id`, `model_version`, configuración de razonamiento y versión del prompt/template. Cambiar el modelo no debe exigir modificar la lógica del agente.

### Qué es el TradingAgent

Para el MVP existe una sola **AgentDefinition** llamada `TradingAgent`.

Una AgentDefinition configura:

```text
role
model_policy
skills
protocols
conventions
allowed_capabilities
output_contracts
guardrails
context_policy
```

Cada ejecución concreta de esa definición es un **AgentRun** y queda trazada.

```text
Agent != service
Agent != repository
Agent != server
```

Un host compatible puede consumir distintas AgentDefinitions. En el futuro podrían existir `ResearchCritic` o `PortfolioAgent`, pero sólo si poseen responsabilidades realmente distintas. El MVP no necesita orquestación multi-agent.

---

## 6. Paso 3 — Los deseos se convierten en objetivos medibles

GaleCore-AI no toma expresiones como “estable”, “alta probabilidad” o “bajo riesgo” como reglas mágicas.

Las convierte en dimensiones que luego pueden medirse:

| Deseo del usuario | Cómo se evalúa |
|---|---|
| Retorno estable | Variabilidad de resultados, meses positivos/negativos y regularidad |
| Alta probabilidad de éxito | Tasa de operaciones ganadoras y probabilidad estimada |
| Bajo riesgo | Pérdida máxima definida, drawdown y exposición por operación |
| Reducir pérdidas | Stop/exit rules, tamaño, diversificación temporal y comportamiento de cola |
| Profit bajo pero estable | Retorno esperado positivo con drawdown y volatilidad acotados |

También muestra tensiones entre objetivos:

```text
Mayor tasa de aciertos
puede implicar
menor ganancia por operación y pérdidas ocasionales más grandes.
```

### Qué ve el usuario

Work presenta un objetivo inicial editable:

```text
Objetivo propuesto

- Estructuras de riesgo definido solamente.
- Pérdida máxima conocida antes de entrar.
- Priorizar consistencia sobre retorno máximo.
- No evaluar calidad usando solamente POP.
- Medir drawdown, valor esperado, pérdidas consecutivas y riesgo de cola.
- Rechazar variantes que sólo funcionen en un período particular.
```

El usuario puede ajustar estos criterios antes de continuar.

### StrategyObjective: el contrato del problema

La interpretación se conserva como un objeto cognitivo durable llamado **StrategyObjective**.

No es una StrategySpec y no puede ejecutarse. Su función es preservar qué problema quería resolver el usuario, incluso después de muchas iteraciones.

Conceptualmente contiene:

```json
{
  "target": { "symbols": ["SPY"], "instrument": "options" },
  "primary_objective": "stable_income",
  "constraints": {
    "defined_risk": true,
    "max_drawdown": 0.10
  },
  "preferences": {
    "consistency_over_maximum_return": true
  },
  "horizon": "multi_year_evaluation",
  "benchmarks": ["US_TBILL_MATCHED_HORIZON", "SPY_BUY_AND_HOLD"],
  "evaluation_metrics": [
    "expected_return",
    "return_on_capital",
    "max_drawdown",
    "sortino",
    "expected_shortfall"
  ],
  "accepted_tradeoffs": [],
  "rejection_criteria": []
}
```

GaleCore-AI es dueño de su significado y puede autorarlo junto con el usuario. GaleCore lo vincula de forma durable al StrategyProject y a las WorkSessions correspondientes.

### Feasibility y contradicciones

Antes de generar hipótesis o consumir backtesting, el sistema revisa si el objetivo tiene sentido económico.

Ejemplo:

```text
99% POP + muy bajo riesgo + retorno estable + capital pequeño
```

puede esconder contradicciones:

- prima demasiado pequeña;
- capital inmovilizado durante mucho tiempo;
- pocas oportunidades por año;
- tail risk desproporcionado;
- retorno inferior a una alternativa casi libre de riesgo;
- objetivos imposibles de satisfacer simultáneamente.

Outcomes posibles:

```text
OBJECTIVE_FEASIBLE
OBJECTIVE_CONFLICT
OBJECTIVE_UNREALISTIC
NEEDS_REFRAMING
```

Si aparece un conflicto, Work lo muestra antes de gastar recursos importantes y permite negociar el objetivo:

```text
No puedo garantizar ganancias ni maximizar simultáneamente POP, retorno y bajo riesgo.

Opciones para reformular:
1. aceptar menor POP a cambio de mejor retorno sobre capital;
2. aceptar menos frecuencia para limitar exposición;
3. mantener riesgo bajo y usar el T-Bill como benchmark mínimo.
```

### Economic Sanity, benchmarks y costo de oportunidad

Una estrategia con P&L positivo no es automáticamente atractiva. Debe justificar riesgo, capital, complejidad y costos frente a alternativas razonables.

GaleCore-AI decide qué benchmarks son relevantes para el objetivo y explica los trade-offs. GaleCore obtiene y calcula los números:

```text
GaleCore-AI
  → selecciona el benchmark apropiado
  → explica por qué corresponde
  → interpreta la comparación

GaleCore
  → obtiene tasas y curva de Treasury
  → calcula retornos y drawdown
  → calcula capital utilizado y retorno sobre capital
  → ejecuta backtests con costos
```

La IA nunca inventa el valor de un benchmark.

Ejemplo:

```text
Strategy return: 4.0%
T-Bill comparable: 4.5%

Además, la estrategia tiene:
- drawdown;
- slippage;
- capital inmovilizado;
- complejidad operacional.

Resultado: NOT_ECONOMICALLY_ATTRACTIVE
```

Resultados posibles de esta comparación:

```text
OUTPERFORMS_BENCHMARK
UNDERPERFORMS_BENCHMARK
CAPITAL_INEFFICIENT
NOT_ECONOMICALLY_ATTRACTIVE
```

### Eficiencia de capital

El análisis debe incluir:

- capital requerido;
- buying power utilizado;
- retorno sobre capital;
- tiempo durante el cual el capital queda comprometido;
- frecuencia real de oportunidades;
- efecto del capital ocioso;
- pérdida extrema posible.

Una estrategia con 99% POP puede ser débil si entra dos veces al año, inmoviliza mucho capital, cobra poco crédito, tiene una pérdida extrema o rinde menos que T-Bills.

> Toda estrategia candidata debe justificar el riesgo, capital utilizado, complejidad y costos frente a una alternativa razonable de menor riesgo o menor complejidad.

---

## 7. Paso 4 — Se busca lo que GaleCore ya sabe

Antes de comenzar una investigación nueva, el Harness pregunta:

```text
¿Qué datos tiene GaleCore?
¿Qué cálculos puede hacer?
¿Qué estudios ya existen?
¿Qué estrategias similares se probaron?
¿Qué findings o preguntas quedaron abiertosí
```

### Partes que intervienen

#### Data Catalog

Describe qué información existe realmente:

- precios de SPY;
- option chains;
- volatilidad implícita;
- GEX;
- histórico disponible;
- frecuencia y frescura de cada dato.

#### Capability Catalog

Describe qué puede hacer GaleCore:

- obtener cotizaciones;
- resolver instrumentos;
- calcular métricas;
- ejecutar un backtest;
- simular una estrategia;
- consultar portfolio y riesgo.

#### Evidence y Study Catalog

Permiten recuperar estudios, hipótesis y conclusiones anteriores.

### Qué aporta

- Evita repetir trabajo.
- Evita que la IA afirme que existe un dato que GaleCore no tiene.
- Reduce costo y tiempo.
- Permite continuar una investigación anterior en lugar de comenzar desde cero.

### Qué ve el usuario

```text
Encontré:

- Datos actuales de opciones sobre SPY: disponibles.
- Histórico de precios: disponible.
- Histórico de opciones: parcial entre determinadas fechas.
- Estudios anteriores sobre venta de prima: 3.
- Finding relevante: alta POP no garantizó valor esperado positivo después de costos.
- Gap principal: cobertura histórica incompleta para algunos vencimientos.
```

---

## 8. Paso 5 — GaleCore-AI propone una hipótesis, no una verdad

Con la información disponible, GaleCore-AI puede plantear una hipótesis inicial. Por ejemplo:

```text
Hipótesis

Un Put Credit Spread de riesgo definido sobre SPY podría producir retornos moderados
y relativamente consistentes si se abre bajo condiciones específicas de volatilidad,
liquidez y riesgo de eventos, evitando vender prima cuando la compensación es insuficiente.
```

También debe explicar por qué podría existir el edge:

```text
Posible mecanismo

- La volatilidad implícita puede exceder posteriormente la volatilidad realizada.
- La venta sistemática de prima cobra esa diferencia.
- El spread limita la pérdida máxima.
- Los filtros intentan evitar situaciones donde el riesgo no está bien compensado.
```

Y cómo podría quedar refutada:

```text
La hipótesis se considera debilitada o inválida si:

- el resultado esperado es negativo después de costos;
- las ganancias dependen de pocas operaciones;
- el drawdown excede el límite aceptable;
- sólo funciona con parámetros extremadamente precisos;
- falla fuera de muestra;
- la pérdida de cola contradice el objetivo de riesgo.
```

### Resultado de esta etapa

GaleCore-AI crea una **StrategyProposal**.

### Qué es una StrategyProposal

Es un documento de trabajo que contiene:

- hipótesis;
- explicación del posible edge;
- reglas candidatas;
- supuestos;
- riesgos;
- evidencia existente;
- evidencia contradictoria;
- preguntas abiertas;
- experimentos recomendados.

No es todavía una estrategia desplegable.

### No es un generador ciego de estrategias

El objetivo del proceso no es fabricar una StrategySpec que parezca cumplir el prompt.

El proceso correcto es:

```text
entender el objetivo
→ comprobar factibilidad
→ identificar trade-offs
→ buscar una razón económica
→ formular una hipótesis
→ probarla
→ rechazarla si no se sostiene
```

> El objetivo del Strategy Development process no es siempre producir una StrategySpec. Es determinar si existe una propuesta económicamente razonable y respaldada por evidencia.

`NO_VIABLE_STRATEGY` es preferible a optimizar parámetros hasta fabricar una estrategia engañosa.

---

## 9. Paso 6 — Se diseña un plan de experimentos

GaleCore-AI propone qué pruebas hacen falta. Por ejemplo:

```text
Experimento 1
  Comparar diferentes rangos de DTE.

Experimento 2
  Comparar selección de short strike por delta.

Experimento 3
  Medir el efecto de IV Rank y volatilidad realizada.

Experimento 4
  Evaluar take profit y time exit.

Experimento 5
  Incluir comisiones, slippage y fills conservadores.

Experimento 6
  Separar desarrollo y prueba fuera de muestra.

Experimento 7
  Revisar sensibilidad: evitar que el resultado dependa de un único parámetro exacto.

Experimento 8
  Analizar drawdown, pérdidas consecutivas y escenarios extremos.
```

### Qué parte hace qué

```text
GaleCore-AI
  decide qué preguntas investigar y cómo interpretar resultados.

GaleCore
  ejecuta cálculos, backtests y simulaciones reproducibles.
```

### Qué aporta esta separación

La IA no calcula mentalmente el rendimiento ni inventa estadísticas. Diseña el estudio; la plataforma ejecuta los números.

---

## 10. Paso 7 — GaleCore ejecuta las pruebas

GaleCore recibe los experimentos y ejecuta los backtests o simulaciones con reglas declaradas.

Cada resultado conserva:

- dataset utilizado;
- período;
- versión del cálculo;
- parámetros;
- costos;
- slippage;
- operaciones generadas;
- métricas;
- errores o limitaciones.

### Qué ve el usuario

Work no necesita mostrar logs técnicos. Presenta progreso comprensible:

```text
Plan de validación

✓ Comparación de DTE completada
✓ Costos y slippage incluidos
✓ Sensibilidad de strikes completada
◐ Prueba fuera de muestra en ejecución
○ Análisis de escenarios adversos pendiente
```

Puede abrir los detalles cuando quiera revisar metodología o resultados completos.

---

## 11. Paso 8 — GaleCore-AI interpreta y compara

GaleCore-AI recibe resultados determinísticos y responde preguntas como:

- ¿El supuesto edge aparece realmente?
- ¿Sobrevive después de costosí
- ¿Es estable o depende de un período excepcional?
- ¿Qué parámetros son robustosí
- ¿Qué resultados contradicen la hipótesisí
- ¿El riesgo coincide con lo que pidió el usuario?

La interpretación puede concluir:

```text
La variante con mayor POP no es la mejor.

Aunque gana más veces, sus pérdidas ocasionales son mayores y su valor esperado
después de costos es inferior al de una variante con menor POP y mejor relación
entre crédito, riesgo y liquidez.
```

### Qué aporta

Evita que el usuario elija automáticamente el backtest con mayor retorno o tasa de aciertos.

El sistema conserva también resultados negativos y contradicciones, para no redescubrirlos después.

### Strategy Quality y Portfolio Fit son preguntas diferentes

Primero se evalúa:

```text
¿La estrategia tiene calidad por sí misma?
```

Sólo si la respuesta es favorable se evalúa:

```text
¿Esta estrategia es conveniente para este usuario y este portfolio?
```

Portfolio Fit considera:

- concentración existente;
- beta y otras exposiciones;
- correlación con posiciones actuales;
- buying power;
- necesidades de liquidez;
- superposición de riesgo de cola;
- interacción con otras estrategias.

GaleCore-AI interpreta el encaje y explica los trade-offs. GaleCore calcula exposiciones y aplica límites duros. Una estrategia válida aisladamente puede ser rechazada o redimensionada para un portfolio concreto.

---

## 12. Paso 9 — Work presenta una propuesta comprensible

Después de varias iteraciones, Work puede mostrar:

```text
Propuesta candidata — SPY Defined-Risk Income

Estructura
  Put Credit Spread

Objetivo
  Retorno moderado con pérdida máxima definida y drawdown acotado

Cuándo considera entrar
  - Existe suficiente prima.
  - La cadena tiene liquidez adecuada.
  - No hay eventos excluidos por las reglas.
  - La exposición resultante cabe dentro del portfolio.

Cómo limita el riesgo
  - Spread de ancho definido.
  - Riesgo máximo por operación.
  - Máximo de posiciones simultáneas.
  - Reglas determinísticas de salida.

Evidencia favorable
  - Resultado positivo después de costos en el período probado.
  - Comportamiento razonable fuera de muestra.
  - Parámetros no excesivamente sensibles.

Evidencia contradictoria
  - Peor desempeño durante shocks rápidos.
  - Pérdidas agrupadas en ciertos contextos.

Estado
  APTA PARA SHADOW, NO APTA PARA PAPER/LIVE.
```

El usuario puede:

- revisar la evidencia;
- comparar variantes;
- pedir otra prueba;
- cambiar el objetivo;
- descartar la propuesta;
- aprobar la creación de una StrategySpec candidata.

---

## 13. Paso 10 — De propuesta a contrato ejecutable

Si el usuario acepta continuar, la StrategyProposal se traduce a una **StrategySpec**.

### Qué es una StrategySpec

Es la definición precisa y versionada que GaleCore puede validar y ejecutar.

La diferencia es importante:

```text
StrategyProposal
  explica la idea, la hipótesis, la evidencia y los riesgos.

StrategySpec
  contiene las reglas exactas que una máquina puede ejecutar.
```

GaleCore valida que la spec:

- tenga una estructura permitida;
- use riesgo definido;
- declare entradas y salidas;
- tenga límites de riesgo;
- use datos y capacidades existentes;
- no contenga parámetros inválidos;
- tenga versión e identidad inmutable.

La IA o el usuario pueden redactar la propuesta, pero GaleCore decide si el contrato es técnicamente válido.

---

## 14. Paso 11 — La estrategia comienza en SHADOW

Una estrategia técnicamente válida no pasa directamente a operar dinero.

Primero se despliega en **SHADOW**:

```text
Datos reales
+ decisiones reales del runtime
+ fills simulados
+ posiciones simuladas
= cero órdenes enviadas al broker
```

### Partes que intervienen

#### Trading Runtime de GaleCore

Ejecuta automáticamente la StrategySpec:

- evalúa condiciones;
- construye candidatos;
- aplica hard risk;
- simula fills;
- crea posiciones SHADOW;
- monitorea posiciones;
- ejecuta salidas determinísticas;
- guarda eventos y resultados.

#### GaleCore-AI

No controla cada tick ni cada salida. Interviene cuando hace falta interpretar:

- resultados acumulados;
- comportamiento inesperado;
- diferencias contra el backtest;
- evidencia que debilita la hipótesis;
- posibles mejoras para una versión futura.

#### Work

Muestra el progreso de la validación y concentra los resultados.

### Qué aporta

SHADOW permite observar cómo se comporta la estrategia con mercado real sin arriesgar capital.

---

## 15. Paso 12 — Evaluación y aprendizaje

Después de cada conjunto significativo de operaciones, GaleCore-AI puede generar una evaluación:

```text
Evaluación SHADOW — versión 0.4

Resultado observado
  42 operaciones cerradas.

Coincidencias con la hipótesis
  - La frecuencia de resultados positivos está dentro del rango esperado.
  - El tamaño de pérdida permaneció limitado por la estructura.

Contradicciones
  - El slippage observado fue superior al supuesto.
  - El desempeño fue débil en días con gaps fuertes.

Conclusión
  La hipótesis sigue siendo plausible, pero la evidencia es insuficiente para PAPER.

Próxima acción
  Ajustar el supuesto de fill y continuar observando sin cambiar las reglas desplegadas.
```

La versión activa no se modifica silenciosamente. Una mejora crea una propuesta y una StrategySpec nuevas, con vínculo a la versión anterior.

Esto permite responder en el futuro:

- ¿Por qué se cambió esta regla?
- ¿Qué evidencia justificó el cambio?
- ¿Qué versión produjo cada operación?
- ¿La mejora realmente funcionó?

### Tres formas distintas de aprendizaje

#### 1. Evidence learning — continuo

Experimentos, SHADOW y outcomes pueden producir:

```text
ResearchFinding
ExperimentResult
RejectedHypothesis
TradeOutcomeInterpretation
OpenQuestion
```

Estos objetos se guardan como Evidence y futuras WorkSessions los recuperan antes de repetir investigación.

#### 2. Methodology learning — controlado

Si aparece repetidamente un patrón como:

```text
alta POP
+ bajo retorno sobre capital
+ underperformance frente a risk-free
```

el sistema puede producir una **MethodologyChangeProposal**:

```text
Propuesta:
Agregar al Strategy Development Protocol la comparación obligatoria
de eficiencia de capital contra un benchmark de bajo riesgo.
```

La propuesta no modifica el Harness por sí sola:

```text
Evidencia repetida
→ Finding
→ MethodologyChangeProposal
→ revisión
→ Protocol vNext
```

Todo cambio es versionado, auditable, revisable y reversible.

#### 3. Model/runtime learning — evaluado

El sistema puede estudiar:

- qué ModelProfile produjo mejores hipótesis;
- qué AgentDefinition produjo outputs más útiles;
- qué versión de protocolo redujo overfitting;
- qué findings sobrevivieron la validación SHADOW;
- qué recomendaciones fueron descartadas posteriormente.

Esto puede generar propuestas para cambiar routing, prompts, Skills o Protocols. No aplica cambios de manera invisible.

### Harness Evaluation

El sistema no evalúa solamente estrategias; también evalúa la calidad de su propia cognición:

```text
AgentRun
→ Cognitive Output
→ Later Outcome
→ Evaluator
→ EvaluationResult
```

Posibles dimensiones:

- calidad y falsabilidad de las hipótesis;
- cumplimiento del protocolo;
- completitud de evidencia;
- calibración;
- hallucination rate;
- precisión de readiness;
- supervivencia de propuestas en SHADOW.

No es necesario fijar todos los KPIs en este caso de uso. Sí debe quedar trazable qué configuración produjo cada output y con qué outcome se evaluó después.

### Qué no aprende o modifica automáticamente

El sistema no debe:

- modificar Skills silenciosamente;
- modificar Protocols automáticamente;
- cambiar StrategySpecs desplegadas;
- cambiar model routing sin trazabilidad;
- promocionar reglas cognitivas a hard gates automáticamente;
- interpretar un único outcome como causalidad;
- reescribir evidencia histórica.

El único flujo permitido es:

```text
Evidence accumulation
→ Proposal for change
→ Review
→ Versioned update
```

---

## 16. Paso 13 — Promoción controlada

El ciclo de madurez es:

```text
RESEARCH
→ SHADOW
→ PAPER
→ LIVE
```

Cada avance necesita evidencia y controles definidos.

### Antes de PAPER

La estrategia debe demostrar, como mínimo:

- comportamiento reproducible;
- datos y métricas suficientes;
- costos realistas;
- estabilidad fuera de muestra;
- riesgo y drawdown aceptables;
- funcionamiento operativo confiable.

### Antes de LIVE

Además necesita:

- aprobación humana;
- autorización final de GaleCore;
- controles P-LIVE completos;
- límites de portfolio;
- kill switch;
- manejo de errores del broker;
- reconciliación de órdenes;
- monitoreo y alertas.

Incluso después de una aprobación, GaleCore revalida precio, liquidez, cuenta y riesgo inmediatamente antes de ejecutar.

```text
Recomendación
!= aprobación
!= autorización
!= ejecución
```

---

## 17. Qué hace cada parte, resumido

| Parte | Qué es | Qué hace en este caso | Qué aporta |
|---|---|---|---|
| Frontend GaleCore | La aplicación que ve el usuario | Muestra Work, gráficos, propuestas y resultados | Una experiencia integrada |
| Work | Espacio durable de trabajo | Guarda conversación, tareas, artifacts y decisiones | Continuidad y orden |
| Work Runtime | Backend que sostiene Work | Mantiene sesiones, estados, archivos y aprobaciones | El trabajo sobrevive a reinicios de la IA |
| GaleCore-AI | Servicio de inteligencia | Investiga, interpreta, diseña y recomienda | Razonamiento financiero |
| Domain Harness | Assets, assurance y adapters de GaleCore-AI | Organiza contexto, skills, protocolos, capabilities y trazas | Consistencia y disciplina |
| TradingAgent | Actor cognitivo configurado | Conduce el desarrollo de la estrategia | Comportamiento especializado |
| Skills | Conocimiento financiero | Enseñan opciones, riesgo, estadística y metodología | Expertise reusable |
| Protocols | Pasos obligatorios | Exigen hipótesis, experimentos, robustez y evidencia | Evitan saltear buen proceso |
| Guardrails | Límites cognitivos | Impiden garantías, datos inventados o readiness sin evidencia | Menos falsa certeza |
| Data Catalog | Inventario de datos reales | Informa qué datos existen y su calidad | Evita suposiciones falsas |
| Capability Catalog | Inventario de funciones reales | Informa qué puede calcular o ejecutar GaleCore | Conecta inteligencia con plataforma |
| Compute/Backtest | Motor determinístico de GaleCore | Ejecuta experimentos reproducibles | Números verificables |
| StrategyProposal | Propuesta cognitiva | Conserva hipótesis, reglas candidatas, evidencia y riesgos | Explica el porqué |
| StrategySpec | Contrato ejecutable | Define reglas exactas y versionadas | Permite ejecución reproducible |
| Trading Runtime | Motor operativo de GaleCore | Ejecuta la spec y administra su lifecycle | Automatización segura |
| Hard Risk | Control obligatorio de GaleCore | Aprueba, limita o rechaza riesgo | La IA no controla la seguridad |
| Evidence | Soporte durable de conclusiones | Relaciona estudios, datos, decisiones y resultados | Aprendizaje acumulativo |

### Objetos principales y ownership

| Objeto | Qué representa | Owner semántico/operacional | Durable | Ejecutable |
|---|---|---|---:|---:|
| WorkSession | Una sesión de trabajo | GaleCore | Sí | No |
| StrategyProject | El desarrollo completo a través del tiempo | GaleCore | Sí | No |
| StrategyObjective | El problema y los objetivos normalizados | GaleCore-AI; vinculado por GaleCore | Sí | No |
| StrategyProposal | Hipótesis, propuesta, evidencia y riesgos | GaleCore-AI | Sí | No |
| ExperimentProposal | Plan cognitivo de una prueba | GaleCore-AI | Sí | No |
| ExperimentResult | Resultado determinístico de una prueba | GaleCore | Sí | No |
| ResearchFinding | Conclusión cognitiva respaldada por evidencia | GaleCore-AI | Sí | No |
| StrategySpec | Contrato versionado que una máquina puede ejecutar | Compartido; GaleCore valida | Sí | Sí |
| StrategyDeployment | Despliegue de una versión en un modo | GaleCore | Sí | Operacional |
| StrategyInstance | Estado de una estrategia en ejecución | GaleCore | Sí | Operacional |
| AgentDefinition | Configuración versionada de un actor cognitivo | GaleCore-AI | Sí | No |
| AgentRun | Una ejecución cognitiva concreta | GaleCore-AI | Metadata durable; trace según retención | No |
| ModelProfile | Capacidades y políticas de uso de un modelo | GaleCore-AI | Sí | No |
| MethodologyChangeProposal | Propuesta revisable para mejorar metodología | GaleCore-AI | Sí | No |
| EvaluationResult | Evaluación de un output o AgentRun contra outcomes | GaleCore-AI | Sí | No |

`StrategyProject` agrega referencias; no se apropia de los objetos de otros dominios ni duplica sus fuentes de verdad.

---

## 18. Cómo se ve la interfaz final

La estrategia no existe solamente como un artifact dentro de Work. La interfaz separa dos espacios complementarios.

### Strategies: dónde vive el proyecto

Cuando Work crea `SPY Stable Income`, el proyecto aparece en la sección **Strategies**:

```text
Strategies
└── SPY Stable Income
    ├── Overview
    ├── Objective
    ├── Thesis
    ├── Versions
    ├── Experiments
    ├── Evidence
    ├── Deployments
    ├── Performance
    └── Work
```

Strategies es la vista estable del StrategyProject. Permite conocer su estado aunque el usuario no esté dentro de una conversación.

### Work: donde se desarrolla y analiza

```text
Work
→ “Quiero desarrollar una estrategia en SPY”
→ crea o vincula StrategyProject
→ abre una WorkSession
→ produce tareas y artifacts
→ los resultados aparecen también en Strategies
```

Work es una interfaz para trabajar sobre objetos del producto; no es el único lugar donde esos objetos existen.

La WorkSession puede organizarse en cinco áreas:

### Conversación

Para expresar objetivos, hacer preguntas y discutir resultados.

### Plan

```text
✓ Objetivo interpretado
✓ Datos disponibles relevados
✓ Hipótesis creada
✓ Experimentos diseñados
✓ Backtest inicial
◐ Validación SHADOW
○ Revisión de readiness
```

### Artifacts

- StrategyProposal.
- Reportes de experimentos.
- Gráficos.
- Comparaciones entre variantes.
- StrategySpec candidata.
- Evaluaciones SHADOW.

### Evidence

- Datos utilizados.
- Estudios previos.
- Resultados favorables.
- Contradicciones.
- Preguntas no resueltas.

### Actions

- Ejecutar un experimento.
- Aprobar una StrategySpec candidata.
- Desplegar en SHADOW.
- Pausar una instancia.
- Continuar observación.
- Solicitar readiness review.

Las acciones sensibles siempre pasan por GaleCore y muestran claramente su estado.

---

## 19. Qué diferencia este proceso de usar un chat

En un chat convencional, el resultado probable es:

```text
“Podrías usar un Put Credit Spread de 30-45 DTE con delta 0.20.”
```

Eso puede ser una idea útil, pero no sabemos:

- si existe edge;
- qué datos la respaldan;
- si sobrevivió costos;
- si está sobreajustada;
- si funciona para este portfolio;
- qué versión se probó;
- qué ocurrió después.

En GaleCore Work, el resultado es un proceso conectado:

```text
Objetivo
→ hipótesis
→ evidencia
→ experimentos reproducibles
→ propuesta versionada
→ ejecución SHADOW
→ resultados
→ aprendizaje
```

La conversación deja de ser descartable y se convierte en trabajo acumulativo.

---

## 20. Resultado final posible

El mejor resultado no es necesariamente que GaleCore encuentre una estrategia rentable.

El proceso puede terminar o pausar con outcomes explícitos:

```text
OBJECTIVE_CONFLICT
OBJECTIVE_UNREALISTIC
NEEDS_REFRAMING
INSUFFICIENT_EVIDENCE
UNDERPERFORMS_BENCHMARK
CAPITAL_INEFFICIENT
NOT_ECONOMICALLY_ATTRACTIVE
NO_VIABLE_STRATEGY
CANDIDATE
```

El resultado correcto puede ser uno de estos:

### Resultado A — Estrategia viable

```text
Se identificó una estrategia con evidencia suficiente para avanzar a SHADOW/PAPER,
con riesgos conocidos, reglas versionadas, resultados reproducibles y una comparación
favorable frente a benchmarks razonables.
```

### Resultado B — Estrategia prometedora, evidencia insuficiente

```text
La hipótesis es plausible, pero necesita más datos, operaciones SHADOW o pruebas.
```

### Resultado C — Objetivos incompatibles

```text
No se encontró una variante que combine el nivel de estabilidad, riesgo y retorno solicitado.
Se muestran las tensiones y las alternativas disponibles.
```

### Resultado D — Positiva, pero económicamente débil

```text
La estrategia tiene valor esperado positivo, pero no compensa el capital, riesgo,
costos y complejidad frente a una alternativa más simple o de menor riesgo.
```

### Resultado E — Hipótesis descartada

```text
La estrategia no conserva valor esperado después de costos o falla fuera de muestra.
Se guarda el resultado para evitar repetir la misma investigación.
```

En todos los casos el usuario obtiene:

- una respuesta honesta;
- evidencia visible;
- conocimiento reusable;
- claridad sobre riesgos;
- próximos pasos concretos;
- un historial que permite aprender.

---

## 21. Definición de éxito del caso de uso

Este caso está completo cuando el usuario puede:

1. Expresar el objetivo en lenguaje natural dentro de Work.
2. Crear o continuar un StrategyProject desde distintas WorkSessions.
3. Entender cómo GaleCore-AI tradujo sus términos ambiguos a un StrategyObjective durable.
4. Revisar factibilidad, contradicciones y trade-offs antes de consumir research intensivo.
5. Revisar benchmarks, costo de oportunidad y eficiencia de capital.
6. Ver qué datos, capacidades y estudios están disponibles.
7. Recibir una StrategyProposal con hipótesis, evidencia, riesgos y preguntas abiertas.
8. Solicitar y observar experimentos reproducibles ejecutados por GaleCore.
9. Comparar variantes contra objetivo, benchmark, riesgo, robustez y capital utilizado.
10. Separar Strategy Quality de Portfolio Fit.
11. Aprobar una StrategySpec candidata sin que eso implique LIVE.
12. Desplegar y observar la estrategia en SHADOW.
13. Ver resultados, contradicciones y recomendaciones de mejora.
14. Saber qué AgentDefinition, modelos, Skills y Protocols produjeron cada output.
15. Saber por qué la estrategia puede o no avanzar de etapa.
16. Recuperar todo el trabajo posteriormente sin reconstruir el contexto.
17. Convertir evidencia repetida en una propuesta de mejora revisable, nunca en una automodificación silenciosa.

El principio que resume la experiencia es:

> El usuario aporta el objetivo. GaleCore-AI organiza la investigación y propone. GaleCore calcula, valida, protege y ejecuta. Work conserva todo el recorrido para que cada resultado se transforme en evidencia y aprendizaje.
