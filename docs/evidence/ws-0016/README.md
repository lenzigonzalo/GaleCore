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
