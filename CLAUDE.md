# GaleCore-AI

Harness de IA financiera sobre GaleCore: métodos (skills), agentes, perfil del trader, memoria con fuente,
validaciones y catálogo. No calcula hechos financieros ni consulta APIs externas por su cuenta: los datos vienen de
GaleCore. El objetivo, el catálogo de lo que el usuario puede pedir y el plan están en `../roadmap/README.md`; la forma
de trabajo en `../ENGINEERING.md`. Este archivo sólo dice cómo se usa y se prueba este repo.

```
GaleCore     = datos, cálculos, riesgo, SHADOW, monitor (verdad operativa)
GaleCore-AI  = método, criterio, memoria y validación determinística
Host         = ejecuta el modelo (hoy Claude Code)
```

## Antes de cambiar el repo

La pieza activa es la del `ACTIVE_WORK_ITEM` del workspace (el hook la muestra). Trabajá sólo en su alcance; el
implementer no marca su trabajo `VALIDATED` ni `CLOSED`. Antes de presentar una pieza como lista:
`python tools/engineering_gate.py`. Evidencia, revisión y estados: `../ENGINEERING.md` §1, §3, §9 y §12.

## Empezar por el trader y el catálogo

```bash
python -B -m galecore_ai.adapters.cli space context        # perfil, objetivos, convenciones, agentes (lo imprime el hook)
python -B -m galecore_ai.adapters.cli state                # estado ahora: entradas, instancias, posiciones, estructuras, datos
python -B -m galecore_ai.adapters.cli catalog --match "<pedido en palabras del usuario>"   # capacidad y su flujo
python -B -m galecore_ai.adapters.cli catalog              # todas: skill (versión+hash), contrato, flujo, controles
python -B -m galecore_ai.adapters.cli kb search --text "<términos>" [--kind ...] [--status unfinished]
python -B -m galecore_ai.adapters.cli kb show <ref>        # research:<id> · regime:SPY/<fecha> · profile:vN · feedback:<id>
python -B -m galecore_ai.adapters.cli profile show         # perfil vigente: aplicarlo y citarlo
python -B -m galecore_ai.adapters.cli project show strategy:<nombre>|portfolio
python -B -m galecore_ai.adapters.cli inbox add --text "<palabras textuales>"   # «anotá esto»
```

El usuario nunca tiene que nombrar una skill: elegí la capacidad con `catalog --match`, decí cuál usás y seguí su
`flow`; si ninguna sirve, ofrecé `capability_builder` en vez de improvisar. Antes de un trabajo nuevo, buscá
antecedentes con `kb search`. Cada capacidad, sus comandos y sus contratos: `docs/HOST-REFERENCE.md`.

**Cómo responder (owner, 11/10: «respuestas largas y complicadas»):** primero 3–5 líneas con la respuesta, qué
recomendás y por qué, y qué necesitás del trader. Después, sólo lo que sostiene esa respuesta, en una tabla si hay
números. Sin códigos internos (`VALID_WITH_DECLARED_GAPS`, ids de reglas como E3/R2, nombres de comandos, rutas,
commits): decí qué significan. El hash se muestra sólo cuando el trader tiene que aprobar. Lo que no se pudo
verificar va en una línea. El resto del detalle, si lo pide. No cierres con resumen de memoria ni de commits.

**Estado:** lo que digas del runtime (entradas, instancias, posiciones, estructuras que ejecuta) o de la salud de los
datos (conectividad, frescura, cobertura para valuar) sale de `state` en esa corrida, con su hora. Una investigación
o un seguimiento guardado es antecedente, nunca estado; lo que `state` no pudo leer es «sin verificar».

**«¿Dejo abiertas las posiciones antes de <evento>?»** (CPI, FOMC…): correr `supervise exposure [--symbol X] [--event
<texto>]` y citar sus montos tal cual (con stops / si hay gap / ganancia actual, por posición y sumado). Nunca calcular
a mano un peor caso. Proponer cerrar / rollear / dejar / esperar con las reglas de la estrategia y decir qué cambiaría
la propuesta; todo es SHADOW. Si `missing` trae algo, «faltan datos para decidir» y cuáles.

**Base de conocimiento:** `<workspace>/knowledge/` (fuera de los checkouts, git propio de datos;
`GALECORE_KNOWLEDGE_DIR` la cambia). Después de una sesión que la escribió, commitearla en ese git (local; nunca se
sube a GitHub).

## Entorno

La API Dev de GaleCore corre desde `../GaleCore` (`python dev/galecore_dev.py api`, `:7001`). La ApiKey nunca se
escribe en archivos.

```bash
export GALECORE_BASE_URL=http://localhost:7001   # en esta PC ya está en el entorno de usuario (HKCU), con la ApiKey
export GALECORE_API_KEY=<ApiKey de GaleCore>
export ALLOW_UNKNOWN_FRESHNESS=true   # PutSkew no trae timestamp
export MAX_STALENESS_SECONDS=36000    # registros diarios de régimen; 600 para GEX intradía
export GALECORE_TIMEOUT_SECONDS=300   # un GEX en frío puede pasar 120 s
```

Salida JSON; stdin se lee como UTF-8. Códigos: `0` éxito · `1` falla de prepare/registro/interna · `2` datos
insuficientes · `3` error de validación (también argumentos y `query` con un registro `INTEGRITY_FAILED`).

## Probar

```bash
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider          # suite completa; para un cambio acotado, los tests del área
python -B -m ruff check --no-cache .
python -B -m galecore_ai.adapters.cli catalog --check   # cada capacidad carga y su flujo existe
```

## Límites

- Nunca se inventan, reescalan ni redondean números de GaleCore; el payload aceptado es el límite del éxito y no se
  reformula.
- Una estrategia llega a SHADOW sólo con la aprobación del owner sobre el hash exacto, y sólo en GaleCore Dev. Nada
  envía órdenes reales ni toca producción.
- Ante «¿la activo / apruebo / espero?» de una versión sin aprobar: correr `strategy controls --ref <ref>` y `capital`,
  y decir primero `recomendar_aprobacion` con su `motivo` y cualquier límite de cartera fuera. Nunca proponer aprobar
  «si el crédito alcanza» cuando los controles no lo recomiendan: aprobar igual es decisión del owner, sabiéndolo.
- Sin secretos en código, logs, fixtures ni trazas. El runtime autónomo (FastAPI/CognitiveRuntime) está congelado.

## Referencia

- Uso desde el host, capacidad por capacidad: `docs/HOST-REFERENCE.md`
- Arquitectura: `docs/architecture/GaleCore-AI-arquitectura-v5.md` · contratos: `docs/architecture/P0-CONTRACTS.md`
- Guías de validación: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`, `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md`
- Visor de registros: `docs/LOCAL-REGIME-VIEWER.md`
- Backlog: `docs/architecture/PRODUCT-BACKLOG.md` · histórico (no se sigue): `docs/archive/`
