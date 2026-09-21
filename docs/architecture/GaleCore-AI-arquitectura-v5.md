# GaleCore-AI — Arquitectura v5

**Fecha:** 2026-09-15

**Estado:** cierre de Phase 3 bloqueado por revisión independiente. Ver `docs/engineering/ACTIVE_WORK_ITEM`; no iniciar nuevas features mientras el work item activo mantenga `feature_freeze: true`.

**Reemplaza:** las definiciones de host, Harness y Cognitive Runtime de la arquitectura v4

**Conserva:** los límites Platform vs Cognition, los contratos P0 y las reglas de seguridad de v4 cuando no contradicen este documento

**Regla de lectura:** ownership arquitectónico no implica que una capability ya esté implementada o validada

---

## 0. Por qué existe v5

La implementación de Phase 3 reveló una ambigüedad de v4: se asumió que GaleCore-AI debía ejecutar necesariamente su propio modelo y su propio agent loop. Esa interpretación llevó a implementar un `ModelProvider`, un `CognitiveRuntime` y una API autónoma antes de confirmar quién ejecutaría realmente el modelo.

La decisión corregida es:

> **El host es el entorno donde vive y trabaja el modelo. Es un rol de ejecución, no un repositorio.**

Hoy, Claude Code o Codex pueden cumplir ese rol. ChatGPT Work es otro host posible, sujeto a validar su mecanismo concreto de integración. En el futuro, una aplicación propia basada en `CognitiveRuntime` puede convertirse en otro host.

GaleCore-AI no debe recrear obligatoriamente las capacidades genéricas que ya proporciona el host. Su valor central es aportar inteligencia financiera reusable y assurance determinístico.

```text
GaleCore     = máquina financiera y verdad operacional
GaleCore-AI  = inteligencia de dominio y assurance
Host         = entorno que ejecuta el modelo y coordina el trabajo
```

---

## 1. North Star

GaleCore + GaleCore-AI debe evolucionar hacia un sistema agentic de trading capaz de ayudar a:

1. analizar mercados y portfolios;
2. investigar y desarrollar estrategias;
3. comparar hipótesis con evidencia;
4. transformar propuestas aprobadas en especificaciones ejecutables;
5. acompañar estrategias desde research hasta SHADOW, PAPER y LIVE;
6. aprender de resultados mediante evidencia versionada y revisable.

El objetivo final no es construir un chatbot que “sepa de trading” ni una API Python que consulte GEX.

> **El objetivo es convertir modelos generales en especialistas financieros confiables mediante conocimiento versionado, acceso a capacidades autoritativas, contratos estructurados, validación determinística, evidencia, trazabilidad y controles humanos.**

Flujo objetivo de largo plazo:

```text
observe
→ understand
→ retrieve existing evidence
→ formulate hypothesis
→ design experiment
→ validate
→ propose strategy
→ assess portfolio fit
→ request approval
→ authorize safely
→ execute or simulate
→ monitor
→ evaluate outcome
→ retain evidence
→ improve under review
```

Research es una capability. El producto final es un sistema que ayuda a tomar mejores decisiones y desarrollar mejores estrategias sin convertir a la IA en una dependencia de seguridad operacional.

---

## 2. Arquitectura del sistema

### 2.1 Vista actual

```text
                         USER
                           ↓
                         HOST
          Claude Code / Codex / ChatGPT Work
           model + conversation + agent loop
                    /                 \
                   /                   \
                  ↓                     ↓
          GaleCore-AI                 GaleCore
   domain intelligence + assurance   financial machine
```

El host coordina el uso de GaleCore-AI y GaleCore. GaleCore-AI no necesita estar físicamente en el medio de todas las llamadas.

### 2.2 Dos repositorios, hosts intercambiables

La arquitectura actual requiere dos repositorios independientes:

```text
GaleCore/
  API, datos, cálculos, estado, riesgo y ejecución

GaleCore-AI/
  assets cognitivos, contratos, assurance, evals y adaptadores
```

Los hosts son entornos externos intercambiables:

```text
Claude Code ─┐
Codex ───────┼── usan GaleCore-AI y GaleCore
Work ────────┘
```

No se necesita un tercer repositorio para representar al host.

Una aplicación autónoma futura podría vivir inicialmente dentro de `GaleCore-AI/runtime`. Sólo debería separarse cuando tenga necesidades reales de despliegue, seguridad, versionado o escalado independientes.

### 2.3 Ownership no es maturity

La arquitectura define por separado:

| Dimensión | Pregunta |
|---|---|
| Ownership | ¿Qué sistema es responsable de este concepto? |
| Maturity | ¿Cuál es su estado real de implementación y validación? |

Toda documentación que describa estado debe usar una etiqueta explícita:

