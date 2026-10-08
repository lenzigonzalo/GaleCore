# WS-0016 — cómo se resolvió cada hallazgo de Codex (08/10)

Informe original, sin tocar: `WS-0016-codex-20261008.md`. Commits en `feature/WS-0016` (GaleCore-AI) salvo que se diga.

| Hallazgo | Resolución |
|---|---|
| BLOCKER — `deploy_check` admitía una versión aprobada sin crítica | Decisión del owner (08/10): exigir crítica válida de la versión exacta también ahí, sin tocar aprobaciones históricas ni despliegues activos. `critique_problem` es la validación que ya usaba `approve`, compartida; test con sin crítica, crítica de otro documento, «descartar» y «seguir» (`91d0d2d`). |
| MAJOR — crédito por acción rotulado «USD por contrato» | GaleCore `feature/WS-0016`: el supuesto dice la unidad de cada monto; la ficha rotula «Crédito (por acción)» (`9d8fdff`). |
| MAJOR — la ficha descartaba gamma y capital | La ficha muestra Γ y Capital tal como vienen de GaleCore; test actualizado (`9d8fdff`). |
| MAJOR — evidencia real sin comando ni exit code | `docs/evidence/ws-0016/ac-03-04-estructuras-1.0.5.md` regenerada con comando, exit code y las secciones de AC-02 y AC-03/04 sin editar (`9d8fdff`). |
| MAJOR — falta la prueba con «una idea nueva del owner» | Ajuste del contrato autorizado por el owner (08/10): «una propuesta nueva de prueba, elaborada por el agente a partir del perfil y los datos disponibles». Recorrido desde cero: `research:2026-10-08-spy-pcs-lejano-prueba` → check `VALID_WITH_DECLARED_GAPS` → `strategy:spy_pcs_lejano_prueba/1.0.0` → crítica «revisar» → ficha. Sin aprobar ni desplegar; la única decisión del owner queda pendiente. Evidencia: `docs/evidence/ws-0016/propuesta-de-prueba-spy_pcs_lejano_prueba.md`. El negativo «sin investigación ni crítica no llega a aprobación» queda en los tests de `approve` y `deploy_check`; no se corrió `approve` sobre la propuesta real para no crear una aprobación. |
| MINOR — «Para retomar» desactualizado | Actualizado en el work item del workspace. |
