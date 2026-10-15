# WS-0036 · Agentes como tareas programadas

Pedido del owner, 14/10/2026: adaptar Agentes al formato de las dos capturas de Claude provistas en la conversación.
Base: `6aa4541`, rama `feature/WS-0036-agentes`, worktree `C:\Users\lenzi\GaleCore-Agentes-WS-0036`.

## Resultado

- Listado «Tareas programadas», con Tuyos/Plantillas y Nueva tarea; catálogo de dos columnas en escritorio y una en ancho reducido.
- Una tarea abre su página: historial y resultado a la izquierda; instrucciones, frecuencia, ejecución y detalles a la derecha. Volver regresa al listado.
- Control activo/pausa conserva el pedido a la PC, el estado pendiente y los errores. El supervisor sigue sin pausa.
- Plantillas de briefing, vigilancia de mercado y seguimiento de estrategia preparan un pedido editable para copiar al chat. No programan corridas por sí mismas.
- Sin cambios en backend, contratos, ejecución, permisos, cálculos financieros o dependencias. Usa los tokens y la tipografía del monitor.
- Historial declara la limitación real: sólo se publica `last_run`; se conserva el contador de corridas sin crear registros ficticios.

## Verificación ejecutada

En `source/galecore-monitor` del worktree:

```powershell
$env:CI='true'
npm run build
npm test -- --watch=false --runInBand
```

Build: exit 0, `Compiled successfully.`; JS principal 458.34 kB gzip y CSS 26.45 kB gzip.
Aviso informativo de Browserslist sobre su catálogo local; no se actualizaron dependencias.
`git diff --check`: exit 0.

Suite completa: exit 0, 39 suites / 172 tests verdes (203.096 s). Incluye los 6 tests de Agentes.
Hay avisos de React `act(...)` en pruebas de otras áreas (RegimeTab, Shadow y posiciones);
no hubo fallos ni se modificaron esas áreas.

Los tests de Agentes usan datos de prueba aislados y API/clipboard simulados: ida y vuelta listado/detalle,
pausa con pedido pendiente, preparación/copia sin crear una tarea, error/reintento/vacío, supervisor y publicación vieja.
No acreditan el recorrido en Dev ni ejecución de un agente real.

## Pendiente

QA visual con datos de Dev, escritorio y 760 px: no ejecutada. CUA devolvió inventario sin navegadores;
los intentos de crear pestaña en `chrome` e `iab` devolvieron `Browser is not available`.
No se generaron capturas ni se afirma verificación visual.

Recorrido para revisar: monitor local → Agentes → abrir una tarea → volver a Tareas programadas → Plantillas → elegir una → editar/cerrar el pedido.
Estado de WS-0036: IN_PROGRESS; sin VALIDATED/CLOSED ni aprobación del owner.
Sin push ni PR.
