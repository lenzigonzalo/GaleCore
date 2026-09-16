# Phase 3 — Alignment y primer incremento

**Fecha:** 2026-09-15
**Autorización:** el usuario pidió corregir los documentos y comenzar a corregir y encaminar la implementación después de la revisión arquitectónica.
**Estado:** cierre en revisión mediante `GC-AI-0001`; tests locales passing no sustituyen la evidencia E2E, evaluación cognitiva ni revisión independiente pendientes.

## 1. Resultado

Se conserva el runtime autónomo, se extrae su aceptación post-model a una función independiente y se fortalecen grounding y freshness. Los factories actuales consumen los assets YAML canónicos; no mantienen otra copia Python de las instrucciones. No se agregaron providers, un servidor, scheduling ni operaciones de trading.

## 2. Clasificación y dependencias

| Archivos / grupo | Responsabilidad y consumidor | Clasificación | Maturity | Acción |
|---|---|---|---|---|
| `config/agents`, `config/skills`, `config/protocols`, `config/conventions` | Conocimiento y configuración consumidos por factories/loaders; host-native pendiente | COGNITIVE_ASSET | CURRENT_IMPLEMENTED | keep |
| `agents/trading_agent.py`, `skills/gex_analysis/skill.py`, `protocols/facts_discipline.py`, `conventions/trading_defaults.py` | Wrappers de compatibilidad que cargan YAML | COGNITIVE_ASSET | CURRENT_IMPLEMENTED | keep |
| `harness/assets.py`, `definitions.py`, loaders y convention resolver | Lectura, schemas y hash de definiciones | CORE_ASSURANCE | CURRENT_IMPLEMENTED | keep |
| `application/validate_interpretation.py` | Schema, grounding y aceptación; consumido por runtime o import Python | CORE_ASSURANCE | CURRENT_VALIDATED (tests locales) | keep |
| `harness/guardrails.py`, `freshness.py`, `preflight.py` | Controles determinísticos; facts/metadata son responsabilidad del caller | CORE_ASSURANCE | CURRENT_IMPLEMENTED | keep |
| `contracts/` y `models/validation.py` | Contratos y comprobaciones de salida; el nombre models no implica dependencia de un provider | CORE_ASSURANCE | CURRENT_IMPLEMENTED | keep; move later sólo si aporta valor |
| `capabilities/` | Registry, dispatcher, DTO y mapping; depende de GaleCore por HTTP | GALECORE_INTEGRATION | CURRENT_IMPLEMENTED | keep |
| `application/analyze_gex.py` | Fetch, mapping/freshness y coordinación con runtime; sigue mezclando preparación y ejecución | AUTONOMOUS_RUNTIME | CURRENT_IMPLEMENTED | refactor later para reutilizar preparación |
| `harness/runtime.py` | Modelo, contexto y trace; delega aceptación | AUTONOMOUS_RUNTIME | CURRENT_IMPLEMENTED | freeze salvo correcciones y extracción |
| `harness/context_assembler.py` | Ensamblado de contexto; todavía usa ModelMessage | AUTONOMOUS_RUNTIME | CURRENT_IMPLEMENTED | refactor later si el adapter lo necesita |
| `models/provider.py`, `gateway.py`, `errors.py`, `providers/` | Contratos/adapters de ejecución de modelo | AUTONOMOUS_RUNTIME | CURRENT_IMPLEMENTED | freeze |
| `api/` | FastAPI y wiring del camino autónomo | AUTONOMOUS_RUNTIME | CURRENT_IMPLEMENTED | freeze |
| `tests/` | Regresiones, contratos y escenarios con mocks/FakeProvider | TEST_OR_EVAL | CURRENT_VALIDATED (suite local) | keep y ampliar por riesgos concretos |
| `docs/architecture/` | Decisiones y estado | DOCUMENTATION | CURRENT_IMPLEMENTED | keep |
| `docs/LOCAL-VALIDATION-GEX-SPY.md` | Guía del adapter autónomo | DOCUMENTATION | CURRENT_IMPLEMENTED | mantener claramente separada del futuro E2E interactivo |
| `adapters/cli.py`, `adapters/snapshot_store.py`, `application/prepare_gex.py`, `application/accept_interpretation.py`, `CLAUDE.md` | Entrada host-native: prepare → interpretación externa → accept, con store local y trace | HOST_ADAPTER | CURRENT_IMPLEMENTED (E2E en `docs/evidence/increment4-e2e/`) | keep; cerrar sólo con AC-09 |

