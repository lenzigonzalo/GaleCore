# GC-0034: cabecera del chat

Interfaz local: http://localhost:3039, bridge 8771 y API Macro 7002; MCP 8772 sin cambios.
Selector centrado proveedor/modelo con logos, listado agrupado y esfuerzo dentro del menu.
Nuevo chat conserva su preferencia al navegar por historial. Conversaciones existentes bloquean la seleccion.
Configuracion y Salir quedan abajo a izquierda; se retiro menu de cuenta duplicado a derecha.
La lista de proyectos tiene scroll propio para conservar visibles los accesos inferiores.
Commits locales de implementacion: 1f0d5d8 y 456dee0; integracion local/integracion, sin push.

Ejecutado: 9/9 tests dirigidos en cuatro suites (frontend-tests.txt), build CI (build.txt),
`python dev/lab_header_smoke.py` (browser.json y capturas selector-desktop.png, chat-desktop.png, selector-narrow.png).
Navegador Chromium real, 1440px/820px: metadatos GET del bridge local reales. Auth Supabase sintetica y API7002
simulada solo dentro de este navegador; POST/chat/mensajes fixture, sin inferencia ni cambios al historial real.
Pruebas Node del contrato en workspace WS-0035 usan hijos simulados, 15/15 pasan.

Logos copiados de Square44x44Logo.png de las aplicaciones Windows instaladas:
OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0 y Claude_2.37337.1.0_x64__pzs8sxrjxfjjc (WindowsApps/assets).

Review independiente de snapshots 1f0d5d8 / 3a93094: CHANGES_REQUESTED, informe inmutable en workspace
docs/engineering/reviews/WS-0035-independent.md. Tres hallazgos corregidos por implementer y cubiertos
por regresiones; sin recheck ni cierre aprobado. No se verifico inferencia real del CLI por navegador.

Multimedia y chat lateral contextual registrados para despues en BL-005 (U-58): contexto explicito
de pantalla con filtros, indicador, fuentes y fechas; evitar adjuntar datos ajenos a esa vista.
No se implementaron esos alcances ni se cambio la prioridad del harness. ACTIVE_WORK_ITEM sigue WS-0031.
Pendientes anteriores: aceptacion/revision Macro M0/M1, M2-M5 no activados; MCP TOCTOU F3 registrado en GC-0031.
Sin push/PR, produccion, VALIDATED/CLOSED. WS-0029 conserva sus pendientes.
