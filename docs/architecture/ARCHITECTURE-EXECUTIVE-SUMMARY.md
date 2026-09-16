# GaleCore + GaleCore-AI — Architecture Executive Summary

**Source of truth:** `GaleCore-AI-arquitectura-v5.md`

**Status:** Phase 3 alignment corrections authorized and implemented; interactive E2E remains open

**Contract detail:** `P0-CONTRACTS.md` remains authoritative where it does not conflict with v5.

---

## 1. Executive thesis

```text
GaleCore     = financial machine and operational truth
GaleCore-AI  = domain intelligence and deterministic assurance
Host         = environment that runs the model and coordinates the work
```

The host is a role, not a third repository. Claude Code and Codex are current interactive host options. ChatGPT Work is a future host option whose concrete integration must be validated. A proprietary application running `CognitiveRuntime` could become an autonomous host later.

> **GaleCore-AI recommends and validates cognitive outputs. GaleCore validates operationally, authorizes and executes.**

If all AI components disappear, GaleCore must continue protecting the portfolio, enforcing hard risk and running deterministic behavior safely.

---

## 2. Current system shape

```text
                         USER
                           ↓
                         HOST
          Claude Code / Codex / ChatGPT Work
           model + conversation + agent loop
                    /                 \
                   ↓                   ↓
            GaleCore-AI              GaleCore
       intelligence + assurance   facts + compute + state
```

Current repository model:

```text
GaleCore/
  APIs, providers, financial calculations, state, risk and execution

GaleCore-AI/
  cognitive assets, contracts, assurance, evals and optional adapters
```

Changing the host must not require rewriting the core financial knowledge or deterministic assurance.

---

## 3. Ownership

### GaleCore

- authoritative market and broker data;
- deterministic analytics such as GEX and IV Rank;
- capability schemas and versions;
- portfolio and operational state;
- persistence;
- StrategySpec/StrategyInstance operational ownership;
- Trading Runtime;
- hard risk;
- authorization, execution and reconciliation;
- SHADOW, PAPER and LIVE controls;
- operational evidence.

### GaleCore-AI

- AgentDefinitions;
- Skills, Workflows, Protocols and Conventions;
- financial knowledge and methodology;
- cognitive input/output contracts;
- consumption-contract validation;
- observable freshness checks;
- grounding, EvidenceRef and cognitive guardrails;
- trace schemas;
- evals and golden cases;
- GaleCore integrations and host adapters;
- optional autonomous runtime.

### Host

- model execution;
- conversation/session context;
- agent loop;
- selection and invocation of tools;
- loading compatible cognitive assets;
- generation of the interpretation;
- coordination of validation and presentation.

Ownership does not prove implementation maturity. Every status claim must independently use `CURRENT_IMPLEMENTED`, `CURRENT_VALIDATED`, `TARGET_APPROVED`, `PROPOSED` or `DEFERRED`.

---

## 4. GaleCore-AI composition

```text
GaleCore-AI
├── Cognitive Assets
│   ├── AgentDefinitions
│   ├── Skills
│   ├── Workflows
│   ├── Protocols
│   ├── Conventions
│   └── Knowledge / Examples
├── Assurance
│   ├── Contracts
│   ├── Validation
│   ├── Grounding
│   ├── Guardrails
│   ├── Trace schemas
│   └── Evals
├── Integrations / Host Adapters
└── Autonomous Runtime — optional and currently frozen
```

This is a conceptual classification. It does not authorize moving the current folders.

Markdown/YAML describe how the agent should work. Deterministic code enforces what cannot safely depend on model compliance. Financial calculations remain in GaleCore.

---

## 5. Harness terminology

Always qualify `Harness`:

- **Host Harness:** generic model loop, context, tools and session supplied by Claude Code, Codex, Work or an autonomous application.
- **GaleCore-AI Domain Harness:** domain assets, contracts, assurance and adapters that specialize a host for financial work.

`CognitiveRuntime` is an optional autonomous host/runtime implementation. It is not the mandatory GaleCore-AI core.

---

## 6. Capability and transport model

GaleCore owns the authoritative capability implementation and contract:

```text
GaleCore capability
├── REST projection
└── MCP projection
```

MCP is a transport/tool surface. It does not replace Skills, methodology, contracts, grounding, guardrails or trace.

Capability classes remain:

```text
PURE_QUERY
COMPUTE
STATE_MUTATION
EXTERNAL_ACTION
```

Phase 3 permits only `PURE_QUERY` and `COMPUTE`.

---

## 7. Trust and evidence

