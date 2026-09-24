# Phase 4 — Alignment: harness completo desde el host con registro evaluable

**Fecha:** 2026-09-16
**Work item:** `GC-AI-0002` (`docs/engineering/work-items/`). Contrato aprobado por el product owner el 2026-09-16 con las decisiones D-1..D-5.
**Estado (2026-09-23):** código implementado y verificado en local (600 tests). Serie AC-08 **completa, 3/3**: 21, 22 y 23 de septiembre, post-cierre (F-2), cada día con prepare → interpretación → accept+record → outcome posterior → review del owner (`agree`, `partial`, `agree`) → query; E2E regenerada (16/16, F-8). Revisión interna 3 APPROVE y Codex recheck 3 **APPROVE** sobre la serie completa (`GC-AI-0002-20260923T213537Z.md`). **Pendiente:** solo la aprobación/cierre por el product owner. Decisiones del owner tomadas: D-6, F-2, F-6, F-7; abierta: F-9 (rotar la ApiKey de desarrollo). Phase 4 **no** está cerrada.

## 1. Resultado

El host (Claude Code) puede completar un caso de uso de punta a punta con el mismo adapter CLI de Phase 3: pedir datos (`prepare --skill regime`), interpretar, pedir persistencia (`accept --record`), dejar un registro evaluable (`GaleCore/research/regime/<SYMBOL>/<YYYY-MM-DD>.md`; desde GC-AI-0005, 2026-09-23, en `<workspace>/knowledge/regime/`), anotar qué pasó después (`record outcome`) y qué opinó el humano (`record review`), y consultarlo (`query`). No se agregó runtime autónomo, scheduler, provider ni base de datos. GaleCore no se tocó (UC-2 y UC-4 quedaron fuera por decisión D-1/D-2 porque requieren código en GaleCore).

## 2. Clasificación de lo nuevo

| Archivos (relativos a `src/galecore_ai/`) | Responsabilidad | Clasificación | Maturity |
|---|---|---|---|
| `config/skills/regime-analysis/skill.yaml` (repo) | Skill de régimen: instrucciones, contrato, ejemplo | COGNITIVE_ASSET | CURRENT_IMPLEMENTED |
| `config/agents/trading-agent.yaml` v1.1.0 (repo) | Agrega el skill y las capabilities `compute.put_skew`, `market_data.trade` | COGNITIVE_ASSET | CURRENT_IMPLEMENTED |
| `contracts/regime_analysis.py` | `RegimeFacts`, `RegimeInterpretation`, registro cerrado de métricas/unidades, `TailPricing` | CORE_ASSURANCE | CURRENT_IMPLEMENTED (tests adversariales) |
| `contracts/regime_record.py` | Documento/entrada del registro evaluable, `entry_hash` | CORE_ASSURANCE | CURRENT_IMPLEMENTED |
| `contracts/prepared_analysis.py` (+`skill_id`, `capability_traces`, `snapshot_hash`) | El snapshot declara para qué skill se preparó y todas las capabilities invocadas; `snapshot_hash` sella skill, ventana de freshness, assets y capabilities (Codex B1); un snapshot sin sello se rechaza al aceptar | CORE_ASSURANCE | CURRENT_IMPLEMENTED |
| `capabilities/galecore_dtos.py` (+PutSkew, Trade), `capabilities/regime_mapper.py`, `capabilities/contracts.py`, `capabilities/dispatcher.py` | DTOs fieles a GaleCore, mapping sin recálculo, dos capabilities nuevas y sus rutas | GALECORE_INTEGRATION | CURRENT_IMPLEMENTED (fixtures reales) |
| `application/prepare_regime.py` | Fetch concurrente de 4 fuentes, freshness por fuente, snapshot; `fetch_regime_facts` reutilizado por `record outcome` | HOST_ADAPTER | CURRENT_IMPLEMENTED (E2E P0) |
| `application/accept_interpretation.py`, `application/validate_interpretation.py` | Despacho por `skill_id`; checks estructurales `tail_pricing_level` y claims por registro | CORE_ASSURANCE | CURRENT_IMPLEMENTED (E2E P1, N03–N08) |
| `application/record_regime.py`, `adapters/record_store.py` | Registro evaluable con el frontmatter YAML como documento autoritativo (AC-03 literal): escritura sólo desde un SUCCESS del mismo proceso, outcome/review anexados (outcome rechaza STALE), query con integridad | HOST_ADAPTER | CURRENT_IMPLEMENTED (tests; E2E y corrida manual a regenerar el próximo día de mercado, F-8) |
| `adapters/cli.py` | `prepare --skill`, `accept --record --prompt`, `record outcome|review`, `query` | HOST_ADAPTER | CURRENT_IMPLEMENTED |
| `adapters/asset_manifest.py` | Selección de skills por vertical; el manifiesto lista sólo los skills cargados | CORE_ASSURANCE | CURRENT_IMPLEMENTED |
| `harness/guardrails.py` | Excepción descriptiva ampliada a formas con guion (`short-gamma`); igualdad numérica exacta en texto (Codex B3); patrones bullish/bearish position y posición alcista/bajista (Codex B2) | CORE_ASSURANCE | CURRENT_IMPLEMENTED (tests EN+ES) |
| `tools/e2e_regime_cases.py`, `tools/engineering_gate.py`, `tools/verify_wheel_assets.py` | Runner E2E en dos fases (todo en dirs temporales); gate consciente de la fase del item activo; verificación reproducible del wheel | TEST_OR_EVAL | CURRENT_IMPLEMENTED |

