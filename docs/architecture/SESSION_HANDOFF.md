# GaleCore-AI — Architecture handoff

**Fecha:** 2026-09-13  
**Estado:** v4 aceptada como constitución arquitectónica; `P0-CONTRACTS.md` redactado y marcado `READY FOR FINAL REVIEW`, todavía pendiente de aprobación explícita.  
**Gate actual:** revisión final y aprobación explícita de P0.  
**Siguiente fase tras la aprobación:** Trading Runtime determinístico → PCS-SPY SHADOW → AI Removal Test.  
**Restricción:** no implementar runtime antes de aprobar P0; después, limitar Phase 1 al vertical slice determinístico acordado.

---

## 1. Decisión de cierre

`GaleCore-AI-arquitectura-v4.md` queda aceptado como **Architecture Constitution v4**.

No se reabre su arquitectura conceptual. Se consideran cerrados:

- GaleCore como Machine / Platform / Operational Plane.
- GaleCore-AI como Brain / Cognitive / Intelligence Plane.
- Harness como infraestructura cognitiva reusable dentro de GaleCore-AI.
- Agent como actor cognitivo configurado que utiliza el Harness.
- Trading Runtime y Work Runtime dentro de GaleCore.
- Cognitive Runtime como componente del Harness.
- GaleCore-AI recomienda; GaleCore valida, autoriza y ejecuta.
- GaleCore conserva la verdad operacional y analítica determinística.
- GaleCore-AI conserva evidencia cognitiva.
- `StrategyProposal != StrategySpec != StrategyInstance`.
- `TradeCandidate != TradeRecommendation != ApprovedTrade`.
- Monitoreo determinístico y cognición deliberada/event-driven.
- `NO_TRADE`, `NOT_READY` e `INSUFFICIENT_EVIDENCE` como resultados válidos.
- Skills, Protocols, Guardrails y Output Contracts como conceptos distintos.
- Internal-first retrieval y reutilización de evidencia previa.

La revisión no invalida v4. Detecta la capa contractual que falta entre la constitución y el código.

---

## 2. Estado real del repositorio

Al iniciar el siguiente trabajo, asumir:

- `GaleCore/` contiene la plataforma existente en .NET y React.
- `GaleCore-AI/` todavía no contiene una implementación de runtime.
- La constitución v4 está copiada junto a las versiones anteriores como `GaleCore-AI-arquitectura-v4.md`.
- `GaleCore/CLAUDE.md` sigue siendo la fuente vigente de arquitectura del sistema implementado.
- La documentación actual usa **Harness** con un significado anterior: research/backtest + backend + operación humana.
- Las estrategias actuales usan JSON, endpoints y documentación específicos por estrategia.
- RPF y GEX son activos existentes; no deben migrarse ni romperse durante P0.
- `GaleCore-AI/docs/architecture/USE-CASE-STRATEGY-DEVELOPMENT-E2E.md` describe, en términos de producto, el recorrido futuro de desarrollo de una estrategia y valida conceptos que todavía no son contratos cerrados.

El use case es una referencia conceptual y de experiencia objetivo. No reemplaza la Constitution v4, `P0-CONTRACTS.md` ni el orden del roadmap.

La copia de v4 ya está dentro del workspace, pero todavía debe adoptarse explícitamente como fuente canónica y ubicarse en la jerarquía documental definitiva. Hasta entonces, `GaleCore/CLAUDE.md` describe la implementación vigente y v4 gobierna la arquitectura objetivo.

Jerarquía documental objetivo:

```text
Architecture Constitution v4
        ↓
P0 Contracts
        ↓
AGENTS.md / repository rules
        ↓
implementation and domain docs
        ↓
legacy CLAUDE.md only where not conflicting
```

Al adoptar esta jerarquía, actualizar o retirar las partes contradictorias de `GaleCore/CLAUDE.md`; no dejar dos constituciones compitiendo.

---

## 3. Estado actual y próxima fase

`GaleCore-AI/docs/architecture/P0-CONTRACTS.md` ya existe y se declara `READY FOR FINAL REVIEW`. Ese estado significa que el documento cubre su alcance y está listo para la revisión humana final; no equivale todavía a aprobación.

La tarea inmediata es revisar P0 y aprobarlo explícitamente. Una vez aprobado, Phase 1 queda limitada a:

```text
Trading Runtime determinístico en GaleCore
        ↓
Primer StrategySpec real: PCS-SPY
        ↓
Ejecución end-to-end en SHADOW
        ↓
AI Removal Test
```

