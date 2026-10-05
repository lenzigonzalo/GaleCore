# P0-CONTRACTS — Fronteras contractuales ejecutables

> **Referencia técnica (desde el 05/10/2026, F0-1).** Vale por sus contratos y límites. El objetivo, el plan y el
> estado vigentes están en `roadmap/README.md` del workspace; donde este texto hable de fases, estado u objetivo,
> manda el roadmap. Los documentos de estado que cita (`PHASE3/4-ALIGNMENT.md`, `SESSION_HANDOFF.md`,
> `ARCHITECTURE-EXECUTIVE-SUMMARY.md`) están en `docs/archive/` y no se siguen.

**Fuente de verdad contractual:** este documento, bajo la arquitectura v5 (`GaleCore-AI-arquitectura-v5.md`).
**Origen histórico:** Architecture Constitution v4.
**Prerrequisitos:** `GaleCore-AI-arquitectura-v5.md`, `SESSION_HANDOFF.md`, `ARCHITECTURE-EXECUTIVE-SUMMARY.md`.
**Estado:** contratos P0 preservados; revisión de alineación con v5 pendiente.
**Alcance:** Documento de diseño contractual. Sin código de producción, sin migraciones, sin cambios en estrategias.
**Propósito:** Preservar las fronteras contractuales ejecutables y versionadas derivadas de v4.

**Precedencia v5:** v5 reemplaza las definiciones de Host, Harness y Cognitive Runtime. El resto de P0 permanece vigente donde no exista contradicción. Ownership no prueba implementación ni validación; toda afirmación de estado debe usar maturity explícita.

---

## 0. Resumen de decisiones P0

### Decisiones cerradas en P0

| # | Decisión | Racional |
|---|---|---|
| P0-D1 | Término legacy "Harness" renombrado a **Quality Gates** | Evita colisiones. Bajo v5, `Harness` debe calificarse como **Host Harness** o **GaleCore-AI Domain Harness** |
| P0-D2 | Versionado de StrategySpec: **SemVer + content hash** | SemVer para comunicación humana; SHA-256 para inmutabilidad. Ambos obligatorios |
| P0-D3 | Transporte de Cognitive API: **REST only** | Tareas async vía job endpoint (POST inicia, GET consulta). Sin gRPC/SSE/WS |
| P0-D4 | Migración de RPF JSON: **después del Trading Runtime** | RPF permanece tal cual. StrategySpec v1 se usa primero para el NUEVO vertical slice PCS-SPY |
| P0-D5 | Alcance del Data Catalog: **solo lo existente** | Catalogar lo que GaleCore puede servir hoy. Agregar items cuando se construyan |
| P0-D6 | JSON Schema de StrategySpec es fuente canónica | No los modelos .NET ni Python. Derivado de v4 D22, Q6 |
| P0-D7 | Las MCP tools derivan del capability model | No al revés. Derivado de v4 D35, D36 |
| P0-D8 | Clases semánticas de capabilities: PURE_QUERY / COMPUTE / STATE_MUTATION / EXTERNAL_ACTION | Derivado de v4 §8 |
| P0-D9 | Tres dimensiones de versionado: schema / calculation / methodology | Derivado de v4 §8. Compatibilidad de schema ≠ compatibilidad semántica |
| P0-D10 | Capas de evidencia: raw → derived → cognitive, con ownership según v4 | Derivado de v4 §11 |

### Decisiones v4 preservadas (D1-D48)

Las 48 decisiones cerradas de v4 §23 se preservan sin modificación. Ninguna se reabre.

### Disposición de preguntas abiertas de v4

| # | Pregunta | Disposición P0 |
|---|---|---|
| Q1 | Ubicación del repo GaleCore-AI | DIFERIDA — antes de la creación del repo |
| Q2 | Rutas de parquet/datasets | DIFERIDA — antes del backtester |
| Q3 | Mecánica de cotización de legs de opciones | DIFERIDA — Phase 1 |
| Q4 | Representación frontend de output cognitivo | DIFERIDA — Phase 5 |
| Q5 | Schema/credenciales Postgres de GaleCore-AI | DIFERIDA — Phase 4 |
| Q6 | Contrato exacto de StrategySpec | **CERRADA por §5 de este documento** |
| Q7 | Mecanismo de evaluación de filtros del Trading Runtime | DIFERIDA — implementación Phase 1 |
| Q8 | Contrato de Cognitive API GaleCore ↔ GaleCore-AI | **CERRADA por §6 de este documento** |
| Q9 | Formato/versionado de Domain Conventions | DIFERIDA — Phase 3 |
| Q10 | Schema de metadata del Data Catalog mínimo | **CERRADA por §11 de este documento** |
| Q11 | Representación de Cognitive Protocols | DIFERIDA — Phase 3-4 |
| Q12 | Criterios para promover checks cognitivos a gates determinísticos | DIFERIDA — Phase 4 |
| Q13 | Política de búsqueda externa | DIFERIDA — antes de integraciones web/noticias |
| Q14 | Lifecycle de MarketNarrative | DIFERIDA — Phase 6 |

---

## 1. Migración de estado actual / terminología

### 1.1 Colisión del término "Harness" — RESUELTA

| Contexto | Término anterior | Término nuevo |
|---|---|---|
| `GaleCore-ways-of-working.md` | Harness (validación de 3 capas: research/backtest + tests de backend + ritual humano) | **Quality Gates** |
| Architecture Constitution v4 | Harness (infraestructura cognitiva reusable dentro de GaleCore-AI) | **GaleCore-AI Domain Harness** (assets, assurance y adapters) |

A partir de este documento, "Harness" sin calificador siempre significa la infraestructura
cognitiva de v4. El sistema legacy de validación de 3 capas se denomina "Quality Gates".

### 1.2 Artefactos actuales → arquitectura objetivo

| Artefacto actual | Ubicación actual | Concepto objetivo | Momento de migración |
|---|---|---|---|
| `galecore_rules_rpf.json` | `Files/Rpf/` | Config legacy de estrategia; mapping a StrategySpec v1 documentado en §5 | Después del Trading Runtime (P0-D4) |
| `galecore_rules_gex.json` | `Files/Gex/` | Config de analytics. GEX es `kind: informativa` — NO es un StrategySpec | Sin migración; GEX no es una estrategia |
| `galecore_rules_core.json` | `Files/` | Config de plataforma. Permanece tal cual | Sin migración |
| Endpoints específicos (`/App/Rpf/*`, `/App/Gex/*`) | `AppController.cs` | Coexisten con proyecciones genéricas de capabilities | Después de implementar el capability model |
| MCP tools (10) | `McpTools.cs` | Proyecciones del capability model (§7) | Después de que exista el capability model |
| `.claude/commands` | Repo GaleCore | Inventariados; NO migrados automáticamente a Skills de v4 | Curación manual en Phase 3 |
| `docs/rpf/` | Repo GaleCore | Reglas operacionales permanecen en GaleCore; metodología/conocimiento → GaleCore-AI | Phase 7 |
| `docs/gex/` | Repo GaleCore | Cálculo determinístico permanece; conocimiento interpretativo → GaleCore-AI | Phase 7 |
| Quality Gates (ex-"Harness") | `GaleCore-ways-of-working.md` | Continúa como disciplina de testing/workflow. Distinto del Harness de v4 | Renombrar en doc cuando sea conveniente |

### 1.3 Reglas de coexistencia

Durante el período de transición:

1. Los JSON actuales de RPF/GEX siguen siendo fuente de verdad para sus estrategias activas.
2. StrategySpec v1 se usa primero para el NUEVO vertical slice PCS-SPY SHADOW, no para reemplazar RPF.
3. Ambos sistemas coexisten. No se necesita capa de adaptación hasta que RPF migre (Phase 7).
4. Las MCP tools siguen funcionando tal cual. El capability model se construye en paralelo, no en reemplazo.
5. Ningún endpoint específico de estrategia se elimina hasta que su reemplazo genérico esté validado.

---

## 2. Ownership de contratos

### 2.1 Jerarquía de fuentes de verdad

```text
Architecture Constitution v4
    ↓
P0 Contracts (este documento)
    ↓
AGENTS.md / reglas del repositorio
    ↓
Documentación de implementación y dominio
    ↓
CLAUDE.md legacy (solo donde no contradiga los niveles superiores)
```

Cuando existe un conflicto entre niveles, gana el nivel superior. Las contradicciones deben
resolverse actualizando el documento de menor nivel, no sobreescribiéndolo silenciosamente.

### 2.2 Ownership por tipo de contrato

| Contrato | Autor | Validador | Ejecutor | Store | Fuente de verdad |
|---|---|---|---|---|---|
| StrategySpec | AI o Humano | GaleCore | GaleCore Trading Runtime | GaleCore | JSON Schema (§5) |
| StrategyProposal | GaleCore-AI | Revisión humana | N/A (artefacto cognitivo) | GaleCore-AI | Evidencia cognitiva |
| TradeRecommendation | GaleCore-AI | GaleCore hard risk | GaleCore (si aprobado) | GaleCore (operacional) | Estado de ActionProposal |
| Definición de capability | GaleCore | GaleCore | GaleCore | GaleCore | Capability model (§7) |
| Evidencia (operacional) | GaleCore | GaleCore | N/A | GaleCore | Postgres |
| Evidencia (cognitiva) | GaleCore-AI | GaleCore-AI | N/A | GaleCore-AI | Persistencia cognitiva |
| Datos de mercado | Providers vía GaleCore | GaleCore | N/A | GaleCore | Provider + cache |
| Preferencias de usuario | Humano | GaleCore | GaleCore | GaleCore | Estado estructurado |
| Domain conventions | GaleCore-AI | GaleCore-AI | Harness | GaleCore-AI | Archivos de convención |
| Skills / Protocols | GaleCore-AI | GaleCore-AI | Harness | GaleCore-AI | Archivos de Skill/Protocol |

