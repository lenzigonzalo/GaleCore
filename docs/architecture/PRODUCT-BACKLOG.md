# GaleCore-AI — Product and Architecture Backlog

Este documento conserva trabajo acordado que no pertenece al incremento actual. No reemplaza
la arquitectura ni autoriza implementación anticipada.

## Cómo gestionar este backlog

Cada ítem usa:

- **ID estable** para poder citarlo desde handoffs, commits y propuestas;
- **estado**: `CAPTURED`, `READY_FOR_DESIGN`, `READY_FOR_IMPLEMENTATION`, `IN_PROGRESS`,
  `VALIDATED` o `CANCELLED`;
- **target** orientativo, sin convertirlo en una fecha comprometida;
- **encaje con la implementación actual**: lectura no bloqueante de componentes reutilizables,
  fundaciones nuevas justificadas, primer vertical, adopción/migración, compatibilidad e invariantes;
- **entry gate** que indica cuándo corresponde comenzar;
- **acceptance criteria** para evitar cerrar el ítem sólo porque existen archivos nuevos.

Los handoffs deben mencionar los ítems que cambien de estado. Una conversación puede producir
evidencia o una propuesta, pero no cambia silenciosamente una Skill publicada.

El encaje no es un veto a ideas nuevas. Sirve para distinguir una evolución, una fundación nueva
escalable, una dependencia y una tensión real con el plan. No se debe deformar una buena propuesta
para reutilizar código existente, ni esconder una reescritura bajo lenguaje de evolución.

---

## BL-001 — Skill bundles, lifecycle y experiencia de evolución

**Estado:** `CAPTURED`

**Addendum 2026-09-24 — generador de estrategias acordado por el owner:** se confirma la skill de
desarrollo de estrategias ya prevista en el plan, I4. Su piloto y secuencia viven en
[`roadmap/README.md`](../../../roadmap/README.md), sección I4. Es una capacidad de producto sobre
el catálogo, conocimiento y host existentes; no requiere activar toda la plataforma de evolución
de BL-001 ni crear un agente autónomo. I3 sigue activo. Referencias externas se evaluarán por método,
licencia, datos, dependencias y resultados antes de adoptarlas; no hay instalación ni validación
de una skill externa por este acuerdo. No se abre otro BL para duplicar I4.

**Target:** Phase 4 — Broader read-only intelligence, después de cerrar y evaluar el vertical
GEX de Phase 3.

**Objetivo:** convertir Skills, Protocols, Conventions, ejemplos y evals en assets declarativos
versionados que puedan crearse y evolucionar a partir de evidencia, con revisión humana y sin
automodificación silenciosa.

### Aclaración del owner 2026-09-27: crear capacidades desde la conversación

El valor de GaleCore-AI incluye guiar al usuario para convertir una necesidad en una capacidad
reutilizable y gestionable desde el host. No alcanza con ofrecer un catálogo de Skills ya escritas.
Esto es una experiencia de producto, además de una herramienta para desarrollar el sistema.

Dos recorridos concretos definen la necesidad:

1. Idea de estrategia → formalización según objetivos → datos y pruebas → misma estrategia
   aprobada y ejecutada en SHADOW → seguimiento → creación y gestión conversacional de una tarea
   recurrente → historial persistente consultable para revisión retrospectiva.
2. Análisis macro transversal al portfolio → selección informada de GaleCore, FRED, FMP y
   Alpha Vantage según disponibilidad real → informe con evidencia → guardar el método como
   Skill reutilizable → proponer mejoras → producir artifacts visibles en la interfaz del host.

El sistema debe poder sugerir estas posibilidades y guiar su creación. Guardar un informe no
equivale a crear una Skill; una Skill define un método, un artifact es un resultado y una tarea
recurrente necesita ejecución efectiva además de instrucciones. La recurrencia debe permitir
consultar estado e historial, modificar frecuencia, pausar y cancelar desde la conversación.
Cada ejecución debe identificar la versión del método y, cuando corresponda, la estrategia
canónica evaluada. Ninguna tarea de seguimiento implica autorización para cambiar la estrategia
o ejecutar operaciones reales.

**Estado observado:** el catálogo de GC-AI-0008 contiene `gex_interpretation`,
`regime_interpretation`, `research`, `context_research`, `strategy_design` y `strategy_followup`.
Eso aporta piezas del recorrido; no demuestra creación conversacional de Skills, scheduling,
gestión de tareas recurrentes ni presentación integrada de artifacts. La memoria de `knowledge/`
no demuestra por sí sola una base histórica de ejecuciones consultable para este uso.

**Encaje:** ampliar BL-001 para creación y evolución de métodos; relacionar BL-005 para artifacts
y BL-008 para agentes/tareas recurrentes y contexto del usuario. El primer incremento puede
reutilizar mecanismos del host o un scheduler existente, previa verificación de sus capacidades
y límites; no presupone construir una plataforma general ni una interfaz nueva. Un candidato
concreto es el seguimiento recurrente de la misma estrategia de GC-AI-0008, con resultado
persistente, recuperación en otra sesión y controles de pausa/cancelación demostrados.

Esta aclaración registra una necesidad central del producto. Los targets históricos de este
ítem no sustituyen la secuencia vigente en `roadmap/README.md`; la próxima entrega debe ubicarse
allí explícitamente. Este registro no cambia `ACTIVE_WORK_ITEM` ni declara implementadas o
validadas estas capacidades.

### Addendum 2026-09-28 — harness que amplía capacidades y aprende del uso

**Origen:** el owner pide entender y tradear mejor, hacer más rápido el trabajo, crear skills y
agentes desde la conversación, unificar su descubrimiento y rutear modelos/agentes según el pedido.
**Clasificación:** `BACKLOG_CANDIDATE`, `ALIGNED_WITH_PREREQUISITE`. Amplía BL-001; relaciona BL-006
(herramientas/host) y BL-008 (delegación y preferencias). El informe de producto vive en
`roadmap/README.md` §1; la secuencia §4 conserva la prioridad y no cambia el item activo.

**Base inspeccionada:** catálogo y métodos en el checkout GC-AI-0009 (`config/catalog.yaml`),
registros de investigación/seguimiento y `.claude/agents/{reviewer,handoff}.md` del workspace.
Estos últimos son agentes de ingeniería: no demuestran creación conversacional de agentes
financieros ni routing automático de producto. La recurrencia actual sólo ejecuta `strategy_followup`.

**Primer recorrido candidato:** un análisis útil → método versionado y descubrible → nueva ejecución
desde otra sesión → feedback asociado al resultado → mejora propuesta y probada contra el caso
anterior. Si el trabajo requiere delegación, definir un agente con objetivo, skills, herramientas,
salida y límites, usando las capacidades reales del host. Selección de modelo sólo cuando el host
la permita, con motivo y consumo disponible registrados; no inventar ahorro ni construir otro host.

**Entry gate:** caso real elegido, capacidades de delegación/modelos del host verificadas y entrega
ubicada en la secuencia. **Aceptación:** el trabajo se recupera y reutiliza sin reconstruir instrucciones;
el método/agente utilizado queda identificado; feedback y resultados sustentan una revisión explícita.
No hay autopublicación silenciosa de mejoras, migración de skills existentes ni plataforma universal
como prerrequisito. El alcance semanal no incluye automáticamente toda esta evolución.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE`.

La base existente ya incluye assets YAML/Markdown canónicos, loaders, schemas Pydantic, hashes,
wrappers Python, evals y packaging verificado. El primer incremento no crea un registry o CMS: usa
`gex-analysis` y una segunda Skill read-only real sobre los loaders actuales para descubrir qué
parte del bundle necesita generalizarse.

El refactor admisible es eliminar una factory específica sólo después de que dos Skills diferentes
usen el mismo camino declarativo. La ubicación `config/skills/`, los consumers actuales y los hashes
de traces se preservan hasta demostrar una migración compatible.

**Invariante anti-rewrite:** evolucionar el bundle desde los assets ejecutables actuales; no mover
directorios ni reemplazar loaders antes del E2E y la evaluación exigidos por el entry gate.

### Problema que resuelve

La implementación actual tiene assets en `config/` y wrappers Python de compatibilidad. Sirve
para el vertical GEX, pero todavía no define el producto completo para:

- crear Skills sin escribir una clase Python por Skill;
- separar metodología, metadata, contratos, ejemplos y evals;
- descubrir Skills desde distintos hosts;
- proponer mejoras a partir de interacciones y resultados;
- comparar una versión candidata contra la versión publicada;
- publicar, revertir y auditar cambios;
- mostrar al usuario qué metodología produjo cada resultado.

### Dirección de diseño a validar

Durante Phase 3 se mantiene la ubicación actual. Después del gate, evaluar un bundle como:

```text
skills/
└── gex-analysis/
    ├── skill.yaml
    ├── SKILL.md
    ├── examples/
    │   ├── positive-gamma.json
    │   ├── negative-gamma.json
    │   └── insufficient-data.json
    ├── evals/
    │   └── cases.yaml
    ├── knowledge/
    │   └── interpretation-notes.md
    └── CHANGELOG.md
```

Responsabilidades propuestas:

| Asset | Responsabilidad |
|---|---|
| `skill.yaml` | Identidad, versión, estado, triggers, capabilities, contracts, protocols, guardrails y referencias a archivos |
| `SKILL.md` | Metodología e instrucciones canónicas para humanos y modelos |
| `examples/` | Ejemplos estructurados y versionados para prompting, revisión y regresiones |
| `evals/` | Casos y expectativas usados para medir calidad; no son instrucciones del modelo |
| `knowledge/` | Conocimiento complementario opcional, con alcance y fuentes explícitas |
| `CHANGELOG.md` | Cambios de metodología y razones de cada versión |
| Python | Loaders, schemas, assurance y adapters; sólo lógica determinística que no debe depender del modelo |

La decisión entre `config/skills/` y un directorio principal `skills/` queda diferida hasta
validar el formato con más de una Skill. No mover el vertical GEX sólo por estética.

### Lifecycle propuesto

```text
interacciones + evals + outcomes + correcciones humanas
                         ↓
                 findings estructurados
                         ↓
                SkillChangeProposal
                         ↓
                    DRAFT vNext
                         ↓
             evals + comparación con current
                         ↓
                   revisión humana
                         ↓
              PUBLISHED o REJECTED
```

Reglas:

1. Las interacciones producen evidencia y propuestas; nunca modifican directamente una Skill
   publicada.
2. Una versión `DRAFT` no afecta ejecuciones normales.
3. Toda publicación conserva autor, versión base, diff, evidencia, resultado de evals y decisión
   humana.
4. Los traces históricos continúan resolviendo la versión y el hash utilizados originalmente.
5. Una versión anterior puede recuperarse sin reescribir evidencia histórica.
6. Repetición no equivale automáticamente a calidad: crear una Skill requiere un caso reusable,
   ownership claro y evaluación.

### Formas de creación

1. **Manual:** un experto solicita una Skill y revisa su draft.
2. **Necesidad repetida:** varias sesiones muestran el mismo trabajo y generan una propuesta de
   extracción.
3. **Workflow exitoso:** una secuencia repetible y evaluada se propone como Skill o Workflow,
   manteniendo separados ambos conceptos.
4. **Mejora metodológica:** errores, correcciones humanas o outcomes generan una propuesta sobre
   una Skill existente.

### Objetos futuros a diseñar

- `SkillBundleManifest`;
- `SkillVersion` y estados `DRAFT | PUBLISHED | DEPRECATED | ARCHIVED`;
- `SkillChangeProposal` o especialización de `MethodologyChangeProposal`;
- `CognitiveFinding` con referencias a runs/evals/outcomes;
- `SkillEvaluationResult`;
- `SkillRegistry` de lectura;
- proyección host-native generada desde el bundle canónico;
- política de publicación, deprecación, rollback y compatibilidad.

Estos nombres son propuestas, no contratos aprobados.

### Experiencia de usuario buscada

Para analizar:

```text
Analizá el contexto de opciones actual de SPY.

Metodología utilizada
✓ GEX Interpretation 1.3.0
✓ IV Context 1.1.0
✓ Facts Discipline 1.0.0

Validación
✓ Facts vigentes
✓ Evidencia verificada
✓ Sin números inventados
```

Para administrar inteligencia:

```text
Skills
├── Published
│   ├── GEX Interpretation 1.3.0
│   └── IV Context 1.1.0
├── Drafts
│   └── Options Market Context 0.1.0
└── Proposals
    └── Clarificar interpretación de call wall