El objetivo es demostrar que GaleCore puede validar y ejecutar una estrategia genérica sin depender de GaleCore-AI. Harness, Work Runtime, Model Management, multi-agent, PAPER/LIVE y la migración de RPF/GEX quedan fuera de Phase 1.

---

## 4. Alcance contractual mínimo

Esta sección registra los requisitos que dieron origen a P0. Desde su creación, `P0-CONTRACTS.md` es la fuente autoritativa para el detalle contractual: este checklist no debe usarse para reinterpretarlo ni reabrir decisiones ya cerradas.

### 4.1 Current-state migration / terminology

Documentar el destino, sin ejecutar todavía la migración:

| Estado actual | Destino propuesto |
|---|---|
| “Harness” de `GaleCore-ways-of-working.md` | Renombrar a Quality Gates |
| JSON de RPF | Legacy strategy config con mapping futuro a `StrategySpec` |
| JSON de GEX | Separar configuración analítica de un eventual `StrategySpec` |
| Endpoints específicos por estrategia | Adaptadores o proyección hacia capabilities/runtime genéricos |
| `docs/rpf` | Separar reglas operacionales de metodología/conocimiento cognitivo |
| `docs/gex` | Separar cálculo determinístico de conocimiento interpretativo |
| `.claude/commands` como skills actuales | Inventariar; no copiar automáticamente al sistema futuro de Skills |

Reglas:

- Documentar coexistencia y source of truth durante la transición.
- No migrar RPF/GEX en P0.
- No introducir dos significados activos y sin calificar para “Harness”.

### 4.2 Shared Contract Envelope v1

Definir un `BaseEnvelope` común y extensiones especializadas. No imponer un objeto físico monolítico a requests, responses, propuestas, recomendaciones y eventos.

```text
BaseEnvelope
├── CommandEnvelope
├── QueryEnvelope
├── CognitiveEnvelope
└── EventEnvelope
```

Todos comparten identidad contractual, correlación, causalidad, trace, actor y contexto temporal. Cada extensión agrega sólo la semántica necesaria; por ejemplo, una query pura puede no requerir expiración y un evento puede no requerir idempotency key.

Base conceptual esperada —los campos condicionales se especializan en P0—:

```json
{
  "contract_version": "1.0",
  "message_id": "...",
  "correlation_id": "...",
  "causation_id": "...",
  "trace_id": "...",
  "idempotency_key": "...",
  "actor": {
    "tenant_id": "...",
    "user_id": "...",
    "actor_type": "HUMAN|AGENT|SYSTEM",
    "agent_definition_version": "..."
  },
  "temporal_context": {
    "requested_at": "...",
    "expires_at": "...",
    "market_data_as_of": "...",
    "portfolio_snapshot_ref": "..."
  },
  "evidence_refs": [],
  "capability_versions": {},
  "payload_type": "...",
  "payload": {}
}
```

P0 debe decidir obligatoriedad, formato, propagación, validación y semántica de ausencia de cada campo para cada tipo de envelope. Debe evitar tanto los campos implícitos como un envelope universal artificialmente pesado.

### 4.3 StrategySpec v1

El source of truth debe ser neutral al lenguaje:

```text
StrategySpec JSON Schema
        ├── modelo/validador .NET
        └── modelo/validador Python
```

Cerrar al menos:

- identidad y versión de estrategia;
- universo e instrumentos;
- entry filters y candidate construction;
- legs y estructuras permitidas;
- sizing y límites declarativos;
- exits y lifecycle determinístico;
- SHADOW/PAPER/LIVE eligibility;
- decimal, moneda y rounding;
- UTC, ET, sesiones y calendarios;
- simbología de opciones;
- `null` vs campo ausente;
- schema version y compatibilidad;
- validación y errores;
- hashing/inmutabilidad de una versión desplegada.

Una versión desplegada debe ser content-addressable o poseer un hash canónico estable. Una `StrategyInstance` referencia ese hash exacto, además de cualquier versión humana legible.

### 4.4 Cognitive API v1

Definir antes del Harness la frontera GaleCore → GaleCore-AI.

Como mínimo:

```text
CognitiveRequest
CognitiveResponse
ResolvedIntent
StrategyProposal
ExperimentProposal
TradeRecommendation
VisualizationIntent
ActionProposal
ResearchFinding
```

Incluir:

- operaciones iniciales;
- request/response síncrono versus job asíncrono;
- cancelación y timeout;
- errores y resultados parciales;
- versionado;
- referencias a artifacts/evidence;
- límites de tamaño;
- comportamiento cuando GaleCore-AI no está disponible.

### 4.5 Capability Contract Model v1