### 2.3 Author / Execute / Store (v4 §3.3)

Para cada objeto que cruza fronteras, estas tres preguntas deben poder responderse:

```text
¿Quién lo AUTORA?                → puede ser AI, Humano o System
¿Quién lo EJECUTA / VALIDA?      → siempre el dueño del dominio operacional
¿Quién ALMACENA el estado
 autoritativo?                    → sigue los ownership tests (AI Removal, Execution vs Cognition,
                                    Operational Truth, Cognitive Artifact)
```

---

## 3. Familia de envelopes v1

### 3.1 BaseEnvelope

Todos los mensajes que cruzan fronteras comparten estos campos:

```json
{
  "contract_version": "1.0",
  "message_id": "<uuid>",
  "correlation_id": "<uuid>",
  "causation_id": "<uuid | null>",
  "trace_id": "<uuid>",
  "actor": {
    "actor_type": "HUMAN | AGENT | SYSTEM",
    "user_id": "<uuid | null>",
    "tenant_id": "<string | null>",
    "agent_definition_version": "<string | null>"
  },
  "temporal_context": {
    "requested_at": "<ISO 8601 UTC>",
    "market_data_as_of": "<ISO 8601 UTC | null>"
  }
}
```

### 3.2 Especializaciones de envelope

| Envelope | Agrega al BaseEnvelope | Caso de uso |
|---|---|---|
| **CommandEnvelope** | `idempotency_key` (REQUIRED), `expires_at` (REQUIRED), `payload_type`, `payload` | Operaciones con side effects, action proposals |
| **QueryEnvelope** | `payload_type`, `payload` | Lecturas puras. Sin idempotency, sin expiración |
| **CognitiveEnvelope** | `evidence_refs[]`, `capability_versions{}`, `model_metadata{}`, `idempotency_key` (OPTIONAL), `expires_at` (OPTIONAL), `payload_type`, `payload` | Frontera GaleCore ↔ GaleCore-AI |
| **EventEnvelope** | `event_type`, `source`, `occurred_at`, `payload` | Notificaciones, cambios de estado, triggers |

### 3.3 Semántica de campos

| Campo | Formato | Obligatoriedad | Semántica de ausencia |
|---|---|---|---|
| `contract_version` | String SemVer | TODOS | Rechazar mensaje |
| `message_id` | UUIDv7 | TODOS | Rechazar mensaje |
| `correlation_id` | UUIDv7 | TODOS | Usar message_id como fallback |
| `causation_id` | UUIDv7 | OPCIONAL | null = causa raíz (sin padre) |
| `trace_id` | UUIDv7 | TODOS | Generar nuevo si ausente |
| `actor.actor_type` | Enum | TODOS | Rechazar mensaje |
| `actor.user_id` | UUID | HUMAN, AGENT | null solo para actor SYSTEM |
| `actor.tenant_id` | String | REQUERIDO en P-LIVE | null en P0-MINIMUM (tenant único) |
| `actor.agent_definition_version` | String | Solo AGENT | null para HUMAN/SYSTEM |
| `temporal_context.requested_at` | ISO 8601 UTC | TODOS | Rechazar mensaje |
| `temporal_context.market_data_as_of` | ISO 8601 UTC | Cuando se referencian datos de mercado | null = sin claim de datos de mercado |
| `idempotency_key` | String (opaco) | Commands, EXTERNAL_ACTION | Ver §7 por clase de capability |
| `expires_at` | ISO 8601 UTC | Commands | null = sin expiración (solo queries) |
| `evidence_refs` | Array de EvidenceRef | Cognitive | [] = sin evidencia previa |
| `capability_versions` | Map<string,string> | Cognitive | {} = versiones no rastreadas |

### 3.4 Reglas de propagación

```text
correlation_id  → se propaga sin cambios a lo largo de toda la cadena de requests
causation_id    → cada mensaje nuevo establece causation_id = message_id del padre
trace_id        → se propaga sin cambios a lo largo de toda la cadena de requests
actor           → se propaga; nunca se eleva (SYSTEM no puede convertirse en HUMAN)
idempotency_key → NO se propaga a mensajes hijos; cada mensaje genera la suya si la necesita
```

### 3.5 Validación

La validación del envelope es fail-fast: un mensaje sin campos obligatorios se rechaza antes de
inspeccionar el payload. La respuesta de error incluye qué campos faltan.

### 3.6 Ejemplos

**BaseEnvelope válido:**

```json
{
  "contract_version": "1.0",
  "message_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60001",
  "correlation_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60001",
  "causation_id": null,
  "trace_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60002",
  "actor": {
    "actor_type": "HUMAN",
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "tenant_id": null,
    "agent_definition_version": null
  },
  "temporal_context": {
    "requested_at": "2026-09-12T14:30:00Z",
    "market_data_as_of": null
  }
}
```

**BaseEnvelope inválido — falta `message_id`:**

```json
{
  "contract_version": "1.0",
  "correlation_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60001",
  "trace_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60002",
  "actor": { "actor_type": "HUMAN", "user_id": "a1b2c3d4-..." },
  "temporal_context": { "requested_at": "2026-09-12T14:30:00Z" }
}
```

> Motivo de rechazo: `message_id` es obligatorio en todos los envelopes. Sin él, el mensaje
> no puede identificarse ni trazarse.

**CommandEnvelope válido:**

```json
{
  "contract_version": "1.0",
  "message_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60010",
  "correlation_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60010",
  "causation_id": null,
  "trace_id": "019212f4-7b3a-7d00-a1b2-c3d4e5f60011",
  "actor": { "actor_type": "HUMAN", "user_id": "a1b2c3d4-...", "tenant_id": null, "agent_definition_version": null },
  "temporal_context": { "requested_at": "2026-09-12T14:31:00Z", "market_data_as_of": null },
  "idempotency_key": "019212f4-8c4b-7d00-b2c3-d4e5f6700020",
  "expires_at": "2026-09-12T14:36:00Z",
  "payload_type": "DeployStrategy",
  "payload": { "strategy_version_hash": "sha256:abc123..." }
}
```

**CommandEnvelope inválido — falta `idempotency_key`:**

```json
{
  "contract_version": "1.0",
  "message_id": "...",
  "actor": { "actor_type": "AGENT", "user_id": "...", "agent_definition_version": "trading_agent:1.0" },
  "temporal_context": { "requested_at": "2026-09-12T14:31:00Z" },
  "expires_at": "2026-09-12T14:36:00Z",
  "payload_type": "DeployStrategy",
  "payload": { "strategy_version_hash": "sha256:abc123..." }
}
```

> Motivo de rechazo: `idempotency_key` es obligatoria en CommandEnvelope. Sin ella, un retry
> podría ejecutar la misma mutación dos veces.

---

## 4. Semántica de versionado compartida

### 4.1 Tres dimensiones

| Dimensión | Qué cambia | Ejemplo |
|---|---|---|
| `schema_version` | Forma del contrato (campos, tipos, estructura) | Agregar un campo a StrategySpec |
| `calculation_version` | Implementación matemática/algoritmo determinístico | Corregir la fórmula de GEX (factor ×0.01) |
| `methodology_version` | Significado semántico o definición metodológica | Cambiar qué significa "gamma_flip" |

**Regla:** Compatibilidad de schema NO implica compatibilidad semántica. Un payload puede conservar
su forma y cambiar el significado de un campo. Ese cambio debe quedar versionado y trazable.

### 4.2 Formato de versión

```text
schema_version:       SemVer (MAJOR.MINOR.PATCH)
calculation_version:  SemVer (MAJOR.MINOR.PATCH)
methodology_version:  SemVer (MAJOR.MINOR.PATCH)
```

Cambios que rompen compatibilidad incrementan MAJOR. Cambios aditivos incrementan MINOR.
Correcciones incrementan PATCH.

### 4.3 Reglas de compatibilidad

| Tipo de cambio | schema | calculation | methodology |
|---|---|---|---|
| Nuevo campo opcional | MINOR bump | — | — |
| Eliminar campo | MAJOR bump | — | — |
| Cambiar tipo de campo | MAJOR bump | — | — |
| Corregir bug matemático | — | PATCH bump | — |
| Nueva variante de algoritmo | — | MINOR bump | — |
| Algoritmo diferente | — | MAJOR bump | — |
| Refinar definición | — | — | MINOR bump |
| Redefinir concepto | — | — | MAJOR bump |

### 4.4 Hashing content-addressable (StrategySpec)

Una versión desplegada de StrategySpec tiene:

```text
version:                  "1.2.0"           (SemVer legible por humanos)
content_hash:             "sha256:<hex>"    (SHA-256 canónico del JSON normalizado)
canonicalization_version: "jcs-1"           (versión del algoritmo de canonicalización)
```

Los tres son obligatorios. Una `StrategyInstance` referencia el `content_hash`, no el string
de versión. Esto garantiza que una instancia desplegada sea inmutable — cualquier cambio al
spec produce un nuevo hash.

**Canonicalización:** Se usa RFC 8785 (JSON Canonicalization Scheme / JCS) como estándar de
referencia para la canonicalización. El campo `canonicalization_version` identifica qué algoritmo
se usó para obtener los bytes que se hashean. Si en el futuro se adoptara un estándar diferente
o una versión revisada, el campo permite distinguir hashes producidos con distintos métodos.

```text
version               → identificación humana de la versión
content_hash          → identidad exacta del contenido
canonicalization_version → cómo se obtienen los bytes a hashear
```

Dos specs con contenido idéntico producen hashes idénticos independientemente del formateo.

---

## 5. StrategySpec v1

### 5.1 Fuente de verdad

```text
StrategySpec JSON Schema (language-neutral)
    ├── Validador .NET (GaleCore)
    └── Validador Python (GaleCore-AI)
```