Las rutas de código en esta tabla son relativas a `src/galecore_ai/`. Los `__init__.py` sólo empaquetan sus respectivos módulos. No se movieron carpetas.

Flujo actual:

```text
FastAPI → AnalyzeGexUseCase
  → dispatcher REST → GaleCore
  → parse DTO → map GexFacts → freshness inicial
  → CognitiveRuntime
      → preflight → assets/context → ModelProvider
      → validate_interpretation(payload que se devolverá)
          → schema → todas las EvidenceRef locales → números → signo GEX
      → resultado + trace (hash de definiciones efectivas)
  → freshness al aceptar → resultado final
```

## 3. Garantías y límites del incremento

Implementado:

- Una referencia inválida rechaza la salida completa; no existe rescate por coincidencias textuales.
- Cada claim numérico se valida contra el valor escalar de su referencia. Claims con varios valores deben dividirse en referencias separadas.
- Los números 0, 1 y 100 también necesitan soporte; no hay excepción universal.
- El payload aceptado se revalida con el schema; un raw_text diferente del provider no puede certificar otro objeto.
- Positive/negative_gamma no puede contradecir el signo de net_gex. `near_zero` se rechaza siempre (escalas incompatibles entre call/put_gex y net_gex).
- Los números interpretativos van en `quantitative_claims` con `GexMetric`/`GexUnit` cerrados; el validador deriva el fact_path desde `metric` y exige igualdad exacta con el fact. Cualquier dígito en observations/implications rechaza el output.
- `conventions_hash` liga los valores resueltos al snapshot; acceptance lo recomputa y no continúa con validación cognitiva si no coincide.
- Un timestamp demasiado futuro se rechaza (tolerancia actual: cinco segundos); los datos que vencen durante la generación no producen SUCCESS.
- Los hashes del trace representan las definiciones cargadas efectivamente, incluidos overrides explícitos del runtime.

Límites:

- `validate_interpretation` devuelve aceptación, payload o null, checks y errores. No obtiene facts, no autentica su origen, no invoca un modelo y no persiste el trace. El runtime incorpora sus checks al TraceRecord existente.
- El caller debe validar facts y freshness. La función interna no es todavía el servicio completo de sesión/snapshot del host interactivo.
- Los claims en prosa no tienen una prueba general de significado. `EvidenceRef` valida que el path exista y sea escalar; no prueba entailment semántico de claims cualitativos ni de afirmaciones causales.
- La detección de números en prosa es un regex determinístico (enteros, negativos, decimales, porcentajes, notación científica). Números escritos con palabras no se detectan.
- Near-zero: la fórmula de magnitud se eliminó por ser dimensionalmente inválida (call/put_gex en millones, net_gex en billones). El regime se rechaza fail-closed; el YAML se preserva como intención hasta que existan facts normalizados o metadata de unidades en GaleCore.
- YAML y factories están verificados desde el checkout y empaquetados en el wheel (`python -m build --wheel`, 5 assets byte-idénticos a `config/`, verificado 2026-09-16 en Increment 4).
- El host externo aún no carga estos assets automáticamente. Un hash de definición no prueba obediencia del modelo.

## 4. Frontera y adapter (histórico: propuesta previa a Increment 3; hoy implementada como CLI JSON, ver §1)

Propuesta concreta:

