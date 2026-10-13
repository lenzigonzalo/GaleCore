# GC-0030 — evidencia M0/M1 frontend

13/10/2026. Ejecutado por Codex, en worktree aislado `C:/Users/lenzi/GaleCore-Macro-GC-0030`.
Base `f85d749`, implementación `4e59631`, `a9afff4`, correcciones `c32415b` y commit de evidencia posterior.
No producción, push/PR, migraciones, harness ni modificación de archivos de Claude. API 7001/monitor 3039 intactos.

## Ejecutado

| Comando desde worktree (npm desde source/galecore-monitor) | Resultado real | Artefacto |
|---|---|---|
| `dotnet build source/galecore-datafeed/DataFeed.Api/DataFeed.Api.csproj -nologo -v q` | exit 0; warnings preexistentes, 0 errores | compila también al iniciar `dev/macro_dev.py api`; no copiar logs de API con URLs sensibles |
| `dotnet test source/galecore-datafeed/DataFeed.Tests/DataFeed.Tests.csproj -nologo -v q` | exit 0; 602 pass, 8 skip sin GALECORE_TEST_DB | backend-tests.txt; 7 tests Macro incluidos |
| `CI=true npm test -- --watchAll=false --runTestsByPath src/pages/Macro.test.tsx src/pages/Resumen.test.tsx src/components/layout/WorkspaceNav.test.tsx` | exit 0; 12 pass / 3 suites | frontend-tests.txt |
| `CI=true npm run build` | exit 0, compiled successfully | frontend-build.txt |
| `CI=true npm test -- --watchAll=false` | exit 1; 21 suites pasan / 3 fallan, 79 tests pasan / 1 falla | frontend-full-summary.txt; detalle abajo |
| `python -m ruff check dev/macro_dev.py dev/macro_smoke.py dev/macro_probe.py` | exit 0 | inspección final del comando; sólo scripts nuevos |
| `python dev/macro_probe.py --output docs/engineering/evidence/GC-0030` | exit 0; 200 catálogo/snapshot/readback/series/events, 400/404 negativos | api-run.json, snapshot-real.json |
| `python dev/macro_probe.py --unconfigured-store --output docs/engineering/evidence/GC-0030` | exit 0; cuatro rutas 503, proceso propio temporal 7003 terminado | unconfigured-store-run.json |
| `python dev/macro_smoke.py --output docs/engineering/evidence/GC-0030` | exit 0; Chromium real, Monitor→Macro y link inmediato | browser-run.json y PNG |
| `git diff --check` | exit 0 | sin whitespace errors |

Los timestamps y SHAs de snapshot en JSON son de las corridas; no se rellenaron a mano.
La sonda consulta fuentes públicas mediante GaleCore Dev, con usuario demo real y credenciales sólo en memoria.
snapshot-real.json no contiene secretos ni cartera. Los tests determinísticos usan fixtures sintéticas explícitas.

La suite frontend completa quedó roja en código ajeno: Lab.test/App.test no cargan react-markdown ESM de LabMarkdown;
LabShadow.test falla «lectura fallida no se presenta como estrategia sin versión o sin métricas».
Los archivos Lab/LabShadow/LabMarkdown y tests correspondientes son idénticos a f85d749 (git diff vacío).
No se modifica el Lab para arreglarlos: Claude continúa WS-0029. App.test conserva además assertion de plantilla.
El import ESM nuevo de MacroChart fue corregido a carga dinámica; la corrida completa posterior falla en LabMarkdown.
No se presenta la suite global como verde. Los 8 tests PostgreSQL omitidos no se acreditan: no se tocó persistencia EF.

## Evaluado

