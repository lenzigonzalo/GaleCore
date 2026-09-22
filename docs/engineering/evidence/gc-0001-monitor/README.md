# GC-0001 — evidencia del recorrido en navegador

`e2e_regime_monitor.py` es el procedimiento reproducible: levanta el adapter de GaleCore-AI sobre
registros **sintéticos** (símbolo `TEST`, en un temp dir; nunca los reales), levanta el monitor en
`:3039` apuntado a ese adapter, inyecta una sesión local simulada (sin API .NET ni Supabase) y
recorre la pestaña Inteligencia → Régimen con Chromium/Playwright: pestañas, "Hoy", historial,
detalle del día pendiente, review con token equivocado (401) y correcto (201), relectura tras
Actualizar, día con outcome (tabla + leyenda), día rechazado (sin contenido), ausencia de
`pageerror`, y relectura del review con `cli query`.

```
python -B docs/engineering/evidence/gc-0001-monitor/e2e_regime_monitor.py <checkout de GaleCore-AI con GC-AI-0004> [<out-dir>]
```

| Corrida | Resultado |
|---|---|
| `run-2026-09-22/run.json` | `ok: true`; pasos con sus salidas (paths sanitizados: `<tmp>`, `<user>`). El día "hoy" coincidió con el día sintético manipulado, por eso "Hoy" muestra integridad fallida: es el estado real de esos datos, no un error |
| `run-2026-09-22/0*.png` | capturas de la corrida (pestaña, detalle pendiente, review guardado, outcome, integridad fallida) |

Lectura del directorio **real** con el adapter (solo lectura, `--no-reviews`) y hashes antes/después:
[`real-dir-readonly-check.json`](../../../../../galecore-ai/GC-AI-0004/docs/evidence/gc-ai-0004-adapter/real-dir-readonly-check.json)
en GaleCore-AI (GC-AI-0004). Login real con la API levantada: no probado en esta sesión (sesión simulada).
Nada de esto es evidencia de ningún criterio de GC-AI-0002.
