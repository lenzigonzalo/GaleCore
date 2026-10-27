# GC-0034 - Selector de proveedor/modelo en cabecera del Lab

Estado: CHANGES_REQUESTED (snapshot revisado; correcciones implementadas, sin recheck). Flag: frontend-local. Implementer: Codex; owner: usuario.
Autorizado 13/10: selector proveedor/modelo arriba centrado, logos y configuracion solo a izquierda.
U-58 / P1-10. Contrato del puente local en workspace WS-0035.

## Contrato
Boton en cabecera abre lista proveedor-modelo; logos locales de las apps instaladas.
Nuevo chat: eleccion llega al contrato POST /chats. Esfuerzo sigue disponible en el menu.
Chats existentes conservan seleccion; no cambia proveedor/identidad/modelo de una conversacion existente.
Desplegable accesible por teclado, Escape/click exterior cierran, provider ausente deshabilitado.
Composer conserva borradores y envio/stop; ya no incluye selectores de proveedor/modelo.
Configuracion solo abajo a izquierda (lateral global o Lab), cuenta duplicada derecha retirada.
Salir permanece accesible abajo a izquierda; contrasena y usuario siguen en Configuracion.
Fuera: multimedia y chat lateral contextual (ideas BL-005), cambios al harness o instrucciones.
Pruebas: 9 frontend de area; build CI; recorrido real en 3039 con metadatos bridge reales.
Evidencia de auth sintetica/fixtures se declara, no se presenta como inferencia LLM real.
Sin push/PR de GaleCore, produccion, VALIDATED/CLOSED. Presupuesto estandar ENGINEERING.

## Para retomar
Selector usable en 3039. Historial conserva su proveedor/modelo sin alterar preferencias del siguiente chat.
Implementacion local: 1f0d5d8 y correcciones 456dee0, integradas en local/integracion sin push.
Con muchos proyectos, desplaza solo la lista; Configuracion/Salir permanecen visibles abajo a izquierda.
Envio bloqueado mientras carga historial; fallback de proveedor limpia seleccion incompatible.
Review independiente: workspace docs/engineering/reviews/WS-0035-independent.md (1f0d5d8 / 3a93094).
Hallazgos corregidos por implementer; informe intacto y sin recheck/VALIDATED/CLOSED.
Evidencia: docs/engineering/evidence/GC-0034; browser auth sintetica y submit fixture declarados.
Worktree C:/Users/lenzi/GaleCore-Lab-Header-GC-0034, feature/GC-0034.
Workspace backend: .worktrees/workspace/WS-0035, feature/WS-0035.
API 7002 y MCP 8772 siguen sin cambios; interfaz permanece 3039.
No se toca ACTIVE_WORK_ITEM (WS-0031 de Claude), ni GaleCore-AI.
Metadatos y parametros de modelos necesitan recarga del bridge 8771 solo cuando esta sin sesiones activas.
