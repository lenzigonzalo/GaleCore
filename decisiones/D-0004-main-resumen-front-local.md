# D-0004 — Main como dashboard inicial

09/10/2026 · decisión del owner · exploración local GC-0011.

El inicio se llama Main y muestra cuenta, performance, posiciones, claves del día y accesos directos.
Las secciones específicas viven en el sidebar. Se conserva el origen local http://localhost:3039.
Todos los valores vienen de GaleCore o de fuentes MCP verificadas; una preview vacía no sustituye
el front operacional. El diseño usa jerarquía, tipografía legible y colores con significado.

La especificación por pantalla vive en roadmap/proposals/FRONT-GALECORE-INTEGRAL.md (workspace) (§3, §21).
No cambia el orden del roadmap ni habilita datos históricos, atribución de posiciones o cálculos inexistentes.

La API Dev admite CORS para http://localhost:3039 y no para :3040 o http://127.0.0.1:3039
(comprobado por OPTIONS /App/GaleCore/Auth/Login: 204 en los tres; allow-origin sólo en localhost:3039).
Se retira LayoutPreview y se restaura autenticación real; no se crean cuentas ni permisos demo.
