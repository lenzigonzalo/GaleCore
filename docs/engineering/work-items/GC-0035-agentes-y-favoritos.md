---
id: GC-0035
status: CHANGES_REQUESTED
implementer: Codex
approver: user
approval_result: PENDING
---

# GC-0035 - Proveedores de IA y favoritos del chat

Pedido del owner, 22/10/2026: adaptar Conexiones a la referencia Agents (proveedor y Cuenta,
Permisos, Servidores MCP, Skills), estrellas a izquierda, proveedor por chat y nombres legibles.
Porcion U-57/U-58; continuacion visual de GC-0031 y GC-0034. ACTIVE_WORK_ITEM del workspace
sigue en WS-0055; esta pieza local no interviene en esa revision.
Rama feature/GC-0035-agentes-y-favoritos desde local/integracion. Presupuesto ENGINEERING.
No hay uso recurrente de modelos nuevo.

## Contrato y recorrido

- Configuracion -> Proveedores de IA -> Claude Code/Codex -> Cuenta: estado real y reautenticacion.
- Permisos describe el control Manual/Auto vigente por chat; no cambia autorizaciones globales.
- Servidores MCP reutiliza inventario y controles existentes, filtrados al proveedor elegido.
- Skills reutiliza el editor y los datos del espacio; son comunes a ambos motores.
- Lateral de proyectos/conversaciones: estrella por proyecto y chat, persistida como preferencia
  privada junto con los grupos existentes. Favoritos primero dentro de cada lista; no cambia grupos.
- Cada chat muestra Claude Code/Codex. Proyectos 16px, chats 15px, proveedor secundario 12px.
- Negativos: cuenta sin instalar/fallo no habilita reautenticar; favoritos antiguos sin campo nuevo
  conservan grupos/colores; no se cambia proveedor de conversaciones existentes.
- Fuera: implementar almacen de secretos/API por usuario, cambiar permisos efectivos, crear MCP,
  credenciales, produccion, push o PR. API y claves queda como necesidad de backend, no formulario ficticio.

## Verificacion y evidencia

Registro de comandos y resultados: ../evidence/GC-0035/README.md.
Review interno requerido por ENGINEERING: diff de UI y persistencia, en ../reviews/.
No VALIDATED/CLOSED sin revision independiente y aprobacion del owner.

## Para retomar

Implementado en rama local; suite completa final 46 suites / 208 tests y build CI verdes.
`git diff --check` verde. Review independiente de una pasada:
`../reviews/GC-0035-independent.md`, CHANGES_REQUESTED sobre el snapshot previo a las correcciones.
F1 corregido: los cambios hechos mientras carga el espacio se aplican sobre la preferencia canónica;
no se guarda remotamente hasta que se leyó la cuenta. Si la lectura falla, sólo copia local y aviso.
Pruebas con lectura demorada y fallida; selección temprana idempotente aunque ya fuera favorito en cuenta.
F2 corregido: un único aviso de fallo de sincronización en ambas pestañas. Sin recheck ni cierre del owner.
QA visual pendiente: cua no tiene navegadores
conectados; abrir iab devuelve Browser is not available. No se afirma recorrido visual ejecutado.
No se tocaron secretos ni servicios. FRED lee FredApi:Key en backend (FredApiProvider.cs);
no existe en esta pantalla una capacidad de guardar claves personales.
