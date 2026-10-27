# GC-0030 — revisión independiente de la iteración por feedback visual

Fecha: 13/10/2026. Reviewer independiente: Codex / GPT-6. Esta es una revisión única de una iteración frontend nueva; no es recheck ni modifica `GC-0030-independent.md`. Tampoco es aprobación del owner ni cierre del work item.

## Identidad y alcance

Worktree aislado: `C:/Users/lenzi/GaleCore-Macro-GC-0030`. Rama: `feature/GC-0030`. Base: `09816f32abf40e0970c469445aa7488c871693dd`. HEAD revisado: `af0b64d9a2efab54fc9a894da16d571f8fedfe02`. Rango completo leído: `09816f3..af0b64d`; un commit, 19 archivos, 382 inserciones y 165 eliminaciones.

Se leyeron `ENGINEERING.md`, `CLAUDE.md`, D-0010, el work item GC-0030, el diff completo, los componentes compartidos afectados, las pruebas modificadas, el smoke visual y todos los artefactos de `docs/engineering/evidence/GC-0030/visual-feedback/`. No se editaron implementación, harness, Lab, Claude ni backend; no se ejecutaron suites, build, navegador, red ni procesos del producto.

Al congelar la lectura, `HEAD` coincidía con `af0b64d`; la implementación no tenía cambios posteriores al SHA. El árbol sólo tenía sin seguimiento los artefactos de `docs/engineering/evidence/GC-0030/visual-feedback/` y este informe al crearlo. `git diff --check 09816f3..af0b64d` no informó errores.

**Resultado: CHANGES_REQUESTED por F1.** F2 a F4 son inconsistencias P2 que conviene resolver en la misma corrección. No marcar VALIDATED/CLOSED.

## F1 — P1: la página Eventos y el panel global pueden mostrar calendarios distintos sin decirlo

Ubicación: `source/galecore-monitor/src/pages/Macro.tsx:95,113`, `source/galecore-monitor/src/components/macro/CalendarDock.tsx:11-34`, `source/galecore-monitor/src/App.tsx:170`.

Eventos renderiza `data.events`, que pertenece al snapshot Macro y puede ser un corte guardado. El panel global monta otro `CalendarDock` y consulta directamente FRED/Fed cada vez que se abre. Como el panel permanece abierto al navegar, ambos calendarios pueden verse lado a lado con fechas o estados de fuente distintos, pero ninguno identifica de forma visible cuál es el snapshot y cuál es la lectura actual ni su hora de corte.

El smoke no detecta esta divergencia: en modo `saved-real-data-synthetic-session`, `macro_visual_smoke.py:34-39` deriva tanto la respuesta Macro como las dos respuestas del panel del mismo `snapshot-real.json`. La captura `calendar-dock.png` acredita la composición, no la coherencia entre cortes reales.

Corrección requerida: definir un dueño de datos común o rotular claramente alcance y corte de cada calendario («snapshot Macro al …» / «calendario actual consultado …»). Agregar un caso donde los cortes difieran o una fuente falle sólo en uno de los dos, para que la UI no presente resultados contradictorios como equivalentes.

## F2 — P2: el rango del calendario global usa UTC y la grilla usa fecha local

Ubicación: `source/galecore-monitor/src/components/macro/CalendarDock.tsx:13-17`, `source/galecore-monitor/src/components/macro/MacroCalendar.tsx:10-17`.

El dock construye `from` y `to` con `toISOString().slice(0, 10)`, mientras la grilla decide mes y «hoy» con getters locales. En Argentina, después de las 21:00, el rango enviado comienza en el día UTC siguiente: puede omitir un evento del día local actual e incluir uno fuera de los 45 días que anuncia la interfaz.

Corrección requerida: formar `YYYY-MM-DD` con año, mes y día locales —o usar una zona explícita compartida— y cubrir el borde de cambio de día.

## F3 — P2: controles del calendario pierden contexto para lector de pantalla

Ubicación: `source/galecore-monitor/src/components/macro/MacroCalendar.tsx:25-28`, `source/galecore-monitor/src/components/ticker/LiveWatchlist.tsx:71-80`.

Cada evento tiene como nombre accesible sólo el indicador (`Inflación · CPI`, por ejemplo); la fecha queda en un `span` hermano y no forma parte del nombre del botón. Además, cuando el drawer muestra Calendario, su separador sigue anunciándose como «Ancho de watchlist». La operación visual es comprensible, pero la navegación por botones no comunica qué día se abre y el resize describe el panel equivocado.

