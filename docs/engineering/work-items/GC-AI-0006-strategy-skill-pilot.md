---
id: GC-AI-0006
title: Piloto de instrucciones para desarrollo de estrategias
status: IN_PROGRESS
implementer: claude-code
reviewer: codex
approver: user
review_result: PENDING
approval_result: PENDING
feature_freeze: false
closure_blocked: true
---

# Alcance acordado

## Primera entrega del piloto de I4 (owner, 25/09/2026) — activa

GC-0004 (I3) se cerró el 25/09 y este item pasa a ser el trabajo activo (`ACTIVE_WORK_ITEM`). El borrador de
abajo (instrucción, cobertura y prueba de primer recorrido, escritos por Codex el 24/09) se reutiliza tal cual
como método; no se crea otro item ni otra instrucción.

**Idea del owner:** investigar si vender prima con put credit spreads sobre SPY, cuando la prima resulte
atractiva y el entorno cumpla condiciones de riesgo, tiene una **ventaja verificable después de costos**.

**Entregable:** aplicar [SKILL.md](../pilots/strategy-design/SKILL.md) a esa idea y producir una **propuesta
que el owner pueda entender y evaluar**, con:
- la hipótesis explícita (mecanismo → resultado buscado → forma de capturarlo → condiciones de falla) y
  explicaciones alternativas;
- RPF (`GaleCore/docs/rpf/`) y lo que hay en GaleCore (runtime SHADOW, specs de prueba, research y registros de
  régimen) como **antecedentes, no como respuesta aprobada**: cuestionar sus reglas actuales;
- evidencia favorable y contraria, con fuentes;
- reglas y parámetros con su estado de cobertura; los que no tengan fundamento quedan `pendiente`, **sin
  inventar umbrales**;
- datos y pruebas que faltan, y un plan de prueba con criterios de apoyo, refutación e inconclusión fijados antes
  de ver resultados; costos incluidos;
- sin presentar rentabilidad como demostrada.

**Fuera de esta entrega:** desplegar, convertir a `StrategySpec`, ampliar el runtime (multiinstancia,
multi-ticker, acciones: postergados en `BL-007`), backtests con datos comprados, PAPER/LIVE. El contraste contra el
host sin la skill (A/B del roadmap) va después de esta entrega.

### Acceptance criteria (primera entrega)

- [ ] **AC-01 — Ventaja y mecanismo:** la propuesta dice qué ventaja se busca, por qué podría existir
  (mecanismo → resultado → forma de capturarlo → condiciones de falla) y qué explicaciones alternativas hay.
- [ ] **AC-02 — Tres capas separadas:** reglas actuales de RPF (con su fuente), recomendaciones nuevas (con su
  razón) y parámetros pendientes de fundamento; ningún umbral nuevo inventado.
- [ ] **AC-03 — Evidencia:** a favor y en contra, cada hecho con una fuente que resuelve; lo que falta para
  concluir queda explícito como conclusión pendiente.
- [ ] **AC-04 — Prueba que permitiría descartarla:** plan con datos, costos, comparación y criterios de apoyo,
  refutación e inconclusión fijados antes de ver resultados.
- [ ] **AC-05 — Evaluación de la instrucción:** qué aportó SKILL.md/coverage.md y qué omitió o dificultó,
  como evidencia del primer recorrido (la comparación contra el host sin la instrucción es el paso posterior).
- [ ] **AC-06 — Revisión:** interna y de Codex; la utilidad la evalúa el owner.

**Dónde queda:** la propuesta, como evidencia del piloto en `docs/engineering/pilots/strategy-design/`
(ubicación experimental, sin decidir la taxonomía de `BL-009`).

**Verificación:** revisión interna y de Codex de la propuesta contra SKILL.md y coverage.md (fuentes que
resuelven, ningún número sin origen, pendientes explícitos); la evaluación del owner decide si sirve.

### Requirement-to-evidence matrix (primera entrega)

| Criterio | Evidencia | Estado |
|---|---|---|
| AC-01 | [propuesta](../pilots/strategy-design/propuesta-pcs-spy-2026-09-25.md) §1, §3.1, §3.3 | Entregado; falta revisión |
| AC-02 | propuesta §4.A (RPF con fuente), §4.B (R1–R8 con razón), §4.C (pendientes sin números) | Entregado; falta revisión |
| AC-03 | propuesta §3.2 (E1–E18 con fuente; cálculos propios marcados), §7 | Entregado; falta revisión |
| AC-04 | propuesta §6 (P1–P4, datos, método, criterios en forma; umbrales del owner) | Entregado; umbrales y compra de datos: decisión del owner |
| AC-05 | [evaluation.md](../pilots/strategy-design/evaluation.md) "Primer recorrido real — 25/09" | Entregado |
| AC-06 | Revisión interna R1 (25/09): CHANGES_REQUESTED → corregido (ver abajo) | Pendiente: Codex y evaluación del owner |