```

El usuario debería poder probar una Skill, ver metodología y evidencia, ejecutar evals, comparar
versiones y proponer un cambio sin editar Python. La edición directa de archivos sigue disponible
para desarrollo y revisión técnica.

### Entry gate

No iniciar este ítem hasta que:

- Phase 3 tenga un E2E interactivo reproducible;
- exista evidencia de que los assets GEX fueron realmente consumidos por el host;
- se haya ejecutado una evaluación cognitiva con y sin assets;
- se conozcan al menos una segunda Skill real y sus diferencias respecto de GEX;
- se haya revisado qué partes del loader actual son reutilizables.

### Acceptance criteria

- [ ] Existe un formato de bundle aprobado y documentado.
- [ ] Dos Skills reales diferentes se cargan sin factories Python específicas.
- [ ] El bundle completo tiene identidad, versión y hash reproducible.
- [ ] Los adapters host-native se generan o referencian el mismo source of truth.
- [ ] Ejemplos y evals tienen contratos separados de las instrucciones.
- [ ] Una interacción puede producir un finding y una propuesta, nunca una publicación automática.
- [ ] Una versión draft puede evaluarse contra la publicada sobre los mismos casos.
- [ ] La publicación requiere revisión humana y deja trazabilidad.
- [ ] Se puede revertir a una versión anterior sin perder historia.
- [ ] Los traces identifican la versión y el hash efectivos.
- [ ] La interfaz muestra Skills publicadas, drafts, propuestas, calidad y evidencia.
- [ ] La documentación explica límites: mejorar evals no demuestra rentabilidad financiera.

### Riesgos a vigilar

- proliferación de Skills demasiado específicas;
- duplicación de conocimiento entre Skills;
- optimización excesiva contra los evals conocidos;
- promoción de preferencias de una sesión a metodología global;
- diferencias entre el bundle canónico y las proyecciones de cada host;
- confundir frecuencia de uso con validez metodológica;
- introducir un CMS o plataforma de workflows antes de demostrar necesidad.

### Próximo paso cuando se abra

Realizar un design checkpoint usando `gex-analysis` y una segunda Skill read-only. Comparar dos
alternativas: `SKILL.md` con frontmatter como fuente única, o `skill.yaml` que referencia
`SKILL.md`. No implementar registry, UI ni proposals antes de elegir el bundle mínimo mediante
esas dos Skills reales.

---

## BL-002 — Metadata de unidades/escala en el contrato GEX de GaleCore

**Estado:** `CAPTURED`

**Target:** después del cierre de GC-AI-0001; requiere un work item propio y un cambio en GaleCore.

**Origen:** GC-AI-0001, Increment 4 (D2/D7). GaleCore publica `callGex`/`putGex` en millones de USD y
`netGex` en billones (`NetGEX = (CallGEX + PutGEX) / 1000`), sin declararlo en el contrato HTTP.
GaleCore-AI conoce esa relación por lectura del código fuente, no por contrato.

**Objetivo:** que GaleCore-AI deje de depender de conocimiento derivado del código fuente de GaleCore
para interpretar escalas, y que `near_zero` pueda validarse sobre facts normalizados.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE` por requerir un cambio contractual aditivo en
GaleCore y un work item cross-repo posterior a GC-AI-0001.

La respuesta GEX, el DTO `GaleCoreGexAnalysisResponse`, el mapper a `GexFacts`, el contrato cerrado
de métricas/unidades y los tests adversariales ya aíslan el recorrido afectado. El primer incremento
agrega metadata nullable/versionada al response sin cambiar los valores de `CallGEX`, `PutGEX` o
`NetGEX`, y congela su consumo con contract tests. Después puede evaluarse la normalización interna.

Los consumidores actuales de GaleCore continúan leyendo los mismos campos y GaleCore-AI mantiene
`near_zero` fail-closed hasta que la metadata y la normalización estén verificadas.

**Invariante anti-rewrite:** no modificar escalas publicadas ni recalcular GEX en GaleCore-AI; el
cambio extiende el contrato y el mapper existentes.

### Alcance propuesto (no implementar antes del entry gate)

- Agregar metadata explícita de unidades/escala a `GexScope` en `GexAnalysisResponse` (campo nuevo,
  nullable, backward-compatible; los valores actuales de `CallGEX`, `PutGEX` y `NetGEX` no cambian).
- Leer esa metadata en el DTO de GaleCore-AI y usarla para habilitar `call_gex`/`put_gex` como
  `GexMetric` con su unidad declarada.
- Evaluar en un work item separado una normalización canónica de `GexFacts` (misma escala para los
  tres campos) y, recién entonces, reactivar la validación de magnitud de `near_zero` con
  `gex_near_zero_threshold_pct`.

### Entry gate

GC-AI-0001 en `VALIDATED` o `CLOSED`, y acuerdo del product owner para tocar GaleCore.

### Acceptance criteria

- El contrato HTTP de GaleCore declara la unidad de cada campo GEX; un test contractual en
  GaleCore-AI falla si la metadata falta o contradice los valores.
- Ningún factor de escala vive hardcodeado en el validador.
- Los consumidores actuales de `NetGEX` (Monitor, RPF, front) no cambian de comportamiento.

**Addendum 2026-09-23 — review del owner, jornada 3 de AC-08:** la unidad declarada tiene que
incluir la **convención de movimiento**, no solo la escala. GaleCore calcula
`gamma × OI × 100 × spot²` (`GammaExposureHandler.cs:567`), sin el `× 0.01` de la convención "por
movimiento del 1 %" que usan Unusual Whales y SqueezeMetrics: sus "billions" son 100× los de esas
fuentes. El owner no pudo reconciliar el `net_gex` de −822.1 del registro `SPY/2026-09-23.md` con
UW por eso (≈ −8.2 B por 1 %), además de que UW agrega todos los vencimientos con otra fuente de
OI/griegos. Consecuencia para el alcance: la metadata declara escala **y** convención, y un
contract test fija ambas. Pendiente sin reproducir: el owner vio −280 B en el front ese día a una
hora no registrada; con el cache de 600 s y el mismo formateo, no coincide con ningún vencimiento
ni con el agregado de las 20:32 UTC.

---

## BL-003 — Onboarding de mercados, proveedores y conectores

**Estado:** `CAPTURED`

**Target:** después del cierre de GC-AI-0001 y antes de comprometer el primer mercado o proveedor
adicional. La primera aplicación candidata es Argentina, sin asumir todavía fuente, broker ni
instrumento.

**Origen:** conversación de producto del 2026-09-16 sobre expansión a fuentes argentinas, agentes
de desarrollo y evolución coordinada de GaleCore, GaleCore-AI y Monitor.

**Relación con el roadmap:** habilitador transversal para Phase 4–7. No adelanta Strategy
Development, autonomous runtime, PAPER ni LIVE.

### Problema que resuelve

La arquitectura asigna datos, cálculos, estado y ejecución a GaleCore, pero todavía no existe un
playbook repetible para decidir qué cambia cuando se incorpora un proveedor, una fuente, un broker
o un mercado con semántica nueva. Sin ese proceso, cada integración puede filtrar conceptos del
vendor al dominio, duplicar cálculos en GaleCore-AI o exigir cambios innecesarios en todos los
consumidores.

### Objetivo

Definir un workflow de ingeniería que convierta una solicitud como “agregar datos y trading local
de Argentina” en una propuesta trazable de capacidades, contratos, adapters, calidad de datos,
conocimiento cognitivo, UI, pruebas y rollout, preservando ownership y compatibilidad.

El workflow podrá ser consumido en el futuro por un agente de desarrollo del ecosistema, pero no
autoriza un agente autónomo que modifique o despliegue componentes sin revisión humana.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE`.

Puntos de apoyo comprobados:

- GaleCore ya separa proveedores bajo `DataFeed.Infrastructure/Providers/` y posee interfaces para
  FRED y Tastytrade;
- los casos de aplicación se invocan mediante MediatR y son consumidos desde REST, MCP y servicios
  internos;
- GaleCore-AI ya posee `CapabilityDefinition`, `CapabilityRegistry`, dispatcher, DTOs y mappings;
- el Monitor consume APIs y streaming detrás de módulos propios, sin acceso directo al proveedor.

Camino incremental:

1. inventariar un caso read-only y el contrato actual que más se aproxima;
2. incorporar un segundo adapter en paralelo detrás de ese caso, inicialmente para una fuente y un
   tipo de instrumento;
3. agregar selección/configuración de provider sin cambiar la respuesta existente;
4. extender el contrato sólo cuando la nueva semántica no pueda representarse honestamente;
5. actualizar GaleCore-AI y Monitor únicamente por esos campos o significados nuevos.

El refactor admisible es local: extraer una interfaz neutral del caso concreto cuando el segundo
provider demuestre la necesidad. Los handlers, tools y DTOs actuales que nombran Tastytrade/DXLink
son deuda a aislar gradualmente, no motivo para reemplazar toda la capa de aplicación. Los
consumidores existentes deben conservar respuesta y comportamiento durante la incorporación.

**Invariante anti-rewrite:** no crear un framework universal de plugins ni migrar todos los
providers antes de que el primer vertical adicional funcione con contract tests y fallback.

### Dirección de diseño a validar

```text
solicitud de fuente / mercado / broker
→ clasificación del cambio y ownership
→ inventario de capabilities canónicas reutilizables
→ gaps de contratos y semántica de mercado
→ plan por repositorio y consumidor
→ contract/data-quality tests
→ vertical read-only
→ evaluación de conocimiento/skills específicos
→ SHADOW → PAPER → LIVE, sólo cuando corresponda
```

Principios propuestos:

1. Un proveedor nuevo detrás de un contrato estable debería cambiar sólo GaleCore y sus tests.
2. GaleCore-AI cambia únicamente cuando aparecen facts, mappings o semánticas cognitivas nuevas.
3. Los identificadores, monedas, calendarios, sesiones, timestamps, provenance y quality flags son
   parte del dominio canónico, no detalles implícitos del vendor.
4. Credenciales, hard risk, estado operacional, autorización y ejecución permanecen en GaleCore.
5. UI y hosts consumen capabilities canónicas; no integran directamente cada proveedor.
6. El primer vertical de un mercado nuevo es read-only y acotado a una fuente, un tipo de
   instrumento y un resultado verificable.

### Alcance de diseño propuesto

- plantilla de `EcosystemChangeProposal` o artefacto equivalente;
- matriz de impacto por GaleCore, GaleCore-AI, Monitor/host y proveedor externo;
- decisión adapter-only vs. cambio contractual versionado;
- checklist de identidad de instrumento, exchange, moneda, zona horaria, calendario, sesión,
  settlement, unidades, freshness, provenance y calidad;
- estrategia de symbol mapping y aislamiento del vendor;
- contract tests, replay y casos de degradación;
- criterio para crear conocimiento, Skill, Workflow y evals específicos del mercado;
- compatibilidad, migración, observabilidad y rollback;
- gates separados para datos, research, SHADOW, PAPER y LIVE.

### No objetivos

- elegir ahora un proveedor o broker argentino;
- implementar conectividad BYMA, CEDEARs, bonos o ejecución local;
- crear un framework universal de plugins;
- permitir que un agente publique contratos, active estrategias o despliegue integraciones sin
  aprobación;
- duplicar en GaleCore-AI cálculos que pertenecen a GaleCore.

### Entry gate

- GC-AI-0001 está `VALIDATED` o `CLOSED`;
- existe una solicitud concreta de segundo proveedor o mercado;
- están identificados al menos una fuente, un tipo de instrumento y un caso read-only;
- el product owner autoriza un work item de diseño, sin autorizar por ello PAPER/LIVE;
- se revisan las capabilities actuales antes de proponer abstracciones nuevas.

### Acceptance criteria

- [ ] Una solicitud concreta produce una clasificación de ownership y una matriz de impacto por
      componente.
- [ ] El diseño demuestra si puede reutilizar contratos existentes o justifica cambios aditivos o
      versionados.
- [ ] El adapter del proveedor no expone su modelo propietario como dominio canónico.
- [ ] Se documentan identidad, moneda, calendario, sesión, timestamps, unidades, provenance,
      freshness y quality flags aplicables.
- [ ] Existen contract tests y casos reproducibles para datos stale, faltantes, duplicados,
      inconsistentes y proveedor no disponible.
- [ ] GaleCore puede operar y degradar de forma segura sin GaleCore-AI.
- [ ] Toda actualización de GaleCore-AI se justifica por nueva semántica, no por el mero cambio de
      proveedor, e incluye evals cuando corresponda.
- [ ] El host y la UI distinguen mercado, moneda, fuente y calidad sin inferirlos desde texto libre.
- [ ] El rollout read-only se valida antes de habilitar mutaciones o acciones externas.
- [ ] Cualquier paso hacia SHADOW, PAPER o LIVE tiene work item, permisos, hard risk, aprobación y
      evidencia independientes.

### Preguntas abiertas

- ¿Cuál será el primer caso concreto: acciones locales, CEDEARs, bonos, macro argentino u otro?
- ¿La fuente inicial será sólo market data o también broker/execution?
- ¿Qué modelo canónico de instrumento y calendario ya puede reutilizarse?
- ¿El agente de desarrollo será una skill del host, un workflow de ingeniería o ambos?

---

## BL-004 — Historia point-in-time y datasets reproducibles de mercado

**Estado:** `CAPTURED`

**Target:** diseñar después del cierre de GC-AI-0001 y antes de usar backtests como evidencia para
Strategy Development. La captura temprana puede abrirse como un incremento acotado cuando el
product owner defina universo, frecuencia, coste y retención.

**Origen:** conversación de producto del 2026-09-16 sobre ausencia de historia propia de opciones
y GEX, uso futuro en backtesting y diferencia respecto de fuentes históricas externas como FRED.

**Relación con el roadmap:** base de datos/evidencia para Phase 5 — Strategy Development. No
autoriza todavía un motor general de backtesting ni cambia el alcance read-only de Phase 3.

### Problema que resuelve

El GEX actual es un cálculo point-in-time construido con spot, cadena de opciones, Greeks live, OI
settled y reglas de cálculo. GaleCore conserva caches operacionales en memoria, pero no un historial
durable de esos snapshots. Guardar únicamente el agregado de `net_gex` permitiría graficar una
serie, pero no reproducir el cálculo, cambiar la metodología, auditar cobertura ni construir un
backtest confiable.

Las series macro externas tampoco son automáticamente point-in-time: algunos valores se revisan.
Un backtest debe distinguir el dato conocido en la fecha evaluada de la revisión disponible hoy.

### Objetivo

Construir en GaleCore una base histórica versionada que permita reconstruir qué información estaba
disponible en cada instante, recalcular derivados y generar datasets congelados y manifestados para
backtests reproducibles, sin trasladar market data autoritativo a GaleCore-AI.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE`.

Puntos de apoyo comprobados:

- `GexAnalysisResponse` ya contiene timestamp, cobertura, vencimientos y detalle por strike;
- `GexAnalysisHandler` produce un snapshot completo antes de colocarlo en su cache en memoria;
- `GammaExposureHandler` ya reúne chain, Greeks y OI en un único recorrido;
- `SkewSnapshotService` demuestra el patrón actual de captura periódica mediante
  `BackgroundService`;
- GaleCore ya cuenta con persistencia EF para metadata y estado operacional.

Primer incremento compatible: agregar un sink de snapshots detrás del resultado GEX completo y
capturar SPY con una cadencia acotada. Debe ser observacional, configurable y fail-open respecto de
la consulta live: una falla de persistencia histórica no cambia ni bloquea la respuesta GEX actual.
El endpoint, cálculo y cache existentes permanecen intactos.

