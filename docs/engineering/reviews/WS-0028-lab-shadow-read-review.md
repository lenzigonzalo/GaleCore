# WS-0028 — Review de lectura separada de estrategia y SHADOW

Fecha: 12/10/2026. Reviewer independiente: Codex / Sol 6.1, solicitado por el owner. Una pasada estática; no es review Sonnet ni aprobación/cierre del work item.

## Alcance y snapshot

Worktree `.worktrees/galecore/WS-0028`; HEAD/base `ca5cc5c6f18cf64ba1eb9f92eac8c9152cd8c88d`. Diff sin commit leído: seis archivos modificados (55 inserciones y 14 eliminaciones) y fixture SHADOW nuevo no versionado.

Blobs de implementación leídos:

- `source/galecore-monitor/src/pages/LabShadow.tsx`: `a1a35608ab65a61945101176d25a5f9965547973`.
- `source/galecore-monitor/src/api/shadow.ts`: `f9a90f5b62d6e4752f3e79b1a23cfa4da153e1c2`.
- `source/galecore-monitor/src/index.css`: `45820594e747f0ae249dc7d6566e4548b5a53a03`.
- `source/galecore-monitor/src/pages/Lab.css`: `48abca4f6901de3a5d9d5b3eab534d67ab45a028`.

Se leyó además el diff de `docs/engineering/evidence/lab-composer-qa/{api.ts,check.cjs}`, el nuevo `shadow.ts` y el contexto de los clientes reales `api/client.ts` y `api/lab.ts`. ENGINEERING.md y CLAUDE.md ya fueron leídos en las pasadas anteriores. Alcance pedido: cargas separadas, errores/reintento, conservación de datos/versiones/integridad/persistencia, carreras entre proyectos y ajustes de toggles. La propuesta de ficha editable no pertenece a este diff.

**Resultado del snapshot: CHANGES_REQUESTED por F1 (P2).** Sin otros hallazgos bloqueantes en esta pasada. QA/build final están a cargo del implementer; no se atribuyen resultados no ejecutados por el reviewer.

## F1 — P2: una versión canonical desconocida se muestra como mismatch

Ubicación: `LabShadow.tsx`, render de `lab-shadow-instances`, expresión `hash(i.versionHash)===hash(strategy?.current?.spec_hash)?'Versión actual':'Otra versión'`.

Tras separar cargas, el runtime puede terminar antes que la lectura canonical de estrategia. También puede estar disponible cuando esa lectura falla por timeout o integridad. En esos estados `strategy` permanece null y el hash canonical se transforma en string vacío. Toda instancia con un hash real queda etiquetada «Otra versión», aunque todavía no se comprobó cuál es la versión actual. Antes, la compuerta conjunta de Promise.all impedía que ese render ocurriera con canonical pendiente/fallida.

Ejemplo reproducible para QA: retornar una instancia RUNNING con `versionHash=sha256:qa`, mientras la estrategia cuyo hash es también `sha256:qa` sigue pendiente. La etiqueta inicial afirma «Otra versión» y luego cambia a «Versión actual» cuando llega la lectura. Si la estrategia falla, la afirmación incorrecta permanece.

Corrección requerida: comparar sólo cuando exista un hash canonical comprobado. Mientras esté pendiente, falle la lectura o no exista versión canonical, mostrar un estado neutral explícito (por ejemplo «Versión sin comprobar»). Conservar las métricas históricas por versión y sus hashes sin convertir la falla de lectura en un mismatch.

Comunicado al implementer antes de emitir. El fixture leído usa `metrics:[]` e `instances:[]`, y su `/strategy` responde inmediatamente; por ello los escenarios nuevos de QA no detectan este caso. Agregar instancia con hash real y estrategia pendiente/fallida permite comprobarlo sin inferencias ni datos financieros nuevos.

## Resto de la evaluación

- Separación de lecturas: una demora/error de runtime ya no borra la propuesta canonical que sí se obtuvo. Loading y errores tienen estados propios; runtime pending/error no se presenta como «No hay métricas». Reintentar dispara nuevas lecturas y limpia los resultados anteriores.
- Carreras: cada ejecución del efecto conserva su propia bandera `active`; cambiar proyecto, nombre canonical, tipo o retry invalida los callbacks de la ejecución previa. Así una respuesta tardía no escribe datos en el proyecto siguiente. Las solicitudes anteriores no se abortan, pero el diff no introduce un poll nuevo ni operaciones de escritura.
- Integridad: `integrity_failed` evita que se publique la estrategia actual/aprobada. Runtime conserva lectura independiente de métricas e instancias; F1 cubre la distinción pendiente entre datos históricos disponibles y versión actual sin comprobar.
- Persistencia: se conserva la comprobación de `status.persistence.available`; su fallo genera error explícito, sin publicar métricas ni instancias como datos válidos. El vacío se reserva para una lectura runtime completa sin resultados del proyecto.
- Datos financieros/versiones: siguen filtrándose por `specName===project.strategyName`. No se recalculan, agregan ni mezclan P&L entre versiones. `contentHash`, métricas por versión, falta de valuación y avisos de simulación se conservan. La referencia canonical se acorta sólo visualmente mediante su último segmento; la referencia completa continúa en title.
- Timeout: sólo Metrics amplía timeout a 30000 ms; Status y el cliente global conservan 15000 ms. `readError` transforma timeout/aborted en una descripción humana de lectura no comprobada. La ampliación no demuestra ni corrige por sí misma una causa backend; la medición Dev suministrada por el principal no fue repetida por este reviewer. Este helper compartido también afecta las otras pantallas que llamen fetchShadowMetrics.
- Autorización: no hay deploy, stop, aprobación, escrituras ni cambios de hash. El aviso de crítica/aprobación de versión exacta permanece. Los cambios de tamaños de toggles son presentación y no alteran permisos o selección.

## Evidencia ejecutada y límites

El reviewer ejecutó sólo lecturas, `git rev-parse HEAD`, `git status --short`, `git diff --stat`, `git diff` y `git hash-object`. No ejecutó QA, build, navegador, solicitudes de red ni control de procesos. No modificó implementación, contratos previos, reviews anteriores o work items.

El guion leído contempla runtime pending/timeout/retry, persistencia no disponible e integridad fallida mediante fixtures explícitos; su lectura no acredita PASS. No prueba el transporte Axios real de 30 s, una lectura canonical demorada ni instancia/versionHash no vacío en esos estados. La entrega debe enlazar los resultados reales del implementer, conservar esos límites y registrar la disposición de F1 sin editar este review. VALIDATED/CLOSED siguen siendo decisión del owner.