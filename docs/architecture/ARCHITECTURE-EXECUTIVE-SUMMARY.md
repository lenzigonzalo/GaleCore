# GaleCore + GaleCore-AI — Architecture Executive Summary

**Source of truth:** Architecture Constitution v4 (`GaleCore-AI-arquitectura-v4.md`).
**Status:** APPROVED EXECUTIVE SUMMARY. `P0-CONTRACTS.md` está listo para revisión final.

---

## 1. Executive Thesis

```
GaleCore     = the Machine.   Platform / Operational Plane.
GaleCore-AI  = the Brain.     Cognitive / Intelligence Plane.
Harness      = the cognitive infrastructure inside GaleCore-AI.
Agent        = a configured cognitive actor running on the Harness.
```

GaleCore provides capabilities, executes operations and maintains operational truth.
GaleCore-AI thinks, interprets, plans and recommends.

> **GaleCore-AI recommends. GaleCore validates, authorizes and executes.**

If GaleCore-AI disappears, the platform continues to protect the portfolio, monitor
positions, enforce risk and run deployed strategies. What stops: intelligent research,
market interpretation, strategy ideation, improvement proposals.

> **Intelligence may propose. The platform remains responsible for safe, durable execution.**

---

## 2. System Architecture

```
                          USER
                           |
                           v
                    GALECORE FRONTEND
                    React 19 / Monitor
                           |
                           v
 +----------------------------------------------------------+
 |                      GALECORE                             |
 |              Machine / Platform Plane                     |
 |                                                           |
 |  Platform Runtime      Trading Runtime      Work Runtime  |
 |  .NET 8 Web API        Scheduler            WorkSession   |
 |  Auth / Permissions    StrategyInstance      Task          |
 |  Supabase/Postgres     Position Monitor     Artifact      |
 |  SignalR / MCP         Hard Risk            Sandbox       |
 |  Providers             Execution            Approval      |
 |                        Determ. Exits        Files         |
 |                                                           |
 |  Market Data    Analytics    Broker    Data Catalog       |
 |  Quotes/Chains  GEX/IV/BS   Orders    Capability Surface |
 |  FRED/Macro     Skew/Vol    Fills     Storage             |
 +----------------------------+------------------------------+
                              |
               cognitive requests (down)
               capability access  (up)
                     REST / MCP
                              |
                              v
 +----------------------------------------------------------+
 |                    GALECORE-AI                             |
 |               Brain / Cognitive Plane                      |
 |                                                           |
 |                      HARNESS                              |
 |  Model Gateway        Context Engine      Skill Loader    |
 |  Agent Definitions    Protocol Loader     Conv. Resolver  |
 |  Planner              Capability Registry/Dispatcher      |
 |  Cognitive Runtime    Output Contracts    Guardrails      |
 |  Trace / Observability                                    |
 |                                                           |
 |                 DOMAIN INTELLIGENCE                       |
 |  Interpretation       Strategy Design     Research        |
 |  Trading Reasoning    Evaluation          Learning        |
 |  Market Narratives    Scenarios            Hypotheses     |
 +----------------------------------------------------------+
```

**Data flow:**

```
Frontend --> GaleCore --> GaleCore-AI   (cognitive requests)
GaleCore-AI --> GaleCore                (capability/data access)
```

The browser never calls GaleCore-AI directly. GaleCore mediates auth and state.

---

## 3. How Value Accumulates (The Flywheel)

```
OBSERVE         GaleCore collects market/broker facts
     |
STORE FACTS     GaleCore persists raw + derived data
     |
INTERPRET       GaleCore-AI synthesizes meaning
     |
STORE EVIDENCE  GaleCore-AI persists findings, hypotheses, narratives
     |
DECIDE          GaleCore-AI recommends; GaleCore validates
     |
EXECUTE         GaleCore runs order / shadow fill / simulation
     |
STORE OUTCOME   GaleCore persists operational evidence
     |
EVALUATE        GaleCore-AI interprets results
     |
LEARN           GaleCore-AI identifies patterns, proposes improvements
     |
IMPROVE         Better strategies, better context, better decisions
```

