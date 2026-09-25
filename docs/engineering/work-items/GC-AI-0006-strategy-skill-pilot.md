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