El JSON Schema es la fuente canónica. Los validadores específicos por lenguaje son derivados,
no autoritativos.

Esto cierra v4 Q6.

### 5.2 Estructura de StrategySpec

`StrategySpec` describe **qué es la estrategia**: sus reglas, restricciones y parámetros.
No contiene estado operativo, estado de deployment ni resultado de readiness.

```json
{
  "strategy_spec_version": "1.0.0",
  "content_hash": "sha256:...",
  "canonicalization_version": "jcs-1",

  "identity": {
    "id": "<uuid>",
    "name": "<string>",
    "display_name": "<string>",
    "version": "<semver>",
    "author": {
      "type": "HUMAN | AI | COLLABORATIVE",
      "agent_definition_version": "<string | null>"
    },
    "created_at": "<ISO 8601 UTC>",
    "parent_version_hash": "<sha256 | null>"
  },

  "deployment_constraints": {
    "eligible_modes": ["SHADOW", "PAPER", "LIVE"],
    "requires_human_approval_for": ["LIVE"]
  },

  "universe": {
    "mode": "WHITELIST | BLACKLIST | DYNAMIC",
    "symbols": ["SPY"],
    "excluded": {},
    "instrument_types": ["EQUITY_OPTION"]
  },

  "structure": {
    "allowed_strategies": ["put_credit_spread"],
    "forbidden_strategies": ["naked_short", "ratio_spread", "long_directional"],
    "default_structure": "put_credit_spread",
    "selection_method": "FIXED | RULE_BASED | AI_RECOMMENDED"
  },

  "entry_filters": {
    "gate_layer": {
      "pass_rule": "ALL",
      "on_fail": "NO_TRADE",
      "gates": [
        {
          "id": "vix_absolute",
          "label": "VIX < 30",
          "metric_ref": "capability:market_data.quote.VIX.price",
          "operator": "LT",
          "threshold": { "value": 30 },
          "on_fail": "NO_TRADE",
          "on_no_data": "BLOCK"
        }
      ]
    },
    "signal_layer": {
      "pass_rule": "ALL",
      "gates": []
    }
  },

  "candidate_construction": {
    "legs": [],
    "sizing": {},
    "constraints": {}
  },

  "exits": {
    "deterministic": {
      "take_profit": {},
      "stop_loss": {},
      "time_exit": {},
      "defensive_roll": {}
    }
  },

  "risk_limits": {
    "max_concurrent_positions": null,
    "max_portfolio_heat_pct": null,
    "max_risk_per_trade_pct": null,
    "max_loss_per_trade_usd": null
  },

  "operational": {
    "timezone": "America/New_York",
    "session_hours": { "start": "09:30", "end": "16:00" },
    "calendar": "NYSE",
    "decimal_precision": 2,
    "currency": "USD",
    "rounding": "HALF_UP",
    "symbology": "OCC_21_CHAR",
    "null_semantics": "null = el campo tiene un valor y ese valor es null; ausente = el campo no aplica a este spec"
  },

  "data_quality": {
    "max_quote_age_seconds": 15,
    "block_on_crossed_market": true,
    "block_on_missing_critical_data": true
  },

  "analytics_refs": {
    "vrp": { "capability_ref": "compute:vrp", "version": "1.0.0" },
    "gex": { "capability_ref": "compute:gamma_exposure", "version": "1.0.0" }
  },

  "metadata": {
    "schema_version": "1.0.0",
    "methodology_version": "1.0.0",
    "reference_docs": [],
    "notes": ""
  }
}
```

### 5.3 Objetos de lifecycle (v4 §14)

```text
StrategySpec       = contrato inmutable que describe la estrategia
StrategyDeployment = acto/configuración de desplegar una versión a un modo
StrategyInstance   = estado operativo en ejecución que referencia un content_hash
```

Detalle:

```text
StrategyProposal    → artefacto cognitivo (hipótesis, edge thesis, evidencia, riesgos)
                      Owner: GaleCore-AI

StrategySpec        → contrato ejecutable estable y versionado (esta sección)
                      Inmutable una vez publicado. AI o humanos lo autoran; GaleCore valida y ejecuta.

StrategyVersion     → un content_hash específico de un StrategySpec
                      Identidad criptográfica de una versión exacta.

StrategyDeployment  → acto de desplegar un StrategyVersion a un modo (SHADOW/PAPER/LIVE)
                      Owner: GaleCore. Contiene: version_hash, mode, deployed_at, deployed_by,
                      readiness_result, approval_ref (si aplica).

StrategyInstance    → estado operativo de runtime que referencia un StrategyVersion content_hash
                      Owner: GaleCore. Contiene: estado de ejecución, posiciones, scheduler state,
                      eventos de lifecycle.
```

### 5.4 Mapping desde el RPF JSON actual

| Sección del RPF JSON actual | Campo de StrategySpec v1 | Notas |
|---|---|---|
| `_meta.version` | `identity.version` | |
| `_meta.status` | NO en StrategySpec | Estado de lifecycle vive en StrategyDeployment |
| `_meta.strategy` | `identity.id` / `identity.name` | |
| `strategy_scope.allowed_strategies` | `structure.allowed_strategies` | |
| `strategy_scope.forbidden_strategies` | `structure.forbidden_strategies` | |
| `universe.tickers` | `universe.symbols` | |
| `macro_regime.checks[]` | `entry_filters.gate_layer.gates[]` | Operadores/umbrales normalizados |
| `signal_gates.gates{}` | `entry_filters.signal_layer.gates[]` | |
| `position_builder` | `candidate_construction` | |
| `orchestration` | `exits` + timing operativo | Descompuesto |
| `definitions.*` | `analytics_refs` (por referencia, no inline) | Cambio clave: las definiciones pasan a ser referencias a capabilities |
| `data_quality` | `data_quality` | Mapping directo |
| `principles` | NO en spec (governance, no ejecución) | Vive en la documentación de la estrategia |

### 5.5 Reglas de validación

1. La validación de JSON Schema es el primer gate — una estructura inválida se rechaza antes de checks semánticos.
2. `content_hash` lo calcula el validador, no lo provee el autor.
3. `structure.allowed_strategies` y `structure.forbidden_strategies` no deben superponerse.
4. Todos los valores de `metric_ref` en los gates deben resolver a capabilities conocidas.
5. `null` significa "el campo tiene un valor y ese valor es null". Campo ausente significa "no aplica a este spec".
6. Un StrategyVersion desplegado es inmutable. Cualquier cambio requiere una nueva versión con un nuevo hash.

### 5.6 Ejemplos

**StrategySpec válido (mínimo):**

```json
{
  "strategy_spec_version": "1.0.0",
  "content_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb924...",
  "canonicalization_version": "jcs-1",
  "identity": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "pcs_spy_shadow_v1",
    "display_name": "PCS SPY SHADOW",
    "version": "1.0.0",
    "author": { "type": "HUMAN", "agent_definition_version": null },
    "created_at": "2026-09-12T15:00:00Z",
    "parent_version_hash": null
  },
  "deployment_constraints": {
    "eligible_modes": ["SHADOW"],
    "requires_human_approval_for": ["LIVE"]
  },
  "universe": { "mode": "WHITELIST", "symbols": ["SPY"], "excluded": {}, "instrument_types": ["EQUITY_OPTION"] },
  "structure": {
    "allowed_strategies": ["put_credit_spread"],
    "forbidden_strategies": ["naked_short"],
    "default_structure": "put_credit_spread",
    "selection_method": "FIXED"
  },
  "entry_filters": { "gate_layer": { "pass_rule": "ALL", "on_fail": "NO_TRADE", "gates": [] }, "signal_layer": { "pass_rule": "ALL", "gates": [] } },
  "candidate_construction": { "legs": [], "sizing": {}, "constraints": {} },
  "exits": { "deterministic": {} },
  "risk_limits": {},
  "operational": { "timezone": "America/New_York", "session_hours": { "start": "09:30", "end": "16:00" }, "calendar": "NYSE", "decimal_precision": 2, "currency": "USD", "rounding": "HALF_UP", "symbology": "OCC_21_CHAR" },
  "data_quality": { "max_quote_age_seconds": 15, "block_on_crossed_market": true, "block_on_missing_critical_data": true },
  "analytics_refs": {},
  "metadata": { "schema_version": "1.0.0", "methodology_version": "1.0.0" }
}
```

**StrategySpec inválido — superposición entre allowed y forbidden:**

```json
{
  "structure": {
    "allowed_strategies": ["put_credit_spread", "iron_condor"],
    "forbidden_strategies": ["iron_condor"],
    "default_structure": "put_credit_spread",
    "selection_method": "FIXED"
  }
}
```

> Motivo de rechazo: `iron_condor` aparece tanto en `allowed_strategies` como en
> `forbidden_strategies`. Las listas no deben superponerse.

---

## 6. Cognitive API v1

### 6.1 Frontera

**Scope: autonomous service mode, DEFERRED.** REST-only (P0-D3), jobs, routing y límites de esta sección se conservan para el servicio autónomo opcional. No obligan al vertical interactivo de Phase 3 a ejecutar un modelo propio ni a usar HTTP. Su interfaz interna de assurance es independiente del transporte; CLI, MCP o HTTP son adapters separados.

```text
GaleCore (caller) ───REST──→ GaleCore-AI (servicio cognitivo)
GaleCore-AI       ───REST──→ GaleCore (acceso a capabilities)
```

El browser nunca llama a GaleCore-AI directamente. GaleCore media auth y estado. (v4 D23)

Esto cierra v4 Q8.

### 6.2 Tipos de request