```text
CURRENT_IMPLEMENTED  = existe en código, sin afirmar validación E2E completa
CURRENT_VALIDATED    = existe y fue validado con evidencia reproducible
TARGET_APPROVED      = ownership/diseño aprobado, todavía no implementado
PROPOSED             = dirección pendiente de aprobación
DEFERRED             = decisión o implementación postergada explícitamente
```

Una lista bajo “GaleCore owns” o “GaleCore-AI owns” expresa ownership actual/objetivo. No prueba `CURRENT_IMPLEMENTED` ni `CURRENT_VALIDATED`.

El estado debe comprobarse contra código, tests y evidencia E2E. No debe inferirse de una arquitectura, un handoff ni una declaración histórica.

---

## 3. Definiciones canónicas

### 3.1 Host

El host es el entorno que ejecuta y coordina una sesión agentic.

Responsabilidades típicas:

- ejecutar el modelo;
- mantener la conversación y el contexto de sesión;
- interpretar el pedido del usuario;
- cargar instrucciones y assets compatibles;
- seleccionar un workflow o skill;
- invocar tools y capacidades;
- observar resultados;
- solicitar al modelo un output;
- enviar ese output a validación;
- presentar el resultado al usuario.

Ejemplos: Claude Code, Codex, ChatGPT Work y una futura aplicación propia ejecutando `CognitiveRuntime`.

El host no es una fuente de verdad financiera ni una razón para duplicar cálculos en GaleCore-AI.

### 3.2 GaleCore — Machine / Platform / Operational Plane

GaleCore es la plataforma financiera y la fuente de verdad operacional. Debe seguir funcionando de manera segura si GaleCore-AI o cualquier host de IA desaparecen.

Ownership arquitectónico de GaleCore, actualmente o cuando la capability sea implementada:

- conectividad con proveedores y brokers;
- market data, option chains, quotes, candles, Greeks y balances;
- GEX, IV Rank, skew, realized volatility y cálculos determinísticos;
- schemas y versiones autoritativas de capabilities;
- portfolio, positions, orders y fills;
- persistencia operacional;
- StrategySpec desplegado y StrategyInstance;
- Trading Runtime, scheduler y evaluación determinística;
- hard risk;
- SHADOW, PAPER y LIVE;
- autenticación, autorización y kill switches;
- evidencia operacional.

> **GaleCore calcula, valida operacionalmente, autoriza, ejecuta y mantiene la verdad del sistema.**

GaleCore no debe poseer metodología cognitiva de trading, prompts de agentes, interpretación narrativa, hipótesis de research ni workflows específicos de un host.

### 3.3 GaleCore-AI — Domain Intelligence + Assurance

GaleCore-AI transforma un host general en un especialista financiero capaz de trabajar de forma disciplinada con GaleCore.

Ownership arquitectónico de GaleCore-AI, actualmente o cuando la capability sea implementada:

- AgentDefinitions de dominio;
- Skills y workflows cognitivos;
- protocolos, convenciones, conocimiento y metodología financiera;
- contratos de input y output;
- validación del contrato de consumo de facts, su consistencia y su antigüedad observable;
- grounding y EvidenceRef;
- cognitive guardrails;
- trace schemas y producción de trazas;
- evals y golden cases;
- contratos de integración con GaleCore;
- adaptadores mínimos para hosts;
- runtime autónomo opcional y diferido.

> **GaleCore-AI enseña cómo trabajar y verifica aquello que no debe quedar librado a la obediencia del modelo.**

GaleCore-AI no debe poseer datos de mercado autoritativos, cálculos ya existentes en GaleCore, credenciales del broker, estado operacional, hard risk ni ejecución LIVE.

### 3.4 Agent

Un Agent no es un proceso ni necesariamente una clase Python. Un AgentDefinition es una configuración versionada que declara misión, Skills, Protocols, Conventions, capabilities permitidas, output contracts, restricciones cognitivas y política de evidencia.

Un AgentDefinition no define hard risk ni puede conceder permisos operacionales. Declara únicamente comportamiento cognitivo y el subconjunto de capabilities que el agente está autorizado a solicitar; GaleCore conserva la autorización efectiva.

En el MVP existe una única definición: `TradingAgent`.

### 3.5 Skill

Una Skill es conocimiento procedimental reutilizable para una tarea concreta. Contiene principalmente instrucciones, criterios de uso, inputs requeridos, capabilities, proceso, output esperado, ejemplos y limitaciones.

Una Skill no es el cálculo financiero, la tool, el validator ni el runtime completo. Tampoco es una garantía de cumplimiento.

### 3.6 Workflow

Un workflow describe una secuencia de trabajo de mayor alcance que una Skill. Puede combinar varias Skills, herramientas, revisiones y entregables.

