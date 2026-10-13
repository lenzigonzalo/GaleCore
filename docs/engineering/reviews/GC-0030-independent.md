# GC-0030 — revisión independiente Macro M0/M1

Fecha: 13/10/2026. Reviewer independiente: Codex / Sol 6.1. Revisión única y estática del cambio grande de API, cálculos, persistencia y frontend; no es recheck, aprobación del owner ni cierre del work item.

## Alcance e identidad

Worktree aislado: `C:/Users/lenzi/GaleCore-Macro-GC-0030`. Base verificada con `git merge-base refs/heads/local/integracion HEAD`: `f85d749a6c9578fcd1ae15c9bf757436e429e109`. HEAD congelado para esta revisión: `a9afff49c88fc6ae9a2d4b3d2f30ed2a574c329c`. Rango completo leído: `f85d749..a9afff4`, incluidos los commits `4e59631` y `a9afff4`; 15 archivos, 767 inserciones y 11 eliminaciones.

Se leyeron `ENGINEERING.md`, `CLAUDE.md`, WS-0030, GC-0030, el contrato técnico Macro citado por el item, el diff completo, los providers/controles de acceso necesarios para validar procedencia y seguridad, y los artefactos de navegador disponibles. No se editaron implementación, harness, Claude, work items ni producción.

El árbol no estaba limpio y cambió mientras se hacía la lectura. Al congelar el dictamen había modificaciones posteriores al SHA en `dev/macro_smoke.py`, `MacroSnapshotHandler.cs` y `MacroChart.tsx`, además de `dev/macro_probe.py` y `docs/engineering/evidence/GC-0030/` sin seguimiento. Esos cambios posteriores y sus resultados no pertenecen al rango revisado. En particular, la importación dinámica de `lightweight-charts` visible en el árbol corrige F2 después de `a9afff4`, pero no fue objeto de recheck.

**Resultado del rango: CHANGES_REQUESTED por F1 y F2.** F3 y F4 son inconsistencias P2 del contrato API que también deben quedar dispuestas. No marcar VALIDATED/CLOSED.

## F1 — P1: el enlace copiado no abre Macro cuando se entra por la navegación normal

Ubicación: `source/galecore-monitor/src/App.tsx:42-53` y `source/galecore-monitor/src/pages/Macro.tsx:65-68`.

Entrar a Macro desde la barra lateral sólo cambia el estado React de `Dashboard`; `setTab` no escribe `macro`, horizonte ni región en la URL. `copy()` parte de esa URL y agrega únicamente `snapshot`. Por lo tanto, desde una sesión iniciada en `/`, la secuencia normal «Monitor → Macro → Copiar enlace» puede producir `/?snapshot=<hash>`. Al abrir o recargar ese enlace, `Dashboard` no encuentra el parámetro `macro` y monta `inicio`, no el snapshot Macro.

El recorrido Playwright no detecta el caso porque empieza directamente en `/?macro=panorama`; cualquier apertura de detalle o cambio de filtro también llama `navigate()` y oculta el defecto al completar los parámetros antes de copiar.

Corrección requerida: hacer que la entrada a Macro refleje la ruta, o construir el enlace copiado desde el estado actual incluyendo como mínimo `macro`, `horizon`, `region` y `snapshot`. Agregar el caso desde la entrada real del shell y comprobar apertura/recarga del enlace sin interacción intermedia.

## F2 — P1: el HEAD revisado agrega una falla de carga ESM a la suite existente

Ubicación del SHA `a9afff4`: `source/galecore-monitor/src/components/macro/MacroChart.tsx:2`.

El import de valores estático desde `lightweight-charts` se propaga por `Macro → App` y Jest no puede cargar ese módulo ESM en la configuración vigente. Los tests propios de `Macro` lo ocultan porque mockean `MacroChart`; una prueba que importa `App` falla antes de ejecutar assertions. El `App.test.tsx` preexistente además tiene una assertion obsoleta de la plantilla, pero eso no elimina la regresión nueva de resolución introducida por este rango.

Durante la revisión apareció en el árbol una corrección no commiteada que mueve la carga a un `import()` dentro del efecto. Esa disposición es posterior al SHA y queda fuera de esta única pasada; el rango revisado no es reproducible por sí solo sin ella.

## F3 — P2: la configuración ausente devuelve 503 sólo al crear, no al leer

Ubicación: `source/galecore-datafeed/DataFeed.Api/Controllers/MacroController.cs:24-25,51-79`.

GC-0030 declara que, sin `Macro__SnapshotDirectory`, la API devuelve 503. `GET /Snapshot` lo cumple, pero `Snapshots/{id}`, `Series/{id}` y `Events` pasan por `Load`, donde una configuración nula se convierte en `null` y luego en 404. El cliente no puede distinguir almacenamiento deshabilitado de una referencia realmente inexistente. `Load` tampoco trata whitespace como configuración ausente, aunque `Snapshot` sí lo hace.

Corrección requerida: aplicar el mismo estado `macro_store_unconfigured` a todas las rutas dependientes del store y cubrirlo en pruebas de controller; reservar 404 para un ID válido ausente en un store configurado.

## F4 — P2: una pendiente nula puede conservar calidad `available`

Ubicación: `source/galecore-datafeed/DataFeed.Application/App/Macro/MacroContracts.cs:74-83`.