Corrección requerida: incluir la fecha localizada en el nombre accesible del evento y usar una etiqueta del separador que corresponda al modo actual o sea genérica («Ancho del panel lateral»).

## F4 — P2: Eventos conserva texto de datos que no describe la vista

Ubicación: `source/galecore-monitor/src/pages/Macro.tsx:105,113`.

La captura `eventos.png` muestra «Últimos valores · cambio frente a 1 mes» sobre el calendario mensual. El botón Actualizar sí puede refrescar el snapshot, pero ese rótulo pertenece a las vistas de series y vuelve a introducir una nota pequeña sin relación con Eventos.

Corrección requerida: adaptar u ocultar el texto para la pestaña Eventos; el control puede conservar una etiqueta clara de actualización del calendario.

## Trazabilidad del feedback del owner

| Pedido | Evidencia leída | Dictamen |
|---|---|---|
| Barra global única con logo, lupa/Ctrl K y toggle junto al logo | `WorkspaceHeader`, `WorkspaceSearch`, `buscar.png`, prueba de foco/Escape | Cumple. El owner confirmó que la barra global y quitar el botón Lab secundario pertenecen al alcance; no se cambian `Lab.tsx`, su host ni conversaciones |
| Quitar encabezados Macro duplicados, notas técnicas chicas y copiar enlace | `WorkspaceHeader`, `Macro.tsx`, `panorama.png` | Se quitaron el título duplicado y Copiar enlace; F4 deja un rótulo de series dentro de Eventos |
| Pestañas grandes | `Macro.css`, capturas desktop/mobile | Cumple; conservan scroll horizontal en móvil |
| Gráficos grandes y curva sin rectángulo enorme | `MacroChart`, `MacroCurve`, `drivers.png` | Cumple visualmente; gráficos de 290 px y curva sin tarjeta opaca |
| Tabla compacta, legible y unidad en la misma fila | `Macro.tsx:86-94`, `Macro.css:7` | Cumple en el código; la tabla conserva scroll horizontal en pantallas angostas |
| Detalle explica el indicador sin lista cruda | `Macro.tsx:75-84,117-125`, `detalle.png` | Cumple para las series visibles: explicación, valor/cambio, gráfico y método colapsable; la evidencia no muestra una lista cruda de observaciones |
| Calendario mensual en Eventos | `MacroCalendar`, `eventos.png` | Cumple la composición mensual; F2-F4 afectan fecha, accesibilidad y rótulo |
| Panel global junto a watchlist, redimensionable | `LiveWatchlist`, `CalendarDock`, `calendar-dock.png`, smoke de teclado/persistencia | Cumple el recorrido principal; F1 y F3 afectan procedencia y semántica accesible |

## Evidencia ejecutada y límites

El implementer dejó `visual-tests-final.log` con 6 suites y 17 tests seleccionados verdes, incluidos los dos componentes nuevos, y `visual-build-final.log` con `Compiled successfully`. El reviewer sólo leyó esos logs; no repitió las ejecuciones. Al congelar este informe, ambos logs finales estaban fuera de `docs/engineering/evidence/GC-0030/visual-feedback/`; el `frontend-tests.txt` permanente todavía describía la corrida anterior de 12 tests.

Se inspeccionó `visual-feedback/browser-run.json`: modo `saved-real-data-synthetic-session`, cuatro checks, Chromium 120 y exit code 0. Las capturas muestran el dato real guardado, pero la sesión y las respuestas HTTP fueron simuladas por el smoke. `failure.png` documenta que el intento con login demo real terminó en «Usuario o contraseña incorrectos». Por lo tanto, esta iteración tiene QA visual reproducida sobre un snapshot real guardado, **no un E2E real autenticado**.

El rango no cambia backend, contratos financieros, cálculos, permisos, posiciones, órdenes, `Lab.tsx`, host/conversaciones de Lab, harness de Claude ni producción. La consolidación autorizada del shell es transversal a Monitor/Operativa/Lab; en la lectura estática no se halló una rotura adicional del host. El principal riesgo restante es que el calendario global actual comparte pantalla con el calendario guardado de Macro sin distinguir procedencia ni corte. No hubo push, PR ni acción sobre producción. Esta revisión no acredita APPROVE, VALIDATED ni CLOSED.