Ejemplos futuros: análisis de mercado, desarrollo de estrategia, experiment design, production readiness y revisión de outcomes.

En Phase 3 sólo existe el flujo mínimo de análisis GEX read-only. No debe construirse todavía una plataforma general de workflows.

### 3.7 Protocol

Un Protocol define pasos o controles cognitivos obligatorios para una clase de tarea. Por ejemplo, `facts_discipline` exige presencia de facts, citas, caveats y ausencia de valores inventados.

### 3.8 Convention

Una Convention es un default semántico que se aplica cuando el usuario no especifica una decisión. La intención explícita tiene precedencia mientras no viole una política.

Una Convention no puede crear una decisión operacional, conceder permisos ni relajar una restricción de GaleCore.

### 3.9 Assurance

Assurance es el conjunto de mecanismos determinísticos que decide si un output cognitivo puede aceptarse:

- schemas;
- comprobación de facts;
- freshness;
- grounding;
- EvidenceRef;
- guardrails;
- estados de falla;
- trace;
- evals.

Assurance no determina si una idea será rentable. Determina si el proceso y el output cumplen condiciones verificables.

GaleCore es autoridad sobre el origen, timestamp y calidad operacional de los facts. GaleCore-AI valida schema, finitud, consistencia interna, símbolo, antigüedad observable y grounding. No afirma autenticidad cuando el payload fue entregado por el host y no pudo verificarse independientemente.

### 3.10 Harness

El término Harness se usa en dos niveles y siempre debe calificarse:

1. **Host Harness:** infraestructura genérica aportada por Claude Code, Codex, Work o un runtime propio: modelo, loop, tools, contexto y sesión.
2. **Domain Harness de GaleCore-AI:** assets cognitivos, contratos, assurance y adaptadores que especializan ese host para GaleCore.

La palabra `Harness` sin calificador debe evitarse cuando pueda generar ambigüedad.

### 3.11 Taxonomía de responsabilidad

Todo concepto nuevo debe clasificarse antes de elegir formato, repositorio, lenguaje o transporte.

| Tipo canónico | Definición | Autoridad principal | Ejemplo |
|---|---|---|---|
| `KNOWLEDGE` | Información usada para interpretar o diseñar | GaleCore-AI | significado y límites interpretativos de GEX |
| `SPECIFICATION` | Decisión declarativa que describe comportamiento reproducible | GaleCore una vez validada/desplegada; GaleCore-AI o humano puede proponerla | StrategySpec, regla de entrada declarada |
| `COMPUTATION` | Transformación determinística de inputs | GaleCore | GEX, IV Rank, edge, sizing |
| `POLICY` | Regla obligatoria de autorización o gobierno | GaleCore para operación; GaleCore-AI para aceptación cognitiva | límite de riesgo; política de evidencia |
| `CONSTRAINT` | Condición que restringe una decisión dentro de una policy o specification | Según el efecto: GaleCore operacional, GaleCore-AI cognitivo | heat máximo; no inventar números |
| `STATE` | Hecho mutable vigente | GaleCore para estado operacional; host sólo para su sesión | posición, cooldown, estado de estrategia |
| `ACTION` | Mutación o efecto externo | GaleCore | enviar o cancelar una orden |
| `EVIDENCE` | Soporte identificable para una afirmación o decisión | GaleCore operacional/determinístico; GaleCore-AI cognitivo | fill, dataset, EvidenceRef, finding |
| `PREFERENCE` | Elección durable del usuario o producto | GaleCore como estado durable; GaleCore-AI la consume | tolerancia o preferencia registrada |
| `CONVENTION` | Default semántico no operacional | GaleCore-AI | horizonte interpretativo por defecto |
| `PROTOCOL` | Proceso cognitivo obligatorio | GaleCore-AI | facts discipline, production readiness |
| `INTERPRETATION` | Inferencia contextual no autoritativa | Host la produce bajo GaleCore-AI | “GEX positivo podría amortiguar movimientos” |

Una decisión declarativa puede comenzar como propuesta cognitiva y convertirse en `SPECIFICATION` operacional sólo después de validación, aprobación, versionado y aceptación por GaleCore.

> **La clasificación ocurre antes de decidir formato, repositorio o transporte. Markdown, Python, REST y MCP son implementaciones; no categorías de responsabilidad.**

---

## 4. Composición interna de GaleCore-AI

Esta clasificación es conceptual y no autoriza todavía una reorganización física:

```text
GaleCore-AI
├── Cognitive Assets
├── Assurance
├── Integrations / Host Adapters
└── Autonomous Runtime (optional, frozen for now)
```

### 4.1 Cognitive Assets