`Slope` propaga correctamente `null` si falta el valor corto o largo, pero el `with` conserva `QualityStatus` de la observación larga. Si la larga está disponible y la corta es nula, la observación calculada queda con `Value=null` y `QualityStatus=available`; también se descartan las razones de calidad de ambas entradas. El test en `MacroDashboardTests.cs:31-37` comprueba el null, pero no el estado incoherente.

Corrección requerida: derivar calidad y razones de las dos entradas; un cálculo sin ambos valores no puede anunciarse disponible. Cubrir valor, status y referencias para entrada corta/larga nula y degradada.

## Trazabilidad de aceptación

| Criterio | Evidencia leída | Dictamen |
|---|---|---|
| M0 catálogo versionado | `MacroCatalog`, `/Catalog`, definiciones con fuente, unidad, frecuencia, horizonte, cobertura y derechos pendientes | Cumple para la cobertura EE. UU. parcial declarada; slots M3 quedan explícitamente `unavailable` |
| Mes calendario, pb y pendientes en fecha común | `MacroCalculations.Change/Slope` y tests de aniversario, pb, null y fechas comunes | Cumple el cálculo principal; F4 deja inconsistente la calidad del derivado nulo |
| Fallos parciales y último valor válido | diez lecturas concurrentes, timeout por fuente, `LastGood`, estado `source-error`, test de Treasury exitosa con resto fallido | Cumple el aislamiento básico. El cache es sólo de proceso, conserva fecha/origen y no se presenta como lectura nueva; no se acreditó reinicio ni envejecimiento prolongado |
| Snapshot local acotado e inmutable | límite 2 MiB/100 JSON, hash/ID, escritura temporal + move sin overwrite, ID hexadecimal validado al leer | Diseño local coherente; F3 rompe la semántica de store no configurado. No hay prueba comprometida de límites, carga o archivo corrupto |
| Seguridad y secretos | `ApiKeyMiddleware`/JWT global, URLs FRED sanitizadas por provider, excepción reducida a tipo, directorio opt-in local | No se halló bypass nuevo ni secreto expuesto en el rango. No hay autorización financiera ni acciones de capital |
| Cinco pestañas, radar/curva/calendario, detalle y foco | `Macro.tsx`, componentes, tests de carrera/foco/Atrás y capturas desktop/mobile | El recorrido visible es consistente y el detalle tiene fuente/fechas/Escape/foco. F1 rompe el enlace desde la entrada normal |
| Sin broker/IA/posiciones ni proxies falsos | cuenta no se refresca al entrar por deep link, watchlist oculta, slots ausentes rotulados, texto sin interpretación; `personal_requests=[]` | Cumple en el recorrido observado. La app conserva autenticación y shell de plataforma, sin controles de gestión dentro de Macro |
| Evidencia de cierre | reporte real de navegador y capturas; backend completo informado 602 pass/8 skip; tests Macro informados verdes | Parcial: el reviewer no ejecutó suites; los artefactos estaban sin seguimiento. El frontend completo no estaba verde y F2 pertenece al rango; fallos de LabShadow y la assertion vieja de `App.test` están fuera del diff |

## Evaluación adicional

- Fuente parcial/cache: las claves están cerradas por fuente/serie y las consultas actuales usan el mismo rango base para Global/US y todos los horizontes; no se observó mezcla con posiciones o cuenta. Una falla conserva los timestamps originales y añade `source-error`, por lo que no renueva silenciosamente `asOf`.
- Persistencia: la escritura está serializada dentro del proceso y el nombre sale de un hash validado; no hay borrado automático ni escritura fuera del directorio configurado en el flujo normal. El límite de 100 es deliberado y queda visible como 507.
- Cálculos: tasas/OAS en porcentaje pasan a diferencias en pb; las pendientes son largo menos corto y exigen fecha común; horizontes sin calendario verificado producen null. No se habilita replay histórico con una fecha manual.
- UI/shell: la página mantiene las seis familias y los cuatro slots P2; los faltantes no se sustituyen. El detalle lateral es ancho completo bajo 1024 px, tiene foco inicial, trampa básica, Escape y restauración al opener. La evidencia real muestra escritorio y 390 px sin P&L, órdenes o posiciones.
- Fuera de alcance: no se tocaron M2–M5, modelo, harness, Lab, producción, push/PR, migraciones ni acciones operativas.

## Evidencia ejecutada y límites

El reviewer ejecutó sólo lecturas locales, `git` de identidad/diff/status, `git diff --check` e inspección visual de los PNG ya generados. No ejecutó suites, build, navegador, red, API, procesos ni smoke; los resultados 602/8, tests Macro y `browser-run.json` se atribuyen al implementer y al artefacto, no al reviewer.

Se inspeccionó `browser-run.json`: modo `real-dev-browser`, cuatro checks, cuatro respuestas Macro 200, `personal_requests=[]`, Chromium 120 y exit code 0. Las capturas muestran Panorama, Drivers, Eventos y detalle móvil con datos de Treasury/FRED/CBOE y calendario, fuentes/fechas y faltantes explícitos. Al momento de la revisión esos artefactos no estaban comprometidos, de modo que no forman parte de `f85d749..a9afff4`.

Esta es la única pasada independiente. Las correcciones posteriores deben registrarse por el implementer con sus pruebas; este archivo no acredita un recheck. APPROVE futuro, VALIDATED y CLOSED requieren el flujo y la decisión del owner definidos en `ENGINEERING.md`.