```text
GALECORE_VERIFIED
VALIDATOR_OBSERVED
HOST_DECLARED
UNKNOWN
```

GaleCore is authority over origin, timestamps and operational quality of facts. GaleCore-AI can validate schema, finiteness, internal consistency, symbol, observable age and grounding.

A payload supplied by a host is `HOST_DECLARED` unless independently verified against GaleCore. A valid timestamp does not prove authentic origin.

`Trace != Evidence`: trace records execution; evidence is selected durable support. Producing a trace object does not imply durable persistence.

---

## 8. Product missions

### Analysis

Interpret authoritative facts, distinguish facts from inference, cite evidence and state limitations.

### Strategy Development — future

Turn objectives into hypotheses, experiments, comparisons and StrategyProposals. GaleCore executes deterministic studies; GaleCore-AI supplies methodology and interpretation.

### Trading Assistance — future

Explain deterministic evaluations, compare allowed alternatives and produce controlled proposals. Approval, hard risk, authorization and execution remain in GaleCore.

---

## 9. Current Phase 3

Phase 3 is **Interactive Minimal Domain Harness, read-only**.

The only vertical is:

```text
“Analizá el GEX actual de SPY.”
```

Required path:

```text
real interactive host
→ versioned TradingAgent/GEX assets
→ real GaleCore compute.gex_analysis
→ hosted-model structured interpretation
→ deterministic contract + grounding + guardrails
→ trace
→ SUCCESS
```

Required negative path:

```text
invalid/stale/missing facts → INSUFFICIENT_DATA
invalid/invented output → VALIDATION_ERROR + null result
```

Unit tests, fixtures and `FakeProvider` are useful evidence but do not close Phase 3.

Out of scope:

- Strategy Development;
- ActionProposal;
- StrategySpec creation/deployment;
- SHADOW/PAPER/LIVE;
- side effects;
- multi-agent;
- autonomous memory;
- scheduling;
- new providers;
- expansion of FastAPI or the autonomous runtime.

---

## 10. Current maturity

### `CURRENT_IMPLEMENTED`

- canonical TradingAgent/GEX YAML assets consumed by Python compatibility factories;
- typed contracts and GaleCore DTO mapping;
- pre/post-generation freshness, strict evidence paths and per-reference numeric checks;
- transport-neutral `application.validate_interpretation` reused by the optional runtime;
- effective definition hashes in runtime traces;
- cognitive guardrails and TraceRecord;
- tests and golden evals;
- an autonomous FastAPI/ModelProvider/CognitiveRuntime path.

### `CURRENT_VALIDATED` — historical evidence to recheck before citing

- GaleCore has returned real GEX-SPY data locally;
- DTO mapping and fail-closed behavior have been exercised;
- the last reported suite contained 221 passing tests and clean ruff output.

### Not yet validated

- automatic asset consumption by the selected interactive host;
- full interactive validation flow with the same identified snapshot and provenance;
- final interactive-host `SUCCESS` path;
- concrete ChatGPT Work integration;
- durable trace persistence.

### `DEFERRED`

- autonomous runtime expansion;
- multi-agent and complex planning;
- autonomous memory/learning;
- broader host compatibility;
- PAPER/LIVE enablement.

---

## 11. Implementation rule

> **Before expanding infrastructure, validate the real execution model and the thin path of the use case.**

```text
LOCAL FIRST → VALIDATE → REVIEW → EXPAND
```

Classify each new concept before selecting repository, format, language or transport:

```text
KNOWLEDGE | SPECIFICATION | COMPUTATION | POLICY | CONSTRAINT
STATE | ACTION | EVIDENCE | PREFERENCE | CONVENTION
PROTOCOL | INTERPRETATION
```

---

## 12. Current implementation sequence

The user authorized documentation corrections and implementation of the Phase 3 alignment on 2026-09-15. This supersedes the earlier read-only stop condition for that scope.

```text
IMPLEMENTED
  → canonical assets used by the existing factories
  → standalone post-model acceptance function
  → stronger grounding and freshness checks with adversarial tests

NEXT
  → controlled fact acquisition and an identified snapshot
  → one host-native entry point and one thin adapter
  → positive and fail-closed interactive GEX-SPY E2E
  → small evaluation of actual model outputs

ONLY AFTER PHASE 3
  → expand read-only Skills/workflows
  → begin Strategy Development
```

No new providers, scheduling, model routing or operational actions were introduced. See `PHASE3-ALIGNMENT.md` for evidence and limits. SUCCESS applies only to the accepted payload; it does not certify arbitrary host paraphrases or the correctness of every narrative inference.