```text
prepare: solicitud → integración controlada → snapshot inmutable identificado
         + assets efectivos + schema de interpretación
accept:  run_id + interpretación externa + metadata declarada del host
         → recuperar el mismo snapshot → freshness → assurance
         → resultado aceptado + trace
```

Conservar el snapshot original; no volver a consultar datos live para comparar valores. Un hash detecta cambios de contenido, pero no autentica datos entregados por el host. La procedencia debe distinguir GALECORE_VERIFIED, VALIDATOR_OBSERVED, HOST_DECLARED y UNKNOWN. El mecanismo local de conservación/protección del snapshot debe quedar explícito antes de afirmar verificación independiente.

| Adapter | Ventaja para este vertical | Costo o límite | Decisión |
|---|---|---|---|
| Direct import Python | Ideal para tests y consumidores Python | No conecta por sí solo una sesión externa | Ya disponible para aceptación |
| CLI JSON stdin/stdout | Sin servicio persistente; fácil de inspeccionar localmente | Requiere snapshot entre invocaciones y tratamiento explícito de errores | **Implementada** (`adapters/cli.py`, store local) |
| HTTP | Servicio compartido y acceso remoto | Proceso, lifecycle, auth y despliegue | Diferido |
| MCP | Descubrimiento e invocación como tool | Integración y configuración adicional del host | Evaluar cuando haga falta |

`python -c` crea un subprocess; no debe llamarse integración in-process.

## 5. Plan de E2E y evaluación (histórico)

> Sección conservada como registro. Todos los archivos listados existen y están validados; el E2E vigente es `docs/evidence/increment4-e2e/`. La evaluación cognitiva (AC-06) sigue BLOCKED.

Archivos propuestos en su momento para el siguiente incremento:

- `application/prepare_gex.py`: preparación de facts reutilizando dispatcher y mapper.
- `contracts/prepared_analysis.py`: snapshot identificado y contexto de aceptación.
- `adapters/cli.py`: preparar y aceptar mediante JSON.
- Una única entrada host-native que referencie assets canónicos, sin duplicarlos.
- `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`: comandos exactos después de implementar y verificar el adapter.

Secuencia: host real → preparar SPY con GaleCore real → cargar assets → interpretación estructurada → aceptar contra snapshot → presentar artefacto aceptado. Evidencia mínima: inputs/snapshot, identificadores y hashes, timestamps, output, checks, trace y mecanismo de carga de assets. No afirmar provider/model/token usage como verificados si los declara el host.

Negativos obligatorios: facts faltantes, expirados o futuros; referencia inexistente; mezcla de referencias válidas e inválidas; valor de otro campo; signo contradictorio; output malformado; snapshot cambiado. Cada rechazo debe tener `result=null`.

Después del E2E: pequeña comparación con/sin assets sobre los mismos snapshots, midiendo fidelidad, limitaciones, exageraciones, utilidad y correcciones humanas. Un SUCCESS aislado prueba integración, no especialización ni rentabilidad.

## 6. Validación local realizada

```powershell
cd GaleCore-AI
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
```

Resultado (Increment 4, 2026-09-16): **434 tests passing**, ruff clean, wheel builds con los 5 assets. La suite incluye regresiones adversariales, tests de snapshot store, tests de CLI subprocess, tests de trust boundary/provenance, integridad de convenciones y contrato de claims cuantitativos. (Registro histórico: 274 tests al cierre de Increment 3.)

E2E interactivo reproducible (`tools/e2e_interactive_cases.py`) ejecutado el 2026-09-16 contra GaleCore en localhost:5000 con datos live de SPY: 1 caso positivo escrito por el host (Claude Code, HOST_DECLARED) y 21 negativos, todos con payload, stdout y exit code archivados en `docs/evidence/increment4-e2e/`. No se modificó GaleCore. (Histórico: 1 positivo + 13 negativos en `phase3-gex-interactive-e2e.md`, esquema anterior a Increment 4.)
