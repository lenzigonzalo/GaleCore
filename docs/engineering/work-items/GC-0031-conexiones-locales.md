# GC-0031 — Conexiones MCP locales

Estado: CHANGES_REQUESTED. Flag: `frontend-local`. Implementer: Codex. Owner: usuario.
Autorizado el 13/10/2026: "dale hacelo". Tajada U-57; referencia BL-006.
Aislada de WS-0031 (Claude/harness): no cambia ACTIVE_WORK_ITEM ni archivos de Claude del repo.

## Contrato y recorrido
Configuración → MCP locales: inventario real separado Claude/Codex y contexto del proyecto.
Habilitar/deshabilitar conexiones existentes conserva configuración y credenciales; respaldo local ignorado.
Conflictos de archivo se rechazan; sólo monitor localhost:3039 con token efímero puede escribir.
No expone argumentos, URLs, headers, variables ni credenciales. No llama tools MCP; Claude mcp list comprueba conexion/autenticacion en segundo plano.
Indica configuración y necesidad de nueva sesión; no afirma que la sesión actual cambie.
Fuera: agregar/instalar MCP, plugins de Codex, integrar brokers, ordenes y produccion.
Incluye listado nativo de conectores de cuenta y MCP de plugins de Claude, con control por proyecto.
Aceptación negativa: archivo inválido/concurrente, origen/token indebidos y conexión inexistente no escriben.
Pruebas: Python en hogares temporales, frontend del área, build CI y navegador con inventario real.
Review independiente por escritura de configuración local; sin VALIDATED/CLOSED ni push/PR.
Presupuesto: 250 llamadas / 200k tokens por ENGINEERING; sin uso recurrente del modelo.

## Para retomar
Implementado en C:/Users/lenzi/GaleCore-Local-MCP-GC-0031, feature/GC-0031.
UI 3039 y servicio local 8772 en ejecución. API Macro 7002 y harness 8771 intactos.
Evidencia: ../evidence/GC-0031/README.md; browser-run.json y capturas.
15 tests backend, 5 del componente y build CI pasan. Suite amplia: 25 suites verdes / 3 fallan
(Lab/App ESM y LabShadow, ajenos al diff). No se arregla trabajo de Claude.
Inventario real comprobado en navegador; auth Supabase sintética declarada.
Switches probados en hogar temporal; no se apagaron los MCP actuales del usuario.
Codex CLI verifica enabled por override de proceso, sin guardar ni conectar.
Review independiente: ../reviews/GC-0031-independent.md, CHANGES_REQUESTED en aae9ceb..364b1c9.
F1/F2 corregidos con pruebas; F3 (ventana de concurrencia hash-reemplazo) registrado, sin recheck.
Pendiente aceptar ese limite o resolverlo; no editar config desde otro programa al usar el switch.
Sin VALIDATED/CLOSED ni aprobacion owner.
Retoma: Configuración → MCP locales, elegir CLI/proyecto, Actualizar y un interruptor.
Servidor: python dev/macro_dev.py mcp. Incluye cuenta y plugins de Claude via su CLI.
Correccion owner 13/10: registro local datafeed no acreditaba MCP activo; faltaban cuenta y plugins.
Proyecto del workspace seleccionado por defecto, buscador y estados de conexion reales.
Actualizar solicita listado Claude en segundo plano (timeout 55s); no publica stdout/URLs/credenciales.
ACTIVE_WORK_ITEM sigue WS-0031 de Claude; prioridad autorizada en roadmap §4.

## Iteracion visual: filtro de habilitacion
Owner 13/10: filtro Todos / Habilitados / Deshabilitados, combinado con busqueda.
Navegador verifica que al apagar/prender una conexion la fila sale del filtro activo.
Solo prueba temporal, sin modificar configuracion real; mismo 3039, sin cambios al harness.

## Iteracion visual: filas compactas y seleccion GaleCore
Owner 13/10: mas conexiones visibles y separar las ajenas a GaleCore.
Filas compactas (desktop verificadas <=80px), controles y espacios reducidos.
Vista GaleCore: favoritos editables con estrella, guardados solo en este navegador.
Seleccion inicial de las conexiones que el owner menciono (Alpha Vantage, Google, IBKR, IoL).
Todas conserva inventario completo; estrellas no cambian autorizaciones del CLI.
6 tests de componente pasan; recorrido real + fixture verifica favoritos, filtros y mobile.
Build: ../evidence/GC-0031/build-compact-favorites.txt. No se modifica backend/harness.