Flujo:

```text
host → cli prepare --skill regime
  → dispatcher REST ×4 (gex, put_skew, trade VIX, trade VVIX) → GaleCore
  → parse DTOs → GexFacts + RegimeFacts (freshness por fuente) → snapshot (skill_id, 4 traces)
host → interpreta → cli accept --record --prompt
  → snapshot por run_id → integridad → freshness → RegimeInterpretation → guardrails + checks estructurales
  → SUCCESS → record_accepted → research/regime/<SYM>/<día>.md (entry_hash)
host (después) → cli record outcome → fetch ×4 → outcomes[] · cli record review → human_reviews[]
host → cli query → JSON (OK | INTEGRITY_FAILED)
```

## 3. Invariantes

- Fail-closed en cada frontera: fuente faltante/stale, contrato no cumplido, run no aceptado, archivo no confiable.
- El registro sólo se escribe desde `accept --record` con un `SUCCESS` del mismo proceso; no existe un comando que acepte un payload "ya aceptado" desde afuera.
- Lo escrito al aceptar queda bajo `entry_hash`; outcome y review se anexan fuera del hash y nunca lo tocan.
- Provenance explícita: facts `GALECORE_VERIFIED`; host `HOST_DECLARED`; checks `VALIDATOR_OBSERVED`.
- El validador no calcula ni umbraliza: `gamma_regime` es signo de `net_gex`; `tail_pricing` es el semáforo `levelOk` de GaleCore.
- Sin secretos ni logs crudos en registros, evidencia, fixtures o docs.

## 4. Límites reales

- PutSkew no publica timestamp: el snapshot de régimen es `UNKNOWN` en el mejor caso (`ALLOW_UNKNOWN_FRESHNESS=true` obligatorio). Los estados por fuente quedan visibles.
- Fuera de sesión, VIX/VVIX son prints de horas atrás (VVIX sin print pre-market) y GaleCore sella el GEX con la hora de cálculo: `MAX_STALENESS_SECONDS` amplio o `prepare` falla (caso `N01`, corrida manual). Ampliar la ventana desactiva el guard de los índices: decisión del owner (F-2).
- El GEX en frío puede tardar más de 120 s.
- El entailment semántico de la prosa no se verifica (el E2E mostró que el host debe leer bien si spot está arriba o abajo del zero-gamma).
- La frontera del archivo es cooperativa: los hashes detectan ediciones, no las impiden.
- Historia de GEX (UC-2) y macro/ValidationLayer (UC-4) requieren GaleCore: fuera de este item.

## 5. Gaps de v5 §13.4 que este incremento mueve

- "producir trace no equivale a persistirlo durablemente": ahora hay persistencia evaluable (markdown + JSON + git), no una plataforma de retención.
- "el flujo interactivo con snapshot y provenance": extendido a un skill multi-fuente con provenance por fuente.
- Decisión abierta v5 §21.7 (persistencia y retención de traces): resuelta para este caso como registro por día y símbolo en el repo de research de GaleCore; base de datos sólo cuando la consulta lo pida (roadmap).
