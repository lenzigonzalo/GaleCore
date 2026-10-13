"""Performance, attribution and decision review (WS-0011, P1-03).

«¿Cómo viene la estrategia? ¿Cuánto rinde contra mi objetivo? ¿Es edge o suerte? ¿Qué aprendo de cada cierre?»

GaleCore computes the numbers (``GET /App/Runtime/Performance``: by strategy, version and exit rule, the portfolio
against the reference capital, and each closed trade against the level its rule planned). This module reads them
and sets them against what the owner declared in the profile (objective, minimum return, edge criterion, limits)
and against what the owner said when deciding (the supervisor's alerts and the project's decisions). Deterministic,
no model call, no financial arithmetic beyond comparing GaleCore's numbers with the profile's.

The diagnosis of a closed trade follows the research of 05/10 (``knowledge/research/2026-10-05-modelos-de-decision``):
a label does not prove a cause. Each review keeps apart what is *observed* (a rule of the profile not respected,
a close worse than its rule's level) from what is a *hypothesis* (the thesis may be failing), and a loss inside the
plan is said to be compatible with the strategy. Labels: ``reglas``, ``ejecucion``, ``tesis``, ``todavia_nada``.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from urllib.parse import urlencode

from galecore_ai.application import capital, supervisor
from galecore_ai.application.knowledge import KnowledgeBase
from galecore_ai.contracts.profile import ProfileContent

QUARTER_DAYS = 90
RULE_EXITS = ("TAKE_PROFIT", "STOP_LOSS", "TIME_EXIT")
SAFETY_EXITS = ("KILL_SWITCH",)  # the system's own safety rule (R2): observed, not a breach by the owner
GAP_TOLERANCE_USD = 2.0          # a close within 2 USD (or 10 % of the credit) of its rule's level is on plan
GAP_TOLERANCE_OF_CREDIT = 0.10
COSTS_NOTE = "SHADOW llena al mid y sin comisiones: el resultado es antes de costos."

_NUM = r"(\d+(?:[.,]\d+)?)"


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def _usd(text: str) -> float | None:
    """«(1.500 USD)» -> 1500 (the profile writes thousands with a dot)."""
    m = re.search(r"\(\s*([\d.]+)\s*USD\s*\)", text)
    return float(m.group(1).replace(".", "")) if m else None


def criteria(content: ProfileContent | None) -> dict:
    """The numbers the profile declares, read from its words. What cannot be read is listed, never guessed."""
    out: dict = {"capital": None, "objetivo_anual_pct": None, "minimo_anual_pct": None, "edge_min_cierres": None,
                 "edge_min_dias": None, "perdida_max_operacion_usd": None, "drawdown_max_usd": None, "no_leidos": []}
    if content is None:
        out["no_leidos"].append("perfil: no hay perfil")
        return out
    if content.reference_capital:
        out["capital"] = content.reference_capital.amount
    for objective in content.objectives:
        if m := re.search(_NUM + r"\s*a\s*" + _NUM + r"\s*%", objective):
            out["objetivo_anual_pct"] = [_num(m.group(1)), _num(m.group(2))]
            break
        if m := re.search(_NUM + r"\s*%", objective):
            out["objetivo_anual_pct"] = [_num(m.group(1)), _num(m.group(1))]
            break
    if content.minimum_return and (m := re.search(_NUM + r"\s*%", content.minimum_return)):
        out["minimo_anual_pct"] = _num(m.group(1))
    edge = content.edge_criterion or ""
    if m := re.search(r"(\d+)\s+operaciones", edge):
        out["edge_min_cierres"] = int(m.group(1))
    if "trimestre" in edge:
        out["edge_min_dias"] = QUARTER_DAYS
    elif m := re.search(r"(\d+)\s+d[ií]as", edge):
        out["edge_min_dias"] = int(m.group(1))
    for limit in content.risk_limits:
        if "por operaci" in limit:
            out["perdida_max_operacion_usd"] = _usd(limit)
    if content.max_drawdown:
        out["drawdown_max_usd"] = _usd(content.max_drawdown)
    labels = {"capital": "capital de referencia", "objetivo_anual_pct": "objetivo (objectives)",
              "minimo_anual_pct": "utilidad mínima (minimum_return)", "edge_min_cierres": "cierres del edge_criterion",
              "edge_min_dias": "tiempo del edge_criterion", "perdida_max_operacion_usd": "pérdida máxima por operación",
              "drawdown_max_usd": "drawdown máximo en USD"}
    out["no_leidos"] = [label for key, label in labels.items() if out[key] is None]
    return out


def _within(days: float | None, need: int | None) -> bool:
    return days is not None and need is not None and days >= need


def edge(portfolio: dict, crit: dict) -> dict:
    """«¿Esto es edge o suerte?»: the sample against the profile's criterion, and a prudent conclusion."""
    closed, days = portfolio.get("positionsClosed") or 0, portfolio.get("daysElapsed")
    need_n, need_d = crit["edge_min_cierres"], crit["edge_min_dias"]
    realized = portfolio.get("realizedPnl")
    sample_ok = need_n is not None and closed >= need_n and _within(days, need_d)
    if need_n is None:
        conclusion = "No se puede concluir: el perfil no declara cuántos cierres hacen falta."
    elif not sample_ok:
        pending = [f"{closed} de {need_n} cierres"]
        if need_d is not None:
            pending.append(f"{days or 0:g} de {need_d} días")
        conclusion = "Sin edge demostrado: la muestra no alcanza (" + ", ".join(pending) + "). Lo que hay es anécdota."
    elif realized is not None and realized > 0:
        conclusion = ("Muestra suficiente y resultado neto > 0 antes de costos: compatible con edge; falta comparar "
                      "contra el efectivo y descontar costos antes de afirmarlo.")
    else:
        conclusion = "Muestra suficiente y resultado neto ≤ 0: no hay edge con estas reglas."
    return {"cierres": closed, "cierres_requeridos": need_n, "dias": days, "dias_requeridos": need_d,
            "muestra_suficiente": sample_ok, "conclusion": conclusion}