**Handoff de la entrega (25/09):** propuesta y evaluación escritas por Claude Code en la misma sesión que cerró
GC-0004 (contexto previo de RPF: declarado como sesgo en la evaluación). Fuentes externas: la nota de Cboe se
leyó; Carr & Wu (2009) sólo se vio en resultados de búsqueda; Bondarenko (2014) se verificó por su abstract
después de la revisión interna; el PDF de Bondarenko (2019) no se pudo leer. Ningún número nuevo sin origen;
los cálculos propios están marcados. Sin cambios de producto, runtime, catálogo ni knowledge; se agregó un driver de `/review-codex` para el
worktree (`docs/evidence/gc-ai-0006/codex_review.py`).

### Revisión interna R1 (agente `reviewer`, `24fdf00..f588259`) — CHANGES_REQUESTED

Reprodujo gate PASS, ruff, pytest 699 passed y `diff --check`. Recalculó los cálculos propios (E13–E15) y
confirmó 4.A contra el JSON y la definición.

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| R1-M1 | MAJOR | E4 invertía a Bondarenko (2014) | E3 reescrito con el abstract (Crossref); el *peso problem* queda como hipótesis del host |
| R1-M2 | MAJOR | E8 omitía el erratum de BT-9 | Agregado: 2018 −$903 con piso; el veredicto se mantiene por 2020 −$1.776 |
| R1-M3 | MAJOR | §6.3 con refuta/inconcluso solapados | Criterios excluyentes con orden de evaluación |
| R1-m | MINOR | E5 selectivo; E6 no era la venta mecánica; faltaba BT-10b; cita de E16; origen del sizing; hard defense extrapolado; dato faltante en RPF; E18 era inferencia; fuentes sólo de buscador; handoff desactualizado | Todos corregidos (E5, E6, E10b, E16, 4.A, 4.C, R9, §5, E18, evaluación, handoff) |
| R1-n | NIT | Cita no textual de SKILL; "2004–2005" sin origen; R6 sin aclarar estado; D-0001 "GEX informativo" | Corregidos (R5 incluye D-0001) |

### Revisión Codex C1 (`GC-AI-0006-20260925T184338Z.md`, `24fdf00..a16eb1a`) — CHANGES_REQUESTED

Reprodujo gate, ruff, pytest 699 y `diff --check`; recalculó E13–E15 (coinciden).

| # | Sev. | Hallazgo | Resolución |
|---|---|---|---|
| C1-M1 | MAJOR | Roll defensivo: `min_dte_remaining: 21` (JSON) vs "nueva expiración ≥ 21" (definición) presentado sin ambigüedad | 4.A declara la disputa; R10 nuevo; el roll queda fuera de la prueba hasta resolverlo |
| C1-M2 | MAJOR | P1/P2 no reproducibles: T-bill por operación, unidad de riesgo, intervalo | §6.3 nuevo con las fórmulas (contrafactual, exceso, razón por riesgo, bootstrap por meses) |
| C1-M3 | MAJOR | Intervalo que cruza cero clasificado como refutación | §6.4: cruza cero → inconcluso; refuta sólo si queda entero en cero o por debajo; la peor pérdida es regla de seguridad explícita |
| C1-m1 | MINOR | E1 visto sólo en buscador | Declarado en E1 |
| C1-m2 | MINOR | Quirks de datos sólo de memoria del host | Marcados "no verificados en este recorrido" |
| C1-m3 | MINOR | "Sin cambios de código" con un driver agregado | Handoff corregido |
| C1-m4 | MINOR | Roadmap: "la skill hoy no existe" | Aclarado: existe un borrador experimental, no aprobado ni catalogado |

### Recheck Codex C2 (`GC-AI-0006-20260925T190220Z.md`, `a16eb1a..11be19f`) — CHANGES_REQUESTED

