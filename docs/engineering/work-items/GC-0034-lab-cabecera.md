# GC-0034 - Selector de proveedor/modelo en cabecera del Lab

Estado: IN_PROGRESS. Flag: frontend-local. Implementer: Codex; owner: usuario.
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
Pruebas: 8 frontend de area; build CI; recorrido real en 3039 con metadatos bridge reales.
Evidencia de auth sintetica/fixtures se declara, no se presenta como inferencia LLM real.
Sin push/PR de GaleCore, produccion, VALIDATED/CLOSED. Presupuesto estandar ENGINEERING.

## Para retomar
Worktree C:/Users/lenzi/GaleCore-Lab-Header-GC-0034, feature/GC-0034.
Workspace backend: .worktrees/workspace/WS-0035, feature/WS-0035.
API 7002 y MCP 8772 siguen sin cambios; interfaz permanece 3039.
No se toca ACTIVE_WORK_ITEM (WS-0031 de Claude), ni GaleCore-AI.
Metadatos y parametros de modelos necesitan recarga del bridge 8771 solo cuando esta sin sesiones activas.
