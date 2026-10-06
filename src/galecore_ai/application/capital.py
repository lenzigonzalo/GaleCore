"""Risk and capital manager (WS-0012, P1-04).

«¿Qué capital tengo disponible u ocioso? ¿Estoy concentrado? Tengo 5.000 USD, ¿qué hago?»

GaleCore computes the numbers: ``GET /App/Runtime/Exposure`` (what is open in SHADOW summed by bet — same underlying,
direction and expiry week — by underlying, strategy and expiration, against the limits) and
``GET /App/Runtime/Allocation`` (the split of a capital: reserve, risk budget, contracts and positions per strategy,
the cap of one bet and the entry ladder at the strategy's pace). This module reads the limits from the profile's
words (percentages; with another capital, the same percentages apply to it — owner, 06/10), passes them, and puts
the answers in short readings. Deterministic, no model call, no financial arithmetic of its own beyond the
percentages it shows. It describes a split to think about; it never places or asks for an order.
"""

from __future__ import annotations

import re
from urllib.parse import urlencode

from galecore_ai.application import supervisor
from galecore_ai.application.knowledge import KnowledgeBase
from galecore_ai.contracts.profile import ProfileContent

_PCT = r"(\d+(?:[.,]\d+)?)\s*%"
# Which profile line declares each limit (words of risk_limits), and the GaleCore parameter it feeds.
_LIMITS = (
    ("maxRiskPerTradePct", "pérdida máxima por operación", ("por operaci",)),
    ("maxOpenRiskPct", "riesgo máximo sumado de las abiertas", ("sumado",)),
    ("reservePct", "reserva para ajustes", ("reserva",)),
    ("maxBetPct", "tope de una apuesta", ("apuesta",)),
)
NOT_AN_ORDER = ("Es un reparto para pensar, no una orden: SHADOW abre y cierra solo según la versión aprobada; "
                "un cambio de capital o de reglas pasa por tu aprobación.")
RULE_LABELS = {"open_risk": "riesgo abierto", "reserve": "reserva intacta"}
BINDING = {"budget": "presupuesto de riesgo", "max_concurrent": "máximo de posiciones de la spec",
           "per_trade": "pérdida máxima por operación", "bet": "tope de una apuesta", "no_width": "la spec no fija ancho"}


def limits(content: ProfileContent | None) -> dict:
    """The percentages the profile declares, read from its words. What cannot be read is listed, never guessed."""
    out: dict = {"capital_referencia": None, "no_leidos": []}
    if content is None:
        return {**out, "no_leidos": ["perfil: no hay perfil"]}
    if content.reference_capital:
        out["capital_referencia"] = content.reference_capital.amount
    for key, label, words in _LIMITS:
        line = next((x for x in content.risk_limits if any(w in x.lower() for w in words)), None)
        m = re.search(_PCT, line) if line else None
        value = float(m.group(1).replace(",", ".")) if m else None
        floor_ok = value is not None and (value >= 0 if key == "reservePct" else value > 0)
        out[key] = value if floor_ok and value <= 100 else None   # out of range is not a limit: listed, not used
        if out[key] is None:
            out["no_leidos"].append(label)
    if out["capital_referencia"] is None:
        out["no_leidos"].insert(0, "capital de referencia")
    return out


def _query(capital: float, lim: dict, strategies: list[str] | None = None) -> str:
    q = [("capital", capital)] + [(k, lim[k]) for k, _, _ in _LIMITS]
    q += [("spec", s) for s in strategies or []]
    return urlencode(q)


def _usd(x: float | None) -> str:
    """GaleCore's number as it is, written the Spanish way (1.368 · 1.824,5); never rounded further."""
    if x is None:
        return "—"
    whole, _, cents = f"{x:,.2f}".partition(".")
    cents = cents.rstrip("0")
    return whole.replace(",", ".") + ("," + cents if cents else "")


def _pct(x: float) -> str:
    return f"{x:g}".replace(".", ",")


def available(exp: dict) -> dict:
    """U-17: capital available or idle on the reference capital, from what is open in SHADOW."""
    reading = (f"Capital de referencia {_usd(exp['limits']['capital'])} USD: en riesgo {_usd(exp['openMaxRisk'])} "
               f"({_pct(exp['openRiskPctOfCapital'])} %) en {exp['positionsOpen']} posiciones; sin comprometer "
               f"{_usd(exp['idleUsd'])} (incluye la reserva de {_usd(exp['reserveUsd'])}); entra riesgo nuevo por "
               f"{_usd(exp['availableForNewRiskUsd'])} sin pasar el máximo abierto ({_usd(exp['maxOpenRiskUsd'])}).")
    return {"capital": exp["limits"]["capital"], "en_riesgo_usd": exp["openMaxRisk"],
            "en_riesgo_pct": exp["openRiskPctOfCapital"], "ocioso_usd": exp["idleUsd"], "reserva_usd": exp["reserveUsd"],
            "riesgo_nuevo_disponible_usd": exp["availableForNewRiskUsd"], "no_realizado_usd": exp.get("unrealizedPnl"),
            "lectura": reading}