Debe existir una única definición autoritativa en GaleCore:

```text
GaleCore Capability Contract Model
        ├── REST projection
        └── MCP projection
                ↓
        Harness Capability Registry
```

Regla canónica:

> MCP is a projection of GaleCore's authoritative capability model, not an independently maintained tool catalog.

El modelo debe incluir identificador, versión, input/output schema, permisos, modos permitidos, availability, freshness, errores, idempotencia y costo/latencia cuando corresponda. REST y MCP deben poder verificarse con contract tests de paridad.

Cada capability debe declarar su clase semántica:

```text
PURE_QUERY
COMPUTE
STATE_MUTATION
EXTERNAL_ACTION
```

De esta clasificación se derivan políticas base:

```text
PURE_QUERY      → sin approval; idempotency NOT_APPLICABLE normalmente
COMPUTE         → límites de costo/recursos; idempotency según ejecución
STATE_MUTATION  → permiso + idempotency REQUIRED
EXTERNAL_ACTION → permiso + approval + freshness + revalidation + idempotency REQUIRED
```

`idempotency_key` no es obligatoria para toda capability. Es requerida para operaciones con side effects, opcional cuando el mecanismo de compute lo justifique y normalmente no aplicable a lecturas puras.

El versionado debe distinguir transversalmente:

```text
schema_version       → forma del contrato
calculation_version  → implementación matemática/determinística
methodology_version  → definición semántica o metodología
```

Compatibilidad de schema no implica compatibilidad semántica. Un payload puede conservar su forma y cambiar el significado de `gamma_flip`; ese cambio debe quedar versionado y trazable.

### 4.6 ActionProposal / Approval / Execution

Formalizar una máquina de estados, incluyendo transiciones inválidas:

```text
PROPOSED
→ VALIDATED
→ APPROVAL_REQUIRED
→ APPROVED
→ REVALIDATING
→ AUTHORIZED
→ EXECUTING
→ EXECUTED

Terminales/alternativas:
REJECTED | EXPIRED | CANCELLED | FAILED | EXECUTION_UNKNOWN
```

Cerrar:

- quién puede ejecutar cada transición;
- diferencia entre aprobación humana y autorización final de la plataforma;
- qué cambio invalida una aprobación;
- duración y alcance de la aprobación;
- revalidación obligatoria inmediatamente antes de ejecutar;
- precio, crédito, liquidez, buying power y portfolio drift tolerables;
- idempotencia y duplicate suppression;
- timeout o resultado incierto del broker;
- audit trail;
- precedencia del kill switch;
- comportamiento fail-closed en LIVE.

Regla canónica:

```text
Recommendation != Approval != Authorization != Execution
```

### 4.7 Identity, permissions, freshness e idempotency

P0 mínimo antes de SHADOW:

- identidad de usuario y actor;
- propagación de principal;
- permiso por capability;
- scope SHADOW/PAPER/LIVE;
- correlation/trace IDs;
- idempotency keys;
- timestamps y freshness;
- separación mínima por tenant/account;
- prohibición explícita de que GaleCore-AI posea credenciales de broker.

### 4.8 Evidence + Trace Lineage

Una conclusión durable debe poder reconstruirse mediante referencias a:

```text
AgentDefinition version
model/provider version
prompt/template version
skills versions
protocol versions
conventions versions
capability versions
tool inputs/outputs
dataset and market snapshots
portfolio snapshot
experiment/study
parent evidence
```

Reglas:

- `Trace != Evidence`.
- Trace sirve para observability/debugging y puede ser detallado, costoso y sujeto a retención limitada.
- Evidence es soporte durable, curado y reusable; debe referenciar sólo lo relevante y no depender de conservar indefinidamente todo el trace.
- Findings, hypotheses y narratives son append-only.
- `SUPERSEDED` e `INVALIDATED` crean revisiones enlazadas; no destruyen historia.
- Distinguir evidencia operacional, determinística y cognitiva.
- Una referencia debe tener identidad, tipo, owner, versión/hash y mecanismo de resolución.
- Definir qué parte del trace se conserva, por cuánto tiempo y con qué redacción de datos sensibles.

### 4.9 Minimal Data Catalog

Definir el mínimo necesario para que `internal-first retrieval` sea real desde el primer Harness:

Clasificar cada asset de información como:

```text
RAW_DATA
DERIVED_METRIC
HISTORICAL_SNAPSHOT
ANALYTICAL_DATASET
VIEW
```

Poseer raw data no implica poseer una métrica, historia, dataset analítico o vista canónica.