| Tipo | Dirección | Sync/Async | Descripción |
|---|---|---|---|
| `CognitiveRequest` | GaleCore → AI | Async (job) | Solicitud de trabajo cognitivo genérica |
| `IntentResolution` | GaleCore → AI | Sync | Resolver intent de lenguaje natural |
| `StrategyAnalysis` | GaleCore → AI | Async (job) | Analizar estrategia/oportunidad |
| `TradeAssessment` | GaleCore → AI | Async (job) | Evaluar oportunidad de trade |
| `ResearchTask` | GaleCore → AI | Async (job) | Ejecutar investigación |
| `Interpretation` | GaleCore → AI | Sync o Async | Interpretar datos/resultados |

### 6.3 Tipos de response

| Tipo | Descripción |
|---|---|
| `CognitiveResponse` | Wrapper de respuesta genérica |
| `ResolvedIntent` | Intent de usuario parseado con parámetros |
| `StrategyProposal` | Hipótesis, edge thesis, reglas candidatas, evidencia, riesgos |
| `ExperimentProposal` | Experimento propuesto con metodología y requerimientos de datos |
| `TradeRecommendation` | Trade recomendado con rationale, o NO_TRADE con explicación |
| `VisualizationIntent` | Solicitud de visualización semántica (qué mostrar, no píxeles) |
| `ActionProposal` | Acción de plataforma propuesta que requiere autorización |
| `ResearchFinding` | Hallazgo durable con evidence refs, metodología, fortaleza |

### 6.4 Patrón async (jobs)

```text
POST /cognitive/jobs
  Body: CognitiveEnvelope con payload de tarea
  Response: 202 Accepted
    { "job_id": "<uuid>", "status": "PENDING", "poll_url": "/cognitive/jobs/<id>" }

GET /cognitive/jobs/<id>
  Response: 200
    { "job_id": "...", "status": "PENDING | RUNNING | COMPLETED | FAILED | CANCELLED",
      "result": <CognitiveResponse | null>,
      "progress": { "stage": "...", "pct": <0-100 | null> },
      "created_at": "...", "updated_at": "..." }

DELETE /cognitive/jobs/<id>
  Response: 200 (cancelación solicitada)
    { "job_id": "...", "status": "CANCELLED" }
```

### 6.5 Patrón sync

```text
POST /cognitive/resolve
  Body: CognitiveEnvelope
  Response: 200
    CognitiveEnvelope con payload ResolvedIntent
  Timeout: 30 segundos (P0 default, configurable)
```

### 6.6 Falla y degradación

| Escenario | Comportamiento |
|---|---|
| GaleCore-AI no disponible | GaleCore sigue operando. Sin features cognitivos. Plataforma, trading runtime, monitoreo, hard risk funcionan normalmente (AI Removal Test) |
| Timeout (sync) | Devuelve 504 con resultado parcial si hay disponible. Timeout configurable, P0 default 30s |
| Timeout (async job) | Job marcado FAILED después de TTL configurable. Caller detecta vía polling |
| Rate limit | 429 Too Many Requests con header Retry-After |
| Resultado parcial | `status: COMPLETED` con `result.completeness: PARTIAL` y explicación |
| Error de modelo | `status: FAILED` con clasificación de error (retryable/terminal) |

### 6.7 Límites de tamaño y rate (P0-MINIMUM)

Todos los valores son **P0 defaults, configurables**. No son verdades arquitectónicas permanentes.

```text
Max request payload:  1 MB      (P0 default, configurable)
Max response payload: 5 MB      (P0 default, configurable)
Max concurrent jobs:  10/tenant (P0 default, configurable)
Max job TTL:          30 min    (P0 default, configurable)
Sync timeout:         30 s     (P0 default, configurable)
```

### 6.8 Ejemplos

**CognitiveRequest válido (async job):**

```json
{
  "contract_version": "1.0",
  "message_id": "019212f5-1234-7d00-a1b2-c3d4e5f60030",
  "correlation_id": "019212f5-1234-7d00-a1b2-c3d4e5f60030",
  "causation_id": null,
  "trace_id": "019212f5-1234-7d00-a1b2-c3d4e5f60031",
  "actor": {
    "actor_type": "HUMAN",
    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "tenant_id": null,
    "agent_definition_version": null
  },
  "temporal_context": {
    "requested_at": "2026-09-12T15:00:00Z",
    "market_data_as_of": "2026-09-12T14:59:55Z"
  },
  "evidence_refs": [],
  "capability_versions": { "compute.gamma_exposure": "1.0.0" },
  "model_metadata": {},
  "payload_type": "TradeAssessment",
  "payload": {
    "target": "SPY",
    "objective": "assess_current_trade_opportunity"
  }
}
```

**CognitiveRequest inválido — `actor_type` no reconocido:**

```json
{
  "contract_version": "1.0",
  "message_id": "...",
  "actor": { "actor_type": "BOT", "user_id": "..." },
  "temporal_context": { "requested_at": "2026-09-12T15:00:00Z" },
  "payload_type": "TradeAssessment",
  "payload": { "target": "SPY" }
}
```

> Motivo de rechazo: `actor_type` "BOT" no es un valor válido del enum (HUMAN | AGENT | SYSTEM).

**CognitiveResponse válido (job completado):**

```json
{
  "job_id": "019212f5-1234-7d00-a1b2-c3d4e5f60030",
  "status": "COMPLETED",
  "result": {
    "contract_version": "1.0",
    "payload_type": "TradeRecommendation",
    "payload": {
      "recommendation": "NO_TRADE",
      "rationale": "VRP insuficiente (0.95 < 1.20). No hay edge en el entorno actual.",
      "evidence_refs": ["evidence:finding:019212f5-aaaa-..."]
    },
    "completeness": "FULL"
  },
  "progress": { "stage": "complete", "pct": 100 },
  "created_at": "2026-09-12T15:00:00Z",
  "updated_at": "2026-09-12T15:00:12Z"
}
```

---

## 7. Capability Contract Model v1

### 7.1 Regla canónica

> MCP es una proyección del capability model autoritativo de GaleCore, no un catálogo de tools
> mantenido independientemente. (v4 D35, D36)

```text
GaleCore Capability Model (autoritativo)
    ├── Proyección REST API
    └── Proyección MCP
            ↓
        Harness Capability Registry (descubre, anota, invoca)
```

### 7.2 Schema de definición de capability

```json
{
  "capability_id": "market_data.quote",
  "display_name": "Obtener cotización de mercado",
  "semantic_class": "PURE_QUERY",
  "schema_version": "1.0.0",
  "calculation_version": null,
  "methodology_version": null,
  "input_schema": {},
  "output_schema": {},
  "permissions": {
    "required_role": null,
    "required_scope": ["SHADOW", "PAPER", "LIVE"]
  },
  "idempotency": "NOT_APPLICABLE",
  "lifecycle_status": "CURRENT",
  "recommended_for_new_cognition": true,
  "availability": {
    "market_hours_only": false,
    "depends_on": ["tastytrade_api"]
  },
  "freshness": {
    "cache_ttl_seconds": null,
    "as_of_tracking": false
  },
  "errors": ["PROVIDER_UNAVAILABLE", "SYMBOL_NOT_FOUND", "RATE_LIMITED"],
  "cost_hints": {
    "latency_p50_ms": 200,
    "api_calls": 1
  }
}
```

### 7.3 Clases semánticas

| Clase | Side effects | Idempotency | Approval | Ejemplos |
|---|---|---|---|---|
| `PURE_QUERY` | Ninguno | NOT_APPLICABLE | Ninguna | GetMarketDataQuote, GetOptionChains |
| `COMPUTE` | Ninguno (puede tener costo de recursos) | Depende del mecanismo | Ninguna | GetGammaExposure, GetIVRank |
| `STATE_MUTATION` | Cambio de estado interno | REQUIRED | Check de permisos | DeployStrategy, UpdatePreference |
| `EXTERNAL_ACTION` | Side effect externo | REQUIRED + duplicate suppression | Permisos + Approval + Revalidación | SubmitOrder, CancelOrder |

### 7.4 MCP tools actuales → mapping de capabilities

| MCP Tool | Capability ID | Clase semántica | Notas |
|---|---|---|---|
| GetMarketDataByType | `market_data.by_type` | PURE_QUERY | Tastytrade REST |
| GetOptionChains | `market_data.option_chains` | PURE_QUERY | Tastytrade REST |
| GetMarketDataCandle | `market_data.candle` | PURE_QUERY | DXLink WebSocket |
| GetMarketDataTrade | `market_data.trade` | PURE_QUERY | DXLink WebSocket |
| GetMarketDataQuote | `market_data.quote` | PURE_QUERY | DXLink WebSocket |
| GetMarketDataGreeks | `market_data.greeks` | PURE_QUERY | DXLink WebSocket |
| GetTradeQuoteGreeks | `market_data.trade_quote_greeks` | PURE_QUERY | DXLink (optimizado) |
| GetGammaExposure | `compute.gamma_exposure` | COMPUTE | GEX por strike, Black-Scholes |
| GetIVRank | `compute.iv_rank` | COMPUTE | 252 trading days de historia |
| GetImpliedVolatility | `compute.implied_volatility` | COMPUTE | IV 9d/30d/90d interpolada |

**Capabilities no expuestas vía MCP** (existen en GaleCore pero solo accesibles internamente o por REST):

| Capability | Clase semántica | Acceso actual |
|---|---|---|
| Balances de cuenta | PURE_QUERY | Solo REST (`/Data/Tastytrade/Account/Balances`) |
| Posiciones de cuenta | PURE_QUERY | Solo REST (`/Data/Tastytrade/Account/Positions`) |
| Switch de estrategia | STATE_MUTATION | Solo REST (`POST <switch_endpoint>`) |
| Evaluación de macro regime | COMPUTE | Solo interno (CascadeUtils.EvaluateLayer1) |
| Evaluación de signal gates | COMPUTE | Solo interno (SignalGatesEvaluator) |
| Búsqueda de símbolos | PURE_QUERY | Solo REST (`/Data/Tastytrade/Symbols/Search`) |
| Put skew | COMPUTE | Solo REST (`/App.Analytics/PutSkew`) |