Ese primer incremento sólo crea historia del resultado. La recomputación completa exige después
capturar inputs suficientes cerca de `GammaExposureHandler`; debe añadirse como evolución del sink,
no reescribiendo el motor GEX. El `FileSnapshotStore` de GaleCore-AI no se reutiliza como data lake:
es efímero, tiene TTL y cumple una frontera de assurance diferente.

La migración debe ser aditiva: versionar nuevos snapshots y manifests sin reinterpretar archivos o
resultados históricos. La selección de storage queda detrás de una interfaz hasta medir volumen y
coste con el vertical real.

**Invariante anti-rewrite:** persistir lo que el pipeline ya produce antes de introducir una
plataforma general de eventos, series temporales o backtesting.

### Dirección de diseño a validar

```text
proveedor
→ captura raw inmutable
→ normalización canónica point-in-time
→ derivados versionados (GEX, IV, skew, features)
→ DatasetManifest congelado
→ backtest reproducible
→ evidencia y métricas
```

Capas propuestas:

1. **Raw:** payload o evento recibido, comprimido, con source y timestamps; permite reprocesar.
2. **Normalized:** instrumentos, quotes, cadenas, OI, Greeks, spot y calendarios en contratos
   canónicos.
3. **Derived:** GEX por strike/vencimiento/agregado y otras métricas con versión de cálculo,
   parámetros y hash de inputs.
4. **Dataset:** selección inmutable de particiones, filtros y versiones usada por un experimento.

Todo registro temporal debe distinguir, cuando aplique:

- `effective_at`: cuándo representa el hecho en el mercado;
- `observed_at`: cuándo lo publicó o entregó la fuente;
- `ingested_at`: cuándo GaleCore lo recibió;
- fuente, calidad, cobertura, sesión y versión del contrato/cálculo.

Para opciones deben evaluarse como mínimo cadena e identidad contractual, expiración, strike,
call/put, spot, quote, IV/Greeks, OI y su fecha efectiva, cobertura y campos derivados. El diseño
debe evitar look-ahead, especialmente por el desfase de OI y por revisiones de datos macro.

### Alcance inicial sugerido para decidir

- un símbolo líquido, inicialmente SPY;
- conjunto explícito de vencimientos y strikes;
- snapshots en hitos de sesión o cadencia acotada, no tick history indiscriminado;
- raw + normalized suficientes para recalcular GEX;
- agregado GEX almacenado también para consulta rápida;
- catálogo y manifest de datasets;
- política explícita de retención, compresión, coste y licenciamiento.

La tecnología de almacenamiento queda abierta. Una alternativa a evaluar es separar metadata y
catálogo transaccional de archivos columnares particionados para los datos voluminosos; no se
aprueba todavía PostgreSQL, object storage, Parquet ni un servicio concreto.

### No objetivos

- afirmar que el historial comienza antes de la primera captura real;
- fabricar datos históricos de opciones o reconstruirlos con información futura;
- conservar todos los ticks y símbolos sin justificar coste y uso;
- tratar el valor agregado de GEX como sustituto de sus inputs;
- almacenar market data autoritativo en GaleCore-AI;
- considerar un backtest reproducible como prueba de rentabilidad futura.

### Entry gate

- GC-AI-0001 está `VALIDATED` o `CLOSED`;
- se define el primer caso de backtest que consumirá la historia;
- se acuerdan universo, frecuencia, campos mínimos, retención y presupuesto;
- se verifican derechos de almacenamiento y reutilización del proveedor;
- se documenta la semántica temporal de OI, Greeks, quotes y cualquier serie revisable.

### Acceptance criteria

- [ ] Un snapshot conserva inputs suficientes para recalcular la versión original y una versión
      posterior de GEX sin consultar datos live.
- [ ] Raw, normalized, derived y dataset manifest tienen identidad, schema version y hashes o
      referencias de integridad reproducibles.
- [ ] Effective, observed e ingested time se distinguen y se prueban con casos de desfase.
- [ ] La cobertura y los datos faltantes se conservan; no se convierten silenciosamente en cero.
- [ ] El cálculo derivado registra versión, parámetros y unidades.
- [ ] Un dataset congelado puede reabrirse y producir los mismos inputs de backtest.
- [ ] Las series macro revisables usan vintages point-in-time o declaran explícitamente la
      limitación.
- [ ] Existen políticas de retención, particionado, compresión, borrado y coste medible.
- [ ] Se verifican licencias y restricciones de persistencia/redistribución del proveedor.
- [ ] GaleCore-AI recibe facts/datasets por contratos y no se convierte en data lake.

### Preguntas abiertas

- ¿Qué decisión concreta queremos investigar primero con la historia de GEX?
- ¿Qué frecuencia aporta señal: apertura/cierre, eventos, intervalos o combinación?
- ¿Conviene almacenar todo el chain snapshot o una banda explícita con cobertura verificable?
- ¿Qué historia puede comprarse/importarse para reducir el cold start sin mezclar metodologías?
- ¿Qué storage y coste son aceptables para opciones?

---

## BL-005 — Dashboards declarativos y artifacts interactivos en vivo

**Estado:** `CAPTURED`

**Target:** después de estabilizar capabilities read-only y sus contratos. Puede explorarse en
Phase 4 como experiencia de análisis; controles operacionales requieren gates posteriores.

**Origen:** conversación de producto del 2026-09-16 sobre crear y modificar dashboards mediante
lenguaje natural —por ejemplo agregar GEX, reorganizar paneles o cambiar estilos— manteniendo datos
en tiempo real.

**Relación con el roadmap:** experiencia transversal de host/Monitor. Complementa, pero no
reemplaza, Skills, capabilities, assurance ni las fases de Strategy Development y ejecución.

### Problema que resuelve

El Monitor actual tiene pantallas y componentes codificados de forma fija. Crear cada combinación
de seguimiento requiere desarrollo frontend, aunque muchos pedidos del usuario son composiciones
seguras de widgets y fuentes ya existentes.

Permitir que el modelo genere JavaScript o React arbitrario en producción mezclaría presentación,
permisos y ejecución, dificultaría seguridad, compatibilidad y reproducción.

### Objetivo

Permitir que el usuario cree, modifique, guarde y comparta artifacts visuales en vivo mediante chat,
voz o edición directa, usando una especificación declarativa validada y un registry de widgets y
data bindings aprobados.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_INCREMENTAL` una vez estabilizadas las capabilities read-only.

Puntos de apoyo comprobados:

- Monitor ya tiene componentes reutilizables de GEX, posiciones, riesgo y estrategias;
- Zustand separa stores de GEX, mercado, cuenta y configuración;
- `useMarketSocket` centraliza la conexión live y expone suscripciones por símbolo/leg;
- las pantallas actuales ya manejan estados de conexión, snapshots y fallback de datos.

Primer incremento compatible: agregar una ruta experimental `Dashboard Lab` que renderice un
`DashboardSpec` escrito manualmente con dos widgets existentes, por ejemplo GEX y riesgo de
portfolio. Los widgets se adaptan mediante wrappers pequeños; las páginas fijas continúan siendo el
camino productivo. Después de demostrar equivalencia, se agrega edición visual y recién luego
patches conversacionales.

El refactor admisible es extraer props o adapters de componentes hoy acoplados a una página/store.
No se reemplazan en bloque `App`, navegación, Zustand ni SignalR. Las suscripciones de widgets deben
reutilizar el socket central y reference counting/budgets, no abrir una conexión por widget. Los
specs se versionan de forma aditiva y un fallo del dashboard no afecta las pantallas operacionales.

**Invariante anti-rewrite:** el renderer compone componentes y data bindings existentes; no crea
una segunda UI completa ni introduce código arbitrario generado por el modelo.

### Dirección de diseño a validar

```text
“agregame GEX y riesgo de portfolio”
→ DashboardIntent
→ patch de DashboardSpec
→ validación de schema, permisos y recursos
→ preview + undo/redo
→ renderer de widgets registrados
→ bindings a REST/stream capabilities
```

Un `DashboardSpec` futuro podría describir:

- layout responsive, tabs y grupos;
- widget type y versión;
- capability/data binding, símbolo, timeframe y refresh policy;
- transformaciones presentacionales permitidas;
- formato, color, tipografía y alertas visuales;
- estado de filtros y vínculos entre widgets;
- autor, versión, permisos, timestamps y provenance.

El modelo propone operaciones declarativas como `add_widget`, `move_widget`, `bind_data` o
`set_style`. No ejecuta código arbitrario ni obtiene más permisos que el usuario. Los datos live
continúan llegando desde las capabilities y canales de streaming de GaleCore.

### Alcance propuesto

- schema versionado de dashboard/artifact;
- registry de widgets compatibles y sus contratos de props/datos;
- renderer determinístico;
- edición conversacional y visual sobre el mismo spec;
- preview, diff, undo/redo, historial y rollback;
- persistencia por usuario/workspace, plantillas y sharing con permisos;
- budgets de suscripciones, frecuencia y volumen;
- estados loading/stale/disconnected/error visibles;
- exportación/importación segura del spec;
- separación entre widgets read-only y controles con side effects.

### No objetivos

- ejecutar HTML, JavaScript, SQL o React arbitrario generado por el modelo;
- convertir el dashboard en fuente de verdad financiera;
- ocultar timestamps, calidad, mercado, moneda o provenance por motivos visuales;
- permitir que una personalización de UI evite approval, hard risk o autorización;
- prometer inicialmente cualquier widget o composición imaginable.

### Entry gate

- las capabilities read-only que alimentarán el primer dashboard son estables y versionadas;
- existe al menos un dashboard fijo real que pueda representarse como spec sin pérdida material;
- se define el primer conjunto pequeño de widgets registrados;
- están resueltos autenticación, autorización y límites de suscripción del streaming;
- el product owner aprueba un prototipo separado de los controles PAPER/LIVE.

### Acceptance criteria

- [ ] El mismo `DashboardSpec` produce una vista equivalente después de guardar y recargar.
- [ ] Una instrucción conversacional genera un patch visible y reversible, no código ejecutable.
- [ ] Sólo pueden usarse widgets, data bindings y transformaciones registrados.
- [ ] Cada widget live muestra estado de conexión, freshness, source y errores relevantes.
- [ ] El sistema impone permisos y budgets de suscripción independientemente del modelo.
- [ ] Cambios de estilo no alteran units, valores, provenance ni significado financiero.
- [ ] Specs incompatibles se migran o rechazan explícitamente por versión.
- [ ] Undo/redo, historial y rollback conservan autor y diff.
- [ ] Un widget operacional conserva confirmación, idempotencia, autorización y hard risk de
      GaleCore; el spec no puede relajarlos.
- [ ] El dashboard degrada de forma comprensible cuando GaleCore o el streaming no están
      disponibles.

### Preguntas abiertas

- ¿El artifact vive dentro de Monitor o en un workspace de host separado?
- ¿Qué cinco widgets forman el primer registry útil?
- ¿Los specs son personales, compartidos por equipo o ambos?
- ¿Qué cambios se aplican inmediatamente y cuáles requieren preview/confirmación?
- ¿Hasta dónde se permiten fórmulas visuales sin crear una segunda capa de cálculo financiero?

**Addendum 2026-09-28 — owner, a partir de la vista práctica de GC-AI-0010:** «estaría bueno que por cada estrategia uno
pueda generar este nivel de informes en la misma interfaz, y con el host o el chat desde la interfaz ir iterándolo
(agregando, mejorando, sacando)… un breve dashboard especial para cada estrategia». Primer caso concreto de este BL:
un dashboard por estrategia con la estructura ya validada por el owner (números clave, «qué mirar», posiciones y salidas,
calendario posiciones × eventos, precio contra strikes, contexto de tasas/volatilidad, faltantes; registro con fuentes al
pie). Referencia visual: https://claude.ai/artifact/G7L8oniVGHvQfFupAQzS8R. Criterios del owner: tablas y gráficos
primero, texto mínimo. Costo: la actualización de números debe ser determinista (plantilla + datos de la API de GaleCore
y de `knowledge/`), sin modelo; el modelo sólo al iterar la plantilla o al escribir interpretación opcional. Responde la
primera pregunta abierta con una recomendación: vivir en el monitor de GaleCore (lee GaleCore local en vivo; un artifact
de claude.ai no alcanza `localhost`). Iterarlo con un chat dentro de la interfaz depende del «host propio», fuera del
plan. Dentro de la secuencia activa sólo entra la vista generada por script de la skill del paso 3 y del reporte del
paso 4 (roadmap §4); actualizarla por la tarea programada requiere ampliar el scheduler (hoy sólo `strategy_followup`).

---

## BL-006 — Federación MCP, trust y routing de tools externas

**Estado:** `CAPTURED`

**Target:** design checkpoint después del cierre de GC-AI-0001, al validar el primer host que no
pueda consumir directamente los assets y adapters locales o al incorporar el primer MCP externo.

**Origen:** conversación de producto del 2026-09-16 sobre cómo conectar desde un host o ChatGPT
Work a GaleCore y GaleCore-AI, y qué ocurre cuando se agrega un MCP que no pertenece a GaleCore.

**Relación con la arquitectura:** desarrolla las decisiones abiertas de v5 sobre interfaz externa
de assurance, provenance y packaging de Work. No cambia la regla de que MCP es transporte y no
ownership, Skill, metodología ni garantía de confianza.

### Problema que resuelve

GaleCore ya proyecta algunas capabilities mediante un servidor MCP. GaleCore-AI dispone de un core
de preparación y aceptación/assurance con adapter CLI, pero no de un servidor MCP. La arquitectura
todavía no define si un host futuro se conecta a dos endpoints, si GaleCore-AI expone únicamente
assurance, ni cómo se clasifican datos y acciones provenientes de servidores MCP externos.

Sin una política explícita, un MCP externo podría confundirse con una fuente autoritativa de
GaleCore, saltar contracts o risk gates, ampliar permisos del agente, introducir contenido no
confiable o convertir a GaleCore-AI en un proxy general innecesario.

### Objetivo

Definir una federación de tools y resources donde el host pueda descubrir GaleCore, GaleCore-AI y
MCPs externos, manteniendo identidad de origen, contracts, allowlists, provenance, permisos y
límites de side effects en cada llamada.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE` por depender del host real y su mecanismo de
autenticación/MCP.