def against_objective(portfolio: dict, crit: dict, sample_ok: bool) -> dict:
    """«¿Cuánto rinde mi cartera contra mi objetivo?»: GaleCore's return set against the profile's numbers."""
    annual = portfolio.get("annualizedReturnPct")
    goal, minimum = crit["objetivo_anual_pct"], crit["minimo_anual_pct"]
    if annual is None:
        reading = "Sin retorno medible todavía (sin cierres ni valuación, o sin capital de referencia)."
    elif not sample_ok:
        reading = (f"Muestra corta ({portfolio.get('daysElapsed') or 0:g} días, {portfolio.get('positionsClosed') or 0}"
                   f" cierres): el anualizado de {annual:g} % es ruido y todavía no se compara con el objetivo.")
    else:
        if goal and annual >= goal[0]:
            where = "en o por encima del objetivo"
        elif minimum is not None and annual >= minimum:
            where = "entre la utilidad mínima y el objetivo"
        elif minimum is not None:
            where = "por debajo de la utilidad mínima"
        else:
            where = "sin utilidad mínima declarada para comparar"
        reading = f"Anualizado {annual:g} %: {where}."
    dd, dd_max = portfolio.get("maxDrawdown"), crit["drawdown_max_usd"]
    return {"retorno_total_pct": portfolio.get("totalReturnPct"), "retorno_anualizado_pct": annual,
            "objetivo_anual_pct": goal, "minimo_anual_pct": minimum, "lectura": reading,
            "drawdown_usd": dd, "drawdown_max_usd": dd_max,
            "drawdown_usado_pct": round(dd / dd_max * 100, 1) if dd is not None and dd_max else None,
            "riesgo_abierto_usd": portfolio.get("openMaxRisk")}


def _tolerance(trade: dict) -> float:
    return max(GAP_TOLERANCE_USD, GAP_TOLERANCE_OF_CREDIT * (trade.get("entryCredit") or 0) * 100)


