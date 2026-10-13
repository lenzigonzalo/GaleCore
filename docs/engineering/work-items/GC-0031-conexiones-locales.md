# GC-0031 — Conexiones MCP locales

Estado: CHANGES_REQUESTED. Flag: `frontend-local`. Implementer: Codex. Owner: usuario.
Autorizado el 13/10/2026: "dale hacelo". Tajada U-57; referencia BL-006.
Aislada de WS-0031 (Claude/harness): no cambia ACTIVE_WORK_ITEM ni archivos de Claude del repo.

## Contrato y recorrido
Configuración → MCP locales: inventario real separado Claude/Codex y contexto del proyecto.
Habilitar/deshabilitar conexiones existentes conserva configuración y credenciales; respaldo local ignorado.
Conflictos de archivo se rechazan; sólo monitor localhost:3039 con token efímero puede escribir.
No expone argumentos, URLs, headers, variables ni credenciales. No ejecuta MCP ni comprueba conexión.
Indica configuración y necesidad de nueva sesión; no afirma que la sesión actual cambie.
Fuera: añadir servidores, plugins/conectores del host, instalar MCP, integrar brokers, órdenes, producción.
Aceptación negativa: archivo inválido/concurrente, origen/token indebidos y conexión inexistente no escriben.
Pruebas: Python en hogares temporales, frontend del área, build CI y navegador con inventario real.
Review independiente por escritura de configuración local; sin VALIDATED/CLOSED ni push/PR.
Presupuesto: 250 llamadas / 200k tokens por ENGINEERING; sin uso recurrente del modelo.

## Para retomar
Implementado en C:/Users/lenzi/GaleCore-Local-MCP-GC-0031, feature/GC-0031.
UI 3039 y servicio local 8772 en ejecución. API Macro 7002 y harness 8771 intactos.
Evidencia: ../evidence/GC-0031/README.md; browser-run.json y capturas.
12 tests backend, 4 del componente y build CI pasan. Suite amplia: 25 suites verdes / 3 fallan
(Lab/App ESM y LabShadow, ajenos al diff). No se arregla trabajo de Claude.
Inventario real comprobado en navegador; auth Supabase sintética declarada.
Switches probados en hogar temporal; no se apagaron los MCP actuales del usuario.
Codex CLI verifica enabled por override de proceso, sin guardar ni conectar.
Review independiente: ../reviews/GC-0031-independent.md, CHANGES_REQUESTED en aae9ceb..364b1c9.
F1/F2 corregidos con pruebas; F3 (ventana de concurrencia hash-reemplazo) registrado, sin recheck.
Pendiente aceptar ese limite o resolverlo; no editar config desde otro programa al usar el switch.
Sin VALIDATED/CLOSED ni aprobacion owner.
Retoma: Configuración → MCP locales, elegir CLI/proyecto, Actualizar y un interruptor.
Servidor: python dev/macro_dev.py mcp. No incluye plugins/conectores remotos.
ACTIVE_WORK_ITEM sigue WS-0031 de Claude; prioridad autorizada en roadmap §4.
