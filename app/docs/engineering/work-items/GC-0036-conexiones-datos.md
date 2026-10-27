---
id: GC-0036
status: CHANGES_REQUESTED
implementer: Codex
approval_result: PENDING
---

# GC-0036 - Recuperar configuracion de datos y broker

Owner 22/10: APIs y broker quedaron sin lugar tras reorganizar Conexiones. Ademas pide sacar
Skills de Proveedores de IA porque son comunes a todo el ecosistema. Continuacion U-57/U-58,
GC-0035. ACTIVE_WORK_ITEM WS-0055 no se cambia. Presupuesto ENGINEERING; sin modelo recurrente.

## Contrato y recorrido

- Configuracion -> Cuenta de broker abre formulario real de Tastytrade: consultar vinculacion,
  guardar numero/token/client secret, actualizar y desvincular con confirmacion.
- Reutilizar formulario retirado en 6d5ff12 y endpoints existentes, sin cambiar backend ni datos.
- Las credenciales solo viajan al endpoint existente con sesion del usuario; no se guardan en
  preferencias del chat ni navegador; inputs secretos se limpian tras guardar.
- Configuracion -> API y claves explica acceso a GaleCore por login, FRED por clave del servidor,
  y Alpha Vantage via MCP cuando se usa asi. Declara pendiente carga personal de API keys.
- Skills se administra solo en la seccion general; IA muestra Cuenta, Permisos y Servidores MCP.
- Negativos: lectura fallida no afirma conexion; formulario incompleto no guarda;
  desvincular requiere confirmacion, advierte cuenta de sistema y no repite datos borrados.
- Fuera: implementacion nueva de almacen de claves personales, migraciones, operaciones reales
  del broker, credenciales reales, produccion, push y PR.

## Verificacion

Tests de formulario con fixtures, navegacion de Configuracion, proveedores, suite y build CI.
Review independiente por formulario que configura credenciales. Sin VALIDATED/CLOSED del agente.
QA visual pendiente si navegador no disponible; nunca guardar/desvincular cuenta real como prueba.

## Para retomar

Implementacion en feature/GC-0036-conexiones-datos. Primer build CI y suite completa verdes
(48 suites / 218 tests). Verificación final tras F1: 48 suites / 220 tests y build CI verdes;
git diff --check verde. QA visual con navegador y recorrido real con credenciales pendientes.
Revision independiente de una pasada: ../reviews/GC-0036-independent.md, CHANGES_REQUESTED.
F1 corregido: load invalida estado anterior; DELETE exitoso tambien lo limpia antes de releer;
controles de escritura bloqueados en carga/guardado. Dos regresiones GET fallido despues de
cuenta vinculada y despues de DELETE exitoso. Sin recheck ni aprobacion del owner.
Falta implementar carga personal de API keys; ahora tiene lugar explicito y no un formulario falso.
