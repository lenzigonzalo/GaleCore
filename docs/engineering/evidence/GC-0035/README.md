# GC-0035 — evidencia local, 22/10/2026

Implementación en `feature/GC-0035-agentes-y-favoritos`, base `d91f166`.
Alcance: presentación de proveedores en Configuración, MCP embebido por proveedor,
skills del espacio, favoritos de proyectos/chats y tipografía del lateral.

## Ejecutado

Desde `source/galecore-monitor`, `CI=true` en el entorno:

```text
npm test -- --watchAll=false --runInBand --runTestsByPath src/components/settings/Connections.test.tsx src/components/settings/LocalMcp.test.tsx src/components/lab/LabProjectList.test.tsx src/pages/LabSidebar.test.tsx src/components/settings/SettingsModal.test.tsx
Test Suites: 5 passed, 5 total
Tests:       27 passed, 27 total
Exit: 0
```

Pruebas con fixtures, sin autenticaciones ni cambios reales a MCP: selección de proveedor,
estados y reautenticación, pestañas, inventario del proveedor sin selector duplicado,
guardar/restaurar/quitar favoritos, grupos antiguos y conservación del proveedor del chat.
JSDOM emite avisos de canvas de xterm y de `act` en pruebas existentes; las cinco suites pasan.

```text
CI=true npm run build
Compiled successfully.
Exit: 0
```

La primera ejecución restringida falló con `spawn EPERM`; la compilación con permiso para
crear sus procesos pasó. Aviso de caniuse-lite antiguo, sin actualizar dependencias.
Se corre nuevamente después de corregir el separador tipográfico de la línea del proveedor.

`git diff --check` en GaleCore: exit 0.

## Límites

QA visual y recorrido con servicios reales pendientes. `cua.getState()` devolvió
`apps: [], browsers: []`; `cua.createBrowserTab('iab', 'http://localhost:3039', ...)`
devolvió `Browser is not available: iab`. No hay capturas de la implementación ni se afirma
que las pruebas JSDOM acrediten apariencia o persistencia real en la API.

API keys: se leyó `FredApiProvider.cs` (configuración `FredApi:Key`) y
`ApiKeyMiddleware.cs` (acepta JWT de usuario o API key). No se leyeron secretos.
Guardar claves personales de FRED/Alpha Vantage requiere implementación aparte; esta pieza
no ofrece un formulario que no tenga backend.

Revisión independiente en `../../reviews/GC-0035-independent.md`.

## Hallazgos y correcciones

Revisión independiente de una pasada: CHANGES_REQUESTED sobre snapshot anterior a las correcciones.
F1 (P1) corregido: cola de acciones tempranas aplicada al estado canónico, con bloqueo de escrituras
remotas hasta lectura exitosa. Una selección de favorito expresa el estado elegido, sin invertir un
favorito que ya existía en la cuenta. Lectura fallida mantiene sólo caché y muestra aviso.
F2 (P3) corregido: retirado el segundo aviso de sincronización en Proyectos.
Dos pruebas de regresión nuevas cubren lectura demorada con grupos/colores/favoritos canónicos y
lectura fallida sin escrituras remotas. No se solicitó recheck ni se editó el informe del reviewer.

Antes de las correcciones finales, suite completa: 46 suites / 206 tests, exit 0.
Después de las correcciones, ejecutado `CI=true npm test -- --watchAll=false --runInBand`:
46 suites / 208 tests pasaron, exit 0 (134.499 s). `CI=true npm run build` sobre la versión
final: `Compiled successfully`, exit 0. `git diff --check`: exit 0.
