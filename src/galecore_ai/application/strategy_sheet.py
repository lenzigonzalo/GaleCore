"""The one-page sheet of a strategy version (WS-0016): parameters, management tree, gaps, decisions, critique.

Built by code from the stored version, its critique and its approval; it adds no number of its own. A version
saved before WS-0016 has no parameter table or management tree: the sheet says so and lists the rules that
carry a parameter instead.
"""

from __future__ import annotations

from galecore_ai.adapters.strategy_store import StrategyIntegrityError, StrategyStoreError
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.application.strategy import IMPLICIT_BEHAVIOR, load_critique, load_proposal
from galecore_ai.contracts.strategy import Basis, RuntimeStatus, StrategyDocument

BASIS_LABEL = {
    Basis.GROUNDED: "fundado",
    Basis.HYPOTHESIS: "hipótesis",
    Basis.PENDING_PARAMETER: "sin fundar",
    Basis.OWNER_DECISION: "decisión del owner",
    Basis.DESIGN_CHOICE: "elección de diseño",
}


def _cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "/")


def _runs(doc: StrategyDocument, rule_ids: list[str]) -> str:
    """Whether GaleCore executes a management step: every rule supported, some declared gap, or nothing to run."""
    rules = [r for r in doc.content.rules if r.id in rule_ids]
    statuses = {r.runtime.status for r in rules}
    if RuntimeStatus.UNSUPPORTED in statuses:
        return "no (hueco declarado)"
    if statuses == {RuntimeStatus.NOT_APPLICABLE}:
        return "no aplica"
    paths = {p for r in rules if r.runtime.status == RuntimeStatus.SUPPORTED for p in r.runtime.spec_paths}
    if paths and paths <= set(IMPLICIT_BEHAVIOR):
        return "sí (lo hace siempre)"
    return "sí"


def sheet(kb: KnowledgeBase, key: str) -> dict:
    doc = load_proposal(kb, key)
    review = load_critique(kb, key)
    try:
        approval = kb.strategies.load_approval(key)
    except (StrategyStoreError, StrategyIntegrityError) as exc:
        raise KnowledgeError(f"strategy:{key}: approval not usable ({exc})") from exc
    c = doc.content
    review_ok = review is not None and review.proposal_hash == doc.content_hash
    lines = [
        f"# {c.display_name} — {c.name} {c.version}",
        "",
        (f"Check: {doc.check.verdict} · hash `{doc.spec_hash}` · crítica: "
         f"{review.content.verdict.value if review_ok else 'sin crítica'} · aprobada: {'sí' if approval else 'no'}"),
        "",
        f"**Para qué:** {_cell(c.purpose)}",
        "",
        f"**Hipótesis:** {_cell(c.hypothesis.mechanism)} → {_cell(c.hypothesis.expected_result)}",
        "",
        "**Falla si:** " + "; ".join(_cell(x) for x in c.hypothesis.failure_conditions if x.strip()),
        "",
        "## Parámetros",
        "",
    ]
    if c.parameters:
        lines += ["| Parámetro | Valor | Unidad | Rango razonable | Depende de | Qué lo fundaría | Estado | Reglas |",
                  "|---|---|---|---|---|---|---|---|"]
        lines += [f"| {_cell(p.name)} | {_cell(p.value)} | {_cell(p.unit)} | {_cell(p.reasonable_range)} | "
                  f"{_cell(p.depends_on)} | {_cell(p.would_found)} | {BASIS_LABEL[p.status]} | {', '.join(p.rules)} |"
                  for p in c.parameters]
    else:
        lines += ["Sin tabla de parámetros (versión guardada antes de WS-0016). Reglas con parámetro:", "",
                  "| Regla | Parámetro | Estado |", "|---|---|---|"]
        lines += [f"| {r.id} | {_cell(r.parameter)} | {BASIS_LABEL[r.basis]} |" for r in c.rules if r.parameter.strip()]
    lines += ["", "## Gestión", ""]
    if c.management:
        lines += ["| Paso | Tipo | Disparador | Acción | Lo ejecuta GaleCore |", "|---|---|---|---|---|"]
        lines += [f"| {s.id} | {s.kind.value} | {_cell(s.trigger)} | {_cell(s.action)} | {_runs(doc, s.rules)} |"
                  for s in c.management]
    else:
        lines += ["Sin árbol de gestión (versión guardada antes de WS-0016)."]
    lines += ["", "## Lo que GaleCore no ejecuta", ""]
    lines += [f"- {_cell(g)}" for g in doc.check.declared_gaps] or ["- Nada declarado."]
    pending = [d for d in c.owner_decisions if d.status == "pending"]
    lines += ["", "## Decisiones pendientes del owner", ""]
    if approval is not None and pending:
        lines += ["Como quedaron en la propuesta, antes de la aprobación:", ""]
    lines += [f"- {_cell(d.question)} — recomendación: {_cell(d.recommendation)}" for d in pending] or ["- Ninguna."]
    lines += ["", "## Crítica", ""]
    if review_ok:
        rc = review.content
        lines += [f"**Veredicto:** {rc.verdict.value}", "", "**Por qué no:**"]
        lines += [f"- {_cell(x)}" for x in rc.why_not]
        lines += ["", "**Qué falta:**"] + [f"- {_cell(x)}" for x in rc.missing]
        lines += ["", "**Sesgos:**"] + [f"- {_cell(x)}" for x in rc.biases]
        lines += ["", f"**Explicación alternativa:** {_cell(rc.alternative_explanation)}"]
        lines += ["", "**Se apaga si:**"] + [f"- {_cell(x)}" for x in rc.shutdown_criteria]
        lines += ["", f"**Tras cada operación cerrada:** {_cell(rc.closed_trade_review)}"]
    else:
        lines += ["Sin crítica de esta versión (aprobada antes de que la crítica fuera obligatoria)." if approval
                  else "Sin crítica de esta versión: no se puede aprobar."]
    return {"strategy": f"strategy:{key}", "spec_hash": doc.spec_hash, "check": doc.check.verdict,
            "critique": review.content.verdict.value if review_ok else None, "approved": approval is not None,
            "markdown": "\n".join(lines) + "\n"}