def review_trade(trade: dict, crit: dict, decision: dict | None, alert_ids: list[str], today: date) -> dict:
    """«Aprender de cada operación cerrada»: which rule acted, against its plan, and an honest diagnosis."""
    reason, pnl, gap = trade.get("exitReason"), trade.get("realizedPnl"), trade.get("gapToPlan")
    observed, hypotheses, label = [], [], "todavia_nada"
    limit = crit["perdida_max_operacion_usd"]
    if limit is not None and (trade.get("maxRisk") or 0) > limit:
        observed.append(f"riesgo máximo {trade['maxRisk']:g} USD por encima del límite por operación ({limit:g} USD)")
        label = "reglas"
    if reason in SAFETY_EXITS:
        observed.append(f"cerró por {reason}: regla de seguridad del sistema (límite de la cartera), no un incumplimiento")
    elif reason not in RULE_EXITS:
        observed.append(f"cerró por {reason or 'motivo desconocido'}, fuera de las salidas automáticas de la spec")
        label = "reglas"
    if gap is not None and gap < -_tolerance(trade):
        observed.append(f"cerró {abs(gap):g} USD peor que el nivel de su regla ({reason})")
        if label == "todavia_nada":
            label = "ejecucion"
    if label == "todavia_nada" and pnl is not None and pnl < 0:
        hypotheses.append("la pérdida está dentro del plan y es compatible con la estrategia; la tesis se revisa "
                          "si las pérdidas por esta regla se repiten más de lo esperado (ver por regla)")
        label = "tesis"
    certainty = "observado" if observed else ("hipotesis" if hypotheses else "sin_hallazgos")
    plan = trade.get("plan") or {}
    happened = f"{reason}: {pnl:+g} USD" if pnl is not None else reason
    planned = {"TAKE_PROFIT": plan.get("takeProfitPnl"), "STOP_LOSS": plan.get("stopLossPnl")}.get(reason or "")
    out = {"posicion": trade.get("positionId"), "estrategia": trade.get("specName"), "version": trade.get("specVersion"),
           "patas": trade.get("legs"), "entrada": trade.get("entryAt"), "salida": trade.get("exitAt"),
           "dias": trade.get("daysHeld"), "credito": trade.get("entryCredit"), "riesgo_max": trade.get("maxRisk"),
           "regla_que_actuo": reason, "planeado_usd": planned, "ocurrido": happened, "desvio_usd": gap,
           "pct_del_riesgo": trade.get("pnlPctOfMaxRisk"), "diagnostico": label, "certeza": certainty,
           "observado": observed, "hipotesis": hypotheses, "avisos": alert_ids, "decision": None}
    if decision:
        review_by = decision.get("review_by")
        out["decision"] = {"eleccion": decision.get("choice"), "palabras": decision.get("words"),
                           "esperado": decision.get("expected") or None, "ocurrido": happened,
                           "revisar_el": review_by, "fecha": decision.get("at"),
                           "revision_vencida": bool(review_by) and date.fromisoformat(review_by) <= today}
    return out


def pending_reviews(decisions: dict[str, dict], today: date) -> list[dict]:
    """U-66: decisions whose review date arrived — what we expected then, to set against what happened."""
    due = [{"aviso": alert, **d} for alert, d in decisions.items()
           if d.get("review_by") and date.fromisoformat(d["review_by"]) <= today]
    return sorted(due, key=lambda d: d["review_by"])


def panel_query(name: str, content: ProfileContent | None, crit: dict, since: datetime | None) -> tuple[str, dict]:
    """The panel's request (WS-0033) with what the profile declares; what it does not say is not passed, so GaleCore
    answers «falta …» for it. Also returns what was passed, so the answer can say it."""
    lim = capital.limits(content)
    passed: dict = {}
    if crit["capital"]:
        passed["referenceCapital"] = crit["capital"]
    if all(lim.get(k) is not None for k, _, _ in capital._LIMITS):     # GaleCore takes the four limits or none
        passed.update({k: lim[k] for k, _, _ in capital._LIMITS})
    if crit["objetivo_anual_pct"]:
        passed["targetAnnualPct"] = crit["objetivo_anual_pct"][0]       # the low end of the declared range
    if crit["edge_min_cierres"] is not None and crit["edge_min_dias"] is not None:
        passed["hypothesisMinTrades"], passed["hypothesisMinDays"] = crit["edge_min_cierres"], crit["edge_min_dias"]
    query = [("spec", name)] + list(passed.items())
    if since:
        query.append(("from", since.astimezone(UTC).isoformat()))
    return "/App/Runtime/Performance/Panel?" + urlencode(query), passed