Recorrido real final: login Dev desde `/` → barra lateral Macro → copiar sin cambiar filtros → recargar snapshot;
radar seis familias y sin P&L/órdenes → Tesoro 10 años → fuente/unidad/fecha → Escape/restauración de foco → Atrás;
Drivers/curva → Sesión (N/D explícito) → mes → enlace/recarga → Mercados/Volatilidad/Eventos → viewport 390 px y detalle.
browser-run.json registra sólo requests personales **durante Macro**: lista vacía. El arranque normal de Inicio
puede consultar cuenta antes de entrar; el enlace directo Macro la omite. No se cambió la cuenta demo.
Se inspeccionaron PNG desktop y móvil: legibilidad, sin overflow global; tablas con scroll horizontal y nombre/unidad
visibles; detalle ancho completo bajo 1024. Mobile muestra shell compacto existente, no rediseño de navegación.
La UI esencial no requiere hover. Foco/Escape/Atrás también están probados en unit tests.
Sin evaluación de experiencia del owner ni puntuación inventada.

Fuentes: Treasury, FRED, FOMC y CBOE respondieron en las corridas reales. Hubo variación: en api-run.json actual,
VIX/VVIX/SKEW excedieron el límite de 12s, con estados source-error; otras fuentes se conservan. Corridas anteriores
mostraron esos índices y sus fechas. Esto demuestra fallos parciales, no latencia sostenida ni SLA.
FOMC volvió a responder y muestra la reunión del 28/10: timeout previo no era evidencia de ausencia definitiva.
OAS confirmó metadato `Daily, Close` (no `Daily`); catálogo/validación ajustados explícitamente.

## Trazabilidad y correcciones de review

| Aceptación | Código / test | Evidencia real |
|---|---|---|
| Familias estables, independencia de IA/broker | MacroCatalog, MacroSnapshotHandler; FailedSources test; Macro.test | browser-run.json, panorama-desktop.png |
| null no cero, fecha/consulta diferenciadas, fallo parcial | MacroContracts / cache LastGood; MissingAndUnsupported, Slope y FailedSources tests | snapshot-real.json, api-run.json |
| mes calendario/pb/fechas comunes; alcance no soportado rechazado | MacroCalculations, MacroDashboardTests | series/400 en api-run.json; drivers-desktop.png |
| snapshot inmutable, referencia inexistente, sin replay | MacroController; HistoricalAndUnsupportedScope test | readback idéntico / 404 / cutoff 400 en api-run.json |
| detalle/foco/keyboard/enlace/recarga/estado tardío | Macro.test y Macro.tsx | browser-run.json, detalle desktop/móvil |
| calendario y negativos por fuente | ReadFredEvents / ReadFedEvents | eventos-desktop.png, eventos-mobile.png; estados por fuente |

Dictamen independiente: ../../reviews/GC-0030-independent.md, única pasada sobre f85d749..a9afff4:
**CHANGES_REQUESTED**. No fue editado por el implementer. Disposición posterior, sin recheck:
- F1: URL canónica al montar + copy con parámetros explícitos; test de entrada sin query y recorrido normal real pasan.
- F2: import dinámico del gráfico dentro de effect; build pasa, suite global ya no falla cargando MacroChart.
- F3: 503 en las cuatro rutas sin store; sonda real unconfigured-store-run.json pasa.
- F4: pendiente con entrada null devuelve qualityStatus unavailable; assertion agregada y suite backend pasa.
No se atribuye APPROVE a estas correcciones. Estado de entrega READY_FOR_REVIEW, nunca VALIDATED/CLOSED.

## Límites y retoma

M0/M1 es cobertura EE. UU. parcial, no etapa 1 global completa. Sesión/5 sesiones/Desde evento, magnitud, fuentes
de acciones/FX/commodities, regiones, IA, noticias, históricos fieles y posicionamiento siguen pendientes por contrato.
No se crea un plan paralelo: M2–M5 quedan propuestos, WS-0029 conserva sus pendientes y su prioridad de producto.
Rollback por revert de commits propios; snapshots capturados conservan sus IDs. Límite local 100 snapshots,
no borrado automático. Preview usable en http://localhost:5173/?macro=panorama; usuario demo Dev.