Puntos de apoyo comprobados:

- GaleCore ya registra un servidor MCP HTTP y sus tools reutilizan los mismos handlers MediatR que
  otros transportes;
- GaleCore-AI separa los application services `prepare_gex_snapshot` y
  `accept_gex_interpretation` del adapter CLI;
- `CapabilityRegistry`, preflight y las clases semánticas ya ofrecen una base para allowlists;
- trace, provenance y `EvidenceRef` ya existen para el vertical actual.

Primer incremento compatible: mantener GaleCore MCP y CLI sin cambios, elegir un único host y
envolver `prepare/accept` con un adapter MCP delgado sólo si ese host lo necesita. El E2E debe
compararse con el CLI para probar que ambos transportes ejercitan los mismos services, validators y
snapshots. La integración de un MCP externo comienza con una sola tool `PURE_QUERY` y provenance no
autoritativo.

El refactor admisible es extender metadata de capability/trace con server, tool y trust, además de
configurar routing en el adapter del host. No se duplica el core, no se mueve el agent loop al MCP y
no se convierte GaleCore-AI en gateway. Las descripciones actuales de tools GaleCore que mencionan
DXLink/Tastytrade pueden aislarse gradualmente junto con BL-003 si aparece otro provider; BL-006 no
las reescribe por anticipado.

**Invariante anti-rewrite:** CLI, import Python, REST y MCP siguen siendo adapters reemplazables
sobre los mismos application services y contracts.

### Topología de referencia a validar

```text
                            ┌→ GaleCore MCP
User → Host / Work → Router ├→ GaleCore-AI assurance MCP (opcional)
                            └→ External MCPs permitidos
```

Responsabilidades propuestas:

- **GaleCore MCP:** facts y cálculos autoritativos; estado y acciones sólo con autenticación,
  autorización, idempotencia, revalidación, approval y hard risk según su clase.
- **GaleCore-AI MCP opcional:** descubrir assets compatibles y exponer operaciones acotadas como
  preparar un contexto y validar/aceptar un output. No ejecuta el modelo del host, no guarda
  credenciales de broker y no reemplaza GaleCore.
- **MCP externo:** aporta conocimiento, documentos, datos o tools de terceros dentro de un trust
  explícito. No obtiene autoridad operacional por estar conectado.
- **Host:** mantiene la conversación y selecciona tools dentro de las allowlists efectivas; no
  convierte resultados externos en hechos verificados por sí solo.

El patrón preferido a evaluar es conexión directa del host a cada servidor con contratos claros.
GaleCore-AI no debe convertirse por defecto en gateway o proxy de todas las capabilities de
GaleCore. Un gateway unificado sólo se justificaría por una necesidad concreta de despliegue,
seguridad o compatibilidad del host.

### Clasificación propuesta de MCPs externos

1. **Knowledge/research:** noticias, papers, documentos o calendarios. Pueden alimentar una
   interpretación con cita, origen y timestamp, pero su contenido es no confiable hasta aplicar la
   política de evidencia correspondiente.
2. **Market/financial data:** si el dato será autoritativo, reproducible o usado por riesgo y
   ejecución, debe normalizarse o verificarse mediante una integración controlada de GaleCore. Una
   lectura directa del host permanece externa/no verificada.
3. **Compute:** puede producir evidencia auxiliar, pero no sustituye un cálculo canónico de
   GaleCore sin contrato, versionado y validación.
4. **State mutation/external action:** no puede saltar autorización. Trading, broker, órdenes,
   posiciones y switches operacionales deben pasar por GaleCore. Otros side effects requieren una
   policy explícita del host y aprobación proporcional al riesgo.

Los nombres definitivos de niveles de trust quedan por diseñar. Hasta que exista verificación
independiente, el output entregado por el host no debe etiquetarse `GALECORE_VERIFIED`.

### Alcance propuesto

- inventario y namespacing de servidores, tools y resources;
- identidad de server/tool, versión de schema y origen por llamada;
- allowlists por AgentDefinition, Skill, usuario, environment y clase de capability;
- clasificación `PURE_QUERY | COMPUTE | STATE_MUTATION | EXTERNAL_ACTION` también para tools
  externas;
- autenticación y ownership de credenciales fuera del core de GaleCore-AI;
- timeouts, retries, rate limits, budgets, cancelación e idempotencia;
- provenance y EvidenceRef para resultados externos;
- aislamiento de contenido no confiable y defensas contra instrucciones embebidas en tool output;
- trace del routing, argumentos saneados, resultado, error y decisión de trust;
- comparación E2E entre dual-MCP, adapter HTTP/CLI y un gateway sólo si un host lo requiere;
- mecanismo concreto y soportado para ChatGPT Work antes de comprometer packaging.

### No objetivos

- registrar automáticamente cualquier MCP disponible en internet;
- tratar la descripción de una tool como prueba de seguridad o calidad;
- duplicar todas las tools de GaleCore dentro de GaleCore-AI;
- permitir acceso del modelo a secretos o credenciales de broker;
- marcar datos externos como `GALECORE_VERIFIED` sin verificación real;
- habilitar mutaciones o acciones por el solo hecho de que un servidor MCP las exponga.

### Entry gate

- GC-AI-0001 está `VALIDATED` o `CLOSED`;
- existe un host objetivo concreto y se conocen sus mecanismos reales de MCP/auth;
- se elige un MCP externo o caso de assurance concreto para el vertical;
- se documentan datos, permisos, credenciales y side effects requeridos;
- el product owner aprueba un work item acotado, inicialmente read-only cuando sea posible.

### Acceptance criteria

- [ ] Cada tool invocada conserva server, tool, versión, clase de capability y provenance en el
      trace.
- [ ] Un resultado externo no puede convertirse silenciosamente en fact autoritativo de GaleCore.
- [ ] Las allowlists se aplican fuera de la obediencia del modelo y el agente no puede ampliar sus
      propias capabilities.
- [ ] El output de una tool externa se trata como contenido no confiable y no puede modificar
      instrucciones, permisos ni políticas.
- [ ] Las credenciales pertenecen al host, GaleCore o al adapter autorizado; nunca al core
      cognitivo ni al prompt.
- [ ] `STATE_MUTATION` y `EXTERNAL_ACTION` conservan idempotencia, autorización, approval y
      revalidación según su riesgo.
- [ ] El MCP opcional de GaleCore-AI, si se implementa, envuelve los mismos application services y
      validators usados por CLI/import, sin crear otro core.
- [ ] El host puede reemplazarse sin reescribir contracts, assets o assurance.
- [ ] Existe un E2E reproducible del vertical elegido con casos de timeout, schema inválido,
      provenance insuficiente, tool no permitida y contenido adversarial.
- [ ] La integración con Work se declara implementada sólo después de probar el mecanismo real
      soportado por ese host.

### Preguntas abiertas

- ¿El primer MCP de GaleCore-AI debe exponer sólo `prepare/accept` o también assets como resources?
- ¿El host objetivo admite múltiples servidores MCP con autenticación independiente?
- ¿Qué fuentes externas pueden ser evidencia auxiliar y cuáles deben incorporarse a GaleCore?
- ¿Hace falta un gateway/BFF para Work o alcanza una conexión dual?
- ¿Cómo se revocan, versionan y auditan permisos de tools externas?

**Addendum 2026-09-24 — conversación con el owner sobre MCPs de brokers y datos:**

*Dicho por el owner (24/09):*

- El host objetivo es Claude Code; como mucho, sesiones de Claude lanzadas desde una interfaz.
  Esto responde en parte el entry gate "existe un host objetivo concreto".
- El tema se queda en este ítem y **fuera de I3**. I5 es el **primer caso propuesto**, no un
  compromiso.
- Cuando se aborde, el primer paso es acotado: **un solo broker, leer posiciones y compararlas
  contra la cuenta**. Antes de eso no se construye una plataforma de conectores ni una interfaz
  propia.

*Regla vigente (no es propuesta):* las órdenes y el control operativo pasan por GaleCore (clase 4
de arriba). Que un broker exponga tools en el host no prueba que funcionen ni autoriza usarlas.

*Propuestas (mías, sin aprobar) — lo que queda por diseñar y probar:*

- Cómo se permiten las lecturas externas: el análisis asistido (cartera, macro, investigación)
  podría usar un MCP conectado guardando en `knowledge/` server, tool, timestamp y el valor tal
  como vino, porque no se puede volver a consultar igual. Lo que decide o ejecuta sin IA sigue
  saliendo sólo de GaleCore.
- Cómo se bloquean técnicamente las escrituras: en los permisos del host, sin depender de lo que
  obedezca el modelo. El mecanismo concreto está sin elegir ni probar.
- Un dato de MCP pasa a adapter de GaleCore (`BL-003`) cuando lo necesitan el runtime o el riesgo,
  o cuando se usa seguido y hace falta reproducirlo.
- El opt-in por usuario lo darían los conectores de la cuenta de cada usuario en el host. Si una
  interfaz propia lanzara sesiones, pasaría la configuración MCP de cada usuario; la custodia de
  tokens va a `BL-008`.

*Verificado y no verificado:*

- **Observado:** en una sesión de Claude Code (extensión de VS Code, 24/09) se ven tools con
  prefijo `mcp__claude_ai_IoL__*` y `mcp__claude_ai_Interactive_Brokers_IBKR__*`. Entre los nombres
  hay tools que escriben: IoL `place_order`, `cancel_order`, `place_caucion`, `subscribe_fci`,
  `redeem_fci` y `buy_ggal_at_50_cents` (no se sabe qué hace); IBKR `create_order_instruction`.
  AlphaAdvantage, Daloopa y LSEG aparecen como servidores que piden autenticación.
- **No verificado:** que alguna de esas tools responda desde Claude Code (no se llamó ninguna); que
  los conectores de claude.ai funcionen en Claude Code igual que en claude.ai; que los datos
  coincidan con la cuenta; qué frescura y límites tienen; que las tools que escriben estén o
  puedan quedar bloqueadas por permisos del host. **Hoy no hay ningún bloqueo configurado ni
  probado.**

---

**Addendum de BL-006, 2026-09-26 — primer caso externo de análisis propuesto:**

El owner necesita demostrar asistencia para estrategias con contexto de mercado, memoria y
retroalimentación; mencionó FRED, Alpha Vantage y SEC EDGAR como fuentes. El régimen actual sólo
consulta GEX, skew, VIX y VVIX. El host puede consultar una fuente externa directamente para análisis
asistido; no necesita esperar a que GaleCore la exponga. `ALIGNED_WITH_PREREQUISITE`: reutilizar
research/knowledge y catálogo; falta verificar acceso real y registrar el recorrido. El proveedor
FRED interno de GaleCore no integra por sí solo una capacidad macro en GaleCore-AI.

La propuesta de secuencia vive en `roadmap/README.md` del workspace, §4 «Corrección propuesta para
el entregable al partner (26/09/2026)», con el hallazgo en GC-AI-0006: análisis SPY + FRED antes del
despliegue completo de I4, sin esperar al caso de broker de I5. Es propuesta, no cambio aprobado de
estado o prioridad. MCP o adapter API se elige por acceso probado; no hay una tool FRED callable
verificada en esta sesión. No implica que FRED cubra consenso, geopolítica o toda explicación de
precios. Riesgo y ejecución automáticos conservan la autoridad de GaleCore.

---

## BL-007 — Portfolio de estrategias, adecuación contextual y asignación adaptativa

**Estado:** `CAPTURED`

**Target:** diseño durante Phase 5 — Strategy Development; ranking read-only y SHADOW antes de
Phase 6. Activación automática, PAPER y LIVE requieren gates posteriores independientes.

**Origen:** conversación de producto del 2026-09-16 sobre cómo validar edge, administrar múltiples
estrategias y utilizar o activar las que mejor correspondan al contexto macro, financiero, de
noticias, eventos, expectativas, valuación y portfolio.

**Relación con el roadmap:** extiende Strategy Quality y Portfolio Fit desde una estrategia aislada
hacia un portfolio de estrategias. Se apoya en Phase 5 para evidencia/StrategyProposal, Phase 6 para
propuestas controladas y Phase 7 para PAPER/LIVE. No convierte un análisis narrativo en autorización.

### Problema que resuelve

Una estrategia puede tener evidencia de edge y aun así no ser adecuada para el contexto actual o
para un portfolio que ya concentra riesgos similares. Con varias estrategias aparecen decisiones
diferentes: cuáles están desplegadas, cuáles son elegibles, cuáles pueden abrir riesgo nuevo, qué
capital/risk budget recibe cada una y cómo se gestionan posiciones existentes cuando cambia el
contexto.

Un único agente que produzca un régimen general y encienda estrategias directamente sería difícil
de auditar, propenso a churn y contrario a la separación entre interpretación, policy,
autorización y ejecución.

### Objetivo