C1-M1, C1-M3 y los cuatro MINOR resueltos. Abierto C1-M2: la serie del T-bill, su unidad y su convención no
estaban identificadas. Corregido: FRED `GS3M` (mensual, %, desde 1981-09), la misma de BT-15 (el CSV del
research coincide 96/96 con GS3M, no con TB3MS; verificado contra FRED el 25/09), tasa del mes del día,
porcentaje/100 y 252 días hábiles.

## Alcance del borrador (24/09)

Origen: conversación del owner del 24/09/2026, I4 de roadmap/README.md y BL-001. El owner
aclaró que SPY es un input de prueba: el entregable es la instrucción, no perfeccionar una estrategia.
Autorizó escribir el borrador y probar cobertura. (Al 24/09 I3/GC-0004 conservaba prioridad y puntero activo; cerrado el 25/09.)
Este registro delimita el piloto lateral autorizado; no inicia integración de I4 ni cambia prioridades.

Problema: el host puede saltar de una intención a una estructura, omitir partes o atascarse relevando
una estrategia cuando se le pidió diseñar la skill. Resultado: instrucción legible y aplicable a una idea
incompleta, con método de conversación, cobertura, ruteo y separación entre propuesta y ejecución.

Primera demo: respuestas de primer recorrido a SPY, bono argentino, futuros y penny stock/sentimiento,
más un caso donde se solicita diseñar la skill. No se necesitan precios ni credenciales para comprobar
el encuadre y los faltantes; no se medirán resultados financieros. Falta evaluación independiente para
afirmar robustez; A/B de utilidad con el owner sigue pendiente.

## Artefactos

- [Instrucción](../pilots/strategy-design/SKILL.md) y [cobertura](../pilots/strategy-design/coverage.md).
- [Evidencia del piloto](../pilots/strategy-design/evaluation.md): cinco respuestas reales de primer
  recorrido, hallazgos, limitaciones y matriz de alcance. No es A/B ni revisión independiente de ingeniería.
- Escrito por Codex en `.worktrees/galecore-ai/strategy-skill-pilot` (rama `feature/strategy-skill-pilot`,
  base `ba9330a`, sin commits); el 25/09 se copió sin cambios a `.worktrees/galecore-ai/GC-AI-0006`
  (rama `feature/GC-AI-0006`), donde sigue el trabajo. Sólo borrador documental; sin registro en catálogo, instalación, schema nuevo,
  runtime, commits, push ni despliegues. Ubicación experimental, no decisión de taxonomía BL-009.

## Criterios

- C1: preservar intención, restricciones y preferencias; preguntar de modo progresivo.
- C2: cobertura común más especialización abierta; no imponer opciones/roll/backtest a todo caso.
- C3: reglas/estados/fuentes explícitos, abstención e incertidumbre sin datos fabricados.
- C4: ruteo a capacidades disponibles sin inventar dependencias ni autorización de ejecución.
- C5: salida retomable y prueba comprensible con limitaciones; distinguir evaluación de skill y de estrategia.

## Reutilización examinada

Research 1.1.0, catálogo y knowledge existentes (consultados en esta sesión antes del borrador).
GEX/régimen mantienen contratos; no se extienden a recomendaciones por este piloto.
Se revisaron los textos públicos de Anthropic: idea-generation, thesis-tracker, market-researcher,
README, licencia raíz Apache-2.0 y configuración de conectores. Referencias:

- https://github.com/anthropics/financial-services/blob/main/plugins/vertical-plugins/equity-research/skills/idea-generation/SKILL.md
- https://github.com/anthropics/financial-services/blob/main/plugins/vertical-plugins/equity-research/skills/thesis-tracker/SKILL.md
- https://github.com/anthropics/financial-services/blob/main/plugins/agent-plugins/market-researcher/agents/market-researcher.md
- https://github.com/anthropics/financial-services/blob/main/LICENSE

Conclusión de diseño: método propio con research existente; los textos examinados aportan screening
y seguimiento de tesis, no este recorrido completo. No se copiaron archivos ni se instalaron plugins.
No se auditaron paquetes enteros ni se probaron conectores, costo, permisos o compatibilidad efectiva.

## Handoff

Borrador experimental; no disponible mediante selección del catálogo. Se puede probar indicando al
host que lea el SKILL.md y procese un input. Mantener evaluación separada de resultados financieros.
No sobrescribir cambios ajenos en archivos compartidos (backlog, roadmap, engineering): ediciones acotadas.
No marcar VALIDATED/CLOSED ni presentar el piloto como integración E2E.