Son principalmente Markdown y YAML:

```text
agents/
skills/
workflows/
protocols/
conventions/
knowledge/
examples/
```

Enseñan qué tarea realizar, cómo realizarla, qué evidencia exigir, qué tools usar, qué conclusiones están permitidas, qué output producir y cuándo detenerse.

### 4.2 Assurance

Es principalmente schemas y código determinístico:

```text
contracts/
validation/
grounding/
guardrails/
traces/
evals/
```

Impone invariantes que no pueden depender solamente de un prompt.

### 4.3 Integrations / Host Adapters

Adaptan el núcleo a GaleCore REST/MCP o a Claude Code, Codex, Work, HTTP, CLI/stdin o import Python. Ningún adaptador es automáticamente el core y sólo debe existir cuando un vertical real demuestre su necesidad.

### 4.4 Autonomous Runtime

Contiene la opción de operar sin un host interactivo externo:

- `ModelProvider` y proveedores concretos;
- `CognitiveRuntime`;
- API de agent runs;
- scheduling, retries, budgets y model routing futuros.

> **Conservar, no eliminar, pero congelar. No expandir durante el cierre de Phase 3 interactiva.**

---

## 5. Markdown, YAML, schemas y código

No existe una elección binaria entre Markdown y Python.

| Necesidad | Forma principal | Motivo |
|---|---|---|
| Metodología financiera | Markdown | Legible y revisable por humanos |
| Skill | Markdown + YAML | Instrucciones y activación |
| Workflow inicial | Markdown | Validar el proceso antes de automatizarlo |
| Protocol | Markdown/YAML | Pasos y guardrails asociados |
| Convention | YAML/Markdown | Defaults versionados |
| Output contract | JSON Schema o modelo tipado | Validación ejecutable |
| Fact mapping | Código | Traducción sin ambigüedad |
| Freshness | Código | Gate determinístico |
| Grounding | Código | Verifica referencias y valores |
| Hard guardrail | Código | Fail-closed obligatorio |
| Trace | Schema + código/datos | Registro auditable |
| Cálculo financiero | GaleCore | Implementación autoritativa |
| Tool | Endpoint/MCP/código | Acceso ejecutable |
| Instrucción de tool | Markdown | Cuándo y cómo usarla |

> **Markdown y YAML describen cómo debe trabajar el agente. El código hace cumplir lo que no puede quedar sujeto a interpretación.**

El número de archivos de cada tipo no es una métrica de calidad arquitectónica.

---

## 6. Capabilities, REST y MCP

GaleCore mantiene un modelo autoritativo de capabilities. REST y MCP son proyecciones o transportes de esas mismas capacidades.

```text
GaleCore capability implementation
        ├── REST projection
        └── MCP projection
```

MCP no reemplaza la Skill, metodología, output contract, validator, guardrails ni trace.

MCP responde principalmente “¿cómo descubre e invoca el host una capacidad de GaleCore?”. Assurance responde “¿podemos aceptar el output cognitivo producido a partir de esa capacidad?”.

Las capabilities conservan la clasificación P0:

```text
PURE_QUERY
COMPUTE
STATE_MUTATION
EXTERNAL_ACTION
```

Phase 3 sólo permite `PURE_QUERY` y `COMPUTE`.

---

## 7. Execution modes

### 7.1 Interactive Host Mode — actual

```text
User
→ Claude Code or Codex
→ load GaleCore-AI cognitive assets
→ call GaleCore capability
→ model interpretation
→ GaleCore-AI assurance
→ validated result + trace
```

El host aporta el modelo y el loop. GaleCore-AI no debe volver a llamarlo.

### 7.2 ChatGPT Work Mode — integración por validar

Conceptualmente es equivalente al modo interactivo, pero no se asume que Work consuma un repositorio local igual que Claude Code o Codex. La integración puede requerir Workspace Skill, plugin, MCP, servicio u otra interfaz soportada. Debe validarse antes de implementarse.

### 7.3 Autonomous Service Mode — futuro opcional

```text
Scheduler / API / event
→ CognitiveRuntime
→ ModelProvider
→ GaleCore tools
→ assurance
→ result + trace
```

Se justifica para análisis programados, vigilancia continua, batches, alertas y trabajos sin sesión humana. No forma parte del cierre actual de Phase 3.

---

## 8. Regla de independencia del core

> **Ningún componente core de GaleCore-AI debe depender de Claude Code, Codex, ChatGPT Work, Anthropic, OpenAI, FastAPI o un transporte específico.**

Los adaptadores sí pueden depender de esas tecnologías.

El core debe poder reutilizarse desde un test, import Python, API, tool MCP, CLI o runtime autónomo.

Esto requiere separar lógicamente:

```text
prepare context/facts
model execution
validate output
```

El `CognitiveRuntime` actual combina esas etapas y debe clasificarse como adapter/runtime autónomo, no como frontera obligatoria del core.

---

## 9. Trust, provenance, evidence y trace

### 9.1 Facts vs interpretation

```text
Fact = dato o cálculo proporcionado por GaleCore
Interpretation = conclusión cognitiva derivada de facts
```

El modelo no debe transformar una inferencia en fact ni recalcular métricas que pertenecen a GaleCore.

### 9.2 Niveles de confianza

```text
GALECORE_VERIFIED
VALIDATOR_OBSERVED
HOST_DECLARED
UNKNOWN
```

- `GALECORE_VERIFIED`: obtenido o verificado contra GaleCore por una integración controlada.
- `VALIDATOR_OBSERVED`: observado directamente durante validación.
- `HOST_DECLARED`: reportado por el host, sin verificación independiente.
- `UNKNOWN`: evidencia insuficiente.

Si el host entrega al validator una respuesta previamente obtenida de GaleCore, su procedencia es `HOST_DECLARED` salvo verificación independiente. Provider, modelo, tokens y metadata externos también son `HOST_DECLARED` salvo mecanismo verificable.

### 9.3 EvidenceRef

Las conclusiones relevantes deben apuntar a facts mediante referencias estructuradas. La comprobación de `EvidenceRef` es primaria. Buscar números dentro del texto puede usarse como defensa secundaria, no como único grounding.

### 9.4 Trace no es Evidence

- Trace registra cómo ocurrió una ejecución.
- Evidence conserva soporte relevante y reusable.

Producir un `TraceRecord` no implica persistencia durable. Retención y almacenamiento histórico son decisiones separadas.

---

## 10. Seguridad y autoridad

1. La disponibilidad de IA nunca es dependencia de seguridad.
2. GaleCore-AI recomienda; GaleCore autoriza y ejecuta.
3. Recommendation, Approval, Authorization y Execution son estados distintos.
4. Hard Risk vive en GaleCore.
5. GaleCore-AI no posee credenciales del broker.
6. PAPER/LIVE requieren gates adicionales y aprobación humana.
7. Un output válido puede ser `NO_TRADE`, `INSUFFICIENT_DATA` o `INSUFFICIENT_EVIDENCE`.
8. Side effects requieren permisos, idempotencia, freshness y revalidación proporcionales.
9. Phase 3 es estrictamente read-only.
10. Ningún secreto se persiste en repositorio, documentación, fixtures, trazas o prompts.

---

## 11. Misiones del producto

### 11.1 Análisis

Ejemplo: “Analizá el GEX actual de SPY”. El host selecciona la Skill, obtiene facts de GaleCore, interpreta, valida y presenta facts, inferencias, evidencia y limitaciones.

### 11.2 Strategy Development — futuro

```text
objective
→ feasibility
→ retrieve evidence
→ hypothesis
→ experiment design
→ backtest
→ challenge
→ compare
→ StrategyProposal
→ human review
→ StrategySpec proposal
```

GaleCore ejecuta cálculos y experimentos. GaleCore-AI aporta metodología, interpretación y propuestas. No forma parte de Phase 3.

### 11.3 Trading Assistance — futuro

```text
GaleCore deterministic evaluation
→ host interpretation
→ opportunity / risk explanation
→ ActionProposal
→ human approval
→ GaleCore revalidation
→ authorization
→ execution
```

La IA no sustituye hard risk ni autorización operacional.

---

## 12. Phase 3 — Minimal Domain Harness MVP read-only

### 12.1 Objetivo

Demostrar que un modelo ejecutado por un host interactivo puede:

1. usar una AgentDefinition, Skill, Protocol y Conventions versionados;
2. obtener facts y cálculos reales de GaleCore;
3. producir una interpretación estructurada;
4. pasar por validación, grounding y guardrails determinísticos;
5. producir un trace auditable;
6. fallar cerrado cuando no existen datos suficientes.

### 12.2 Primer vertical

```text
“Analizá el GEX actual de SPY.”
```

```text
User
→ interactive host
→ TradingAgent definition
→ GEX Skill
→ Facts Discipline Protocol
→ Trading Conventions
→ GaleCore compute.gex_analysis
→ GexFacts
→ hosted-model interpretation
→ GexInterpretation contract
→ grounding + guardrails
→ trace
→ SUCCESS
```

### 12.3 Fail-closed

```text
missing/invalid/stale facts
→ INSUFFICIENT_DATA

invalid contract/invented value/broken evidence
→ VALIDATION_ERROR

rejected output
→ result = null
```

### 12.4 Definition of Done

Phase 3 termina únicamente cuando existe una ejecución local reproducible donde:

