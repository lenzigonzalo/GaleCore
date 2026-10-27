# GC-0036 — evidencia local

22/10/2026. Rama `feature/GC-0036-conexiones-datos`.
Formulario de Tastytrade recuperado de `6d5ff12^`, con tipografía legible, controles bloqueados
durante carga/guardado y limpieza del número tras desvincular. Backend y contratos existentes
sin cambios. Skills retirado del proveedor y conservado en la sección general.

## Ejecutado

Desde `source/galecore-monitor`, con `CI=true`:

```text
npm test -- --watchAll=false --runInBand --runTestsByPath src/components/account/BrokerAccountCard.test.tsx src/pages/SettingsConnections.test.tsx src/components/settings/Connections.test.tsx
Test Suites: 3 passed, 3 total
Tests:       7 passed, 7 total
Exit: 0
```

Fixtures explícitos, sin cuentas ni claves reales: vincular por el contrato existente y limpiar
secretos, advertir app OAuth propia, confirmar/cancelar desvinculación de cuenta de sistema,
lectura fallida con reintento y navegación API/bróker/IA/Skills sin duplicación.
No se hicieron escrituras reales en la API ni en el bróker.

`git diff --check`: exit 0.

Primer build CI: `Compiled successfully`, exit 0. Suite completa antes de la corrección F1:
48 suites / 218 tests, exit 0.

Después de F1, `CI=true npm test -- --watchAll=false --runInBand`: **48 suites / 220 tests**
pasaron, exit 0 (112.805 s). `CI=true npm run build`: `Compiled successfully`, exit 0.
Build con permiso para crear procesos de compilación; aviso de caniuse-lite antiguo sin cambios
de dependencias. `git diff --check`: exit 0.

## Límites

La sección API y claves explica la configuración actual; **no implementa guardar claves
personales de FRED/Alpha Vantage**. FRED usa `FredApi:Key` en backend. Acceso a GaleCore por
login del monitor. Alpha Vantage se administra por MCP si ése es el conector que usa la persona.

QA visual pendiente: en esta sesión no hay navegador conectado. Los tests de navegación
usan JSDOM y mocks; no acreditan apariencia ni un guardado real. El owner no debe vincular o
desvincular una cuenta real sólo para verificar esta pieza.

Revisión: `../../reviews/GC-0036-independent.md`. Sin cierre del agente.

## Corrección de revisión

Informe independiente de una pasada: CHANGES_REQUESTED por F1 (P1). El formulario recuperado
conservaba el estado anterior cuando fallaba la consulta. Corregido: cada lectura invalida el
estado previo; DELETE exitoso limpia también ese estado antes de consultar; escrituras bloqueadas
durante carga/guardado. Dos regresiones nuevas cubren GET fallido tras cuenta vinculada y tras
DELETE exitoso. No se solicitó recheck ni se modificó el informe del reviewer.

## Seguimiento: errores TS2307 en el monitor de desarrollo

22/10/2026, reporte del owner: el monitor abierto decía no encontrar `BrokerAccountCard` ni
`ApiConnections`. Ambos archivos estaban presentes, versionados y el árbol limpio en
`local/integracion`; el build final anterior era verde. Se identificó el proceso del puerto 3039,
levantado con `dev/galecore_dev.py monitor`, y se reinició sólo ese árbol de procesos con el mismo
comando y entorno Dev. No se tocaron API, Lab, credenciales ni código.

Verificación del compilador de desarrollo tras reinicio: WebSocket `ws://127.0.0.1:3039/ws`
de webpack-dev-server devolvió `{"type":"ok"}` (comando diagnóstico exit 0).
Logs locales ignorados: `dev/.local/monitor-restart.stdout.log` y `.stderr.log`.
Esto acredita recompilación del servidor de desarrollo, no inspección visual del navegador.