The goal is not a model that "thinks well once". It is a system that compounds:

- data and snapshots
- studies and artifacts
- findings and hypotheses
- market narratives
- trade outcomes
- unresolved research questions

> **Search before build. Retrieve before recompute. Reuse before rediscover.**

Three layers of retained knowledge:

| Layer | Owner | Examples |
|---|---|---|
| Raw / normalized facts | GaleCore | GEX snapshots, IV history, prices, orders, fills |
| Derived deterministic evidence | GaleCore | 30-day GEX percentile, rolling correlations, strategy metrics |
| Cognitive evidence | GaleCore-AI | Findings, narratives, hypotheses, interpretations, open questions |

---

## 4. From Idea to Running Strategy

```
USER IDEA
  |
  v
Analysis / Research              GaleCore-AI interprets, Harness retrieves prior evidence
  |
  v
Hypothesis                       explicit claim about a potential source of edge
  |
  v
Edge Thesis                      mechanism, measurability, falsification criteria
  |
  v
StrategyProposal                 cognitive artifact: rules, assumptions, risks, experiments
  |
  v
Experiment / Validation          GaleCore executes backtest; GaleCore-AI interprets
  |
  v
StrategySpec                     stable, versioned, executable contract
  |
  v
GaleCore Trading Runtime         validates, deploys
  |
  v
SHADOW --> PAPER --> LIVE        each transition requires defined evidence/readiness gates;
                                human approval is mandatory before LIVE
  |
  v
Outcome / Evidence               operational + cognitive evidence stored
  |
  v
Evaluation / Learning            feed future decisions
```

Canonical distinctions:

```
IDEA              != HYPOTHESIS
HYPOTHESIS        != EVIDENCE
EVIDENCE          != EDGE
EDGE              != STRATEGY
STRATEGY          != PRODUCTION-READY STRATEGY
StrategyProposal  != StrategySpec
StrategySpec      != StrategyInstance
```

A strategy must pass through Protocols and validation gates, not arrive at production
through intuition or a single attractive backtest.

---

## 5. Strategy Development Guardrails

The Harness requires structured reasoning through mandatory questions:

```
What is the hypothesized source of edge?
Why should it exist (economically / behaviorally / structurally)?
Is the evidence sufficient?
Is it overfit? Could the result be data-mined?
Is there out-of-sample evidence?
Does it survive realistic fees and slippage?
Is the sample large enough?
Is performance concentrated in one regime or period?
What would falsify the thesis?
Is it executable with available liquidity?
Is it portfolio-compatible?
Is there enough evidence to advance to the next stage?
```

Five distinct Harness concepts enforce discipline:

```
Skills       = how to reason about a domain
Protocols    = which steps must happen for a class of task
Conventions  = default semantic meaning when user is ambiguous
Guardrails   = what cognition must NOT do or claim
Contracts    = what structured outputs must contain
```

When a cognitive check stabilizes and becomes reproducible, it should be promoted to
a deterministic validation gate in GaleCore:

```
Cognitive question --> methodology stabilizes --> deterministic gate
```

Examples: minimum sample size, fees included, no lookahead leakage, max risk thresholds.

---

## 6. Representative Use Cases

### A. "Show me AAPL implied volatility"

```
Natural language --> Work Runtime --> Harness
  Context + Convention + User Preferences
  --> resolve InstrumentContext (AAPL = equity, optionable)
  --> Convention Resolver determines canonical default IV view
      (e.g. skew by strike — exact default is a product/domain convention to be defined)
  --> GaleCore IV capability
  --> VisualizationIntent (semantic, not pixel-level)
  --> GaleCore ChartSpec + user visual preferences
  --> rendered View
```

- Harness resolves semantic ambiguity; may not need deep inference.
- Calculation lives in GaleCore. Interpretation lives in GaleCore-AI.
- Same view is reachable manually from the UI or via Work.

### B. "Analyze SPY GEX and save it daily"

Two intents decomposed:

```
Intent 1: Analyze GEX now
  GaleCore GEX Engine --> GexAnalysis
  --> Harness interpretation Skill
  --> interpretation + GEX View

Intent 2: Persist daily GEX
  Harness --> ActionProposal: CREATE_METRIC_CAPTURE
  --> GaleCore validates, creates subscription
  --> GaleCore Scheduler (deterministic, no LLM)
  --> daily GexSnapshot --> Supabase/PostgreSQL
```

- Calculation != interpretation.
- Snapshot belongs to GaleCore (logical owner) even if stored in Postgres.
- Daily deterministic capture does not require daily LLM invocation.
- Snapshots include `methodology_version` and `calculation_version`.

### C. "Design a PCS strategy using Tastytrade methodology"

```
Objective --> Work Runtime --> Harness
  Strategy Development Skill (Tastytrade methodology)
  Strategy Development Protocol (mandatory steps)
  Account/portfolio context
  Existing evidence retrieval
  GaleCore options/market capabilities
       |
       v
  StrategyProposal
    hypothesis + edge thesis + candidate rules
    + risks + open questions + recommended experiments
       |
       v
  GaleCore executes deterministic backtests/simulations
       |
       v
  Harness interprets results / compares variants
       |
       v
  Refined StrategyProposal --> human review
       |
       v
  StrategySpec --> GaleCore validation --> SHADOW
```

- Tastytrade methodology = Skill (knowledge), not Convention (defaults).
- "high POP / low risk / stable returns" are objectives to operationalize.
- POP != trade quality. StrategyProposal != StrategySpec.
- Edge validation is mandatory before advancing stages.

### D. "What trade would you make on SPY today?"

```
AnalysisContext
  target = SPY
  objective = assess_current_trade_opportunity
  horizon = resolved/inferred from session context
  allowed_strategies = user/account/platform constraints
         |
         v
Existing Evidence + Market Context
+ Volatility + GEX / Market Structure
+ Events + Portfolio State
         |
         v
   Is there sufficient edge?
      /              \
 NO_TRADE         Opportunity
                      |
                Strategy Fit
               /      |      \
             PCS      IC     CCS ...
                      |
               TradeCandidates
                      |
                Portfolio Fit
                      |
           TradeRecommendation
                      |
             GaleCore Hard Risk
                      |
      Approval / Authorization / Execution
```

- The system first determines whether an opportunity exists, then determines
  which strategy best expresses it. No strategy is assumed before opportunity assessment.
- `NO_TRADE` is a first-class successful result.
- `MarketOpportunity != PortfolioOpportunity`.
- `StrategyFit != TradeCandidateQuality`.
- `TradeCandidate != TradeRecommendation != ApprovedTrade`.
- Deterministic monitoring + event-driven cognition.

---

## 7. Market / Macro Context

The system does NOT reduce markets to a universal `BULLISH / NEUTRAL / BEARISH` score.

> The goal is to understand what story the market is currently pricing, through which
> mechanisms it transmits, what evidence supports or contradicts it, and what it implies
> for the specific asset, strategy and horizon being considered.

```
RAW WORLD
     |
GALECORE
  deterministic facts / features
  rates, FX, commodities, credit, equities, vol, positioning
     |
HARNESS
  Context selection (relevance before completeness)
  AnalysisContext: target + horizon + objective
     |
MARKET CONTEXT SYNTHESIS
  |-- narratives (ACTIVE / WEAKENED / SUPERSEDED / INVALIDATED)
  |-- expectations vs actual (consensus, surprise, revision)
  |-- transmission mechanisms (contextual hypotheses, not eternal rules)
  |-- cross-asset signals
  |-- market structure / positioning
  |-- events / catalysts
  |-- scenarios (BASE / BULL / BEAR / TAIL)
     |
ASSET / STRATEGY IMPLICATIONS
```

Causal relationships like "rates up --> tech down" are contextual hypotheses, not laws.
The same event can be positive on one horizon and negative on another.

---

## 8. Capability and Data Discovery

The Harness must know not only "what tools exist" but "what information exists":

```
Capability Catalog    --> what can the machine do?
Data Catalog          --> what data actually exists? (coverage, freshness, history)
Artifact/Study Catalog --> what has already been produced?
Cognitive Evidence    --> what has already been concluded or left open?
```

