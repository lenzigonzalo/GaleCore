# GC-AI-0017 — corridas manuales de la tarea `atencion-diaria-spy` (30/09, antes de la primera automática)

`task run atencion-diaria-spy` (mismo código que el Programador; `invoked_by=manual`, no cuenta como corrida
automática). Eventos: `knowledge/tasks/atencion-diaria-spy/events.jsonl`; salida de cada una en `C:/tmp/gc17_manual_run<N>.json`.

| # | UTC | Resultado | Turnos | Duración | Qué pasó | Arreglo |
|---|---|---|---|---|---|---|
| 1 | 21:55 | INCOMPLETE (datos del día guardados) | — | 10 s | `claude.CMD`: el pedido como argumento superó el límite de Windows | pedido por stdin, esquema corto en el argumento, contrato completo en el pedido |
| 2 | 21:57 | INCOMPLETE (datos del día) | 25/40 | 254 s | evidencia rechazada: se guardaba con la hora de inicio y el modelo la obtuvo después | se guarda con inicio + tiempo transcurrido |
| 3 | 22:04 | INCOMPLETE (datos del día) | 26/40 | 275 s | el modelo citó la propia investigación y la evidencia con ids inventados; 3 evidencias quedaron guardadas sin uso | pedido explícito; `evidence:<slug>` también resuelve; chequeo previo antes de guardar nada |
| 4 | 22:11 | INCOMPLETE (datos del día) | 30/40 | 253 s | un «hecho» sin fuente: el validador rechazó todo el briefing | validación completa previa (mismos controles del almacén) + una ronda de corrección sin herramientas dentro del tope |
| 5 | 22:17 | **INCOMPLETE con briefing guardado**: `research:2026-09-29-atencion-diaria-spy-prima-varianza-30-45d` rev 5, 3 evidencias | 27/40 | 295 s | el modelo completó el método y declaró lo que faltó: posiciones de la instancia 1.0.3 fuera del registro, `prepare` sin conexión, resultados sin conector | — (ver nota) |

Nota de la 5: `prepare` falló porque esta sesión de Claude Code arrancó antes de que `GALECORE_BASE_URL` (:7001)
quedara en el entorno del usuario y fue a `:5000`; el Programador corre con el entorno del usuario. Los conectores
de resultados (FMP/Alpha Vantage) no existen en una corrida programada (`--strict-mcp-config`): la skill 0.2.2 lo dice.

Las 3 evidencias de la corrida 3 (`2026-09-30-atencion-diaria-spy-2208-*`) son respuestas reales de FRED, la Fed y un
fallo de GaleCore; quedan en la base (create-only) sin investigación que las cite.

## Pruebas del 30/09 a la noche (entorno del usuario, como el Programador: `GALECORE_BASE_URL` :7001, claves de HKCU)

| Prueba | UTC | Resultado |
|---|---|---|
| AC-06 pausa | 23:48:28 (`paused`), 23:48:30 (`run_skipped`) | `task pause` → el CLI devolvió `scheduler.status: Disabled`, `next_run: N/A`; `task run` → `SKIPPED (task is paused)`; `task status` → `PAUSED` |
| AC-06 reanudación | 23:48:33 (`resumed`) | `task resume` → `scheduler.status: Ready`, `next_run: 01/10/2026 10:00:00 AM` |
| AC-06 cancelación (tarea descartable `prueba-cancelacion-0017`) | 23:48:44 (`created`), 23:48:45 (`cancelled`), 23:48:47 (`run_skipped`) | `task cancel` → `scheduler: {registered: false}`; `schtasks /query /tn GaleCore-AI\prueba-cancelacion-0017` → «ERROR: The system cannot find the file specified.»; `task run` → `SKIPPED (task is cancelled)` |
| 6 — AC-05 con la API de GaleCore Dev **apagada** (procesos detenidos) | 23:50 | **INCOMPLETE**, rev 6 guardada: el motivo nombra la conexión rechazada al seguimiento (registro `20260930T235009Z`, ERROR) y a `prepare`, y qué sí se obtuvo (FRED, FOMC); ningún valor del runtime inventado |
| API levantada otra vez desde `.worktrees/galecore/GC-0005` | 23:55 | Recuperó 4 instancias, 2 posiciones abiertas, la 1.0.5 con su hash |
| 7 — corrida completa con la API arriba | 23:55 | **OK**, rev 7, 21/40 turnos, 342 s, 3 evidencias. Faltantes declarados: contexto de GaleCore fuera de sesión (VIX viejo), resultados sin conector, griegas, y las posiciones abiertas de la 1.0.3 y la v2 que el registro de seguimiento no muestra (ver hallazgo) |

**Hallazgo de la corrida 7:** `runtime-report` muestra abiertas una posición de la 1.0.3 y una de la v2, pero el registro de
seguimiento (`followup run`) sólo trae la instancia de la versión aprobada más reciente (1.0.5). El briefing lo marcó
como «posible regla incumplida, no verificable». Es un límite del seguimiento (GC-AI-0009), no de esta entrega.

Horas de AC-06 tomadas de `knowledge/tasks/<id>/events.jsonl` (revisión interna: la primera versión de esta tabla las
tenía redondeadas). El estado del Programador es lo que devolvió `schtasks /query` a través del CLI.

## Después de los arreglos de la revisión interna

| # | UTC | Resultado | Turnos | Duración | Qué muestra |
|---|---|---|---|---|---|
| 8 | 01/10 00:24 | **OK**, rev 8, 3 evidencias | 29/40 | 378 s | El runner corrió el seguimiento (`20261001T002416Z`, con los reportes de las otras specs, los tres con exit 0) antes del modelo; el briefing incluye las dos posiciones abiertas de instancias STOPPED (1.0.3 y v2). Faltantes declarados: contexto de GaleCore fuera de sesión, resultados sin conector, griegas, reglas de la v2, feriados de NYSE |
