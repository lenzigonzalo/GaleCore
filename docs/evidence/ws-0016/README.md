# WS-0016 — evidencia

**AC-06 + AC-01 (06/10/2026), sobre una copia de `knowledge/` (scratchpad), sin tocar GaleCore ni el conocimiento real:**

- Base: `strategy:spy_prima_varianza_30_45d/1.0.5` (aprobada, en SHADOW) como 1.0.6 con tabla de parámetros (11 filas)
  y árbol de gestión (6 pasos); la spec es la de la 1.0.5 con `identity.version` 1.0.6. Se quitó una referencia
  `file:` a un worktree ya borrado (`.worktrees/galecore-ai/GC-AI-0006/...`): la 1.0.5 real ya no la resuelve.
- `strategy check` → VALID_WITH_DECLARED_GAPS, `design_gaps` [] · `strategy save` → RECORDED.
- `strategy approve` sin crítica → REJECTED («no critique of this version»).
- `strategy critique` → RECORDED, veredicto «revisar» (`ac06-critica-1.0.6.json`).
- `strategy sheet` → `ac01-ficha-1.0.6-copia.md`.
- `strategy sheet` sobre la 1.0.5 real: cae a «sin tabla de parámetros» y lista las 10 reglas con parámetro; las 6
  versiones guardadas siguen íntegras (`kb search --kind strategy`: `integrity_failed` []).

La crítica la escribió el host (Claude) leyendo la versión; es `HOST_DECLARED`, no la verificó un tercero.

**AC-02 (07/10 01:14 UTC), misma copia, API Dev reiniciada:** `strategy sheet` suma «Riesgo contra el perfil»
(`profile:v8`): pérdida máxima por operación 500 USD (tope de la spec) contra 500 USD (5 %) → dentro; peor caso
sumado 5.000 USD (10 × 500) contra 5.000 USD (50 %) → dentro; kill switch G5 → no lo ejecuta GaleCore (hueco
declarado); abierto hoy en SHADOW 1.367 USD en 3 posiciones, entra riesgo nuevo por 3.633 USD (GaleCore Exposure).
Contexto del instrumento: el método pide `story pack --symbol` o el pack del día
(`evidence:2026-10-06-historia-spy-2309`, con `drivers`) y lo cita en la hipótesis; sin código nuevo.

Corrección a la crítica de la copia (`ac06-critica-1.0.6.json`): heredó de la 1.0.5 «drawdown del perfil 1.500 USD».
El perfil vigente dice que 1.500 USD es el tope de **una apuesta** (mismo subyacente, dirección y semana), no un
drawdown; el riesgo sumado permitido es 5.000 USD. La ficha nueva lo muestra con los números del perfil.
