# WS-0036 · revisión independiente de Agentes

**Resultado:** APPROVE. No encontré hallazgos que frenen integrar esta rama localmente para que el owner revise la pantalla.

## Alcance

- Revisión estática independiente del rango `6aa4541e16bee969625f732d80f89b6b58633b73..a22b5d252b2fa6406206c17d69576fa33285eb70` en `feature/WS-0036-agentes`.
- Archivos revisados: `Agentes.tsx`, `Agentes.css`, `Agentes.test.tsx` y la evidencia `docs/engineering/evidence/ws-0036-agentes/ENTREGA.md`.
- El árbol estaba limpio al comenzar esta revisión. `git diff --check 6aa4541..a22b5d2` terminó con exit 0.
- Contrasté el diff con el pedido del owner, el contrato de WS-0036, `ENGINEERING.md`, la guía `galecore-frontend` y el contrato publicado por GaleCore-AI para pedidos, supervisor y `last_run`.

## Evaluación

El listado implementa «Tuyos», «Plantillas» y «Nueva tarea» y deja la apertura del detalle como una acción explícita. Las plantillas y la acción nueva abren un pedido editable y copiable; no llaman a `saveSpaceItem` ni presentan el pedido como una tarea ya creada.

El detalle distribuye historial/resultado a la izquierda e instrucciones, frecuencia, ejecución y detalles a la derecha. Como la API sólo publica `last_run`, muestra una sola entrada y declara de forma visible que GaleCore conserva únicamente la última corrida; el contador se presenta como cantidad, sin inventar registros.

El control activo/pausa conserva el protocolo existente: escribe un `request`, espera la republicación de la PC y muestra el estado pendiente sin afirmar que el cambio ya se aplicó. El supervisor continúa sin control de pausa. La detección de publicación vieja conserva el aviso, el último resultado y oculta una próxima corrida que ya no es confiable. Los errores de lectura, guardado y aplicación siguen siendo explícitos.

Los controles principales son botones nativos; el toggle expone semántica de `switch` y nombre según la acción; el resultado declara `aria-expanded`; y el diálogo tiene nombre, foco inicial, cierre con Escape, trampa de foco y restauración del foco previo. El foco visible proviene del estilo global del monitor. No observé una regresión funcional o de accesibilidad en el diff.

## Evidencia considerada

La evidencia del mismo commit registra build CI verde y suite completa verde: 39 suites, 172 tests, incluidos los 6 casos de Agentes. Esos casos cubren listado/detalle, pedido de pausa pendiente, plantilla sin creación, error/reintento/vacío, supervisor y publicación vieja. No tomé esos tests como prueba de apariencia ni de una ejecución real del agente.

## Limitación

No hubo navegador disponible en CUA, por lo que sigue pendiente observar la pantalla con datos de Dev en escritorio y 760 px. Esta limitación no impide la integración local para que el owner haga esa revisión, pero sí impide afirmar QA visual completo o usar este review para marcar WS-0036 como `VALIDATED` o `CLOSED`.