def report(kb: KnowledgeBase, read: supervisor.Reader, *, strategies: list[str] | None = None,
           since: datetime | None = None, now: datetime | None = None) -> dict:
    """The whole answer: criteria, portfolio against the objective, edge, by strategy/version/rule, each close."""
    now = now or datetime.now(UTC)
    doc = kb.profile.latest()
    crit = criteria(doc.content if doc else None)
    names = strategies or sorted({k.split("/")[0] for k in kb.strategies.versions()})
    query = [("spec", n) for n in names]
    if crit["capital"]:
        query.append(("referenceCapital", crit["capital"]))
    if since:
        query.append(("from", since.astimezone(UTC).isoformat()))
    perf = read("/App/Runtime/Performance?" + urlencode(query))
    if not isinstance(perf, dict):
        raise supervisor.SupervisorError("GaleCore devolvió algo que no es el informe de performance")

    decisions = supervisor.decisions(kb)
    by_position: dict[str, list[str]] = {}
    for a in supervisor.alerts(kb):
        if a.position_id:
            by_position.setdefault(a.position_id, []).append(a.id)
    today = now.date()
    trades = []
    for t in perf.get("trades", []):            # GaleCore already cut them to `from`
        ids = by_position.get(t.get("positionId") or "", [])
        decision = next((decisions[i] for i in ids if i in decisions), None)
        trades.append(review_trade(t, crit, decision, ids, today))

    portfolio = perf.get("portfolio", {})
    verdict = edge(portfolio, crit)
    missing = [f"perfil: no pude leer {x}" for x in crit["no_leidos"]]
    missing.append("comparación contra el efectivo: GaleCore no expone la tasa libre de riesgo en este informe")
    missing.append("drawdown: es del P&L realizado; las pérdidas abiertas no cuentan hasta cerrar")
    if not_valued := portfolio.get("openNotValued"):
        missing.append(f"{not_valued} abierta(s) sin valuación: su P&L no está en el retorno total")
    seen = {g.get("specName") for g in perf.get("strategies", [])}
    missing += [f"estrategia {n}: GaleCore no tiene operaciones ni instancias con ese nombre" for n in names
                if n not in seen]
    panels: dict[str, dict] = {}
    if strategies:                                  # «¿cómo viene la estrategia X? ¿dónde falla?»: the SHADOW panel
        for n in names:
            path, passed = panel_query(n, doc.content if doc else None, crit, since)
            try:
                panel = read(path)
            except supervisor.SupervisorError as exc:
                missing.append(f"panel de {n}: {exc}")
                continue
            if isinstance(panel, dict):
                panels[n] = {"pedido_con": passed, **panel}
            else:
                missing.append(f"panel de {n}: GaleCore devolvió algo que no es el panel")
        if panels:
            missing.append("panel: efectivo y bono a 10 años no los declara el perfil; sus comparaciones salen sin valor")
    scope = ("cartera, contra_objetivo, edge, por_estrategia y por_version: acumulado desde la primera entrada"
             + (f"; ventana y operaciones: cierres desde {since.date().isoformat()}" if since else ""))
    return {"al": perf.get("asOf"), "estrategias_pedidas": names, "desde": since.isoformat() if since else None,
            "alcance": scope, "ventana": perf.get("window"), "criterios": crit, "cartera": portfolio,
            "contra_objetivo": against_objective(portfolio, crit, verdict["muestra_suficiente"]),
            "edge": verdict, "por_estrategia": perf.get("strategies", []), "por_version": perf.get("versions", []),
            "operaciones": trades, "paneles": panels, "decisiones_a_revisar": pending_reviews(decisions, today),
            "costos": COSTS_NOTE, "faltantes": missing,
            "fuente": "GaleCore GET /App/Runtime/Performance" + (" y /Performance/Panel" if panels else "") + "; perfil " + (doc.ref if doc else "ninguno")}
