# GC-0031 ? Conexiones MCP locales

Estado: IN_PROGRESS. Flag: `frontend-local`. Implementer: Codex. Owner: usuario.
Autorizado el 13/10/2026: "dale hacelo". Tajada U-57; referencia BL-006.
Aislada de WS-0031 (Claude/harness): no cambia ACTIVE_WORK_ITEM ni archivos de Claude del repo.

## Contrato y recorrido
Configuración → MCP locales: inventario real separado Claude/Codex y contexto del proyecto.
Habilitar/deshabilitar conexiones existentes conserva configuración y credenciales; respaldo local ignorado.
Conflictos de archivo se rechazan; sólo monitor localhost:3039 con token ef?mero puede escribir.
No expone argumentos, URLs, headers, variables ni credenciales. No ejecuta MCP ni comprueba conexión.
Indica configuración y necesidad de nueva sesión; no afirma que la sesión actual cambie.
Fuera: a?adir servidores, plugins/conectores del host, instalar MCP, integrar brokers, ?rdenes, producción.
Aceptaci?n negativa: archivo inválido/concurrente, origen/token indebidos y conexión inexistente no escriben.
Pruebas: Python en hogares temporales, frontend del ?rea, build CI y navegador con inventario real.
Review independiente por escritura de configuración local; sin VALIDATED/CLOSED ni push/PR.
Presupuesto: 250 llamadas / 200k tokens por ENGINEERING; sin uso recurrente del modelo.

## Para retomar
Implementaci?n en worktree GC-0031; interfaz permanece 3039. Evidencia pendiente.
