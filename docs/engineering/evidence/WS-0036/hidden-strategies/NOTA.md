# WS-0036 — estrategias ocultas por usuario

14/10/2026 · `feature/GC-0036-panel` · sólo frontend, sin push ni capturas.

Cada fila (SHADOW, proyecto en diseño y RPF) ofrece Ocultar de mi lista al pasar el mouse o enfocar con teclado; en dispositivos táctiles queda visible. Guarda `preference/estrategias` mediante el espacio autenticado existente, como JSON `{ "hidden": [...] }` y visibilidad privada. Mostrar ocultas permite verlas atenuadas y volver a mostrarlas. Sin preferencia se ven todas, incluidas las estrategias de prueba; no cambia el runtime ni el acceso a la página.

Una lectura fallida no habilita sobrescribir la preferencia; un guardado fallido mantiene la fila y permite reintentar. El estado no es global y no se hereda al cambiar de usuario.

Desde `source/galecore-monitor`:

```powershell
$env:CI='true'
npm.cmd run build
npm.cmd test -- --watchAll=false --runInBand
```

Exit 0 en ambos; 38 suites y 171 tests verdes. Salidas: `build.log` y `tests.log`.

Prueba real en Dev :3039, sin capturas: ocultar iwm_prima_condor_30_45d, recargar, comprobar persistencia, mostrar ocultas y restaurarla sin abrir la estrategia. PUT HTTP 200 en ambas acciones, sin pageErrors. Se restauró exactamente el estado previo de la preferencia de demo (no existía: DELETE HTTP 204), ver `dev.log`. No se tocó producción ni se marcó VALIDATED/CLOSED.
