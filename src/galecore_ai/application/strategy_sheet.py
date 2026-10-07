"""The one-page sheet of a strategy version (WS-0016): parameters, management tree, risk against the profile, gaps,
decisions, critique.

Built by code from the stored version, its critique and its approval; it adds no number of its own. A version
saved before WS-0016 has no parameter table or management tree: the sheet says so and lists the rules that
carry a parameter instead.
"""

from __future__ import annotations

import json
from collections.abc import Callable

from galecore_ai.adapters.strategy_store import StrategyIntegrityError, StrategyStoreError
from galecore_ai.application import capital, supervisor
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.application.strategy import IMPLICIT_BEHAVIOR, load_critique, load_proposal
from galecore_ai.contracts.strategy import Basis, ManagementKind, RuntimeStatus, StrategyDocument

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


def _num(v) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def risk(kb: KnowledgeBase, doc: StrategyDocument, read: Callable[[str], object] | None = None) -> dict:
    """The version's limits against the profile (AC-02). The per-trade loss is the spec's cap, which the runtime
    enforces ((width − credit) × 100); without a cap, the full width × 100 bounds it. The sum is the worst case of
    every allowed position at that loss. Both are per contract: a saved version always sizes one contract (the check
    refuses any other sizing), and the profile limits are bounds computed here from its percentages. What is open
    now comes from GaleCore's Exposure, as it is."""
    profile = kb.profile.latest()
    lim = capital.limits(profile.content if profile else None)
    spec = json.loads(doc.spec_json)
    limits_ = spec.get("risk_limits") or {}
    legs = (spec.get("candidate_construction") or {}).get("legs") or []
    width = next((_num((leg.get("strike_selection") or {}).get("width")) for leg in legs
                  if str(leg.get("side", "")).upper() == "BUY"), None)
    cap = _num(limits_.get("max_loss_per_trade_usd"))
    per_trade, per_trade_src = (cap, "tope de la spec; el runtime no abre por encima") if cap is not None else (
        (width * 100, "ancho completo × 100; la spec no fija tope") if width is not None else (None, "no calculable"))
    positions = _num(limits_.get("max_concurrent_positions"))
    ref = lim.get("capital_referencia")
    rows, missing = [], [x if x.startswith("perfil") else f"perfil: {x}" for x in lim["no_leidos"]]
    if ref is not None and lim.get("maxRiskPerTradePct") is not None and per_trade is not None:
        allowed = ref * lim["maxRiskPerTradePct"] / 100
        rows.append(("Pérdida máxima por operación (1 contrato)", f"{capital._usd(per_trade)} USD ({per_trade_src})",
                     f"{capital._usd(allowed)} USD ({capital._pct(lim['maxRiskPerTradePct'])} %)",
                     "dentro" if per_trade <= allowed else "EXCEDE"))
    if ref is not None and lim.get("maxOpenRiskPct") is not None and per_trade is not None and positions is not None:
        allowed = ref * lim["maxOpenRiskPct"] / 100
        worst = per_trade * positions
        rows.append(("Peor caso sumado", f"{capital._usd(worst)} USD ({positions:g} posiciones × pérdida máxima)",
                     f"{capital._usd(allowed)} USD ({capital._pct(lim['maxOpenRiskPct'])} %)",
                     "dentro" if worst <= allowed else "EXCEDE"))
    elif positions is None:
        missing.append("la spec no fija posiciones máximas: no hay peor caso sumado")
    kill = [s for s in doc.content.management if s.kind == ManagementKind.KILL_SWITCH]
    kill_text = ("falta: ningún paso del árbol lo define" if not kill
                 else "; ".join(f"{s.id} — lo ejecuta GaleCore: {_runs(doc, s.rules)}" for s in kill))
    opened = None
    if read is not None and ref is not None and not lim["no_leidos"]:
        try:
            exp = read("/App/Runtime/Exposure?" + capital._query(ref, lim))
        except supervisor.SupervisorError as exc:
            missing.append(f"lo abierto en SHADOW: {exc}")
        else:
            try:
                opened = (f"{capital._usd(exp['openMaxRisk'])} USD en riesgo en {exp['positionsOpen']} posiciones; "
                          f"entra riesgo nuevo por {capital._usd(exp['availableForNewRiskUsd'])} USD "
                          f"(GaleCore, {exp.get('asOf')})")
            except (KeyError, TypeError) as exc:
                missing.append(f"lo abierto en SHADOW: respuesta inesperada de GaleCore ({exc!r})")
    elif read is None:
        missing.append("lo abierto en SHADOW: no se consultó GaleCore")
    return {"rows": rows, "kill_switch": kill_text, "open_now": opened, "missing": missing,
            "profile": profile.ref if profile else None}


def sheet(kb: KnowledgeBase, key: str, read: Callable[[str], object] | None = None) -> dict:
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
    r = risk(kb, doc, read)
    lines += ["", f"## Riesgo contra el perfil ({r['profile'] or 'sin perfil'})", ""]
    if r["rows"]:
        lines += ["| Qué | Esta versión | Límite del perfil (% × capital) | |", "|---|---|---|---|"]
        lines += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in r["rows"]]
        lines += [""]
    lines += [f"- Kill switch: {r['kill_switch']}"]
    if r["open_now"]:
        lines += [f"- Abierto hoy en SHADOW: {r['open_now']}"]
    lines += [f"- Falta: {m}" for m in r["missing"]]
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
    return {"strategy": f"strategy:{key}", "spec_hash": doc.spec_hash, "check": doc.check.verdict, "risk": r,
            "critique": review.content.verdict.value if review_ok else None, "approved": approval is not None,
            "markdown": "\n".join(lines) + "\n"}