- GaleCore real está levantado;
- el GEX de SPY proviene del cálculo real de GaleCore;
- un host interactivo real ejecuta el modelo;
- el host usa assets cognitivos versionados de GaleCore-AI;
- el output cumple `GexInterpretation`;
- todas las referencias de evidencia son válidas;
- no aparecen números inventados;
- freshness es válida;
- se ejecutan guardrails;
- se produce trace con versiones y timestamps;
- el resultado final es `SUCCESS`;
- existe también una prueba negativa fail-closed;
- la guía local permite repetirlo sin secretos versionados.

Tests unitarios, fixtures o un `FakeProvider` no satisfacen por sí solos esta Definition of Done.

### 12.5 Fuera de alcance

- `StrategyProposal → StrategySpec`;
- deployment;
- SHADOW/PAPER/LIVE;
- ActionProposal y side effects;
- Work Runtime propio;
- multi-agent;
- autonomous memory/learning;
- scheduling;
- nuevos providers;
- expansión del runtime autónomo;
- compatibilidad simultánea con todos los hosts.

---

## 13. Estado actual de implementación

Las etiquetas siguientes describen el estado observado de GaleCore-AI al redactar v5. El próximo checkpoint debe verificarlas. El estado detallado de GaleCore requiere una auditoría separada y no se infiere de su ownership arquitectónico.

### 13.1 Assets existentes

- `config/agents/trading-agent.yaml`
- `config/skills/gex-analysis/skill.yaml`
- `config/skills/gex-analysis/instructions.md`
- `config/protocols/facts-discipline.yaml`
- `config/conventions/trading-defaults.yaml`

**Maturity:** `CURRENT_IMPLEMENTED`; los factories consumen YAML canónico. Todavía no `CURRENT_VALIDATED` como assets host-native.

Son assets internos válidos, pero su formato y ubicación no implican descubrimiento automático por Claude Code, Codex o Work.

### 13.2 Assurance existente

**Maturity:** `CURRENT_IMPLEMENTED`; la validación final mediante un host interactivo real permanece pendiente.

Existen contratos Pydantic, DTOs y mapping de GaleCore, freshness, guardrails, structured grounding, EvidenceRef, TraceRecord y tests contractuales, unitarios, integración y golden evals.

Esta inversión es reusable aunque deba refactorizarse su frontera.

### 13.3 Runtime/adapters existentes

**Maturity:** `CURRENT_IMPLEMENTED` como camino autónomo parcial; `DEFERRED` respecto de su expansión y uso como arquitectura primaria.

Existen `ModelProvider`, `AnthropicProvider`, `FakeProvider`, `CognitiveRuntime`, FastAPI y `AnalyzeGexUseCase`.

No deben eliminarse. Quedan clasificados como autonomous runtime / adapter futuro y congelados hasta nueva decisión.

### 13.4 Gaps reales

Estado al redactar v5; el estado vigente se lee en `PHASE3-ALIGNMENT.md` (Phase 3, cerrada el
2026-09-16 con `GC-AI-0001`) y `PHASE4-ALIGNMENT.md` (Phase 4, `GC-AI-0002`, en curso):

- ~~no existe un `CLAUDE.md` dentro de `GaleCore-AI`~~ (Phase 3);
- ~~no existe todavía un adapter de host aprobado~~ (Phase 3: CLI `prepare`/`accept`);
- los assets internos no son necesariamente host-native;
- ~~falta el flujo interactivo con snapshot y provenance~~ (Phase 3; Phase 4 lo extiende a un skill multi-fuente);
- ~~el flujo con host interactivo y resultado `SUCCESS` no está demostrado~~ (evidencia E2E en `docs/evidence/`);
- el mecanismo concreto para Work no está validado;
- producir trace no equivale a persistirlo durablemente — en curso (`GC-AI-0002`, Phase 4: registro evaluable por día y símbolo, sin base de datos; pendiente de revisión independiente).

---

## 14. Clasificación obligatoria del repositorio

Antes de mover o crear código, cada archivo actual debe clasificarse como:

```text
COGNITIVE_ASSET
CORE_ASSURANCE
GALECORE_INTEGRATION
HOST_ADAPTER
AUTONOMOUS_RUNTIME
TEST_OR_EVAL
DOCUMENTATION
REVIEW
OUT_OF_SCOPE
```

Para cada archivo se debe indicar responsabilidad, dependencias, consumidor real, pertenencia a Phase 3, responsabilidades mezcladas y acción recomendada: keep, freeze, refactor later, move later o retire later.

Esta clasificación no autoriza movimientos ni eliminación.

---

## 15. Implementación dirigida por verticales