Internal-first retrieval before external search:

```
1. Does GaleCore expose a capability?
2. Does the Data Catalog already contain the needed data?
3. Does an artifact or study already exist?
4. Does cognitive evidence already answer part of the question?
5. Can the answer be derived internally with deterministic compute?
6. Only then: is external/web research necessary?
```

MCP role:

> MCP is a projection of GaleCore's authoritative capability model, not an independently
> maintained tool catalog. GaleCore describes its executable capability surface to the
> Harness dynamically.

---

## 9. Ownership Summary

| Concern | Owner |
|---|---|
| Market / broker data | GaleCore |
| Deterministic analytics (GEX, IV, BS) | GaleCore |
| Scheduler / Trading Runtime | GaleCore |
| Hard risk enforcement | GaleCore |
| Orders / fills / positions | GaleCore |
| WorkSession / Task / Artifact | GaleCore |
| User preferences | GaleCore (structured state) |
| Operational evidence | GaleCore |
| Capability + Data Catalog | GaleCore |
| Frontend / visualization rendering | GaleCore |
| Harness infrastructure | GaleCore-AI |
| Skills / Protocols / Conventions | GaleCore-AI |
| Market interpretation / narratives | GaleCore-AI |
| Strategy design / hypothesis / edge thesis | GaleCore-AI |
| Experiment design / result interpretation | GaleCore-AI |
| Cognitive evidence (findings, open questions) | GaleCore-AI |
| StrategySpec | Shared: AI/human authors, GaleCore validates + executes |

---

## 10. Extensiones conceptuales futuras

El caso de uso E2E de desarrollo de estrategias validó conceptos que amplían la dirección del producto sin cambiar la Constitution v4, cerrar nuevos contratos ni modificar el roadmap vigente.

Documento de referencia:

```text
GaleCore-AI/docs/architecture/USE-CASE-STRATEGY-DEVELOPMENT-E2E.md
```

### StrategyProject y StrategyObjective

- `StrategyProject` representa el desarrollo completo de una estrategia a través del tiempo. Es estado durable de producto y pertenece a GaleCore.
- Agrupa referencias a WorkSessions, proposals, experiments, findings, specs, deployments, instances y evaluations sin absorber el ownership de esos objetos.
- No reemplaza a `StrategySpec`, `StrategyDeployment` ni `StrategyInstance`.
- `StrategyObjective` conserva el problema que el usuario quiere resolver: objetivos, constraints, benchmarks, métricas, horizonte y trade-offs.
- `StrategyObjective` es cognitivo y durable, pero no ejecutable. Su schema, lifecycle y persistencia exactos quedan diferidos.

```text
WorkSession != StrategyProject
StrategyObjective != StrategySpec
StrategyProject != StrategyInstance
```

### Factibilidad y valor económico

Una estrategia no se evalúa solamente por P&L, POP o win rate. El proceso futuro de desarrollo debe considerar:

- coherencia y factibilidad del objetivo;
- benchmarks razonables y costo de oportunidad;
- riesgo y drawdown;
- capital requerido y return on capital;
- tiempo durante el cual el capital queda comprometido;
- frecuencia de oportunidades;
- complejidad y costos operativos.

GaleCore-AI selecciona la metodología y determina qué benchmark resulta relevante. GaleCore obtiene los datos y calcula retornos, riesgo, capital utilizado y métricas comparables. Los benchmarks nunca se inventan mediante inferencia del modelo.

### Model management

El Harness evolucionará hacia una gestión explícita de modelos:

```text
Model Gateway
├── Model Registry
├── Routing Policy
└── Provider Adapters
```

Un futuro `ModelProfile` podrá describir proveedor, identidad/versión del modelo, capacidades, soporte de tools, costo, latencia, disponibilidad y política de datos. Las AgentDefinitions no deben hardcodear un proveedor o modelo concreto.

### Agent model