Construir un control plane de portfolio de estrategias que combine evidencia histórica y reciente,
contexto multidimensional, adecuación por estrategia, correlación y riesgo de portfolio para
producir decisiones reproducibles de elegibilidad y asignación, inicialmente como recomendación y
después bajo políticas de automatización explícitamente aprobadas.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_NEW_FOUNDATION` con prerrequisitos explícitos.

Puntos de apoyo comprobados:

- `StrategySpec` ya define reglas, gates, límites y modos elegibles de forma inmutable/versionada;
- `StrategyDeployment` y `StrategyInstance` separan contrato, despliegue y estado operativo;
- `MetricResolver` y `GenericGateEvaluator` resuelven métricas y producen `NO_TRADE` de forma
  determinística;
- `ShadowRiskValidator`, switches, evaluation logs y operational events proporcionan límites y
  trazabilidad iniciales;
- GaleCore-AI ya separa Strategy Quality de Portfolio Fit en el caso de uso E2E.

La fundación nueva necesaria es el nivel portfolio: contexto versionado, evaluación comparable de
adecuación, correlación entre estrategias, risk budgets y un plan de asignación. No existe hoy un
allocator ni un contrato de context/fitness. Además, el runtime conserva múltiples instancias en su
store pero su acceso `ActiveInstance()` selecciona una sola; multi-strategy real debe validarse en
SHADOW antes de cualquier automatización.

Primer incremento compatible:

1. dos `StrategySpec` SHADOW versionadas, sin ejecución simultánea automática;
2. un `MarketContextSnapshot` pequeño con facts determinísticos ya disponibles;
3. una matriz read-only que muestre hard eligibility, context fit, evidencia y riesgo compartido;
4. una recomendación explicada de `preferir | mantener | no habilitar`, sin cambiar switches;
5. comparación retrospectiva y registro de decisiones antes de introducir allocation o activation.

Después puede agregarse un orchestrator determinístico en GaleCore que evalúe varias instancias y
produzca un `AllocationPlan`; GaleCore-AI aporta assessments y explicaciones estructuradas. Los
nombres de contratos son propuestas hasta el design checkpoint.

**Invariante anti-rewrite:** extender StrategySpec/Deployment/Instance y los evaluators actuales;
no reemplazar cada estrategia por un agente ni crear un segundo trading runtime en GaleCore-AI.

### Modelo estructural a validar

```text
Datos y eventos
→ Context specialists / workflows
→ MarketContextSnapshot multidimensional
→ Strategy eligibility (hard gates, GaleCore)
→ StrategyFitnessAssessment (contexto + evidencia, GaleCore-AI)
→ Portfolio optimizer/policy (GaleCore)
→ AllocationPlan / StrategyActivationProposal
→ approval o policy preaprobada
→ revalidación GaleCore
→ StrategyInstances
```

No usar un único label `bullish | neutral | bearish` como verdad universal. El contexto debería
preservar dimensiones independientes, por ejemplo crecimiento, inflación, liquidez, volatilidad,
correlación, crédito, valuación, positioning y riesgo de eventos, cada una con horizonte,
freshness, confidence y evidencia.

Especialistas futuros pueden cubrir macro, noticias/eventos, macro-finance, valuación,
microestructura, volatilidad y portfolio. Pueden ser Skills/Workflows ejecutados por un mismo host o
AgentDefinitions separadas sólo cuando la responsabilidad y los evals realmente lo justifiquen.

### Objetos conceptuales propuestos

- `MarketContextSnapshot`: facts e interpretaciones contextuales versionadas por horizonte;
- `StrategyEdgeEvidence`: evidencia a favor/en contra, estabilidad y límites del supuesto edge;
- `StrategyApplicabilityProfile`: condiciones donde la estrategia pretende funcionar o abstenerse;
- `StrategyFitnessAssessment`: adecuación contextual explicada, con incertidumbre y evidencia;
- `EligibilityResult`: resultado determinístico de data quality, gates, permisos y readiness;
- `AllocationPlan`: risk budget/capital propuesto por estrategia y restricciones de portfolio;
- `StrategyActivationProposal`: cambio operativo propuesto, todavía no autorizado;
- `StrategyPortfolioState`: deployments, instances, allocations, posiciones y decisiones vigentes.

Estos objetos no deben colapsarse en un score opaco. Hard eligibility, estimación de edge,
portfolio fit, asignación y autorización son decisiones distintas.

### Validación de edge

El edge no es un booleano permanente. Su evidencia debe contemplar, según la estrategia:

- hipótesis económica y mecanismo plausible;
- dataset point-in-time y prevención de leakage/look-ahead;
- costos, slippage, liquidez y capacidad;
- separación train/validation/out-of-sample y walk-forward;
- sensibilidad a parámetros y estabilidad por subperiodos/regímenes;
- benchmarks y costo de oportunidad;
- correlación y marginal contribution to risk frente al portfolio;
- SHADOW/PAPER y divergencia entre comportamiento esperado y observado;
- decay, drift y criterios explícitos de suspensión/revisión.

La selección entre muchas estrategias también debe evaluarse fuera de muestra: optimizar el selector
contra los mismos datos de las estrategias produciría meta-overfitting.

### Niveles de automatización

1. **Advisory:** matriz y recomendación; el humano cambia estado/asignación.
2. **Supervised:** el sistema crea propuestas; el humano aprueba cada cambio.
3. **Policy automation:** una policy previamente aprobada permite cambios dentro de límites,
   cooldowns y modos definidos; GaleCore revalida y registra.
4. **LIVE autonomy:** diferida hasta P-LIVE, seguridad, reconciliación y evidencia suficiente.

Desplegada, habilitada, autorizada para riesgo nuevo y actualmente con posiciones son propiedades
distintas. Pausar nuevas entradas no debe abandonar la gestión de posiciones existentes.

### Ownership propuesto

| Componente | Responsabilidad |
|---|---|
| GaleCore | Facts, métricas, hard gates, estado de instances, portfolio risk, allocator/policy, autorización y ejecución |
| GaleCore-AI | Metodologías de research, context synthesis, edge assessment, fitness explanation, assurance y evals |
| Host | Orquestar specialists/workflows, mantener la sesión y presentar propuestas |
| Interfaz | Matriz de estrategias, contexto, evidencia, allocations, approvals, overrides y audit trail |

### Experiencia de interfaz buscada

Una vista `Strategy Portfolio` debería mostrar por estrategia:

- versión, modo, deployment e instance state;
- evidence/readiness y salud del edge;
- hard eligibility y motivos de bloqueo;
- context fit por horizonte, con confidence y evidence;
- exposición/correlación/marginal risk;
- allocation vigente y propuesta;
- posiciones abiertas y semántica de pausa;
- última decisión, policy, actor y trace.

El usuario debe poder simular “qué cambiaría si…” antes de aplicar una propuesta, comparar contra
mantener la asignación actual y ver por qué una estrategia fue preferida, limitada o excluida.

### No objetivos

- prometer o certificar rentabilidad futura;
- permitir que un LLM cambie switches, allocation o órdenes directamente;
- depender de un único score macro universal;
- activar/desactivar estrategias en cada cambio menor de contexto;
- optimizar sólo por retorno histórico ignorando riesgo, correlación, costes y estabilidad;
- modificar `StrategySpec` desplegadas en lugar de crear versiones nuevas;
- habilitar PAPER/LIVE como parte del primer vertical.

### Entry gate

- GC-AI-0001 está `VALIDATED` o `CLOSED`;
- existe historia/dataset suficiente para el primer análisis, vinculada a BL-004;
- al menos dos estrategias reales tienen StrategySpec y evidencia comparable;
- cada estrategia funciona de forma segura e independiente en SHADOW;
- se define semántica de deployment, enabled, accepting-new-risk, paused y position-management;
- se acuerdan objetivo del selector, benchmark, frecuencia de decisión, cooldown y límites;
- el product owner aprueba primero un work item read-only/advisory.

### Acceptance criteria

- [ ] Strategy Quality, context fit, portfolio fit, hard eligibility, allocation y autorización se
      representan como decisiones separadas y trazables.
- [ ] Cada assessment contextual conserva horizonte, timestamp, provenance, evidence y confidence.
- [ ] Un selector baseline determinístico puede compararse contra la recomendación cognitiva.
- [ ] El sistema incluye un benchmark de “mantener asignación actual” y penaliza turnover/churn.
- [ ] La evaluación del selector usa periodos no utilizados para ajustar las estrategias ni el
      selector.
- [ ] Missing/stale/conflicting data produce abstención o degradación explícita, no una selección
      aparentemente segura.
- [ ] El portfolio allocator respeta límites duros aunque todos los assessments favorezcan una
      estrategia.
- [ ] Pausar nuevas entradas preserva la gestión segura de posiciones ya abiertas.
- [ ] Todo cambio operativo genera una propuesta versionada, revalidación y audit trail; LIVE exige
      los controles P-LIVE.
- [ ] El primer E2E usa dos estrategias SHADOW y no requiere reemplazar el runtime existente.

### Preguntas abiertas

- ¿Context fit debe vivir dentro de StrategySpec, en un perfil separado o dividido entre hard gates
  y evidencia adaptable?
- ¿Qué objetivo optimiza el allocator: retorno ajustado por riesgo, drawdown, utilidad, estabilidad
  o una combinación declarada?
- ¿Con qué frecuencia puede cambiar allocation y qué cooldown evita churn?
- ¿Qué fuentes de noticias/eventos son evidencia y cuáles pueden convertirse en facts de GaleCore?
- ¿Qué decisions requieren aprobación por cambio y cuáles podrían quedar dentro de una policy
  preaprobada en SHADOW/PAPER?

**Addendum 2026-09-25 — GC-0004 (I3), propuesta de multiinstancia en SHADOW:** el owner pidió ver varias
estrategias en SHADOW a la vez y decidió **no** ampliar el runtime ahora ni abrir un incremento previo a I4; se
retoma cuando haya que comparar dos propuestas concretas (coincide con el primer E2E de este ítem: dos specs
SHADOW). Lo que implica, medido en el código al cierre de I3 (rama `feature/GC-0004-shadow-durable`, GaleCore):
- el invariante "una sola instancia RUNNING" está garantizado en memoria (`ShadowRuntimeStore.ActiveInstance`,
  `_deployGate`) y en la base (índice único parcial `ix_strategy_instances_single_running`); fue pedido por la
  revisión interna R1-M3 y Codex C1-M3 — pasaría a "una RUNNING por spec" con una migración nueva;
- el loop de entrada evalúa una instancia por tick; tendría que evaluar todas, cada una con su máximo de posiciones;
- ya existe: valuación de todas las posiciones abiertas de cualquier instancia, métricas por versión de spec y
  `POST /App/Runtime/Instances/{id}/Stop` (I3); la pestaña SHADOW muestra una instancia (la RUNNING) y no lista
  las posiciones de instancias paradas;
- riesgo: más llamadas a Tastytrade/DXLink por minuto (instancias × símbolos) compitiendo con RPF y GEX, y más
  filas en el plan Free de GaleCore Dev.
**Postergados, no descartados** (owner, 25/09), como capacidades futuras: una spec de prueba de acciones (hoy choca
con la prohibición de posiciones long direccionales de `GaleCore/CLAUDE.md`; requeriría una decisión explícita) y
una multi-ticker de spreads. Toca GaleCore.

---

## BL-008 — Gestión integral del portfolio y espacio financiero personal y compartido

**Estado:** `CAPTURED`

**Clasificación del feedback:** `BACKLOG_CANDIDATE`; requiere decisiones de producto y arquitectura
antes de implementar identidad, colaboración y ejecución programada.

**Target:** capacidad transversal de producto. Primer candidato: revisión patrimonial read-only
desde un host validado, como ampliación futura de inteligencia de consulta. Orden respecto de
SHADOW pendiente de decisión del owner; este registro no cambia la secuencia vigente.

**Origen:** conversación con el owner del 2026-09-22. Se busca gestionar el conjunto del portfolio,
comprender posiciones y sus fundamentos, investigar empresas y contexto macro, y desarrollar
métodos propios. Dos usuarios iniciales —el owner y su padre— necesitan espacios separados y la
posibilidad de compartir métodos e investigaciones explícitamente. Los importes y tenencias
personales no se registran como configuración del producto ni como fixtures del backlog.

### Problema y objetivo

El recorrido actual de régimen → investigación de estrategias → SHADOW no define por sí solo la
gestión del patrimonio: posiciones manuales, efectivo, renta fija, aportes, objetivos, monedas y
tesis de inversión. BL-007 administra un portfolio de estrategias; no sustituye esa visión integral.
La visión de WS-0001 deja el alcance multiusuario pendiente de definición.

Permitir que cada usuario trabaje con GaleCore-AI y un host compatible sobre su portfolio completo:
entender qué tiene y por qué, identificar exposiciones compartidas, investigar alternativas,
conservar decisiones y revisar resultados. Poder crear, evaluar y reutilizar métodos personales,
compartir versiones y coordinar trabajo recurrente con permisos y evidencia trazables.

El objetivo económico es personal y revisable, no una promesa de rentabilidad del producto ni una
cuota mensual que obligue a asumir riesgo. Aportes, retiros, resultados realizados/no realizados,
costos y efectos de moneda deben distinguirse mediante cálculos autoritativos.

### Alcance propuesto y ownership

| Parte | Responsabilidad propuesta |
|---|---|
| GaleCore | Integraciones, normalización de instrumentos y monedas, posiciones, flujos, valuación, exposición y resultados; preferencias financieras durables según v5 §3.11; credenciales, autorización y controles operacionales |
| GaleCore-AI | Métodos de revisión patrimonial, análisis fundamental y macro, tesis, escenarios, propuestas, skills y workflows versionados, evidencia y evaluación de outputs |
| Host / experiencia de trabajo | Conversaciones, proyectos, selección y coordinación de agentes, presentación, revisión y ejecución de tareas dentro de los permisos efectivos |
| Identidad y colaboración | Fundación transversal por diseñar: propietarios, membresías, ámbito de datos/assets, aislamiento, permisos y revocación; ubicación técnica de cada estado a resolver explícitamente |

Capacidades buscadas:

- Consolidar cuentas y activos, incluido efectivo o reservas declaradas fuera de brokers, con
  cobertura y procedencia explícitas. Una cartera parcial no se presenta como patrimonio completo.
- Registrar objetivos, horizontes, liquidez, aportes previstos, restricciones y fundamentos de
  posiciones. Distinguir razones declaradas por el usuario de hipótesis sugeridas por el modelo.
- Relacionar investigación de empresas, macro, noticias y calendario con posiciones y decisiones;
  conservar fuentes, fechas, supuestos e invalidaciones. Contexto favorable no equivale a edge.
- Crear y probar skills personales mediante BL-001; compartir una versión o derivar una variante
  sin cambiar silenciosamente métodos ajenos. Compartir metodología no comparte cuentas ni datos.
- Mantener proyectos, investigaciones, registros y permisos por usuario o espacio compartido.
- Definir agentes y tareas recurrentes con propietario, objetivo, contexto, capabilities,
  versiones efectivas, horario/zona, presupuesto, destino, fallos y cancelación observables.
  Evaluar primero capacidades del host; un runtime propio necesita justificación separada.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_NEW_FOUNDATION`, con prerrequisitos de datos, identidad y host.

