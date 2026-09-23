# GaleCore-AI — Session Handoff

**Fecha:** 2026-09-16
**Estado (2026-09-23):** Phase 3 cerrada (`GC-AI-0001` CLOSED el 2026-09-16). Phase 4: `GC-AI-0002` — "Harness completo desde el host con registro evaluable" — con **todos los criterios evidenciados**: serie AC-08 en 3/3 (21, 22 y 23 de septiembre, reviews del owner `agree`/`partial`/`agree`), revisión interna 3 APPROVE y Codex recheck 3 APPROVE (`GC-AI-0002-20260923T213537Z.md`). **Solo falta la decisión del owner** (`VALIDATED`/`CLOSED`); APPROVE no cierra. Ver "Próxima sesión" más abajo, `PHASE4-ALIGNMENT.md` y el work item.
**Fuente operativa:** `docs/engineering/ACTIVE_WORK_ITEM`. Las declaraciones históricas de cierre deben revalidarse contra su matriz de evidencia.

## Próxima sesión — después del 2026-09-23

**Serie AC-08 completa y revisada.** `GC-AI-0002` no tiene criterios abiertos; lo único pendiente
es la **decisión del owner** sobre el cierre (`VALIDATED`/`CLOSED`). Si la toma, el implementer la
transcribe al work item y, recién entonces, crea el tag `phase4-closed` (política de tags de
`ENGINEERING.md`). Después, según `roadmap/REALINEACION-2026-09-21.md`: rebase de GC-AI-0004 /
GC-0001 sobre el `feature/gc-ai-0002` final y paso 2 (consolidar estado) → paso 3 (SHADOW).

**No cambiar el corte de datos** de la skill de régimen sin pasar por `BL-011`: los registros de la
serie son comparables entre sí porque comparten corte.

### Jornada 3 (2026-09-23), lo que pasó

- Registro `SPY/2026-09-23.md`: negative_gamma / calm, 8 checks OK, dos outcomes (el primero a
  ~7 min por pedido del owner, que pegó en el cache de 600 s del GEX; el segundo a ~31 min) y review
  del owner `agree` / "Está ok". Evidencia `day4-*`, desviaciones en el README.
- El owner cuestionó la magnitud de `net_gex` (−822.1) contra Unusual Whales y el front (−280 B,
  sin reproducir). Hallazgos ruteados: escala ×100 vs la convención por 1 % → `BL-002`; 0DTE
  vencido dentro de la lectura post-cierre → `BL-011`.
- A pedido del owner: `ENGINEERING.md` §1 ahora dice dónde va lo que surge trabajando, y la skill
  `/donde-va` lo aplica (workspace `779c3ab`; nota en `BL-009`).
- Reviews: interno 3 APPROVE (MINORs corregidos en `f5e9747`); Codex recheck 3 APPROVE
  (`GC-AI-0002-20260923T213537Z.md`), único MINOR (estas líneas de estado) corregido.
- Commits locales, sin push: GaleCore-AI `c039be9`, `72f1dd9`, `f5e9747` y el de estado/reviews;
  GaleCore `229e145` (registro); workspace `779c3ab`.
- Permisos: el allowlist de `.claude/settings.local.json` se amplió (git add/commit/-C, until, cd,
  ls, grep, date) porque los prompts cortaban el loop; el push sigue bloqueado por `guard_git`.

### Estado al terminar el 2026-09-22

Serie AC-08 en **2/3**. Todos los commits son **locales, sin push**, en los tres repos:

| Repo | Rama | Commits del día |
|---|---|---|
| GaleCore-AI | `feature/gc-ai-0002` | `fc3e7df` jornada 22 (pasos 1-6) · `fb8549c` review `partial` + query final · `a346f42` BL-009/010/011 · `6d4dbb0` restricción del store de datos vivos |
| GaleCore | `feature/pcs-spy-shadow-runtime` | `100cc5b` los tres registros de régimen entran a git |
| workspace | `main` | `23cec3c` ENGINEERING.md: cómo se escribe el diff + trabajo local y reunificación |

Registros de la serie, con su veredicto humano:

| Fecha | Régimen | Outcome | Review del owner |
|---|---|---|---|
| 2026-09-17 | negative_gamma / calm | — | — (historia marcada, F-7, no cuenta) |
| 2026-09-21 | positive_gamma / calm | sí | `agree` |
| 2026-09-22 | positive_gamma / calm | sí | **`partial`** |

