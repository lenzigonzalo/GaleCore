# GaleCore-AI — Session Handoff

**Fecha:** 2026-09-16
**Estado:** feature freeze activo; cierre de Phase 3 bajo revisión independiente en `GC-AI-0001`.
**Fuente operativa:** `docs/engineering/ACTIVE_WORK_ITEM`. Las declaraciones históricas de cierre deben revalidarse contra su matriz de evidencia.

## 1. Autorización y alcance

Después de la revisión del repositorio, el usuario pidió corregir la documentación y empezar a corregir y encaminar lo implementado. Esa autorización reemplaza la pausa read-only del handoff anterior para este alcance. No reintroducir esa pausa como requisito de aprobación ya satisfecho.

El vertical sigue siendo “Analizá el GEX actual de SPY”, read-only. No implementar Strategy Development, ActionProposal, SHADOW/PAPER/LIVE, scheduling, nuevos providers o una plataforma general de agentes. No modificar GaleCore ni hacer commit sin una instrucción correspondiente.

## 2. Lectura y precedencia

1. `GaleCore-AI-arquitectura-v5.md`.
2. `PHASE3-ALIGNMENT.md`.
3. `P0-CONTRACTS.md`, donde no contradiga v5.
4. `ARCHITECTURE-EXECUTIVE-SUMMARY.md`.
5. Código y tests de los archivos enumerados en el alignment.

El caso Strategy Development es dirección futura diferida. `docs/LOCAL-VALIDATION-GEX-SPY.md` describe el adapter autónomo, no el E2E interactivo.

## 3. Cambios realizados

- `application.validate_interpretation`: aceptación determinística independiente de providers, API y host; el runtime existente la reutiliza.
- Validación de todas las referencias locales, sin fallback textual. Los números de cada claim deben corresponder a su fact escalar.
- El objeto devuelto es el mismo payload validado, aunque un provider entregue un raw_text diferente.
- Rechazo de timestamps futuros fuera de tolerancia y nueva comprobación de freshness al aceptar la salida del modelo.
- Factories de Agent/Skill/Protocol/Conventions cargan YAML canónico. Las definiciones efectivas tienen hashes en trace.
- Tests adversariales de rechazos obligatorios. Consultar el alignment para los comandos de validación y límites.

## 4. Incremento completado (2026-09-16)

Todos los puntos del incremento anterior fueron implementados y verificados:

1. **Snapshot store interno**: `FileSnapshotStore` conserva el snapshot autoritative en `$TEMP/galecore-ai/snapshots/`. El host recibe solo `PreparedAnalysisView` (sin poder modificar facts ni hashes).
2. **CLAUDE.md**: entrada host-native que referencia assets canónicos, schema de output y el flujo prepare/interpret/accept/present.
3. **CLI JSON adapter**: `python -m galecore_ai.adapters.cli prepare|accept` con salida siempre JSON y exit codes determinísticos (0/1/2/3).
4. **Accept con store**: recupera snapshot por run_id, revalida freshness con reloj interno, produce trace con provenance explícita (`HOST_DECLARED`, `validator_called_model=false`, `host_model_execution=HOST_DECLARED`).
5. **E2E real**: histórico de este incremento, 1 positivo + 10 negativos con el esquema anterior. Vigente (Increment 4, 2026-09-16): 1 positivo escrito por el host + 21 negativos, reproducibles con `tools/e2e_interactive_cases.py`, en `docs/evidence/increment4-e2e/`.
6. **Trust boundary**: el host no puede reemplazar el snapshot ni inyectar provenance mediante el contrato `accept`; `accepted_at` es interno. El store local en `$TEMP` es un MVP para un host cooperativo — un proceso con acceso al mismo usuario del OS puede modificar los archivos directamente. El hash detecta cambios accidentales pero no autentica origen. Una frontera más fuerte requiere proceso separado, principal diferente, o firma con clave inaccesible al host.
7. **Trace completa**: la traza de aceptación registra run_id, facts_hash, conventions_hash, prepared_at, accepted_at (interno), facts_provenance (GALECORE_VERIFIED), asset IDs/versiones/hashes efectivos, capability trace, freshness (STALE/FUTURE/UNKNOWN/INVALID_POLICY según lo observado), `snapshot_lookup`/`snapshot_integrity` y los guardrails cognitivos. Un rechazo temprano registra las etapas alcanzadas, no inventa las que no corrieron.
8. **Guardrails**: `no_invented_numbers`, `facts_match_source`, `no_trading_recommendation` (pattern-based, con limitaciones documentadas), `gex_regime_sign`. Limitaciones min_length=1 enforced por schema.

## 5. Pendientes y límites

- Near-zero se rechaza siempre (Increment 4, D1): las escalas de call/put_gex y net_gex son incompatibles. El YAML queda como intención inerte.
- La adquisición de GEX no informa versiones autoritativas de schema/calculation/methodology de GaleCore.
- No se ha demostrado persistencia durable de traces (el store es efímero en `$TEMP`).
- Claims en prosa no tienen prueba general de significado semántico.
- `from_cache: false` no garantiza que el dato sea live (caching interno de GaleCore es opaco).

Mantener secretos fuera de código, logs, fixtures, docs y traces. Una credencial expuesta en sesiones anteriores se considera comprometida: no recuperarla ni reutilizarla.

## 6. Backlog persistente

`PRODUCT-BACKLOG.md` conserva trabajo acordado posterior al incremento actual. En particular,
`BL-001` define la dirección para bundles declarativos de Skills, lifecycle basado en evidencia,
drafts, evals, revisión humana y experiencia de administración. No implementarlo durante el cierre
de Phase 3; actualizar su estado cuando se cumpla el entry gate.