Evidencia de código inspeccionada al capturar:

- `config/skills/regime-analysis/skill.yaml` declara metodología, versión, capabilities y contrato
  de output: aporta un patrón de asset, no una skill patrimonial ya implementada.
- `src/galecore_ai/application/record_regime.py` conserva facts, identidad de snapshot y assets
  efectivos; `record_accepted` restringe explícitamente la persistencia a `REGIME_SKILL_ID`.
  Es una base conceptual de trazabilidad, no un registro genérico ni multiusuario demostrado.

Primer vertical propuesto: un usuario obtiene una revisión de cartera read-only desde un host,
basada en un snapshot consolidado por GaleCore, registra tesis y preguntas pendientes y recupera
la revisión en otra sesión. Puede empezar con cobertura parcial declarada y crecer hacia varias
cuentas; la consolidación multicuenta debe probarse antes de afirmarla como capacidad completa.

La extensión necesita contratos propios de portfolio y revisión, y una decisión sobre persistencia
e identidad. Evaluar qué partes del almacenamiento actual son reutilizables; no ensanchar el
contrato de régimen ni asignar registros históricos a usuarios por inferencia. Cualquier migración
debe preservar lectura, hashes y versiones existentes, con asignación de propietario explícita.

La experiencia compartida y la recurrencia se prueban en incrementos posteriores acotados. No se
exige construir toda la plataforma para entregar la primera revisión, pero tampoco se declara
aislamiento por disponer solamente de carpetas separadas o instrucciones al modelo.

**Invariantes:** cálculos y controles en GaleCore; permisos impuestos fuera del modelo; versiones
y evidencia históricas recuperables; ninguna skill, agente o tarea concede autoridad operacional.

### Relación con el plan y backlog

- **BL-001:** lifecycle de skills; este ítem agrega contexto personal, variantes y colaboración,
  sin duplicar el sistema de publicación y evals ni omitir sus gates.
- **BL-003 / BL-006:** proveedores y federación MCP. IBKR, IOL y A3 son candidatos, no integraciones
  comprometidas. Determinar por caso si basta un adapter GaleCore o hacen falta contratos,
  mappings, conocimiento y UI nuevos. Datos autoritativos y acciones conservan sus fronteras.
- **BL-004:** historia y datos disponibles en cada momento cuando el análisis los requiera.
- **BL-005:** vistas personales y compartidas sobre un modelo común de identidad y permisos.
- **BL-007:** usa contexto patrimonial para portfolio fit; su selector mantiene sus propios gates.
- **v5 §§3, 7 y 11:** preserva ownership y hosts intercambiables; propone explicitar la misión
  patrimonial y concretar coordinación/recurrencia sin convertir GaleCore-AI en un host obligatorio.
- **WS-0001 / roadmap:** al aprobar el diseño, alinear VISION y PROJECT y decidir la ubicación de
  este recorrido en la única secuencia vigente. Consulta patrimonial no requiere por naturaleza
  PAPER/LIVE ni dos estrategias SHADOW, pero adelantarla requiere una decisión explícita de orden.

### Entry gate

- El owner autoriza un incremento acotado y su lugar en la secuencia; GC-AI-0002 conserva su alcance.
- Se define el primer usuario, conjunto de cuentas/activos, moneda de referencia, objetivo de
  revisión y cobertura mínima, sin incorporar datos privados al código o documentación pública.
- Se inspeccionan capacidades reales de balances, posiciones, flujos y valuación; faltantes se
  convierten en dependencias GaleCore explícitas, no en cálculos improvisados del modelo.
- Se elige un host y se valida su acceso a assets, datos, contexto y resultados persistidos.
- Se acuerdan identidad, autorización y almacenamiento para el incremento; compartir exige
  demostrar aislamiento, acceso y revocación antes de usar información privada de otro usuario.
- Cada incremento selecciona criterios de abajo y sus dependencias; no se declara completado el
  alcance integral a partir de una primera revisión individual.

### Acceptance criteria

- [ ] Una revisión multicuenta identifica cobertura, posiciones, efectivo, moneda, fecha y fuente;
      exposiciones equivalentes entre instrumentos/cuentas se relacionan sin doble conteo.
- [ ] Los resultados distinguen aportes, retiros, rendimiento, costos y moneda, o explicitan qué
      métrica no puede calcularse con la historia disponible.
- [ ] El usuario recupera en otra sesión objetivos, fundamentos, análisis y decisiones originales,
      con datos y versiones; lo desconocido no se completa con razones inventadas.
- [ ] Un análisis de empresa y uno macro relacionan evidencia con la cartera, conservan supuestos
      y límites y producen preguntas o propuestas revisables, sin autorizar operaciones.
- [ ] Dos usuarios usan una skill compartida sobre sus cuentas; una variante personal no altera
      la del otro y la adopción de una actualización queda registrada.
- [ ] Consultas, búsquedas de memoria, registros y tareas rechazan acceso cruzado no autorizado;
      compartir/revocar un asset no expone datos privados ni hereda permisos de broker.
- [ ] Una tarea programada deja resultado o fallo observable, propietario, permisos, versiones y
      evidencia; puede cancelarse y no ejecutarse con permisos revocados. El recorrido interactivo
      permanece utilizable sin habilitar trabajo autónomo.
- [ ] La revisión se compara con el proceso manual o host directo: cobertura, omisiones, tiempo y
      utilidad observada. La evaluación no confunde calidad técnica con rentabilidad.
- [ ] Los registros de régimen anteriores siguen legibles y verificables; cualquier migración
      queda documentada y no reescribe evidencia histórica.

### No objetivos de esta captura

- Cambiar prioridades, abrir otro work item o ampliar el contrato de GC-AI-0002.
- Implementar de una vez todos los brokers, mercados, agentes, un SaaS o un host propio.
- Ejecutar trading desde un MCP externo eludiendo GaleCore ni habilitar PAPER/LIVE o asignación
  automática por disponer de tareas programadas.
- Convertir datos privados, preferencias u objetivos de un usuario en metodología global.

### Decisiones abiertas

- ¿Qué capacidades patrimoniales deben preceder o seguir al próximo incremento SHADOW?
- ¿Cómo se separan identidad, cuentas, espacios compartidos y propiedad de investigaciones?
- ¿Qué estado durable pertenece a GaleCore y qué persistencia requieren los assets/proyectos?
- ¿Qué host se valida primero y qué contrato permitirá trasladar contexto entre hosts?
- ¿Cómo se comparten versiones, se derivan variantes y se revoca acceso sin filtrar información?
- ¿Qué revisión concreta justifica primero fuentes de empresas, macro, noticias y calendario?
- ¿Qué tareas necesitan recurrencia, qué aprobación las habilita y cuándo se justifica un runtime
  propio frente a la capacidad del host?

### Addendum 2026-09-29 — Atención diaria, capital disponible y seguimiento de posiciones

**Ideas aportadas por el usuario — texto completo, sin resumir ni modificar.**
El orden de implementación acordado se consulta en el roadmap §4.

```text
● Acá va el plan completo. Lo organizo en capas — de lo más atómico a lo más compuesto — con modelo, actores y dependencias para cada
  pieza.

  ---
  Fuentes disponibles y sus límites reales

  ┌──────────────────────┬──────────────────────────────────────────────┬───────────────────┬────────────────────────────────────┐
  │        Fuente        │                  Qué cubre                   │      Límite       │               Acceso               │
  ├──────────────────────┼──────────────────────────────────────────────┼───────────────────┼────────────────────────────────────┤
  │ GaleCore API (:5000) │ TastyTrade: balance, posiciones, opciones    │ Sin límite        │ httpx desde GaleCore-AI, ya está   │
  │                      │ SPY, GEX                                     │ (local)           │ wired                              │
  ├──────────────────────┼──────────────────────────────────────────────┼───────────────────┼────────────────────────────────────┤
  │ FRED                 │ Treasury rates, Fed Funds, inflación, macro  │ Sin límite        │ API pública, httpx directo         │
  ├──────────────────────┼──────────────────────────────────────────────┼───────────────────┼────────────────────────────────────┤
  │ FMP MCP              │ Calendario económico, noticias, earnings     │ ~250 calls/día    │ MCP disponible en sesión           │
  │                      │                                              │ free              │                                    │
  ├──────────────────────┼──────────────────────────────────────────────┼───────────────────┼────────────────────────────────────┤
  │ Alpha Vantage MCP    │ News sentiment, datos históricos,            │ 25 calls/día free │ MCP disponible en sesión           │
  │                      │ indicadores                                  │                   │                                    │
  ├──────────────────────┼──────────────────────────────────────────────┼───────────────────┼────────────────────────────────────┤
  │ GaleCore-AI          │ Historial régimen, research, perfil          │ Sin límite        │ CLI o lectura directa              │
  │ knowledge/           │                                              │ (local)           │                                    │
  └──────────────────────┴──────────────────────────────────────────────┴───────────────────┴────────────────────────────────────┘

  Sobre web scraping para noticias: no vale para agentes automáticos. Cada página cuesta tokens de contexto, es frágil y lento. FMP
  calendar cubre FOMC, CPI, NFP, Fed speakers — que es el 90% de lo que necesitás saber. AV news sentiment da un pulso de sentimiento
  con las 25 calls diarias. Para V1 es suficiente. El scraping lo reservamos para cuando el usuario pide investigar algo específico y
  no hay otra fuente.

  ---
  Capa 1 — Skills atómicas (bloques de construcción)

  Hacen una sola cosa, no sintetizan, no razonan. Modelo: Haiku.

  S-1: fetch-market-context

  Qué hace: trae calendario económico próximos 7 días + VIX actual + tasa treasury 3M
  Fuentes: FMP MCP (calendar) + AV MCP (VIX) + FRED API (httpx directo, gratis)
  Actores: Host llama MCPs, sin intervención de GaleCore ni del usuario
  Output: JSON { events: [{date, name, impact}], vix: float, treasury_3m: float }
  Cuándo se usa: llamada por A-1, A-2, A-3

  S-2: fetch-account-status

  Qué hace: trae balance TastyTrade, posiciones abiertas con DTE y P&L, buying power
  Fuentes: GaleCore API :5000 (TastyTrade está ahí)
  Actores: Host → GaleCore (HTTP) → TastyTrade
  Output: { idle_cash: float, positions: [{symbol, strikes, dte, pnl_pct}], buying_power: float }
  Cuándo se usa: llamada por A-1, A-2, A-3, M-1, M-2

  S-3: fetch-regime-context

  Qué hace: lee el último régimen de knowledge/regime/SPY/, calcula si está fresco (≤2 días hábiles)
  Fuentes: filesystem local
  Actores: Host lee archivos directamente
  Output: { regime: {gamma, tail_pricing, date}, fresh: bool, days_old: int }
  Cuándo se usa: llamada por A-1, A-2, A-3, M-3

  S-4: score-risk-window

  Qué hace: dado el output de S-1, puntúa el riesgo de la semana
  Lógica: FOMC/CPI/NFP esta semana → alto; Fed speaker → medio; semana limpia → bajo
  Actores: Host solo (sin MCPs, solo lógica sobre el JSON de S-1)
  Modelo: Haiku
  Output: { risk: "low|medium|high", reason: "CPI el miércoles" }

  ---
  Capa 2 — Agentes de análisis (síntesis y razonamiento)

  Orquestan varias skills, razonan sobre los datos, proponen. Modelo: Sonnet.

  A-1: capital-ocioso-agent

  El caso de uso que describiste.

  Flujo:
  1. Llama S-2 → ¿hay idle cash > umbral (configurable, ej. $1000)?
  → Si no hay capital ocioso: termina, informa
  2. Llama S-1 y S-4 → ¿qué riesgo tiene la semana?
  3. Llama S-3 → ¿cuál es el régimen? ¿está fresco?
  4. Razona (Sonnet):
    - Si risk=alto O régimen stale → propone conservador: "mové a T-bills, $X al 4.8% = $Y por 30 días"
    - Si risk=bajo Y régimen gamma positivo → evalúa PCS: calcula strikes (SPY spot - 5%), spread 5pts, crédito estimado, max loss,
  prob OTM
    - Compara PCS vs treasury en retorno esperado ajustado por riesgo
  5. Formula propuesta concreta para el usuario (llama E-1)
  6. Espera confirmación del usuario — nunca ejecuta sin ella
  7. Con confirmación → llama E-2 para colocar la orden en TastyTrade

  Actores: Host orquesta → GaleCore-AI razona → GaleCore ejecuta (solo con OK del usuario)
  Cuándo corre: on-demand (/capital-ocioso) o disparado por M-1
  Modelo: Sonnet para el paso 4, Haiku para el resto

  ---
  A-2: daily-briefing-agent

  Flujo:
  1. Llama S-1, S-2, S-3 en paralelo
  2. Sintetiza (Sonnet): qué pasó overnight, eventos del día, estado de cuenta, régimen vigente
  3. Una línea de acción: "esperá el CPI antes de hacer algo" / "semana limpia, spread abierto al 76% del profit"

  Actores: Host orquesta → MCPs + GaleCore + knowledge/
  Output: texto para leer en 2 minutos
  Cuándo corre: on-demand (/briefing) o scheduled 8:30 ET
  Modelo: Haiku para fetches, Sonnet para síntesis final

  ---
  A-3: position-manager-agent

  Flujo:
  1. Llama S-2 → posiciones con DTE ≤ 10 días
  2. Si no hay: termina
  3. Para cada posición: evalúa P&L actual + régimen (S-3) + riesgo semana (S-4)
  4. Propone por posición: cerrar / rollear (a qué fecha y strike) / dejar vencer
  5. Presenta al usuario para confirmación

  Actores: Host → GaleCore (posiciones) → GaleCore-AI (evaluación) → usuario confirma
  Cuándo corre: daily si hay posiciones abiertas (disparado por M-2)
  Modelo: Sonnet

  ---
  Capa 3 — Monitores (Haiku, scheduled, no interrumpen al usuario)

  Corren solos. Solo notifican o disparan agentes. No toman decisiones.

  M-1: idle-capital-monitor

  Hace: llama S-2, chequea si idle_cash > $1000
  Si sí: notifica al usuario "tenés $X ocioso, ¿corro el análisis?" y dispara A-1
  Schedule: diario 9:00 ET
  Modelo: Haiku

  M-2: position-expiry-monitor

  Hace: llama S-2, chequea posiciones con DTE ≤ 10
  Si hay: notifica y dispara A-3
  Schedule: diario 9:30 ET
  Modelo: Haiku

  M-3: regime-freshness-monitor

  Hace: llama S-3, chequea freshness
  Si stale: "el régimen tiene 3 días, GaleCore necesita estar corriendo para actualizarlo"
  Schedule: diario 9:00 ET
  Modelo: Haiku

  ---
  Capa 4 — Skills de ejecución (siempre con confirmación del usuario)

  E-1: propose-trade

  Hace: toma los parámetros de un trade y lo formatea legible
  Ejemplo: "Vender PCS SPY 480/475 vto. 20 dic · crédito $0.42 · max loss $458 · prob OTM 84% · capital requerido: $500/spread"
  No ejecuta nada. Solo presenta.
  Modelo: Haiku

  E-2: execute-trade (fase 2, no V1)

  Hace: con confirmación explícita del usuario, llama GaleCore API para colocar la orden en TastyTrade
  Nunca corre autónomamente. Requiere un "sí" textual del usuario en el turno anterior.
  Modelo: cualquiera (una sola llamada HTTP)

  ---
  Routing de modelos

  ┌─────────────────────────────────────────┬────────┬────────────────────────────────────────────────────────┐
  │                  Tarea                  │ Modelo │                     Justificación                      │
  ├─────────────────────────────────────────┼────────┼────────────────────────────────────────────────────────┤
  │ Fetch de datos, monitores, checks       │ Haiku  │ Determinístico, 0 síntesis, barato                     │
  ├─────────────────────────────────────────┼────────┼────────────────────────────────────────────────────────┤
  │ Análisis, síntesis, propuestas de trade │ Sonnet │ Balance costo/calidad para razonamiento financiero     │
  ├─────────────────────────────────────────┼────────┼────────────────────────────────────────────────────────┤
  │ Research profundo, strategy design      │ Opus   │ Solo cuando el usuario pide análisis estratégico nuevo │
  └─────────────────────────────────────────┴────────┴────────────────────────────────────────────────────────┘

  ---
  Secuencia de implementación

  Fase 1 (base): S-1, S-2, S-3, S-4  ← skills atómicas, sin ellas nada funciona
  Fase 2 (el caso real): A-1 + E-1    ← capital-ocioso funcional, sin ejecución aún
  Fase 3 (automatización): M-1, M-2, M-3 + schedules
  Fase 4 (completar flujos): A-2, A-3
  Fase 5 (ejecución): E-2 con TastyTrade

  ---
  Dónde vive cada pieza

  ┌──────────────────────┬──────────────────────────────────────┬───────────────────────────────────────┐
  │        Pieza         │                Dónde                 │            Quién la invoca            │
  ├──────────────────────┼──────────────────────────────────────┼───────────────────────────────────────┤
  │ Skills S-1..S-4, E-1 │ .claude/skills/ (SKILL.md)           │ Agentes o usuario vía /nombre         │
  ├──────────────────────┼──────────────────────────────────────┼───────────────────────────────────────┤
  │ Agentes A-1..A-3     │ .claude/agents/ (.md)                │ Host como subagente                   │
  ├──────────────────────┼──────────────────────────────────────┼───────────────────────────────────────┤
  │ Monitores M-1..M-3   │ .claude/agents/ + cron via /schedule │ Scheduler autónomo                    │
  ├──────────────────────┼──────────────────────────────────────┼───────────────────────────────────────┤
  │ E-2                  │ .claude/skills/                      │ Solo A-1 con OK explícito del usuario │
  └──────────────────────┴──────────────────────────────────────┴───────────────────────────────────────┘

  ¿Arrancamos por Fase 1 y 2 en un work item?
```