### 7.5 Paridad contractual REST / MCP

Las proyecciones REST y MCP de la misma capability deben garantizar:

- misma semántica de capability;
- mismo contrato de input (parámetros, tipos, restricciones);
- mismo schema de output (campos, tipos, estructura);
- mismas unidades de medida;
- mismos error codes y semántica de errores;
- mismo versionado (schema_version, calculation_version, methodology_version);
- mismos permisos requeridos.

**No se exige igualdad de valores** entre calls independientes a datos en tiempo real. Una
cotización obtenida por REST a las 10:30:01.000 y otra obtenida por MCP a las 10:30:01.200
pueden ser legítimamente distintas.

**Contract tests** verifican la paridad usando fixtures determinísticos, mocks o snapshots
congelados — no comparando valores live entre calls independientes.

### 7.6 Ejemplos

**CapabilityContract válido:**

```json
{
  "capability_id": "compute.gamma_exposure",
  "display_name": "Gamma Exposure por strike",
  "semantic_class": "COMPUTE",
  "schema_version": "1.0.0",
  "calculation_version": "1.1.0",
  "methodology_version": "1.0.0",
  "idempotency": "NOT_APPLICABLE",
  "lifecycle_status": "CURRENT",
  "recommended_for_new_cognition": true,
  "errors": ["OPTION_CHAIN_NOT_FOUND", "PROVIDER_UNAVAILABLE"]
}
```

**CapabilityContract inválido — PURE_QUERY con idempotency REQUIRED:**

```json
{
  "capability_id": "market_data.quote",
  "semantic_class": "PURE_QUERY",
  "idempotency": "REQUIRED"
}
```

> Motivo de rechazo: PURE_QUERY no tiene side effects; exigir idempotency key es innecesario
> y contradice la definición de la clase semántica.

---

## 8. Máquina de estados de ActionProposal

### 8.1 Estados

```text
PROPOSED ──→ VALIDATED ──→ APPROVAL_REQUIRED ──→ APPROVED ──→ REVALIDATING ──→ AUTHORIZED ──→ EXECUTING ──→ EXECUTED
   │             │               │                    │              │               │              │
   └→REJECTED  └→REJECTED    └→REJECTED          └→EXPIRED      └→REJECTED      └→FAILED      └→FAILED
                                  │                                                              └→EXECUTION_UNKNOWN
                                  └→EXPIRED
                                  └→CANCELLED
```

### 8.2 Definición de estados

| Estado | Significado | Owner del estado |
|---|---|---|
| PROPOSED | AI, system o humano produjo una propuesta. GaleCore-AI puede *proponer*; GaleCore recibe y crea el estado operativo | GaleCore |
| VALIDATED | Validación de plataforma de GaleCore pasó (estructura, risk limits, permisos) | GaleCore |
| APPROVAL_REQUIRED | Esperando aprobación humana (obligatoria para LIVE; configurable para SHADOW/PAPER) | GaleCore |
| APPROVED | Humano aprobó | GaleCore |
| REVALIDATING | La plataforma re-verifica condiciones de mercado inmediatamente antes de autorizar | GaleCore |
| AUTHORIZED | Plataforma confirmó que las condiciones siguen vigentes; listo para ejecutar | GaleCore |
| EXECUTING | Ejecución en progreso | GaleCore |
| EXECUTED | Ejecución confirmada | GaleCore |
| REJECTED | Falló validación, aprobación denegada, o revalidación falló | GaleCore |
| EXPIRED | Aprobación o propuesta expiró por timeout | GaleCore |
| CANCELLED | Cancelado explícitamente por humano o sistema | GaleCore |
| FAILED | Ejecución falló con error conocido | GaleCore |
| EXECUTION_UNKNOWN | El broker no confirmó; resultado incierto | GaleCore |

**Nota sobre ownership:** GaleCore-AI puede *proponer* un ActionProposal (autor = AI). GaleCore lo recibe,
crea el registro operativo de la propuesta y es dueño de todo el estado subsiguiente. GaleCore valida,
autoriza y ejecuta. El autor puede ser AI, System o Human; el dueño del estado operativo es siempre GaleCore.

### 8.3 Reglas de transición

| Transición | Quién la dispara | Condiciones |
|---|---|---|
| → PROPOSED | AI Agent, System o Humano | Estructura válida de ActionProposal |
| PROPOSED → VALIDATED | GaleCore | Validación de plataforma pasa |
| PROPOSED → REJECTED | GaleCore | Validación de plataforma falla |
| VALIDATED → APPROVAL_REQUIRED | GaleCore | El modo requiere aprobación O la política lo exige |
| VALIDATED → REVALIDATING | GaleCore | El modo no requiere aprobación (SHADOW por defecto) |
| APPROVAL_REQUIRED → APPROVED | Humano | Acción de aprobación explícita |
| APPROVAL_REQUIRED → REJECTED | Humano | Rechazo explícito |
| APPROVAL_REQUIRED → EXPIRED | Sistema | TTL de aprobación excedido |
| APPROVAL_REQUIRED → CANCELLED | Humano o Sistema | Cancelación explícita |
| APPROVED → REVALIDATING | GaleCore | Automático, inmediato |
| REVALIDATING → AUTHORIZED | GaleCore | Condiciones de mercado siguen vigentes |
| REVALIDATING → REJECTED | GaleCore | Condiciones cambiaron más allá de la tolerancia |
| AUTHORIZED → EXECUTING | GaleCore | Ejecución iniciada |
| EXECUTING → EXECUTED | GaleCore | Broker confirma fill |
| EXECUTING → FAILED | GaleCore | Broker rechaza o error |
| EXECUTING → EXECUTION_UNKNOWN | GaleCore | Timeout del broker, sin confirmación |

### 8.4 Revalidación

La revalidación ocurre automáticamente entre APPROVED y AUTHORIZED. Verifica:

- Drift de precio: precio actual vs precio al momento de la propuesta, dentro de tolerancia
- Cambio de crédito/débito: crédito actual vs crédito propuesto, dentro de tolerancia
- Buying power: todavía suficiente
- Estado del portfolio: no se abrieron posiciones conflictivas desde la aprobación
- Liquidez: bid-ask spread dentro de tolerancia
- Kill switch: no activado

Si algún check falla, la propuesta pasa a REJECTED con la razón específica.

### 8.5 Relación con los estados de RPF

La máquina de 7 estados de RPF (IDLE → SCANNING → CANDIDATE → SUGGESTING → COOLDOWN → IN_POSITION → CLOSING)
es una máquina de estados del **lifecycle de la estrategia**, no de autorización de trades. Son distintas:

- Los estados de RPF gobiernan cuándo y cómo opera el motor de la estrategia
- Los estados de ActionProposal gobiernan la autorización y ejecución de un trade específico

Un estado SUGGESTING de RPF puede producir un ActionProposal en estado PROPOSED. La máquina
de estados de RPF no cambia para reflejar el progreso del ActionProposal — cada una lleva su propio lifecycle.

### 8.6 Restricciones P0-MINIMUM

En modo SHADOW:
- EXECUTING → EXECUTED es un fill simulado (sin llamada al broker)
- EXECUTION_UNKNOWN no es posible (la simulación siempre resuelve)
- APPROVAL_REQUIRED es opcional (configurable, default: saltar a REVALIDATING)
- Kill switch sigue funcionando (detiene todas las propuestas)

### 8.7 Reglas canónicas

```text
Recommendation  != Approval
Approval        != Authorization
Authorization   != Execution
```

La aprobación humana es obligatoria antes de LIVE (v4). La revalidación de plataforma es
obligatoria antes de cada ejecución independientemente del modo.

Precedencia del kill switch: kill switch > cualquier ActionProposal en vuelo. Una activación
del kill switch mueve inmediatamente todas las propuestas no terminales a CANCELLED.

Fail-closed en LIVE: cualquier incertidumbre resulta en NO ejecutar. `EXECUTION_UNKNOWN`
dispara notificación humana inmediata y reconciliación de posiciones.

### 8.8 Ejemplos

**ActionProposal válido (estado PROPOSED):**

```json
{
  "proposal_id": "019212f6-5678-7d00-a1b2-c3d4e5f60040",
  "state": "PROPOSED",
  "proposed_by": { "actor_type": "AGENT", "agent_definition_version": "trading_agent:1.0" },
  "strategy_version_hash": "sha256:abc123...",
  "mode": "SHADOW",
  "action": {
    "type": "OPEN_POSITION",
    "structure": "put_credit_spread",
    "symbol": "SPY",
    "legs": [
      { "side": "SELL", "strike": 520, "expiration": "2026-10-17", "type": "PUT" },
      { "side": "BUY", "strike": 515, "expiration": "2026-10-17", "type": "PUT" }
    ],
    "expected_credit": 0.85,
    "max_risk": 415.00
  },
  "market_context_as_of": "2026-09-12T14:59:55Z",
  "proposed_at": "2026-09-12T15:00:00Z"
}
```

**ActionProposal inválido — transición ilegal:**

```json
{
  "proposal_id": "...",
  "state": "PROPOSED",
  "transition_requested": "EXECUTING"
}
```

> Motivo de rechazo: la transición PROPOSED → EXECUTING es ilegal. Debe pasar por VALIDATED
> (y opcionalmente APPROVAL_REQUIRED → APPROVED) → REVALIDATING → AUTHORIZED antes de EXECUTING.

---

## 9. Identidad, permisos, freshness, idempotency

### 9.1 Estado actual

