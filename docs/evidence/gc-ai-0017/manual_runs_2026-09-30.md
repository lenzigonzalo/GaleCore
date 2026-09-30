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