**Evaluación y priorización posteriores del asistente (no sustituyen las ideas anteriores):**

**Actualización posterior (29/09):** el owner autorizó la integración en el plan; el orden vigente
vive en `roadmap/README.md` §4 del workspace. La captura y recomendación originales de abajo se
conservan como antecedente, no como secuencia alternativa. Atención diaria empieza en SHADOW;
cuenta real y capital disponible van después de la base, en incrementos separados.

**Origen:** el owner pide evaluar y priorizar una propuesta de skills de datos (S-1..S-4),
análisis de capital disponible/briefing/posiciones (A-1..A-3), monitores (M-1..M-3) y propuesta/
ejecución (E-1/E-2). **Clasificación:** `BACKLOG_CANDIDATE`, `ALIGNED_WITH_PREREQUISITE`.
Se conserva en BL-008; enlaza BL-001 (creación y evolución), BL-006 (host/conectores), BL-007
(adecuación y riesgo), BL-015 (acceso de cuenta). No autoriza implementación ni modifica §4.

**Base inspeccionada:** GC-AI-0012 (fuentes) y GC-AI-0013 (perfil) figuran CLOSED en main;
GC-AI-0014 (orden por tipo de uso) es el activo según el puntero del workspace.
`config/sources.yaml` registra FMP economics-calendar denegado y acceso externo dependiente
del host. `capabilities/contracts.py` no registra balances/posiciones de cuenta, aunque
`DataController.cs` de GaleCore tiene endpoints de lectura. BL-015 registra 403 en Dev, no
un diagnóstico vigente de producción. `contracts/task.py` sólo acepta `strategy_followup`;
`application/followup.py` corre sin modelo. El scheduler actual no demuestra ejecución
autónoma de análisis con modelo ni disponibilidad de los MCP de una sesión interactiva.

**Secuencia recomendada, no aprobada:**

1. Completar el incremento activo. Usar «qué merece mi atención hoy» como primer caso de las
   entregas 3–4 del harness: método versionado, perfil, fuentes, datos frescos, faltantes y
   resultado recuperable. Reutilizar GC-AI-0007/0008 y el material de GC-AI-0010 (suspendido),
   sin reabrirlo implícitamente. Una vista SHADOW se identifica como tal y no representa la cuenta.
2. Si el objetivo elegido es capital disponible real, comprobar primero lectura autenticada
   de balances/posiciones de una cuenta delimitada y acordar la semántica de capital disponible.
   Un capital de referencia del perfil no sustituye un saldo ni buying power. Este acceso es
   una dependencia de GaleCore, no requiere activar todo BL-008 ni implementar multiusuario.
3. Convertir el recorrido útil en tarea recurrente con la entrega 5, tras demostrar ejecución
   sin sesión interactiva, acceso a fuentes/modelo, presupuesto, destino, fallos y pausa/cancelación.
   Checks de frescura/umbrales van en código; no requieren un agente ni modelo por chequeo.
4. Incorporar evaluación de posiciones contra las reglas/tesis aprobadas; después alternativas
   de asignación y construcción de operaciones, con datos y cálculos autoritativos suficientes.
   E-2 queda para un incremento de ejecución explícitamente autorizado, fuera de esta captura.

**Primer resultado observable:** pedido natural → perfil y antecedentes → estado/exposición
con origen y fecha → cambios y condiciones que requieren atención → pendientes explícitos →
registro con versiones recuperable en otra sesión. Sin calendario verificado no se informa
«semana sin eventos»; ausencia de datos no habilita una recomendación de inversión.
Medir utilidad por omisiones, tiempo de revisión, frescura y alertas duplicadas, no por número
de agentes ni rentabilidad inferida de un informe. La automatización agrega evidencia de
corrida por horario y destino accesible del resultado, no sólo un archivo de configuración.

**Ownership y límites:** métodos/contratos en GaleCore-AI (`config/skills`, catálogo y services),
datos operacionales/cálculos/riesgo/autorización en GaleCore, modelo y conectores en el host,
resultados/perfil en `knowledge/`. `.claude/` sólo adapta al host; no duplica métodos canónicos.
Los umbrales propuestos ($1000, 10 DTE, frescura de dos días, spot menos 5 %) son propuestas
sin validar, no reglas globales. Una etiqueta de eventos no prueba edge ni retorno esperado.
Un «sí» textual aislado no reemplaza aprobación de una propuesta identificada, revalidación e
idempotencia de ejecución. No se añaden proveedores pagos ni se asume acceso ilimitado.

---

## BL-009 — Taxonomía de conocimiento entre GaleCore y GaleCore-AI, y skill de ruteo

**Estado:** `CAPTURED`

**Target:** después de cerrar GC-AI-0002; primero un ADR de taxonomía, después la skill.

**Origen:** conversación con el owner del 2026-09-22, a partir del `partial` de ese día. Al
investigar cómo se calcula el GEX aparecieron cuatro lugares con conocimiento del dominio y
ninguno alcanzable por el host: los campos en prosa `_note` / `_por_que_existe` /
`_lo_que_la_banda_no_dice` dentro de `galecore_rules_gex.json`, `GaleCore/research/got/`,
`GaleCore/decisiones/` y la propia skill. La duda del owner fue si, con el host pasando por
GaleCore-AI, ese material debería migrar acá.

**Objetivo:** una taxonomía explícita de qué tipo de conocimiento vive en cada repo, con una skill
que la aplique al crear cada artefacto nuevo, para no seguir decidiéndolo caso por caso mientras
los dos repos coexisten.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE`. No toca código: es un ADR más una skill de proceso
en el tooling del workspace. La convención de `GaleCore/decisiones/README.md` (plataforma →
GaleCore, proceso → workspace, IA → `GaleCore-AI/docs/decisions/`) y la de `research/` como
antesala de la plataforma ya existen; la taxonomía las recoge en vez de reemplazarlas.

**Invariante anti-rewrite:** no mover `research/` ni los ADRs existentes de repo. La migración que
sí contempla es acotada: la prosa interpretativa embebida en los JSON de reglas.

### Alcance propuesto (no implementar antes del entry gate)

- ADR de taxonomía con los cuatro tipos distinguidos por consumidor: parámetro ejecutable,
  medición empírica, decisión, instrucción al modelo.
- Criterio de residencia y su fundamento, incluida la razón por la que `research/` no migra.
- Skill de ruteo que, ante un artefacto nuevo, indique destino y formato citando el ADR.
- Corrección puntual detectada: `PutSkewCalculator.LevelThreshold = 1.30` es una `const` de C#
  mientras `max_dte` es configuración JSON; dos parámetros del mismo análisis con residencia
  distinta y sin razón visible.
- **Restricción medida el 2026-09-22 al versionar los registros:** `research/regime/` es la ruta
  fija desde la que el loop lee y escribe (default de `GALECORE_RECORDS_DIR`), y a la vez está
  dentro del árbol de un repo de código. Trackearla en una rama propia hace que los archivos
  desaparezcan del disco al cambiar de rama, y el loop del día siguiente escribe sobre un
  directorio vacío. Un directorio de datos vivos no puede depender de en qué rama está parado el
  repo: el ADR debe decidir dónde vive un store de datos generados, no sólo dónde viven los
  documentos. (Sin efecto sobre la integridad: verificado que la conversión de finales de línea
  no rompe el `entry_hash`, que se calcula sobre el YAML parseado y no sobre los bytes.)

### Entry gate

GC-AI-0002 en `VALIDATED` o `CLOSED`, y el ADR de taxonomía aprobado por el owner.

### Acceptance criteria

- El ADR decide la residencia de los cuatro tipos y queda citado desde ambos repos.
- La skill produce destino y formato para un artefacto nuevo, y falla explícitamente cuando el
  caso no encaja en la taxonomía en vez de elegir por defecto.
- Ningún criterio de residencia queda sólo en esta conversación o en un handoff.

**Addendum 2026-09-23 — pedido del owner:** la parte de **proceso** de la skill de ruteo se
adelantó sin esperar el entry gate: `ENGINEERING.md` §1 ahora dice dónde va lo que surge
trabajando (backlog único, addendum antes que `BL-` nuevo, work item, ADR, pendientes, handoff) y
la skill `/donde-va` del workspace lo aplica. No decide nada nuevo: transcribe convenciones ya
vigentes. Lo que sigue abierto en este ítem es la **taxonomía del conocimiento de dominio** (los
cuatro tipos y su residencia), que §1 marca como "Sin regla todavía" y la skill deriva al owner.
Cuando el ADR se apruebe, se agrega como filas de §1; la skill no cambia.

---

## BL-010 — Procedencia de hechos como asset versionado

**Estado:** `CAPTURED`

**Target:** primer incremento después de GC-AI-0002; depende del ADR de BL-009.

**Origen:** el `partial` del 2026-09-22. La interpretación aceptada trató los call/put walls como
referencias de cobertura; la investigación propia de GaleCore tiene medido lo contrario (argmax
sobre un solo strike, nunca más del 19 % del GEX absoluto de su lado, saltos intradía, y sin
diferencia frente a cualquier strike del mismo delta sobre 926 observaciones 2013-2025). Los ocho
checks la dejaron pasar correctamente: los números eran exactos y no había recomendación de
trading. Lo que falta no es un guardrail, es que el host tenga a la vista qué está medido sobre
cada hecho.

**Objetivo:** que cada familia de hechos llegue al host con su procedencia declarada, versionada y
hasheada junto al resto de los assets efectivos.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE`. Reutiliza el cargador de assets, el hasheo y el
`effective_assets` del snapshot; agrega una clase de asset, no un mecanismo nuevo.