| Mecanismo | Implementación | Notas |
|---|---|---|
| API Key | Header `X-API-KEY`, `ApiKeyMiddleware` | Bypass para /swagger, /mcp, /favicon.ico |
| JWT (Supabase) | Opcional para SignalR hub | Flag `RequireAuthOnHub`, actualmente false |
| Flag admin | `users.is_admin` en Supabase | Usado por `canManagePlatform` |
| Permisos de switch | `AppController.CanManagePlatformAsync` | Autoridad única para acceso al switch |

### 9.2 Adiciones P0-MINIMUM

| Concern | Requisito P0-MINIMUM |
|---|---|
| Identidad de actor | Cada request lleva `actor` (type + user_id). Tres tipos: HUMAN, AGENT, SYSTEM |
| Propagación de principal | Cuando GaleCore llama a GaleCore-AI, el actor original se propaga en el envelope |
| Permisos de capability | Cada capability declara permisos requeridos. Verificados antes de la ejecución |
| Scope de modo | SHADOW / PAPER / LIVE como scope explícito. P0-MINIMUM solo habilita SHADOW |
| Correlation/trace | Cada request lleva `correlation_id` y `trace_id`. Propagados a lo largo de cadenas |
| Idempotency | Commands y EXTERNAL_ACTIONs requieren `idempotency_key`. Detección de duplicados dentro del TTL |
| Timestamps | `requested_at` obligatorio. `market_data_as_of` cuando se referencian datos de mercado |
| Freshness | Detección de datos stale: rechazar si `market_data_as_of` excede el TTL específico de la capability |
| Tenant/account | Mínimo: tenant único en P0-MINIMUM. Aislamiento multi-tenant diferido a P-LIVE |
| Credenciales de broker | **GaleCore-AI NUNCA posee credenciales de broker** (v4 §4). Todas las operaciones de broker pasan por GaleCore |

### 9.3 Contrato de idempotency

`idempotency_key` debe ser un identificador **opaco, estable, generado una sola vez por
comando lógico**. No debe derivarse automáticamente del contenido de la intención ni de un
bucket temporal.

```text
Formato preferido:    UUIDv7 o ULID
Generación:           una vez por comando lógico, reutilizada en retries del mismo comando
TTL:                  24 horas (P0 default, configurable)
Detección de duplicados: misma idempotency_key dentro del TTL → devolver respuesta cacheada,
                         sin re-ejecución
Scope:                por tenant (P0-MINIMUM: global, tenant único)
```

Reglas por clase semántica:

```text
PURE_QUERY       → idempotency NOT_APPLICABLE (las lecturas son naturalmente idempotentes)
COMPUTE          → depende del mecanismo (NOT_APPLICABLE si es puro; OPTIONAL si tiene costo/side effect)
STATE_MUTATION   → idempotency REQUIRED
EXTERNAL_ACTION  → idempotency REQUIRED + duplicate suppression REQUIRED
```

---

## 10. EvidenceRef y lineage de trazas

### 10.1 Trace ≠ Evidence

| Concern | Trace | Evidence |
|---|---|---|
| Propósito | Observabilidad, debugging | Hallazgos cognitivos/operacionales durables |
| Granularidad | Detallada, por paso | Curada, por conclusión |
| Retención | Limitada (TTL configurable) | Durable (append-only) |
| Mutabilidad | Inmutable una vez escrita | Append-only; SUPERSEDED/INVALIDATED crean revisiones enlazadas |
| Volumen | Alto volumen, comprimible | Bajo volumen, alto valor |
| Owner | Sistema que lo produjo | Dueño del dominio (GaleCore o GaleCore-AI según v4) |

### 10.2 Schema de EvidenceRef

Este contrato identifica evidencia durable. La clase GEX actual `{fact_path, claim}` es una **referencia local a facts** dentro de un análisis; no satisface este contrato ni demuestra persistencia. Conserva por compatibilidad el nombre Python `EvidenceRef`, pero su alcance debe documentarse como `GexFactReference`. La conexión futura debe incluir identidad del snapshot y no resolver contra datos live nuevos.

```json
{
  "evidence_id": "<uuid>",
  "evidence_type": "FINDING | HYPOTHESIS | NARRATIVE | EXPERIMENT | TRADE_OUTCOME | METRIC_SNAPSHOT",
  "owner": "GALECORE | GALECORE_AI",
  "layer": "RAW | DERIVED | COGNITIVE",
  "version": "<string>",
  "content_hash": "sha256:<hex>",
  "created_at": "<ISO 8601 UTC>",
  "created_by": { "actor_type": "...", "user_id": "..." },
  "resolution": {
    "mechanism": "API | STORAGE | INLINE",
    "uri": "<string | null>"
  },
  "status": "ACTIVE | SUPERSEDED | INVALIDATED",
  "superseded_by": "<evidence_id | null>",
  "methodology_version": "<string | null>"
}
```

### 10.3 Tres capas de evidencia (v4 §11)

| Capa | Owner | Ejemplos |
|---|---|---|
| Raw / hechos normalizados | GaleCore | Snapshots de GEX, historia de IV, precios, órdenes, fills, posiciones |
| Derivada determinística | GaleCore | Percentil 30 días de GEX, correlaciones rolling, métricas de estrategia |
| Cognitiva | GaleCore-AI | Hallazgos, narrativas, hipótesis, interpretaciones, preguntas abiertas |

### 10.4 Reglas de lifecycle

- Hallazgos, hipótesis y narrativas son **append-only**.
- `SUPERSEDED` e `INVALIDATED` crean revisiones enlazadas; nunca destruyen historia.
- Cada conclusión cognitiva debe ser trazable a sus inputs:
  - Versión de AgentDefinition
  - Versión de model/provider
  - Versiones de skill/protocol/convention
  - Versiones de capabilities usadas
  - Snapshots de dataset/mercado referenciados
  - Snapshot del portfolio referenciado
  - Evidencia padre (si se basa en conclusiones previas)

### 10.5 Retención de trazas (P0-MINIMUM)

Todos los valores son **P0 defaults, configurables**.

```text
Trazas cognitivas:     30 días  (P0 default, configurable)
Trazas operacionales:  90 días  (P0 default, configurable)
Evidencia:             indefinida (append-only)
```

Datos sensibles en trazas (credenciales, portfolio completo) deben redactarse antes del almacenamiento.

### 10.6 Ejemplos

**EvidenceRef válido:**

```json
{
  "evidence_id": "019212f7-abcd-7d00-a1b2-c3d4e5f60050",
  "evidence_type": "FINDING",
  "owner": "GALECORE_AI",
  "layer": "COGNITIVE",
  "version": "1",
  "content_hash": "sha256:def456...",
  "created_at": "2026-09-12T15:30:00Z",
  "created_by": { "actor_type": "AGENT", "user_id": "a1b2c3d4-..." },
  "resolution": { "mechanism": "STORAGE", "uri": "findings/019212f7-abcd-..." },
  "status": "ACTIVE",
  "superseded_by": null,
  "methodology_version": "1.0.0"
}
```

**EvidenceRef inválido — SUPERSEDED sin `superseded_by`:**

```json
{
  "evidence_id": "019212f7-abcd-...",
  "evidence_type": "FINDING",
  "status": "SUPERSEDED",
  "superseded_by": null
}
```

> Motivo de rechazo: un EvidenceRef con `status: SUPERSEDED` debe indicar `superseded_by`
> con el ID de la evidencia que lo reemplaza. Sin ese enlace, la cadena de revisiones se rompe.

---

## 11. Data Catalog mínimo

### 11.1 Clasificación de assets

```text
RAW_DATA            — datos sin procesar de fuentes externas
DERIVED_METRIC      — cómputo determinístico a partir de datos raw
HISTORICAL_SNAPSHOT — captura point-in-time de datos raw o derivados
ANALYTICAL_DATASET  — dataset curado para research/backtest
VIEW                — presentación en tiempo real o bajo demanda de datos
```

### 11.2 Schema de metadata de assets

```json
{
  "asset_id": "market_data.equity.quote",
  "asset_type": "RAW_DATA",
  "owner": "GALECORE",
  "source": "tastytrade_dxlink",
  "schema_version": "1.0.0",
  "coverage": {
    "symbols": "Equities y opciones de EEUU listadas en Tastytrade",
    "history_start": null,
    "granularity": "TICK"
  },
  "freshness": {
    "update_frequency": "REALTIME",
    "as_of_tracking": false
  },
  "quality": "PRODUCTION",
  "availability": "AVAILABLE",
  "lifecycle_status": "CURRENT",
  "recommended_for_new_cognition": true,
  "permissions": {
    "requires_broker_link": false
  },
  "derived_from": [],
  "methodology_version": null,
  "calculation_version": null,
  "resolution": "capability:market_data.quote"
}
```

**Campos de lifecycle:**

- `lifecycle_status`: LEGACY | CURRENT | DEPRECATED
  - LEGACY: existe y funciona, pero diseñado bajo premisas que la arquitectura v4 ya revisó.
  - CURRENT: vigente y alineado con la arquitectura objetivo.
  - DEPRECATED: programado para eliminación; no usar para trabajo nuevo.
- `recommended_for_new_cognition`: boolean — indica si el Harness futuro debería usar esta capability/asset como input para nueva cognición. Un asset LEGACY con `recommended_for_new_cognition: false` significa: "esto existe, pero no es el método recomendado para nueva cognición".

### 11.3 Semántica de availability

| Status | Significado |
|---|---|
| AVAILABLE | El dato existe y es accesible ahora |
| PARTIAL | El dato existe pero con gaps (cobertura, freshness, o limitaciones de calidad) |
| DERIVABLE | No almacenado, pero computable bajo demanda a partir de datos disponibles |
| NOT_AVAILABLE | No existe en la plataforma |

`PLANNED` se excluye per P0-D5 (solo existente). Los items se agregan al catálogo cuando se construyen.