def concentration(exp: dict) -> dict:
    """U-35: aggregated exposure against the limits; several small positions that are one bet, said as one."""
    broken = [c for c in exp["checks"] if not c["ok"]]
    ok_by_bet = {c["limit"][4:]: c["ok"] for c in exp["checks"] if c["limit"].startswith("bet:")}
    bets = [{"apuesta": b["key"], "posiciones": b["positions"], "riesgo_usd": b["maxRisk"],
             "pct_del_maximo_abierto": b["pctOfMaxOpenRisk"], "vencimientos": b["expirations"],
             "dentro_del_tope": ok_by_bet.get(b["key"])} for b in exp["bets"]]
    if not bets:
        reading = "Nada abierto en SHADOW: no hay concentración."
    else:
        big = bets[0]
        several = f"{big['posiciones']} posiciones que son una sola apuesta" if big["posiciones"] > 1 else "1 posición"
        reading = (f"La apuesta mayor es {big['apuesta']}: {several}, {_usd(big['riesgo_usd'])} USD "
                   f"({_pct(big['pct_del_maximo_abierto'])} % del riesgo abierto permitido; tope "
                   f"{_usd(exp['maxBetUsd'])}). ")
        symbols = exp["bySymbol"]
        if len(symbols) == 1:
            reading += f"Todo el riesgo está en {symbols[0]['key']}: no hay diversificación entre activos. "
        reading += ("Límites cumplidos." if not broken
                    else "Fuera de límite: " + "; ".join(_limit_text(c) for c in broken) + ".")
    return {"apuestas": bets, "por_subyacente": [{"subyacente": g["key"], "riesgo_usd": g["maxRisk"],
                                                   "pct_capital": g["pctOfCapital"]} for g in exp["bySymbol"]],
            "por_estrategia": [{"estrategia": g["key"], "riesgo_usd": g["maxRisk"]} for g in exp["byStrategy"]],
            "por_vencimiento": [{"vencimiento": g["key"], "posiciones": g["positions"], "riesgo_usd": g["maxRisk"]}
                                for g in exp["byExpiration"]],
            "limites": [{"limite": _limit_name(c["limit"]), "usado_usd": c["used"], "maximo_usd": c["max"],
                         "margen_usd": c["headroom"], "ok": c["ok"]} for c in exp["checks"]],
            "fuera_de_limite": len(broken), "lectura": reading}


def _limit_name(limit: str) -> str:
    if limit.startswith("bet:"):
        return "apuesta " + limit[4:]
    if limit.startswith("per_trade:"):
        return "por operación " + limit[10:18]
    return RULE_LABELS.get(limit, limit)


def _limit_text(check: dict) -> str:
    return f"{_limit_name(check['limit'])} {_usd(check['used'])} de {_usd(check['max'])}"