**Invariante anti-rewrite:** el asset **cita, no copia**. La medición sigue viviendo donde se
produjo; el asset lleva la afirmación, sus límites y un puntero verificable. Dos copias de una
medición son peor que una sola mal ubicada.

### Alcance propuesto (no implementar antes del entry gate)

- `config/facts/<familia>.yaml` por familia de hechos (gex, put_skew, vix/vvix): cómo se calcula,
  qué asume, qué corte usa, qué está medido sobre el hecho y con qué resultado, y qué no puede
  afirmarse a partir de él.
- Supuestos que hoy no están declarados en ningún lado que el host lea: el signo del GEX asume
  dealer largo calls y corto puts; el OI viene del candle del cierre anterior; los griegos y la IV
  son del proveedor (DXLink), no calculados por GaleCore; el skew se mide sobre la expiración de
  mayor DTE del rango, no sobre el frente.
- Check de integridad: la ejecución falla si un puntero de procedencia no resuelve.
- Regla 11 en la skill de régimen: no afirmar sobre un hecho algo que su procedencia declara no
  soportado. No es automatizable como guardrail; es criterio de review.

### Entry gate

GC-AI-0002 cerrado y el ADR de BL-009 aprobado (define dónde vive la medición citada).

### Acceptance criteria

- El `prepare` expone la procedencia de cada familia de hechos y su hash entra en
  `effective_assets`.
- Un puntero roto falla cerrado, como el resto de la verificación de assets.
- Una interpretación que contradiga una limitación declarada es un hallazgo de review con cita,
  no una discusión de criterio.
- La prosa migrada desde los JSON de reglas deja un puntero en origen; no quedan dos versiones.

---

## BL-011 — Recetas de corte versionadas para los hechos de mercado

**Estado:** `CAPTURED`

**Target:** Phase 5/6. **La decisión de cuáles son las recetas conviene tomarla antes**, porque
determina si los registros ya escritos siguen siendo comparables.

**Origen:** conversación del 2026-09-22. El owner planteó que un host con contexto de lo que se
está trabajando debería pedir el corte de datos adecuado — GEX corto para una estrategia 0DTE,
30-45 días para swing, agregado completo para un panorama macro — en vez de recibir siempre el
mismo corte fijo.

**Objetivo:** que el corte de datos sea parte del contrato y del registro, elegido entre recetas
nombradas y versionadas, sin perder comparabilidad entre registros.

### Encaje con la implementación actual

**Clasificación:** `ALIGNED_WITH_PREREQUISITE`. La cañería ya existe y está sin usar:
`GammaExposureRequest` acepta `MaxDTE`, `TargetDte`, `AllExpirations`, `IncludeZeroDte` e
`IncludeByExpiry`, y el desglose por vencimiento ya llega y se parsea en
`GaleCoreGexExpiryScope` (`byExpiry[]`), pero `by_expiry` no se usa en ningún lado de `src/`: el
mapper de régimen toma sólo el agregado y lo descarta. Hoy el corte está congelado en la skill
(agregado 0-60 DTE más skew sobre la expiración de mayor DTE del rango).

**Invariante anti-rewrite:** recetas acotadas y versionadas, no parámetros libres. Si el host elige
parámetros arbitrarios, dos registros del mismo análisis dejan de ser comparables y se pierde la
premisa del registro evaluable. La comparabilidad pasa a ser verificable: dos registros son
comparables si y sólo si comparten receta y versión.

### Alcance propuesto (no implementar antes del entry gate)

- Recetas nombradas, cada una un asset con su hash y su procedencia propia: p. ej. `gex_0dte`
  (0-1 DTE), `gex_swing` (target 30-45), `gex_macro` (agregado más `byExpiry`).
- Los límites medidos no son los mismos por receta: el hallazgo del wall vale para todas, pero el
  OI atrasado un día pesa mucho más en 0DTE que a 45 días. La procedencia (BL-010) es por receta.
- La receta elegida y su justificación entran en el registro.
- Paso previo de adecuación del pedido: su salida correcta es una pregunta o una negativa
  explícita, nunca un ajuste silencioso de parámetros.

### No objetivos de esta captura

- Permitir parámetros libres elegidos por el modelo.
- Cambiar el corte de la serie AC-08 en curso: cambiarlo antes de cerrarla la invalida.

### Entry gate

GC-AI-0002 cerrado, BL-010 implementado (una receta sin procedencia propia no aporta) y decisión
del owner sobre el conjunto inicial de recetas.

### Acceptance criteria

- El registro declara receta y versión; `query` permite distinguir registros comparables.
- Un pedido cuyo corte no corresponde al contexto produce pregunta o negativa registrada.
- Las recetas son un conjunto cerrado y versionado; agregar una es un cambio de asset revisado.

**Addendum 2026-09-23 — review del owner, jornada 3 de AC-08:** el corte fijo actual **incluye el
0DTE del mismo día en una lectura post-cierre**, cuando esos contratos ya vencieron y su gamma a
DTE 0 está degenerada. Observado (no archivado) en `/App/Gex/Analysis` de SPY a las 20:56 UTC: el vencimiento
2026-09-23 aporta −435.7 de un agregado de −822.5 (53 %); sin él, ≈ −386.8. Afecta igual a los
registros del 21 y 22 (mismo corte), así que la serie es consistente entre sí pero comparte el
sesgo. Consecuencia para el alcance: toda receta declara qué hace con el vencimiento del día según
el momento de la lectura (intradía vs post-cierre), y el cambio va en GaleCore (`IncludeZeroDte`
ya existe en `GammaExposureRequest`). No se aplica a la serie AC-08 en curso (ver no objetivos).

---

## BL-012 — Acceso del host a GaleCore por MCP

**Estado:** `CAPTURED` (pedido del owner, 2026-09-24)

**Origen:** el owner notó que el host consulta GaleCore "a mano" (CLI de GaleCore-AI, `curl`, scripts)
y preguntó si no debería existir un MCP de GaleCore bien detallado.

**Lo que hay (verificado 24/09):** GaleCore ya expone un servidor MCP en `/mcp`
(`DataFeed.Api/Infrastructure/McpTools.cs`, `app.MapMcp("/mcp")` en `Program.cs`) con ~11 tools de
datos crudos: cotización, trade, griegas, trade+quote+greeks, cadena de opciones, candles, GEX por
strike, IV Rank/Percentile, IV por plazo. **No está conectado** a Claude Code en este workspace.

**Lo que falta o hay que revisar:**
- No cubre lo que el trabajo usa hoy: `/App/Gex/Analysis` (el GEX global de la estrategia), put
  skew, el runtime SHADOW (`App/Runtime/*`: specs, instancias, evaluaciones, eventos), cuenta.
- Algunas descripciones podrían estar desactualizadas (dicen "Black-Scholes" y "expiración regular
  más cercana" donde el GEX de la estrategia es global con griegas de DXLink): verificar.
- Autenticación (ApiKey o JWT), solo lectura por defecto, y cómo se registra en el host.
- Relación con GaleCore-AI: las capabilities de GaleCore-AI (procedencia, frescura, validación) vs un
  acceso directo del host por MCP. v5 §6 ya distingue REST y MCP; hay que decidir qué va por cada uno
  para no tener dos caminos a los mismos datos con garantías distintas.

**Pregunta para el owner:** ¿el MCP de GaleCore pasa a ser la forma principal en que el host lee
datos, con GaleCore-AI validando lo que se afirma? Se decide al contrastar con el plan (no entra en I2).

**Relación:** `BL-006` (tools externas y confianza), v5 §6.

## BL-013 — Hora de bid/ask en las cotizaciones de DXLink

**Estado:** `CAPTURED` (decisión del owner en GC-0002, 2026-09-24)

**Origen:** Codex C1 de GC-0002 pidió rechazar las cotizaciones de opciones sin hora del proveedor.
En vivo (24/09), DXLink manda todos los Quote con `eventTime` 0, así que esa regla dejaría al runtime
SHADOW sin poder cotizar ninguna pata. El owner decidió aceptar la hora desconocida como limitación
declarada (protección: sin fills ni cierres fuera de sesión; hora vieja o futura sí se rechaza) y
capturar acá la mejora de fondo.

**Qué es:** pedir a DXLink los campos de hora de la cotización (`bidTime`/`askTime`, o `time` del
evento) en la configuración del feed de Quote, mapearlos en `QuoteModel`/`QuoteEvent` y usarlos en
`MediatorRuntimeMarketData.GetQuoteAsync` para que `DataFreshness` pueda medir la edad de cada pata.

**Riesgo:** el streaming DXLink lo usa todo GaleCore (RPF, GEX, monitor); cambiar el FEED_SETUP es un
cambio transversal y necesita verificar que ningún consumidor dependa del formato actual.

**Entry gate:** GC-0002 cerrado y decisión del owner de abrirlo como work item de GaleCore.

## BL-014 — Cobertura del OI en el GEX (¿falta o es cero?)

**Estado:** `DIAGNOSED` (24/09, mismo día). Dos causas: (1) **bug**: la ventana de 2 días de candles
dejaba sin OI a strikes sin operaciones recientes (call 515 OI 97 → 0); fix listo en GaleCore
`fix/gex-oi-lookback`, Codex APPROVE, PR a la espera del owner (GC-0003); (2) **no bug**: strikes de $1
recién listados y calls muy dentro del dinero con OI 0 real (verificado contra IBKR). Pendiente: medir el
impacto en el GEX global sobre la misma foto del mercado. Captura original abajo.

**Estado original:** `CAPTURED` (decisión del owner en GC-0002, 2026-09-24)

**Origen:** Codex C2 de GC-0002 pidió exigir cobertura de OI por lado en el net GEX del gate. Con los
contadores nuevos de `GammaExposureResponse` (`CallOiRequested/Received`, `PutOiRequested/Received`),
en vivo el 24/09 ~18:00 UTC el GEX de SPY (vencimiento 2026-11-20) recibió OI para **50 de 168 calls y
44 de 124 puts** de la banda de |delta| 0.02–0.98, igual en cuatro corridas. `TryParseValidOpenInterest`
descarta el OI ≤ 0, así que no se distingue un OI cero real de un candle que no llegó. El owner eligió
mantener en el gate la regla mínima (griegas completas + OI de los dos lados) y declararlo.

**Qué es:** averiguar si el OI faltante es cero real o dato perdido (candles sin OI, cupo de
suscripción, lotes que vencen), y según eso: registrar el cero como dato, o reintentar/marcar el
faltante. Después, definir con evidencia qué cobertura exige el gate.

**Relación:** mismo cálculo que `BL-002` (escala) y `BL-011` (corte post-cierre). Afecta a todo
consumidor del GEX de GaleCore, no sólo al runtime.

**Entry gate:** GC-0002 cerrado y decisión del owner.

## BL-015 — 403 de Tastytrade en los endpoints de cuenta que llama `RpfLoopService`

**Estado:** `CAPTURED` (owner, 2026-09-25; observado en GC-0004)

**Origen:** corridas de GC-0004 en GaleCore Dev, 25/09. En sesión de mercado, cada tick de `RpfLoopService`
falla con `AccountPositionsHandler Error: … 403 (Forbidden)` y `AccountBalancesHandler Error: … 403 (Forbidden)`
("RpfLoop: fallo evaluando SPY; emito estado de error"). Conteo en los logs locales de la API de esa sesión
(`%TEMP%/gc0004-*-api.log`, fuera de git): 68 de posiciones y 85 de balances; **cero** en las corridas fuera de
sesión del 24/09 (`run0`, `run0b`, `env1`), porque el loop sólo evalúa en sesión. Los datos de mercado (quotes,
cadenas, GEX) funcionaron en las mismas corridas; el runtime SHADOW no se ve afectado.

**Qué se sabe y qué no:**
- **Sólo hay evidencia en desarrollo:** API local contra el proyecto Supabase GaleCore Dev. Sin usuario en la
  request (el loop corre sin token), `AccountPositionsHandler` resuelve la credencial de sistema y, si no la
  hay, cae a la configuración (`Tastytrade:AccountNumber` y el refresh token de user-secrets); GaleCore Dev no
  tiene la fila `is_system` de `accounts` (verificado el 25/09: `accounts` vacía, 0 filas; en producción la
  credencial de sistema sale de esa fila, según `GaleCore/CLAUDE.md`). Hipótesis sin verificar: la credencial o el
  número de cuenta que usa el loop en local no tienen acceso a esa cuenta.
- **Producción: sin evidencia en ningún sentido.** No se revisaron logs del VPS; no se supone que ocurra ni que
  no ocurra.

**Qué es:** determinar qué credencial y qué número de cuenta usa el loop en cada entorno, si el 403 existe en
producción (logs del VPS en sesión) y, si es sólo del entorno local, documentar cómo configurarlo o que el loop
lo informe como estado esperado en vez de error por tick.

**Entry gate:** decisión del owner de abrirlo como work item de GaleCore. No es de I3 ni lo bloquea. Toca GaleCore.

## BL-016 — Mejoras visuales de la pestaña SHADOW del monitor

**Estado:** `CAPTURED` (owner, 2026-09-25)

**Origen:** recorrido del owner de la pestaña SHADOW (GC-0004, I3) contra GaleCore Dev: "requiere mejoras
visuales pero anda". Evidencia de cómo se ve hoy: `GaleCore/docs/evidence/gc-0004/walk1/walk-3-shadow.png`.

**Qué es:** las mejoras concretas las define el owner al abrirlo. Observado al hacer el recorrido headless, para
considerar: las horas de las tablas salen en la hora local del navegador y el reloj del encabezado en ET; con
varias instancias o versiones, la pantalla muestra sólo la RUNNING (ver addendum de `BL-007`). Las métricas
siguen calculándose en la API (el front no calcula).

**Entry gate:** GC-0004 cerrado y lista de mejoras del owner. Toca GaleCore (monitor).