- `AgentDefinition` configura role, model policy, Skills, Protocols, Conventions, capabilities permitidas, output contracts, guardrails y context policy.
- `AgentRun` es una ejecución cognitiva concreta; la ejecución es transitoria, aunque su metadata y trace se conservan según política de retención.
- Un mismo Harness Runtime puede ejecutar múltiples AgentDefinitions.
- El MVP continúa usando una sola AgentDefinition: `TradingAgent`.
- Multi-agent orchestration permanece diferida hasta que existan responsabilidades distintas y comprobadas.

### Harness learning y evaluation

La dirección objetivo distingue:

```text
Evidence learning
  → acumulación continua de findings, resultados, hipótesis rechazadas y preguntas abiertas

Methodology learning
  → evidencia repetida
  → MethodologyChangeProposal
  → revisión
  → actualización versionada y reversible

Model/runtime learning
  → evaluación de modelos, prompts, Skills, Protocols y AgentDefinitions contra outcomes posteriores
```

El Harness no se automodifica silenciosamente. No cambia Skills, Protocols, routing ni StrategySpecs desplegadas sin una propuesta explícita, revisión y nueva versión.

Harness Evaluation relacionará:

```text
AgentRun
→ Cognitive Output
→ Later Outcome
→ EvaluationResult
```

Estos conceptos son dirección objetivo. Sus schemas, campos obligatorios, persistencia, lifecycle, métricas y contratos de UI se formalizarán en fases posteriores.

---

## 11. Roadmap

```
DONE
  [x] Architecture Constitution v4
  [x] Platform vs Cognition boundary
  [x] Harness model and component inventory
  [x] Use-case driven validation (7 cases)
  [x] SESSION_HANDOFF
  [x] P0-CONTRACTS drafted — READY FOR FINAL REVIEW

NOW
  --> Final review and explicit approval of P0-CONTRACTS.md

NEXT
  --> Phase 1: deterministic Trading Runtime in GaleCore
  --> PCS-SPY SHADOW vertical slice
  --> AI Removal Test: runs end-to-end without GaleCore-AI

THEN
  --> Minimal Harness MVP (ModelProvider, AgentDefinition, Context, Skills,
      Protocols, Capabilities, CognitiveRuntime, OutputContracts, Trace)
  --> Evidence / catalogs / protocol maturity

AFTER
  --> Work Runtime foundation
  --> Market Context Intelligence (narratives, scenarios)
  --> P-LIVE controls (before PAPER/LIVE)
  --> Legacy RPF/GEX migration (separate and reversible)
```

---

## 12. What NOT To Do Yet

```
DO NOT:
  - Implement Harness runtime
  - Create multi-agent orchestration
  - Migrate RPF or GEX
  - Replace legacy strategy JSON files
  - Enable PAPER or LIVE
  - Build advanced planner or reflection loops
  - Implement external web research
  - Duplicate GaleCore analytics in GaleCore-AI
  - Move operational state into GaleCore-AI
  - Resolve P-LIVE enterprise controls
  - Build full Work/Cowork UI
```

RPF and GEX are currently operational inside GaleCore. They must not be disrupted.
Migration happens only after GaleCore has a generic Trading Runtime capable of
replacing them.

Note: the term "Harness" exists in `GaleCore-ways-of-working.md` with a different
meaning (3-layer validation infrastructure). P0 resolves the collision by renaming
that legacy usage to "Quality Gates"; "Harness" remains reservado para el Cognitive
Harness de GaleCore-AI.

---

## 13. Current Gate and Next Deliverable

```
CURRENT GATE
  Review and approve:
  GaleCore-AI/docs/architecture/P0-CONTRACTS.md

AFTER APPROVAL
  Phase 1 — GaleCore deterministic Trading Runtime
  → PCS-SPY SHADOW
  → AI Removal Test
```

P0 ya convierte la arquitectura conceptual en fronteras ejecutables y versionadas. Todavía requiere aprobación explícita antes de iniciar implementación.

Phase 1 no incluye Harness, Work Runtime, Model Management, multi-agent ni PAPER/LIVE. Su objetivo es probar primero la máquina determinística y el AI Removal Test.

No se escribió código de producción como parte de P0.
