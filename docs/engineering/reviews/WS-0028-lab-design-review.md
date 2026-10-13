# WS-0028 — Review de ficha Diseño y preparación de mensaje

Fecha: 12/10/2026. Reviewer independiente: Codex / Sol 6.1, solicitado por el owner. Una pasada estática del diff; no es review Sonnet ni aceptación/cierre del work item.

## Alcance e identidad

Worktree `.worktrees/galecore/WS-0028`; HEAD/base `79ac3c7fa19ba08eae43617a737c0c6d4c9900fc`. Árbol inicial: tres archivos modificados y `LabStrategySheet.tsx` nuevo no versionado. El diff de los archivos rastreados tenía 31 inserciones y 10 eliminaciones; esa cifra excluye la ficha nueva.

Snapshot leído:

- `source/galecore-monitor/src/pages/Lab.tsx`: `1b71fd15823686578b417ef4cdfc28636cbabe6c`.
- `source/galecore-monitor/src/pages/LabShadow.tsx`: `20fb7672fa54cd823d07b4c4dff19992092ae337`.
- `source/galecore-monitor/src/pages/LabStrategySheet.tsx`: `2e17d2813b59820d2e53f519c2b5e77058a9161f`.
- `source/galecore-monitor/src/pages/Lab.css`: `c7a14b00f7fab9e666e8d65ab0d0be863234e740`.

Alcance autorizado comunicado por el principal: Diseño real con hipótesis, reglas, parámetros, pendientes y preparación de mensaje revisable en chat. Se verificó contra el contrato y selección reales de `GaleCore-AI/src/galecore_ai/{application/project.py,contracts/strategy.py}`. ENGINEERING.md y CLAUDE.md ya fueron leídos en las revisiones anteriores.

**Resultado: APPROVE estático, con observación menor F1.** Sin hallazgos bloqueantes. QA del recorrido está siendo añadida por el principal; su ejecución, build y aceptación del owner no se acreditan por este review.

## F1 — P3: texto corrupto en la entrada a Diseño

`Lab.tsx:186` contiene el literal visible `Dise?o` en el botón de navegación. Sustituir por `Diseño`; el carácter interrogación está en el archivo y no es sólo representación del terminal. Comunicado al implementer antes de emitir.

## Evaluación del comportamiento

- Fuente real: hipótesis, reglas y compatibilidad, parámetros de reglas, owner_decisions, pendientes, declared_gaps y log.open corresponden a los campos de `strategy_project`. Los nueve bloques de la ficha corresponden exactamente al enum Block. No se fabrican reglas o valores cuando faltan: se muestra la ausencia de definición.
- Versiones: el backend selecciona la última versión aprobada si existe; de otro modo, la última propuesta. La ficha respeta esa selección y muestra ref completa, versión y estado, además del aviso sobre propuestas posteriores sin aprobar. No elige una propuesta nueva como aprobada. El texto «Aprobada para SHADOW Dev» coincide con `APPROVAL_SCOPE = SHADOW:galecore-dev` del contrato leído.
- Integridad: la lectura canonical conserva el rechazo de `integrity_failed` antes de setStrategy; una falla muestra alerta/reintento y no entrega los datos a LabStrategySheet. Cambiar proyecto o modo remonta LabShadow por key e invalida callbacks del efecto anterior mediante active. Actualizar invalida también la ejecución previa del efecto.
- Diseño sin runtime: fetchShadowMetrics/fetchShadowStatus están bajo `mode==='shadow'`; Diseño sólo lee `/workspaces/{id}/strategy`. runtimeLoading se inicializa aunque no haya solicitud runtime, pero no se renderiza en la rama Diseño y no introduce efecto externo. No hay deploy, aprobación, stop ni escritura de propuesta desde la ficha.
- Mensaje revisable: los botones llaman onChat con texto, que añade el mensaje al borrador actual y cambia a Chat. No llaman send, requestSubmit, labRequest con body ni al modelo. El usuario puede editar antes de usar el envío existente. Las instrucciones incluyen la ref de la versión y piden proponer antes de guardar otra versión.
- Borradores/proyectos: el callback usa la clave existente projectId/chatId; actualiza el estado con setter funcional y conserva el borrador previo mediante separación de párrafos. No abre otra conversación, no vacía otro borrador ni modifica provider/modelo/esfuerzo. Al cambiar proyecto, el remount evita que quede un botón de ficha vieja activo para el nuevo proyecto. Se intenta devolver foco al textarea tras volver a Chat.
- Representación: React escapa el texto de la propuesta, sin HTML ejecutable. Las reglas conservan id, texto, parámetro y compatibilidad declarada; no se reduce el conjunto de reglas para ocultar las que el runtime no soporta. La interfaz aclara que ausencia de pendientes declarados no certifica completitud.
- Alcance: no se modifica el backend, el contrato canonical, la selección de versiones ni los permisos; la ficha nueva y CSS trazan al pedido de Diseño. La rama SHADOW conserva sus datos y comportamientos existentes.

## Evidencia y límites

El reviewer ejecutó únicamente lecturas, git status, rev-parse, diff/stat y hash-object. No ejecutó QA/build, navegador, red ni control de procesos. No editó implementación, items ni reviews anteriores.

Antes de entregar conviene acreditar el recorrido de Diseño con propuesta real guardada/fixture identificado, integridad fallida, versión aprobada con propuesta posterior, cambio de proyecto y botón sobre un borrador existente; comprobar que no hay llamadas runtime desde Diseño ni envío automático. Revisar también un borrador cercano a 12000 caracteres: el append programático puede superar el maxLength del textarea, que restringe entrada manual pero no asignaciones de value. El código conserva el texto, sin truncarlo; este review no afirma haber probado la edición/envío de ese caso extremo.

QA final y disposición de F1 deben quedar en evidencia del implementer sin editar este informe. VALIDATED/CLOSED requieren aprobación del owner.