def split(plan: dict, capital: float) -> dict:
    """U-34: «tengo X USD»: reserve, risk per trade, positions per strategy, the ladder, and what stays in cash."""
    rows, notes = [], []
    for a in plan["strategies"]:
        rows.append({"estrategia": a["specName"], "version": a["specVersion"], "subyacente": a["symbol"],
                     "ancho": a.get("width"), "riesgo_por_contrato_usd": a.get("riskPerContract"),
                     "riesgo_de": (f"promedio de {a.get('observedPositions', 0)} posiciones en SHADOW"
                                   if a["riskSource"] == "observed" else "ancho completo (sin crédito)"),
                     "dte_entrada": a.get("entryDte"),
                     "contratos_por_posicion": a["contractsPerPosition"], "posiciones": a["positions"],
                     "riesgo_usd": a["riskUsd"], "por_semana_max": a["positionsPerWeek"],
                     "limita": BINDING.get(a["bindingLimit"], a["bindingLimit"]), "entra": a["fits"]})
        if not a["fits"] and a["bindingLimit"] == "per_trade":
            alt = (f"un spread de ancho {a['maxWidthThatFits']:g} entraría si cobrara el mismo crédito relativo "
                   "(estimación) — es una versión nueva de la estrategia y necesita tu aprobación"
                   if a.get("maxWidthThatFits") else "ningún ancho entero entra")
            notes.append(f"{a['specName']}: con {_usd(capital)} USD un contrato de ancho {a.get('width'):g} arriesga "
                         f"{_usd(a.get('riskPerContract'))} y el máximo por operación es {_usd(a['maxRiskPerTradeUsd'])}: "
                         f"no entra; {alt}. Alternativa: esperar y dejar el capital en efectivo.")
    symbols = {a["symbol"] for a in plan["strategies"] if a["fits"]}
    if len(symbols) <= 1 and plan["strategies"]:
        notes.append("Una sola estrategia en un subyacente: la diversificación posible es en el tiempo (escalera de "
                     "vencimientos), no entre activos; para eso hace falta otra estrategia.")
    weeks = max((s["week"] for s in plan["ladder"]), default=0)
    ladder = [{"dia_habil": s["day"], "semana": s["week"], "semana_vencimiento": s.get("expiryWeek"),
               "estrategia": s["specName"], "contratos": s["contracts"],
               "riesgo_usd": s["riskUsd"], "acumulado_usd": s["cumulativeRiskUsd"]} for s in plan["ladder"]]
    if ladder:
        reading = (f"Con {_usd(capital)} USD: reserva {_usd(plan['reserveUsd'])}, riesgo máximo abierto "
                   f"{_usd(plan['maxOpenRiskUsd'])}, por operación {_usd(plan['maxRiskPerTradeUsd'])}. Entran "
                   f"{len(ladder)} posiciones por {_usd(plan['allocatedRiskUsd'])} USD de riesgo, en {weeks} semanas "
                   f"(a lo sumo {_usd(plan['maxBetUsd'])} por apuesta, con el vencimiento estimado); quedan "
                   f"{_usd(plan['cashUsd'])} sin riesgo.")
    else:
        reading = (f"Con {_usd(capital)} USD no entra ninguna posición con los límites de hoy: queda todo en "
                   "efectivo (ver notas).")
    return {"capital": capital, "reserva_usd": plan["reserveUsd"], "presupuesto_riesgo_usd": plan["riskBudgetUsd"],
            "por_operacion_max_usd": plan["maxRiskPerTradeUsd"], "abierto_max_usd": plan["maxOpenRiskUsd"],
            "apuesta_max_usd": plan["maxBetUsd"], "asignado_usd": plan["allocatedRiskUsd"],
            "sin_asignar_usd": plan["unallocatedRiskUsd"], "efectivo_usd": plan["cashUsd"],
            "por_estrategia": rows, "escalera": ladder, "semanas": weeks, "notas": notes,
            "supuestos": plan.get("assumptions", []), "no_encontradas": plan.get("strategiesNotFound", []),
            "lectura": reading, "aviso": NOT_AN_ORDER}


def report(kb: KnowledgeBase, read: supervisor.Reader, *, capital: float | None = None,
           strategies: list[str] | None = None) -> dict:
    """The whole answer: limits read, capital available, concentration, and the split of `capital` (default: reference)."""
    doc = kb.profile.latest()
    lim = limits(doc.content if doc else None)
    source = "perfil " + (doc.ref if doc else "ninguno")
    if lim["no_leidos"]:
        return {"status": "MISSING_LIMITS", "limites": lim, "fuente": source,
                "error": "No puedo calcular sin estos límites del perfil: " + ", ".join(lim["no_leidos"])
                         + ". Se agregan con `profile review` (cambiar límites necesita tu aprobación)."}
    if capital is not None and capital <= 0:
        raise supervisor.SupervisorError("el capital debe ser > 0")
    ref = lim["capital_referencia"]
    names = strategies or sorted({k.split("/")[0] for k in kb.strategies.versions()})
    exp = read("/App/Runtime/Exposure?" + _query(ref, lim))
    plan = read("/App/Runtime/Allocation?" + _query(capital or ref, lim, names))
    if not isinstance(exp, dict) or not isinstance(plan, dict):
        raise supervisor.SupervisorError("GaleCore devolvió algo que no es exposición o reparto")
    missing = ["cuenta real: lo disponible es sobre el capital de referencia y lo abierto en SHADOW (sin broker)",
               "correlación entre subyacentes: se agrupa por subyacente, dirección y semana; no se mide la correlación",
               "costos: el riesgo es el máximo del spread, sin comisiones"]
    if exp.get("openNotValued"):
        missing.append(f"{exp['openNotValued']} abierta(s) sin valuación: su no realizado no está")
    if capital is None or capital == ref:
        missing.append(f"el reparto no descuenta lo ya abierto ({_usd(exp['openMaxRisk'])} en riesgo): hoy entra riesgo "
                       f"nuevo por {_usd(exp['availableForNewRiskUsd'])}, y cada apuesta abierta ya usa parte de su tope")
    else:
        missing.append(f"el reparto de {_usd(capital)} es aparte de lo abierto en SHADOW (que va contra la referencia "
                       f"de {_usd(ref)})")
    return {"al": exp.get("asOf"), "limites": lim, "disponible": available(exp), "concentracion": concentration(exp),
            "reparto": split(plan, capital or ref), "faltantes": missing,
            "fuente": "GaleCore GET /App/Runtime/Exposure y /App/Runtime/Allocation; " + source}