**Por qué el `partial` del 22, que importa más que el registro mismo:** la interpretación aceptada
trata los call/put walls como referencias de cobertura cuyos niveles cambiarían el comportamiento
de los dealers. La investigación propia de GaleCore tiene medido lo contrario (`research/got` §61.4
y los campos en prosa de `galecore_rules_gex.json`): el wall es un argmax sobre un solo strike que
nunca junta más del 19 % del |GEX| de su lado, salta intradía, y sobre 926 observaciones de
SPY/QQQ/IWM 2013-2025 su borde se comporta como cualquier strike del mismo delta. **Los ocho checks
la dejaron pasar en verde**, correctamente: los números eran exactos y no había recomendación de
trading. Es el caso concreto de la brecha declarada — el entailment no se chequea — y del review
humano como único mecanismo que la detecta. De ahí salieron `BL-010` (procedencia de hechos) y
`BL-011` (recetas de corte).

### Decisiones del owner pendientes

- **F-9 (higiene):** rotar la `ApiKey` de desarrollo de GaleCore, citada literal en dos reviews
  inmutables de GC-AI-0001. Recomendación: hacerlo **después** de cerrar la serie, porque obliga a
  reiniciar GaleCore y el `prepare` del día 3 lo necesita levantado.
- **ADR de taxonomía (`BL-009`):** dónde vive cada tipo de conocimiento ahora que los dos repos
  coexisten. Criterio acordado el 22: lo que no corre en producción no tiene por qué vivir en
  GaleCore; lo que hoy está ahí es historia, no diseño. Debe resolver además dónde vive un **store
  de datos generados** — ver la restricción registrada en BL-009.
- **Conjunto inicial de recetas (`BL-011`).** Conviene decidirlo antes de que la serie crezca.

### Otros frentes abiertos (no tocar sin pedido)

- **Runtime SHADOW en GaleCore:** 32 archivos untracked y 4 modificados (282 inserciones, 0
  borrados: puramente aditivo). Pendiente commitear por tema en ramas locales. `origin/master` no
  se movió desde el 2026-09-04, así que no hay divergencia entrante.
- **GC-AI-0003 / GC-AI-0004 / GC-0001** (visor de régimen y pestaña Inteligencia): APPROVE interno
  y Codex; faltaba el recheck de Codex que abortó por límite de cuota, y la decisión del owner.
  **El 2026-09-22 el owner autorizó correr los dos rechecks** (GC-AI-0004 en `b7f76b9`, GC-0001 en
  `d05a87c`), así que puede que ya estén hechos. **No autorizó el rebase**: se hace una sola vez,
  después de cerrar la serie, sobre el `feature/gc-ai-0002` final. Motivo: el solapamiento de
  archivos entre las dos ramas es cero (GC-AI-0002 tocó `cli.py`, `record_regime.py` y su test;
  GC-AI-0004 toca `record_store.py` y archivos nuevos), así que rebasar antes no cambia nada de lo
  que Codex revisa, y cada rebase reescribe SHAs e invalida el rango declarado del review.
- **Prioridad de cuota de Codex:** si está justa, el recheck de `GC-AI-0002` va primero — es lo
  único que bloquea el DoD del item activo.

### Quirks del entorno

- El hook `guard_git` rechaza un commit si hay un `cd` antes del `git`, si hay más de un `-C`, o si
  el comando es compuesto. Usar un `git -C <path> commit` plano, con el `add` en un comando aparte.
- `core.autocrlf = true` en GaleCore y no hay `.gitattributes`. **Verificado el 22** que la
  conversión a CRLF no rompe el `entry_hash` de los registros: se calcula sobre el YAML parseado,
  no sobre los bytes. No hace falta cambiar nada.

## 1. Autorización y alcance

Después de la revisión del repositorio, el usuario pidió corregir la documentación y empezar a corregir y encaminar lo implementado. Esa autorización reemplaza la pausa read-only del handoff anterior para este alcance. No reintroducir esa pausa como requisito de aprobación ya satisfecho.

Los verticales son “Analizá el GEX actual de SPY” (Phase 3) y “Analizá el régimen de hoy de SPY y guardalo” (Phase 4), ambos read-only. No implementar Strategy Development, ActionProposal, SHADOW/PAPER/LIVE, scheduling, nuevos providers o una plataforma general de agentes. No modificar GaleCore ni hacer commit sin una instrucción correspondiente.

## 2. Lectura y precedencia

1. `GaleCore-AI-arquitectura-v5.md`.
2. `PHASE3-ALIGNMENT.md` y `PHASE4-ALIGNMENT.md`.
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