### 11.4 Catálogo inicial (lo que GaleCore puede servir hoy)

| Asset ID | Tipo | Fuente | Availability | Lifecycle | Recom. cognición | Notas |
|---|---|---|---|---|---|---|
| `market_data.equity.quote` | RAW_DATA | Tastytrade DXLink | AVAILABLE | CURRENT | si | Tiempo real vía WebSocket |
| `market_data.equity.by_type` | RAW_DATA | Tastytrade REST | AVAILABLE | CURRENT | si | Precio, volumen, fundamentales |
| `market_data.option.chains` | RAW_DATA | Tastytrade REST | AVAILABLE | CURRENT | si | Todas las expiraciones y strikes |
| `market_data.option.candle` | RAW_DATA | Tastytrade DXLink | AVAILABLE | CURRENT | si | OHLCV con IV y Greeks |
| `market_data.option.trade` | RAW_DATA | Tastytrade DXLink | AVAILABLE | CURRENT | si | Último trade |
| `market_data.option.quote` | RAW_DATA | Tastytrade DXLink | AVAILABLE | CURRENT | si | Bid/ask/mid |
| `market_data.option.greeks` | RAW_DATA | Tastytrade DXLink | AVAILABLE | CURRENT | si | Delta/Gamma/Theta/Vega/IV |
| `compute.gamma_exposure` | DERIVED_METRIC | GaleCore (Black-Scholes) | AVAILABLE | CURRENT | si | GEX por strike, por expiración o global |
| `compute.iv_rank` | DERIVED_METRIC | GaleCore | AVAILABLE | CURRENT | si | IV Rank + Percentile de 252 días |
| `compute.implied_volatility` | DERIVED_METRIC | GaleCore | AVAILABLE | CURRENT | si | IV 9d/30d/90d interpolada |
| `compute.macro_regime` | DERIVED_METRIC | GaleCore (CascadeUtils) | AVAILABLE | LEGACY | no | 6 checks, solo interno. v4 D42 rechazó el engine universal bullish/neutral/bearish como modelo primario. Existe y funciona para RPF, pero nueva cognición no debe depender de un score de régimen universal |
| `compute.signal_gates` | DERIVED_METRIC | GaleCore (SignalGatesEvaluator) | AVAILABLE | LEGACY | no | 5 gates, solo interno. Acoplado a la estructura actual de RPF. Nueva cognición debe usar capabilities más granulares |
| `compute.put_skew` | DERIVED_METRIC | GaleCore | AVAILABLE | CURRENT | si | Vía endpoint REST |
| `history.skew25` | HISTORICAL_SNAPSHOT | SkewSnapshotService | AVAILABLE | CURRENT | si | Cada 6 horas, archivo JSON |
| `dataset.pop_calibration` | ANALYTICAL_DATASET | Research (parquet → JSON) | AVAILABLE | CURRENT | si | POP trailing por delta, solo SPY |
| `account.balances` | RAW_DATA | Tastytrade REST | AVAILABLE | CURRENT | si | Requiere link de broker |
| `account.positions` | RAW_DATA | Tastytrade REST | AVAILABLE | CURRENT | si | Requiere link de broker |
| `macro.fred` | RAW_DATA | FRED API | PARTIAL | CURRENT | si | Endpoints limitados implementados |

### 11.5 Ejemplos

**DataCatalogAsset válido:**

```json
{
  "asset_id": "compute.gamma_exposure",
  "asset_type": "DERIVED_METRIC",
  "owner": "GALECORE",
  "source": "galecore_black_scholes",
  "availability": "AVAILABLE",
  "lifecycle_status": "CURRENT",
  "recommended_for_new_cognition": true,
  "calculation_version": "1.1.0"
}
```

**DataCatalogAsset inválido — falta `asset_type`:**

```json
{
  "asset_id": "compute.gamma_exposure",
  "owner": "GALECORE",
  "availability": "AVAILABLE"
}
```

> Motivo de rechazo: `asset_type` es obligatorio. Sin él, no se puede clasificar el asset
> ni aplicar las reglas de ownership correspondientes a su tipo.

---

## 12. Semántica de fallas

### 12.1 Frontera GaleCore ↔ GaleCore-AI

| Escenario | Comportamiento |
|---|---|
| GaleCore-AI no disponible | GaleCore sigue operando normalmente. Features cognitivos degradados. Sin retry loop |
| Timeout (sync) | Devuelve 504. Loguea. Sin retry automático. El caller decide. Timeout: P0 default 30s, configurable |
| Timeout (async job) | Job marcado FAILED después del TTL. Caller detecta vía polling. TTL: P0 default 30 min, configurable |
| Rate limit | 429 con Retry-After. Caller hace backoff |
| Resultado parcial | Devuelto con `completeness: PARTIAL`. Utilizable para algunos propósitos |
| Error de modelo (retryable) | Retry una vez con exponential backoff. Luego FAILED |
| Error de modelo (terminal) | FAILED inmediatamente. Log completo del error para debugging |
| Respuesta malformada | FAILED. Log de la respuesta para investigación. Nunca reenviar datos malformados |
| Circuit breaker | Después de 5 fallas consecutivas en 60s, circuito abierto por 120s. Half-open después. (Valores: P0 defaults, configurables) |

### 12.2 Frontera GaleCore ↔ Broker

| Escenario | Comportamiento |
|---|---|
| Broker no disponible | Datos de mercado se detienen. Posiciones congeladas en último estado conocido. Sin nuevas órdenes |
| Orden rechazada | ActionProposal → FAILED con error code del broker |
| Timeout de orden | ActionProposal → EXECUTION_UNKNOWN. Notificación humana. Reconciliación requerida |
| Credencial expirada | `broker_credential_invalid` (409). El humano debe re-vincular |
| Cuenta no vinculada | `broker_account_not_linked` (409). El humano debe vincular |
| Desconexión DXLink | Auto-reconexión con backoff. Log del gap. Reanudar suscripciones |

### 12.3 Frontera GaleCore ↔ Frontend

| Escenario | Comportamiento |
|---|---|
| API no disponible | Frontend muestra indicador offline. Fallback REST polling (30s) para precios |
| Desconexión SignalR | Auto-reconexión. Re-suscripción. Indicador de datos stale |
| Datos stale | `lastUpdate` > umbral → indicador visual en TickerCard |
| 409 Conflict | Frontend lee campo `code` para mensaje apropiado al usuario |
| Error 500 | Mensaje de error genérico. Nunca exponer detalles internos |

### 12.4 Reglas transversales

```text
Errores retryable:       network timeout, 429, 503, errores transitorios de broker
Errores terminales:      4xx (excepto 429), fallas de validación, violaciones de reglas de negocio
Entrega duplicada:       idempotency_key previene re-ejecución; devuelve respuesta cacheada
Ordenamiento:            sin garantías de orden entre requests independientes
Concurrencia:            optimistic concurrency para state mutations →
                         version / ETag / row_version →
                         conflicto detectado → 409 Conflict →
                         caller recarga estado actual y reintenta explícitamente
Contexto stale:          rechazar si market_data_as_of excede umbral de freshness
Cancelación:             soportada para async jobs; best-effort para órdenes de broker en vuelo
```

---

## 13. P0-MINIMUM vs P-LIVE

### P0-MINIMUM — requerido antes de implementar el vertical slice

| Concern | Requisito P0-MINIMUM |
|---|---|
| Contratos | Contratos aplicables al vertical operacional; no constituyen prerrequisitos de implementación del GEX interactivo |
| Identidad | Tipo de actor (HUMAN/AGENT/SYSTEM) + user_id |
| Permisos | Check de permisos por capability |
| Scope de modo | Solo SHADOW. PAPER/LIVE deshabilitados |
| Idempotency | Para STATE_MUTATION y EXTERNAL_ACTION |
| Freshness | Tracking de market_data_as_of y rechazo por staleness |
| Trace | Correlation/trace IDs en todas las llamadas cross-boundary |
| Aislamiento de broker | GaleCore-AI nunca posee credenciales de broker |
| Ejecución | SHADOW = fills simulados únicamente |

### P-LIVE — requerido antes de PAPER/LIVE multiusuario

| Concern | Requisito P-LIVE |
|---|---|
| Aislamiento de tenants | Separación multi-tenant endurecida y testeada |
| Modelo de delegación | Cadena completa de delegación de principal |
| Datos de modelos | Política de tratamiento y retención de datos por model provider |
| Secretos | Credenciales delegadas de mínimo privilegio |
| Prompt injection | Protección contra inyección desde fuentes externas |
| Búsqueda externa | Política y provenance contract para web/noticias |
| Fallas de broker | Manejo completo de failure modes con reconciliación |
| Reconciliación de órdenes | Reconciliar outcomes inciertos contra estado del broker |
| Kill switches | Kill switches de plataforma y por estrategia con procedimientos operativos |
| SLOs | Objetivos de latencia, disponibilidad, tasa de error |
| Alertas | Procedimientos de detección y respuesta a incidentes |
| Modelo de amenazas | Revisión de seguridad y documentación de threat model |
| Tests de auth | Suite de tests de autorización y aislamiento |
| Aprobación humana | Aprobación humana obligatoria antes de ejecución LIVE |

**P0-MINIMUM habilita diseñar y construir SHADOW. NO habilita PAPER ni LIVE.**

---

## 14. Matriz de ownership