```text
asset_id / concept
asset_type
owner / source / provider
schema/version
coverage
history_start
granularity/frequency
freshness/as_of
quality/status
availability
permissions
derived_from
methodology/calculation version
resolution mechanism
```

Precisar la semántica de:

```text
AVAILABLE | PARTIAL | DERIVABLE | NOT_AVAILABLE | PLANNED
```

### 4.10 Failure semantics

Definir por frontera:

- timeout y retry policy;
- retryable vs terminal;
- circuit breaking;
- duplicate delivery;
- ordering y concurrencia;
- partial result;
- stale context;
- cancellation;
- unavailable dependency;
- uncertain execution outcome;
- degradación cuando GaleCore-AI está caído;
- límites básicos de latencia, costo y cantidad de tool calls.

---

## 4A. Extensiones conceptuales posteriores a P0

El use case `USE-CASE-STRATEGY-DEVELOPMENT-E2E.md` permitió aceptar una dirección de producto más completa sin convertirla en una decisión P0 ni cambiar el roadmap actual:

- `StrategyProject`: estado durable de producto, propiedad de GaleCore, que agrupa referencias a WorkSessions, proposals, experiments, specs, deployments y evaluations. No reemplaza a `StrategySpec` ni a `StrategyInstance`.
- `StrategyObjective`: contrato cognitivo y durable del problema que conserva objetivos, constraints, benchmarks, métricas y trade-offs. No es ejecutable; su schema y lifecycle exactos están diferidos.
- Economic feasibility, benchmark y opportunity cost: una estrategia debe evaluarse por retorno, riesgo, capital efficiency, complejidad y un benchmark razonable, no sólo por P&L. GaleCore-AI determina la relevancia y metodología; GaleCore calcula datos y métricas.
- Model Management: `Model Gateway`, `Model Registry`, `Routing Policy` y `ModelProfile` evitarán que los agentes hardcodeen proveedor o modelo.
- Agent model: `AgentDefinition` describe la configuración versionada y `AgentRun` una ejecución concreta. El MVP mantiene un solo `TradingAgent`; multi-agent sigue diferido.
- Harness learning loop: la evidencia puede mejorar continuamente el trabajo, pero los cambios metodológicos requieren propuesta, revisión y versionado. El aprendizaje de modelo/runtime se evalúa; no existe auto-modificación silenciosa.
- Harness Evaluation: conecta `AgentRun → output → later outcome → EvaluationResult` para evaluar la calidad real de las decisiones con resultados posteriores.

Estos conceptos son dirección objetivo. No agregan schemas obligatorios, no modifican P0 y no habilitan su implementación dentro de Phase 1.

### Contratos explícitamente diferidos

- `StrategyProject`.
- `StrategyObjective`.
- `ModelProfile`.
- Lifecycle de `AgentDefinition`.
- Retención de `AgentRun`.
- `MethodologyChangeProposal`.
- `EvaluationResult`.
- Contrato de UI Strategies ↔ Work.
- Convenciones para selección de benchmarks.
- Umbrales de capital efficiency.

---

## 5. Dos gates de seguridad

No convertir P0 en el diseño completo de una institución financiera antes de probar SHADOW.

### P0-MINIMUM — requerido antes de implementar el vertical slice

- contratos indicados en este documento;
- actor/user identity mínima;
- permisos de capabilities;
- scope SHADOW/PAPER/LIVE;
- idempotencia;
- freshness y expiración;
- trazabilidad y lineage mínimos;
- no broker execution desde GaleCore-AI;
- vertical slice inicialmente limitado a SHADOW.

### P-LIVE — requerido antes de PAPER/LIVE multiusuario

- tenant isolation endurecido y probado;
- delegation model completo;
- tratamiento y retención de datos por proveedor de modelos;
- secrets y credenciales delegadas de mínimo privilegio;
- protección contra prompt injection de fuentes externas;
- política de external search y provenance;
- failure modes completos del broker;
- reconciliación de órdenes con outcome incierto;
- kill switches y procedimientos operativos;
- SLOs, alertas y respuesta a incidentes;
- threat model y security review;
- tests de autorización y aislamiento.

P0-MINIMUM habilita diseñar/construir SHADOW. No habilita PAPER/LIVE.

---

## 6. Orden corregido de ejecución

