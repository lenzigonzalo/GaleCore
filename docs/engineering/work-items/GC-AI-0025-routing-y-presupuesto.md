---
id: GC-AI-0025
title: Routing y presupuesto de modelos (desarrollo y producto) — pieza 1b
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0025 — Routing y presupuesto de modelos

## Qué y para qué

- **Qué hacemos:** un presupuesto por work item que se ve y frena el desarrollo, y una regla que elige el modelo de
  cada capacidad según el trabajo (código → Haiku → Sonnet → Opus).
- **Para qué:** que el owner vea cuánto gasta cada trabajo y que nada consuma cuota en silencio; que el trader pida
  y el sistema use el modelo adecuado sin nombrarlo.
- **Cómo veremos que sirve:** al iniciar la sesión aparece el consumo del item; al 80 % avisa; al 100 % sólo deja
  guardar el handoff; cada corrida programada registra modelo y motivo.
- **Qué queda fuera:** topes en USD, cambiar el modelo del chat, abrir sesiones solas, el lifecycle de skills.

## Objective

Pieza 1b del roadmap §4 (BL-001, addendum «Routing y presupuesto visibles», 04/10), con las decisiones del owner del
04/10: presupuesto **250 llamadas / 200 000 tokens de salida por work item**, aviso al 80 %, al 100 % **freno**
(guardar y explicar; el owner sube el límite); sesión nueva por work item con **comando listo que abre el owner**;
routing de producto **código → Haiku → Sonnet → Opus**, Opus sólo para interpretar, y una caída o falta de cuota
nunca sube de modelo.

## Lo que el host permite (verificado 04/10, Claude Code 2.1.288)

- Sesión interactiva: `--model`, `--effort` y `-n/--name` al abrir; no hay tope de gasto nativo. Un hook ve el
  transcript (`transcript_path`), que trae `usage` por llamada: se puede contar en vivo y bloquear herramientas.
- `-p` (lo que usa el runner): `--model`, `--max-turns`, `--fallback-model` (no se usa), `--max-budget-usd` (sólo
  USD de API; no aplica a la cuota de la suscripción: no se usa).
- Subagentes: `model` y `effort` en el frontmatter, o `model` al lanzarlos.
- `--bg` y `claude agents` existen; el owner eligió abrir él la sesión.
- Consumo real de referencia (últimas 30 sesiones del workspace): mediana 90 llamadas / 75k salida; percentil 75:
  263 llamadas / 195k salida. Las lecturas de caché dominan el volumen (mediana 16 M) y no entran al límite.

## Non-goals

- Tope en USD o tarifas; cambiar o detener el modelo de la sesión del chat.
- Abrir sesiones automáticamente; subagentes por defecto.
- Lifecycle general de skills (BL-001 sigue postergado).

## Scope

- Workspace (`.claude/`): hook de presupuesto, configuración de límites, alineación de `reviewer`/`autorun` con
  `ENGINEERING.md` §5, comando de sesión nueva en el handoff y en `work_item.py start`.
- GaleCore-AI: política de modelo por tipo de trabajo en el catálogo (`schedulable.work`), registro de modelo y
  motivo en cada corrida, inventario y `catalog --match` con el modelo que corresponde; sección «Qué y para qué» en la
  plantilla y aviso del gate si el item activo no la tiene.

## Acceptance criteria

- [ ] **AC-01 — Presupuesto visible:** al iniciar la sesión y en cada aviso se ve llamadas y salida del item activo
  contra su límite, sumando sesiones anteriores y subagentes.
- [ ] **AC-02 — Aviso y freno:** al 80 % avisa una vez; al 100 % bloquea herramientas salvo leer y escribir el
  work item / handoff, y explica cómo subir el límite.
- [ ] **AC-03 — Agentes alineados:** `reviewer` y `autorun` siguen `ENGINEERING.md` §5 (Sonnet; Opus sólo al cierre).
- [ ] **AC-04 — Sesión por trabajo:** `work_item.py start` y el handoff dejan el comando `claude -n <id> "retoma el
  handoff"` listo.
- [ ] **AC-05 — Routing de producto:** toda capacidad programable por modelo declara su trabajo; el modelo sale de la
  política; un modelo que no corresponde se rechaza en `catalog --check`; nunca hay modelo de respaldo.
- [ ] **AC-06 — Elección registrada:** cada corrida guarda modelo y motivo; `inventory` y `catalog --match` lo muestran.
- [ ] **AC-07 — Qué y para qué:** la plantilla tiene la sección y el gate avisa si el item activo no la tiene.
- [ ] **AC-08 — Cierre:** owner.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 | PENDING | PENDING | PENDING | PENDING |
| AC-02 | PENDING | PENDING | PENDING | PENDING |
| AC-03 | PENDING | PENDING | PENDING | PENDING |
| AC-04 | PENDING | PENDING | PENDING | PENDING |
| AC-05 | PENDING | PENDING | PENDING | PENDING |
| AC-06 | PENDING | PENDING | PENDING | PENDING |
| AC-07 | PENDING | PENDING | PENDING | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Implementer handoff

**State:** PENDING

## Independent review

**Reviewer:** PENDING
**Review result:** PENDING