> **Antes de expandir infraestructura, validar primero el execution model real y el thin path del caso de uso.**

```text
LOCAL FIRST
→ VALIDATE
→ REVIEW
→ EXPAND
```

Antes de una abstracción nueva, responder:

1. ¿Qué caso real la necesita ahora?
2. ¿Quién la ejecutará?
3. ¿Qué componente existente no puede resolverlo?
4. ¿Cuál es la interfaz mínima?
5. ¿Cómo se probará end-to-end?
6. ¿Qué ocurre si no se construye todavía?
7. ¿Introduce otra fuente de verdad?

---

## 16. Próximo checkpoint obligatorio

El checkpoint inicial contemplaba los siguientes entregables. La autorización posterior del usuario habilitó las correcciones; el estado actual se registra en `PHASE3-ALIGNMENT.md`:

1. inventario y clasificación de archivos;
2. diagrama de dependencias reales;
3. responsabilidades mezcladas;
4. frontera lógica mínima entre host y assurance;
5. comparación de adapters para el host actual;
6. mecanismo de carga de assets;
7. comandos propuestos para el E2E;
8. archivos que sería necesario modificar;
9. confirmación de que no se amplía autonomous runtime;
10. autorización humana del alcance (correcciones autorizadas; no incluye PAPER/LIVE).

La interfaz interna y el transporte externo son decisiones separadas:

```text
validation application service
        ≠
HTTP / MCP / CLI / direct import adapter
```

No considerar `python -c` una invocación directa in-process: crea otro proceso y funciona como una CLI improvisada.

---

## 17. Roadmap corregido

### Phase 0 — Architecture and contracts

Constitución, ownership, contratos P0 y seguridad.

### Phase 1 — Deterministic Trading Runtime

Vertical PCS-SPY SHADOW ejecutable sin GaleCore-AI y AI Removal Test.

### Phase 2 — Capability readiness

Exposición y estabilización de capabilities/facts para consumidores humanos y de IA.

### Phase 3 — Interactive Minimal Domain Harness

GEX-SPY read-only con host interactivo, assets versionados, GaleCore real, assurance y trace.

### Phase 4 — Broader read-only intelligence

Más Skills y workflows sólo después de evaluar GEX. Primer incremento (`GC-AI-0002`, 2026-09-16):
harness completo desde el host — skill de régimen diario (GEX + put skew + VIX/VVIX) con registro
evaluable en `GaleCore/research/regime/` y consulta posterior. Ver `PHASE4-ALIGNMENT.md`.

El lifecycle futuro de bundles de Skills, creación desde evidencia, drafts, evals, revisión y
publicación está capturado como `BL-001` en `PRODUCT-BACKLOG.md`. Su registro preserva la
dirección; no autoriza implementarla antes de cumplir su entry gate.

### Phase 5 — Strategy Development

Objectives, hypotheses, experiment design, backtests, StrategyProposal y revisión humana.

### Phase 6 — Controlled action proposals

ActionProposal, approval, revalidation y transición controlada hacia SHADOW.

### Phase 7 — PAPER/LIVE readiness

Sólo después de P-LIVE, security review, observability, reconciliation y kill switches.

### Autonomous Runtime — capability transversal diferida

Se activa únicamente cuando un caso requiera trabajo sin host interactivo.

---

## 18. Quality tests preservados

- **AI Removal Test:** GaleCore continúa seguro sin IA.
- **No Duplicate Analytics Test:** GaleCore-AI no reimplementa cálculos de GaleCore.
- **Grounding Test:** cada afirmación cuantitativa aceptada se vincula a facts.
- **Host Replacement Test:** cambiar de host no obliga a reescribir el core.
- **Fail-closed Test:** datos insuficientes no producen una respuesta aparentemente válida.
- **Side-effect Test:** Phase 3 no produce mutaciones ni acciones externas.
- **Sunk-work Test:** un adapter puede reemplazarse sin descartar assets ni assurance.
- **Repository Hygiene Test:** no existen secretos ni outputs sensibles versionados.

---

## 19. Jerarquía documental

Desde la aprobación humana de v5:

```text
GaleCore-AI-arquitectura-v5.md
        ↓
P0-CONTRACTS.md
        ↓
ADRs aprobados
        ↓
AGENTS.md / CLAUDE.md / host adapters
        ↓
Skills, Protocols, Workflows and Conventions
        ↓
implementation docs and validation guides
        ↓
legacy handoffs and prior versions
```

V5 gobierna objetivo, ownership y execution model. P0 gobierna el detalle contractual cuando no contradice v5. V4 queda como historia y fuente de decisiones preservadas. Un handoff no modifica arquitectura y la implementación no la reemplaza silenciosamente.

---

## 20. Decisiones cerradas por v5

