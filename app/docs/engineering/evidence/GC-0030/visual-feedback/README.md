# GC-0030 — feedback visual del owner

13/10/2026 · flag `frontend`. Iteración nueva autorizada por el feedback del owner; no M2–M5.
Dirección vigente del monitor: **http://localhost:3039/**. El owner pidió conservarla y se cerró 5173.
Se reemplazó sólo el proceso frontend 3039, con autorización explícita de esta conversación.
API Macro sigue en 7002; API/harness habituales 7001 y host del Lab no se reiniciaron ni modificaron.

## Cambios

Barra global de 64 px con logo, lupa/Ctrl+K, control de barra lateral, modos y reloj. Sin segunda barra
Macro/buscador/Lab ni título Macro repetido. Pestañas de 18 px; gráficos de 290 px con valor/cambio claros.
Curva del Tesoro sin gran rectángulo gris; tabla compacta, indicador/unidad juntos, cuatro columnas útiles.
Fuentes, timestamps y método están en el detalle desplegable, no dispersos por la portada.
El detalle explica qué mide cada indicador y muestra gráfico/valor/comparación; se retiró la tabla cruda de fechas.
Se retiró copiar enlace. Los enlaces antiguos siguen parseándose; horizontes no soportados no se simulan.
Comparación visible: 1 mes, el único período calculado en M1; se retiró el selector de regiones sin cobertura adicional.
Panorama muestra cuatro series nombradas explícitamente: Tesoro 10Y, real 10Y, breakeven y VIX. No se las llama
política implícita, dólar o amplitud: el owner cambió la prioridad visual de los slots vacíos de la propuesta.
Calendario mensual en Eventos y en el panel derecho global junto a watchlist, ajustable de ancho. Eventos con nombres
en español y abreviaturas legibles en el panel pequeño; el nombre accesible incluye fecha. Al navegar mantiene apertura.
No cambios a backend, fórmulas, fuentes nuevas, trading, permisos, Lab.tsx, harness ni archivos de Claude.

## Ejecutado

| Comando | Resultado | Artefacto |
|---|---|---|
| `CI=true npm test -- --watchAll=false --runInBand --detectOpenHandles --runTestsByPath src/pages/Macro.test.tsx src/pages/Resumen.test.tsx src/components/layout/WorkspaceNav.test.tsx src/components/layout/WorkspaceSearch.test.tsx src/components/layout/WorkspaceHeader.test.tsx src/components/macro/CalendarDock.test.tsx` | exit 0, 17 tests / 6 suites | tests.txt |
| `CI=true npm run build` | exit 0, compiled successfully | build.txt |
| `python -m ruff check dev/macro_dev.py dev/macro_visual_smoke.py` | exit 0 | comando final |
| `git diff --check` | exit 0 | comando final |
| `python dev/macro_visual_smoke.py --saved-data` | exit 0, Chromium 120 | browser-run.json y PNG |

Npm desde source/galecore-monitor; Python/git desde worktree aislado. Extractos de consola normalizados sólo
en whitespace. Hubo una advertencia de worker al ejecutar tests en paralelo; la corrida serial con detección de
handles terminó sin esa advertencia. No se repitió suite backend: ningún cambio en backend/cálculos/contratos.
D-0010 aplica a esta vuelta visual; pruebas proporcionales para los controles y calendario añadidos.
La suite global de frontend tenía fallos de Lab documentados en el hito anterior; no se modificó ese código ajeno.

## Evaluado y límites

Recorrido visual: Macro en 3039 → lupa/Ctrl K/foco/Escape → ocultar/mostrar navegación → abrir indicador y método →
Drivers → Eventos/mes/Hoy → agenda de consulta guardada identificada → calendario lateral actual → ajustar ancho con
teclado → Resumen conservando panel → cerrar panel → Macro → viewport 390 px sin overflow global.
Se inspeccionaron los PNG desktop/móvil, gráfico, detalle, calendario y búsqueda. Sin nota de experiencia inventada.

**No es un E2E autenticado real:** el login demo con contraseña guardada fue rechazado. `failure.png` registra el
estado. No se reseteó contraseña ni modificó autenticación. El helper CUA también falló y no permitió inspeccionar
la sesión existente del owner. Para QA visual se usó `snapshot-real.json` del hito anterior (datos de mercado reales
guardados) y una sesión/respuestas de prueba aisladas en Playwright. Todas las capturas exitosas llevan el rótulo
«QA visual · datos reales guardados · sesión simulada»; browser-run.json declara ese modo. No se inyectó ese mock
en la aplicación servida al owner. La aplicación en 3039 sigue consultando GaleCore Dev.
El calendario de la prueba del panel se deriva de esos mismos datos guardados: no acredita actualidad de FRED/Fed.
La prueba negativa de una fuente fallida conserva los eventos de la otra en CalendarDock.test.
Pendiente: repetir login y recorrido con una credencial Dev vigente o sesión autorizada disponible al agente.

## Review y retoma

Review nuevo: ../../../reviews/GC-0030-visual-feedback.md, rango `09816f3..af0b64d`, CHANGES_REQUESTED.
Disposición posterior del implementer, sin recheck y sin editar ese dictamen:
- F1: agenda actual identificada en dock y fuente/consulta desplegables; agenda guardada identificada en Eventos
  cuando la URL pide snapshot. La prueba visual verifica ambos rótulos. No se afirma que ambas agendas coincidan.
- P2 fecha local: rango del panel usa día/mes/año locales, como el calendario, en lugar de ISO UTC.
- P2 accesibilidad: evento anuncia fecha y nombre completo; resize anuncia calendario cuando corresponde.
- P2 contexto: Eventos ya no muestra «últimos valores / cambio en 1 mes».
El alcance global y retiro del botón secundario Lab estaban autorizados por el owner; se mantiene la lógica del Lab.
READY_FOR_REVIEW, sin APPROVE/VALIDATED/CLOSED. Commits locales y rollback por revert de esta vuelta.
Para probar: recargar 3039; abrir Macro; Ctrl K; calendario debajo de watchlist; ajustar ancho y abrir un indicador.