```text
0. Versionar Architecture Constitution v4 y resolver fuentes documentales
1. Diseñar y aprobar P0-CONTRACTS
2. Implementar contratos neutrales y validadores mínimos
3. Construir vertical slice determinístico PCS-SPY SHADOW en GaleCore
4. Verificar AI Removal Test y evidencia operacional end-to-end
5. Construir Minimal Harness sobre Cognitive API/Capability contracts estables
6. Incorporar evidence/catalogs/protocols incrementales
7. Completar P-LIVE antes de habilitar PAPER/LIVE multiusuario
8. Migrar legacy RPF/GEX de forma separada y reversible
```

La Cognitive API no se posterga hasta después del Harness. El Harness depende de su contrato.

En términos operativos, **Phase 1 = Trading Runtime determinístico → PCS-SPY SHADOW → AI Removal Test**. Harness, Work Runtime y Model Management continúan fuera de esta fase.

El backtester no bloquea iniciar SHADOW, pero SHADOW por sí solo no habilita PAPER ni LIVE. Production Readiness conserva la obligación de evidencia suficiente, out-of-sample, costos, robustez y controles operativos.

---

## 7. Criterios de aceptación de P0-CONTRACTS

P0 declara cubiertos los siguientes criterios y está listo para revisión final. La aprobación humana explícita sigue siendo el gate antes de implementar:

- cada contrato tiene owner, source of truth y versión;
- la jerarquía documental y la precedencia ante conflictos están definidas;
- existen ejemplos válidos e inválidos;
- los estados y transiciones están definidos;
- errores, timeout, retry e idempotencia tienen semántica explícita;
- REST y MCP derivan del mismo capability model;
- cada capability declara `PURE_QUERY`, `COMPUTE`, `STATE_MUTATION` o `EXTERNAL_ACTION` y aplica idempotencia proporcional;
- schema, calculation y methodology versioning están diferenciados;
- StrategySpec no depende de C# ni Python como fuente canónica;
- una StrategyInstance puede identificar inequívocamente el hash canónico de su StrategySpec;
- una recomendación puede reconstruir actor, contexto temporal, capabilities y evidencia;
- una aprobación no puede ejecutarse con contexto vencido sin revalidación;
- aprobación, autorización y ejecución son estados distintos;
- trace efímero y evidence durable tienen contratos y retención diferenciados;
- los assets del Data Catalog están clasificados por tipo;
- queda documentado qué sigue funcionando si GaleCore-AI desaparece;
- queda documentada la coexistencia con JSON/endpoints/docs actuales;
- P0-MINIMUM y P-LIVE están claramente separados;
- no se escribió runtime de producción como parte del documento.

---

## 8. Fuera de alcance inmediato

- Implementar GaleCore-AI.
- Crear planners avanzados o multi-agent orchestration.
- Migrar RPF o GEX.
- Reemplazar los JSON actuales.
- Habilitar PAPER o LIVE.
- Resolver exhaustivamente UI/Work.
- Implementar external web research.
- Diseñar todos los controles enterprise de P-LIVE.

---

## 9. Instrucción para la próxima sesión/agente

> Aceptamos v4 como Architecture Constitution y `P0-CONTRACTS.md` está listo para revisión final. Antes de escribir runtime code, revisar P0 y registrar su aprobación explícita. Si se aprueba, planificar o implementar únicamente Phase 1: Trading Runtime determinístico en GaleCore, PCS-SPY en SHADOW y AI Removal Test. No iniciar Harness, Work Runtime, Model Management, multi-agent, PAPER/LIVE ni migraciones de RPF/GEX. Usar el use case E2E como dirección futura, sin promover sus extensiones conceptuales a contratos cerrados.

Al encontrar una decisión no especificada, el siguiente agente debe:

1. derivarla de la Constitution v4 cuando sea posible;
2. verificar la realidad del repositorio;
3. registrar para revisión cualquier contradicción real, sin modificar automáticamente v4 ni P0;
4. evitar introducir implementación accidental como source of truth;
5. elevar únicamente decisiones de producto o riesgo que cambien materialmente el alcance.

---

## 10. Resultado esperado de la siguiente revisión

La revisión final debe confirmar si P0 responde inequívocamente:

```text
¿Qué cruza cada frontera?
¿Quién lo emitió y con qué autoridad?
¿Qué versión del contrato usa?
¿En qué datos y evidencia se basó?
¿Hasta cuándo es válido?
¿Puede repetirse de forma segura?
¿Cómo falla?
¿Cómo se audita?
¿Qué ocurre si la IA desaparece?
```

Si las respuestas están cerradas y P0 se aprueba explícitamente, el próximo trabajo será planificar o implementar el vertical slice determinístico PCS-SPY SHADOW y verificar el AI Removal Test. Las extensiones conceptuales registradas en la sección 4A permanecen diferidas y no forman parte de ese alcance.