| Concepto | Owner | Fuente de verdad | Autor | Validador | Ejecutor | Store |
|---|---|---|---|---|---|---|
| StrategySpec | Compartido | JSON Schema | AI o Humano | GaleCore | Trading Runtime | GaleCore |
| StrategyProposal | GaleCore-AI | Evidencia cognitiva | AI | Revisión humana | N/A | GaleCore-AI |
| StrategyInstance | GaleCore | Estado operacional | GaleCore | GaleCore | Trading Runtime | GaleCore |
| TradeCandidate | GaleCore (dato) | Trading Runtime / Cognitive output | GaleCore (determinístico) o GaleCore-AI (cognitivo) | Hard risk | N/A | GaleCore |
| TradeRecommendation | GaleCore-AI | Output cognitivo | AI | GaleCore | N/A | GaleCore |
| ActionProposal | GaleCore (estado) | Máquina de estados | AI, System o Humano (proponen) | GaleCore (valida/autoriza) | GaleCore (ejecuta) | GaleCore |
| Definición de capability | GaleCore | Capability model | GaleCore | GaleCore | GaleCore | GaleCore |
| Datos de mercado | GaleCore | Provider + cache | Providers | GaleCore | N/A | GaleCore |
| Analytics (GEX, IV, BS) | GaleCore | Código de cálculo | GaleCore | Tests | GaleCore | GaleCore |
| Evidencia operacional | GaleCore | Postgres | GaleCore | GaleCore | N/A | GaleCore |
| Evidencia cognitiva | GaleCore-AI | Persistencia cognitiva | AI | GaleCore-AI | N/A | GaleCore-AI |
| Preferencias de usuario | GaleCore | Estado estructurado | Humano | GaleCore | GaleCore | GaleCore |
| Domain conventions | GaleCore-AI | Archivos de convención | AI o Humano | GaleCore-AI | Harness | GaleCore-AI |
| Skills | GaleCore-AI | Archivos de Skill | AI o Humano | GaleCore-AI | Harness | GaleCore-AI |
| Protocols | GaleCore-AI | Archivos de Protocol | AI o Humano | GaleCore-AI | Harness | GaleCore-AI |
| Guardrails | GaleCore-AI | Config de Guardrail | AI o Humano | GaleCore-AI | Harness | GaleCore-AI |
| Narrativas de mercado | GaleCore-AI | Evidencia cognitiva | AI | GaleCore-AI | N/A | GaleCore-AI |
| Contratos de envelope | Compartido | Este documento | P0 | Ambos | Ambos | N/A |
| Error codes | GaleCore | Implementación API | GaleCore | Tests | GaleCore | N/A |
| Estado de switch | GaleCore | Archivos JSON | Humano (admin) | GaleCore | GaleCore | File system |

**Notas sobre TradeCandidate y ActionProposal:**

- **TradeCandidate:** el dato del candidato (strikes, legs, crédito esperado) es propiedad de GaleCore. Pero el *autor* puede variar: GaleCore lo construye determinísticamente vía Trading Runtime, o GaleCore-AI lo propone cognitivamente con rationale y evidencia. La validación de hard risk siempre la hace GaleCore independientemente del origen.
- **ActionProposal:** GaleCore-AI puede *proponer* un ActionProposal (autor = AI). GaleCore recibe la propuesta, crea el registro operativo y es dueño de todo el estado subsiguiente. Validación, autorización y ejecución son siempre de GaleCore.

---

## 15. Mapa de migración actual → objetivo

| Artefacto actual | Concepto objetivo | Regla de coexistencia | Disparador de migración |
|---|---|---|---|
| `galecore_rules_rpf.json` | StrategySpec v1 (vía mapping en §5.4) | RPF JSON permanece como fuente de verdad de RPF. Nuevas estrategias usan StrategySpec | Trading Runtime completo (Phase 1-2) |
| `galecore_rules_gex.json` | Config de analytics (no es un StrategySpec) | Permanece tal cual. GEX es informativa, no estrategia de trading | Sin migración planificada |
| `galecore_rules_core.json` | Config de plataforma | Permanece tal cual | Sin migración planificada |
| `McpTools.cs` (10 tools) | Proyecciones del capability model (§7) | MCP tools siguen funcionando. Capability model se construye en paralelo | Implementación del capability model |
| `/App/<Prefix>/*` endpoints | Coexisten con endpoints genéricos de capabilities | Endpoints de estrategia no se eliminan hasta validar su reemplazo | Endpoints genéricos del Trading Runtime |
| `CascadeContracts.cs` DTOs | Schemas de output de capabilities | DTOs continúan como contratos internos. Capability model agrega metadata | Cuando las capabilities se formalicen |
| `MarketDataHub.cs` | Coexiste con Cognitive API | Hub permanece para streaming real-time. Cognitive API es REST separado | Hub y API sirven propósitos distintos |
| Contrato de switch (`{enabled, source}`) | Permanece. Potencialmente extendido con scope de modo | Sin cambio necesario para P0-MINIMUM | P-LIVE si se necesitan switches por modo |
| Error codes (campo `code` del 409) | Formalizados en semántica de fallas (§12) | Los codes son contrato — nunca renombrar | N/A (ya estables) |
| `CLAUDE.md` | Nivel inferior en la jerarquía de fuentes de verdad | Válido para la implementación actual. v4/P0 gobiernan la arquitectura objetivo | Se actualiza incrementalmente a medida que la implementación avanza |

---

## 16. Decisiones abiertas

### 16.1 Cerradas por P0 (derivables de v4)

| # | Decisión | Fuente |
|---|---|---|
| P0-D6 | JSON Schema de StrategySpec es canónico | v4 D22, Q6 |
| P0-D7 | MCP deriva del capability model | v4 D35, D36 |
| P0-D8 | Cuatro clases semánticas para capabilities | v4 §8 |
| P0-D9 | Tres dimensiones de versionado | v4 §8 |
| P0-D10 | Tres capas de evidencia con ownership | v4 §11 |

### 16.2 Cerradas por decisión de usuario

| # | Decisión | Input de usuario |
|---|---|---|
| P0-D1 | "Harness" legacy → Quality Gates | Resuelto 2026-09-12 |
| P0-D2 | SemVer + content hash | Resuelto 2026-09-12 |
| P0-D3 | REST only para Cognitive API | Resuelto 2026-09-12 |
| P0-D4 | Migración de RPF después del Trading Runtime | Resuelto 2026-09-12 |
| P0-D5 | Data Catalog solo existente | Resuelto 2026-09-12 |

### 16.3 Explícitamente diferidas

| Pregunta | Diferida a | Razón |
|---|---|---|
| Aislamiento multi-tenant | P-LIVE | No necesario para SHADOW single-user |
| Formato/versionado de Domain Conventions | Phase 3 | No hay runtime de Harness todavía |
| Representación de Cognitive Protocols | Phase 3-4 | No hay runtime de Harness todavía |
| Criterios de promoción (cognitivo → gate determinístico) | Phase 4 | Requiere experiencia operacional |
| Política de búsqueda externa | Antes de web/noticias | Sin búsqueda externa planificada para MVP |
| Lifecycle de MarketNarrative | Phase 6 | Market context intelligence es post-MVP |
| Contratos completos de Work Runtime | Phase 5 | Work product model es post-trading MVP |
| Representación frontend de output cognitivo | Phase 5 | Work UX es post-trading MVP |

---

## 17. Checklist de aceptación P0-MINIMUM

Derivado de SESSION_HANDOFF §7. P0 está listo para revisión cuando todos los items se cumplen:

- [x] Cada contrato tiene owner, fuente de verdad y versión (§14 matriz de ownership)
- [x] Jerarquía documental y precedencia ante conflictos definidas (§2.1)
- [x] Existen ejemplos válidos e inválidos (§3.6, §5.6, §6.8, §7.6, §8.8, §10.6, §11.5)
- [x] Estados y transiciones definidos (§8 ActionProposal)
- [x] Errores, timeout, retry e idempotency tienen semántica explícita (§12 semántica de fallas)
- [x] REST y MCP derivan del mismo capability model (§7.1)
- [x] Cada capability declara clase semántica con idempotency proporcional (§7.3)
- [x] Versionado de schema, calculation y methodology diferenciado (§4)
- [x] StrategySpec no depende de C# ni Python como fuente canónica (§5.1)
- [x] StrategyInstance puede identificar el hash canónico de su StrategySpec (§4.4, §5.2)
- [x] Una recomendación puede reconstruir actor, contexto temporal, capabilities y evidencia (§3 envelopes)
- [x] Una aprobación no puede ejecutarse con contexto vencido sin revalidación (§8.4)
- [x] Aprobación, autorización y ejecución son estados distintos (§8.2)
- [x] Trace efímero y evidence durable tienen contratos y retención diferenciados (§10)
- [x] Assets del Data Catalog clasificados por tipo (§11)
- [x] Documentado qué sigue funcionando si GaleCore-AI desaparece (§6.6, §12.1, §13)
- [x] Documentada la coexistencia con JSON/endpoints/docs actuales (§15)
- [x] P0-MINIMUM y P-LIVE claramente separados (§13)
- [x] No se escribió runtime code de producción como parte de este documento

---

## Lo que este documento NO hace

```text
NO:
  - Implementar código de runtime
  - Modificar código fuente de GaleCore
  - Migrar RPF o GEX
  - Reemplazar archivos JSON existentes
  - Habilitar PAPER o LIVE
  - Construir el Harness
  - Crear orquestación multi-agente
  - Implementar búsqueda web externa
  - Resolver controles enterprise de P-LIVE
  - Definir contratos completos de Work/Cowork
```

---

## Próximo entregable

Con P0-CONTRACTS aprobado:

```text
1. Implementar validadores de contratos (JSON Schema + .NET + Python)
2. Construir vertical slice determinístico PCS-SPY SHADOW en GaleCore
3. Verificar AI Removal Test end-to-end
4. Cerrar el Domain Harness GEX interactivo según v5; Cognitive API queda diferida
```

El vertical slice demuestra que la arquitectura funciona sin AI.
El Harness demuestra que la arquitectura funciona con AI.
Ambos dependen de los contratos definidos aquí.