1. Existen dos repositorios actuales: GaleCore y GaleCore-AI.
2. Host es un rol, no un repositorio.
3. Claude Code y Codex son hosts interactivos posibles hoy.
4. Work es un host posible cuya integración debe validarse.
5. `CognitiveRuntime` es un runtime autónomo opcional, no el core obligatorio.
6. GaleCore-AI es host-agnostic en su núcleo.
7. Cognitive assets son principalmente declarativos.
8. Assurance requiere código determinístico.
9. MCP es transporte/proyección, no Skill, metodología ni validación.
10. GaleCore conserva facts, compute, state, hard risk y execution.
11. GaleCore-AI conserva domain intelligence, contracts, assurance y evals.
12. Phase 3 es read-only y tiene un único vertical GEX-SPY.
13. No se expande autonomous runtime antes de cerrar el vertical interactivo.
14. No se reorganizan carpetas antes del inventario.
15. La interfaz interna de validación y el adapter externo se deciden por separado.

---

## 21. Decisiones abiertas

1. Formato host-native mínimo para Claude Code.
2. Formato host-native mínimo para Codex.
3. Interfaz externa inicial hacia assurance.
4. Frontera exacta del validation application service.
5. Quién obtiene los facts en el primer E2E: host o validator.
6. Cómo elevar provenance de `HOST_DECLARED` a `GALECORE_VERIFIED`.
7. Persistencia y retención futura de traces.
8. Packaging futuro para ChatGPT Work.

Estas preguntas se resuelven dentro del alcance autorizado y con evidencia. No implican que el adapter ni el E2E ya existan.

---

## 22. Declaración final

> **GaleCore es la máquina financiera. GaleCore-AI es la inteligencia de dominio y la capa de assurance. El host es el entorno intercambiable que ejecuta el modelo y coordina el trabajo.**

GaleCore-AI no debe convertirse hoy en una plataforma general de agentes. Debe hacer que cualquier host compatible trabaje con GaleCore como un especialista financiero disciplinado, grounded, trazable y seguro.

```text
one interactive host
→ one TradingAgent definition
→ one GEX Skill
→ one GaleCore COMPUTE capability
→ one structured output
→ deterministic assurance
→ one reproducible SUCCESS
```

Sólo después:

```text
LOCAL FIRST → VALIDATE → REVIEW → EXPAND
```


## 23. Contrato de aceptación y siguiente incremento

- `SUCCESS` cubre exclusivamente el payload aceptado por assurance. Una reformulación posterior del host no hereda esa aceptación.
- Validar todas las referencias locales y sus valores; una coincidencia textual no rescata evidencia inválida.
- Grounding estructural no prueba que toda inferencia narrativa sea correcta. Evaluar por separado fidelidad, utilidad, limitaciones y exageraciones.
- Los facts deben vincularse al mismo snapshot utilizado durante la interpretación. Un hash identifica contenido, no autentica origen. Nunca comparar contra una segunda consulta live como si fuera el mismo snapshot.
- Revalidar freshness al aceptar la salida; contemplar timestamps futuros y desfase tolerado del reloj.
- Los YAML en `config/` son los assets canónicos ejecutables. Los factories Python son wrappers; `instructions.md` es documentación complementaria, no otra fuente de reglas.
- Registrar hash del contenido efectivo de las definiciones, además de su versión. Ese registro no prueba por sí solo que un host externo las leyó o siguió.
- `near_zero` no puede producir SUCCESS: GaleCore publica call_gex/put_gex y net_gex en escalas incompatibles, así que el validador lo rechaza fail-closed. El YAML (5% de suma absoluta) se preserva como intención futura; no habilita nada hoy.
- Los números interpretativos viven únicamente en `quantitative_claims` (`metric`, `value`, `unit` con enums cerrados). El validador deriva el fact_path y la unidad desde `metric`; `value` debe ser exactamente el fact, sin normalizar. Observations e implications son prosa sin dígitos.
- Las unidades son contrato técnico del validador, no conventions configurables. Incorporar metadata de unidades al contrato HTTP de GaleCore es trabajo futuro (backlog), no de este incremento.
- Las convenciones se leen una sola vez; del mismo objeto salen el hash del asset, los valores resueltos y `conventions_hash`, que el snapshot exige y acceptance recomputa. Sin default, sin grace period.
- El primer E2E debe usar un host, un snapshot y un resultado aceptado, más casos negativos estrictos. Después, una pequeña evaluación con outputs reales debe medir el aporte de los assets frente a una ejecución sin ellos.

Ver `PHASE3-ALIGNMENT.md` para responsabilidades actuales, garantías implementadas y trabajo pendiente. La apertura de este incremento no declara cerrada Phase 3.
