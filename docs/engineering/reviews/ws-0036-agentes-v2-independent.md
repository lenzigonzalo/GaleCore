# WS-0036 · revisión independiente de Agentes v2

**Resultado:** APPROVE para integración local. No quedan hallazgos bloqueantes abiertos. Este resultado no acredita QA visual ni autoriza `VALIDATED`, `CLOSED`, producción, push o PR.

## Alcance exacto

- GaleCore, rama `feature/WS-0036-agentes`: diff sin commit contra `e98d2120fe41a5993ca61f4be8fbf2c78d086fd3` en `Agentes.tsx`, `Agentes.css`, `Agentes.test.tsx` y `Markdown.tsx`.
- GaleCore-AI, rama `feature/WS-0036-agentes`: diff sin commit contra `426ad6a0298e1af1a509b26e21cf9f9f9a4aa0b3` en `space.py`, `tasks.py`, `contracts/task.py`, `test_space.py` y `test_model_tasks.py`.
- Revisión estática de una pasada, enfocada en fidelidad del historial, edición concurrente, selección de modelo y preservación del contrato de ejecución. `git diff --check` terminó sin errores en ambos repos; GaleCore sólo informó la conversión futura LF/CRLF de `Agentes.css`.
- El árbol de GaleCore-AI contenía además `.pytest-agentes-output.txt`, artefacto de una corrida y fuera del diff de producto revisado.

## Hallazgo de la pasada

1. **Pedido mixto de configuración y estado podía descartarse sin rechazo.** En la versión revisada inicialmente, `apply_requests` devolvía `already` antes de validar el formato cuando `request.status` coincidía con el estado actual. Un pedido como `{status: "active", settings: {...}}` sobre una tarea activa perdía la edición y no dejaba `request_error`, aunque el contrato exige separar configuración y estado y rechazar pedidos inválidos.

   El implementer informó que restringió el atajo `already` a pedidos sin `settings` y agregó `test_combined_settings_and_current_status_are_refused_instead_of_discarded`. `test_space.py` completo pasó después del ajuste: 21 tests, exit 0. Conforme a la revisión independiente de una sola pasada, no hice un recheck del parche; registro la corrección y su evidencia reportada.

## Evaluación

El historial nuevo conserva la identidad de cada resultado. Las corridas de modelo sólo reciben informe cuando el evento guarda `research` y su `revision` exacta; una corrida `INCOMPLETE` sin revisión queda sin informe, aunque exista uno bueno anterior. Las tareas por código enlazan cada evento con su `followup` exacto. La publicación se limita a 20 filas y 6000 caracteres de informe por fila, marca el recorte y mantiene el total por separado.

La edición escribe `request.settings` y se aplica bajo el lock de la tarea. La validación admite únicamente objetivo y modelo, rechaza modelos fuera de Haiku/Sonnet/Opus, texto vacío o excesivo, tareas canceladas, pedidos anteriores a un cambio local y selección de modelo en tareas por código. El cambio conserva horario, estado, herramientas, fuentes y límites. Mientras hay un pedido remoto, el front bloquea edición y toggle hasta la siguiente sincronización.

Para tareas de modelo, `None` conserva la política del catálogo. Una elección explícita llega al cliente y evita la escalada automática de `market_story`; no cambia `allowed`, `max_turns` ni timeout. Las tareas por código siguen sin invocar ni elegir modelo.

La UI muestra tarjetas de altura uniforme, nombres derivados legibles, frecuencia y toggle en el listado. El detalle agrupa corridas por fecha y las deja plegadas; retira «Al día» e identificadores técnicos y permite editar instrucciones/modelo. Los errores técnicos permanecen disponibles dentro de cada corrida. El cambio compartido de `Markdown` mantiene los valores anteriores por defecto (13 px/1.55) y Agentes solicita 15 px/1.65 de forma explícita.

## Evidencia considerada

- Ejecuté los tests focales: Agentes, 9/9 verdes; GaleCore-AI `test_space.py` + `test_model_tasks.py` antes del ajuste final, 68/68 verdes.
- El implementer reportó build CI verde y suite completa del monitor verde: 39 suites, 175 tests. La primera corrida del front falló por `internalConnectMultiple` de Node 20.9; el reintento con `--no-network-family-autoselection` pasó.
- GaleCore-AI: 89 tests del área y ruff verdes antes del ajuste; `test_space.py` 21/21 verde después. La suite amplia no se acredita verde porque el test del gate detectó que el worktree está fuera del workspace; el gate activo y ese test se ejecutaron desde el checkout principal y pasaron.
- Lectura real y sólo lectura de `agent_state`, sin ejecutar modelos ni modificar datos: atención diaria publicó 14 corridas con la última `INCOMPLETE` sin informe; seguimiento publicó 20 corridas con informe propio por fila; historia publicó 10. Los payloads observados quedaron entre 50 y 59 kB, bajo el límite de 200 kB de la API.

## Observación no bloqueante

Para tareas por código, `t.runs(..., limit=20)` aplica el límite después de que `followup_history` leyó y validó todos los registros de la estrategia. La respuesta y su fidelidad están acotadas y probadas, pero el trabajo local de la sincronización cada cinco minutos crecerá con el historial acumulado. No afecta esta integración; conviene acotar también la lectura en una pieza posterior si el volumen empieza a ser material.

## Limitación visual

CUA no ofreció Chrome ni navegador integrado. No se observó la pantalla con datos de Dev en escritorio o 760 px y no se generaron capturas. Esa comprobación queda pendiente para el owner después de integrar localmente.
