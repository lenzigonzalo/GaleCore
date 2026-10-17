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

_PCT = r"([-+−]?\s*\d+(?:[.,]\d+)?)\s*%"
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
           "per_trade": "pérdida máxima por operación", "bet": "tope de una apuesta", "no_width": "la spec no fija ancho",
           "missing_dte": "la spec no fija DTE"}
RISK_SOURCE = {"width": "ancho completo (sin crédito)", "none": "no calculable"}
MISSING_INPUT = {"no_width": "la spec no fija el ancho del spread: no se puede calcular el riesgo",
                 "missing_dte": "la spec no fija el DTE: no se puede estimar el vencimiento ni la apuesta"}


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
        value = float(re.sub(r"\s", "", m.group(1)).replace("−", "-").replace(",", ".")) if m else None
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
                                   if a["riskSource"] == "observed" else RISK_SOURCE.get(a["riskSource"], a["riskSource"])),
                     "dte_entrada": a.get("entryDte"),
                     "contratos_por_posicion": a["contractsPerPosition"], "posiciones": a["positions"],
                     "riesgo_usd": a["riskUsd"], "max_por_apuesta_si_fuera_sola": a["positionsPerWeek"],
                     "limita": BINDING.get(a["bindingLimit"], a["bindingLimit"]), "entra": a["fits"]})
        if a["bindingLimit"] in MISSING_INPUT:
            notes.append(f"{a['specName']}: falta un dato, no es un límite — {MISSING_INPUT[a['bindingLimit']]}.")
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
    elif not plan["strategies"]:
        reading = ("No hay estrategias calculables" + (": GaleCore no encontró " + ", ".join(plan["strategiesNotFound"])
                                                      if plan.get("strategiesNotFound") else "")
                   + ". No se puede repartir; no es por los límites.")
    elif all(a["bindingLimit"] in MISSING_INPUT for a in plan["strategies"] if not a["fits"]):
        reading = f"Con {_usd(capital)} USD no se puede calcular el reparto: faltan datos de la spec (ver notas)."
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


SCOPE = ("Chequeo de dos topes del perfil (por operación y sumado), no una revisión de la operación: no lee la "
         "cotización de cada pata, eventos, balance, ex-dividendo ni un crédito realista.")
STATE = {True: "cumple", False: "no cumple", None: "no evaluable"}


def _risk_gaps(ov: dict) -> tuple[list[str], list[str]]:
    """GaleCore's missing list split by impact: what leaves the open risk incomplete, and what does not change it."""
    risk, other = [], []
    for m in ov.get("missing") or []:
        (risk if "sin emparejar" in m.lower() else other).append(m)
    if ov.get("maxRisk") is None:
        risk.append("GaleCore no informó el riesgo abierto de la cuenta.")
    risk += [f"{p.get('symbol')} {p.get('structure')}: sin pérdida máxima, no suma al riesgo abierto."
             for p in ov.get("positions", []) if p.get("maxLoss") is None and p.get("structure")]
    return risk, other


def _cap_check(used: float, cap: float, complete: bool) -> bool | None:
    """Within the cap, over it, or unknown: an incomplete total that is already over is over; under it, unknown."""
    if used > cap:
        return False
    return True if complete else None


def real_account(kb: KnowledgeBase, read: supervisor.Reader, *, width: float | None = None, credit: float | None = None,
                 contracts: int = 1, symbol: str | None = None) -> dict:
    """The real account (Tastytrade, read-only) against the profile limits, and optionally a candidate spread.

    The profile percentages apply to the account's own value (`netLiq`, owner 15/10). Advisor only: what is traded in
    Tastytrade does not go through GaleCore, so nothing here blocks. Each cap is «cumple», «no cumple» or «no
    evaluable»: GaleCore's missing items are kept, and those that leave the open risk incomplete (unpaired legs, a
    risk not reported) make the summed cap unknown instead of passing it. It checks two caps, not the whole trade.
    """
    doc = kb.profile.latest()
    lim = limits(doc.content if doc else None)
    source = "perfil " + (doc.ref if doc else "ninguno")
    unread = [x for x in lim["no_leidos"] if x not in ("capital de referencia", "reserva para ajustes", "tope de una apuesta")]
    if unread:
        return {"status": "MISSING_LIMITS", "limites": lim, "fuente": source,
                "error": "No puedo calcular sin estos límites del perfil: " + ", ".join(unread)}
    if (width is None) != (credit is None):
        raise supervisor.SupervisorError("un candidato necesita ancho y crédito (o ninguno)")
    per_pct, open_pct = lim["maxRiskPerTradePct"], lim["maxOpenRiskPct"]
    ov = read("/App/GaleCore/Account/Overview?" + urlencode([("maxRiskPerTradePct", per_pct), ("maxOpenRiskPct", open_pct)]))
    if not isinstance(ov, dict) or not ov.get("netLiq"):
        raise supervisor.SupervisorError("GaleCore devolvió una cuenta sin valor: no se calculan los topes")
    net = float(ov["netLiq"])
    per_cap, open_cap = round(net * per_pct / 100, 2), round(net * open_pct / 100, 2)
    risk_gaps, other_gaps = _risk_gaps(ov)
    complete = not risk_gaps
    open_risk = float(ov["maxRisk"]) if ov.get("maxRisk") is not None else None
    rows = [{"posicion": f"{p.get('symbol')} {p.get('structure')} {p.get('expiration') or ''}".strip(),
             "perdida_maxima_usd": p["maxLoss"], "tope_usd": per_cap, "estado": STATE[p["maxLoss"] <= per_cap]}
            for p in ov.get("positions", []) if p.get("maxLoss") is not None]
    open_ok = _cap_check(open_risk, open_cap, complete) if open_risk is not None else None
    out = {"estado": "cuenta real", "al": ov.get("asOf"), "valor_cuenta_usd": net,
           "tope_por_operacion_usd": per_cap, "tope_sumado_usd": open_cap, "riesgo_abierto_usd": open_risk,
           "riesgo_abierto_completo": complete, "tope_sumado": STATE[open_ok],
           "margen_sumado_usd": round(open_cap - open_risk, 2) if open_risk is not None and complete else None,
           "posiciones": rows, "atencion": [a["title"] for a in ov.get("attention", []) if a.get("kind") == "riesgo"]}
    risk_txt = (f"{_usd(open_risk)} USD" + ("" if complete else " (incompleto)")) if open_risk is not None else "sin dato"
    parts = [(f"Cuenta real {_usd(net)} USD: riesgo abierto {risk_txt} contra un tope sumado de {_usd(open_cap)}"
              f" ({_pct(open_pct)} %): {STATE[open_ok]}; por operación el tope es {_usd(per_cap)} ({_pct(per_pct)} %).")]
    if width is not None and credit is not None:
        if width <= 0 or credit < 0 or credit >= width or contracts < 1:
            raise supervisor.SupervisorError("candidato inválido: ancho > 0, 0 ≤ crédito < ancho, contratos ≥ 1")
        loss = round((width - credit) * 100 * contracts, 2)
        after = round(open_risk + loss, 2) if open_risk is not None else None
        per_ok = loss <= per_cap
        sum_ok = _cap_check(after, open_cap, complete) if after is not None else None
        caps = [{"tope": "por operación", "estado": STATE[per_ok],
                 "detalle": f"arriesga {_usd(loss)} USD; tope {_usd(per_cap)}"},
                {"tope": "sumado", "estado": STATE[sum_ok],
                 "detalle": (f"el riesgo abierto pasaría a {_usd(after)} USD; tope {_usd(open_cap)}" if after is not None
                             else "sin riesgo abierto informado") + ("" if complete else " (riesgo abierto incompleto)")}]
        both = False if False in (per_ok, sum_ok) else None if sum_ok is None else True
        out["candidato"] = {"simbolo": symbol, "ancho": width, "credito": credit, "contratos": contracts,
                            "perdida_maxima_usd": loss, "riesgo_abierto_despues_usd": after, "topes": caps,
                            "cumple_los_dos_topes": both}
        verdict = {True: "cumple los dos topes", False: "no cumple: " + "; ".join(
            c["detalle"] for c in caps if c["estado"] == "no cumple"),
            None: "cumple el tope por operación; el sumado no es evaluable (riesgo abierto incompleto)"}[both]
        parts.append(f"El candidato {verdict}.")
    out["faltantes"] = ([f"afecta el tope sumado: {m}" for m in risk_gaps] + other_gaps
                        + ([] if width is not None else ["candidato: sin spread para evaluar"]))
    out |= {"lectura": " ".join(parts), "alcance": SCOPE,
            "aviso": "Asesor: lo que se opera en Tastytrade no pasa por GaleCore y nada lo bloquea.",
            "fuente": f"GaleCore GET /App/GaleCore/Account/Overview con los topes del {source}"}
    return out


def _simulated_amounts(kb: KnowledgeBase, names: list[str], running: set[str] | None = None) -> dict[str, dict]:
    """The amount each strategy simulates with, from the version SHADOW is running (its hash among `running`, the
    RUNNING instances of GaleCore); with none running, the latest *approved* one (a newer approval or a later draft
    does not move what runs). With no approved version, the latest saved one, said as a draft. `monto` None: not
    declared."""
    out: dict[str, dict] = {}
    for name in names:
        keys = sorted((k for k in kb.strategies.versions() if k.split("/")[0] == name),
                      key=lambda k: tuple(int(x) for x in k.split("/")[1].split(".")))
        docs = {k: kb.strategies.load(k) for k in keys}
        live = [k for k in keys if docs[k] and docs[k].spec_hash in (running or set())]
        approved = [k for k in keys if kb.strategies.load_approval(k)]
        key = live[-1] if live else approved[-1] if approved else keys[-1] if keys else None
        doc = docs.get(key) if key else None
        out[name] = {"version": key.split("/")[1] if key else None, "aprobada": bool(live or approved),
                     "corriendo": bool(live), "monto": doc.content.simulated_amount_usd if doc else None}
    return out


def _running_hashes(read: supervisor.Reader) -> set[str] | None:
    """Hashes of the versions SHADOW is running; None when GaleCore does not say (then the latest approved stands)."""
    try:
        instances = read("/App/Runtime/Instances")
    except Exception:  # noqa: BLE001 - without it the approved version is the best guess, said in `corriendo`
        return None
    if not isinstance(instances, list):
        return None
    return {i.get("versionHash", "") for i in instances
            if i.get("mode") == "SHADOW" and i.get("lifecycleState") == "RUNNING"}


def report(kb: KnowledgeBase, read: supervisor.Reader, *, capital: float | None = None,
           strategies: list[str] | None = None) -> dict:
    """The whole answer: limits read, capital available, concentration, and the split of `capital` (default: reference)."""
    doc = kb.profile.latest()
    lim = limits(doc.content if doc else None)
    source = "perfil " + (doc.ref if doc else "ninguno")
    if capital is not None and capital <= 0:
        raise supervisor.SupervisorError("el capital debe ser > 0")
    names = strategies or sorted({k.split("/")[0] for k in kb.strategies.versions()})
    amounts = _simulated_amounts(kb, names, _running_hashes(read))   # WS-0043 (1e): sized with its own amount
    sized = {n: a["monto"] for n, a in amounts.items() if a["monto"] is not None}
    whatif = capital is not None
    # The reference capital is the real account's: simulated amounts do not need it (only a what-if or no amounts do).
    unread = [x for x in lim["no_leidos"] if not (x == "capital de referencia" and sized and not whatif)]
    if unread:
        return {"status": "MISSING_LIMITS", "limites": lim, "fuente": source,
                "error": "No puedo calcular sin estos límites del perfil: " + ", ".join(unread)
                         + ". Se agregan con `profile review` (cambiar límites necesita tu aprobación)."}
    ref = lim["capital_referencia"]
    base = sum(sized.values()) if sized and not whatif else ref
    exp = read("/App/Runtime/Exposure?" + _query(base, lim))
    if whatif:
        plans = [(capital, read("/App/Runtime/Allocation?" + _query(capital, lim, names)))]
    else:
        plans = [(a, read("/App/Runtime/Allocation?" + _query(a, lim, [n]))) for n, a in sized.items()]
    if not isinstance(exp, dict) or not all(isinstance(p, dict) for _, p in plans):
        raise supervisor.SupervisorError("GaleCore devolvió algo que no es exposición o reparto")
    missing = ["cuenta real: esto es lo simulado en SHADOW (sin broker); la cuenta real se mide con `capital --real`",
               "correlación entre subyacentes: se agrupa por subyacente, dirección y semana; no se mide la correlación",
               "costos: el riesgo es el máximo del spread, sin comisiones"]
    unsized = sorted(n for n, a in amounts.items() if a["monto"] is None)
    if unsized and not whatif:
        missing.append("monto simulado no declarado en el diseño (no se reparte): " + ", ".join(unsized))
    drafts = sorted(f"{n} {a['version']}" for n, a in amounts.items() if a["monto"] is not None and not a["aprobada"])
    if drafts and not whatif:
        missing.append("monto de un borrador (ninguna versión aprobada): " + ", ".join(drafts))
    if not sized and not whatif:
        missing.append(f"ninguna estrategia declara monto simulado: lo abierto en SHADOW se mide contra el capital de "
                       f"referencia de la cuenta real ({_usd(ref)}), sólo como referencia")
    if exp.get("openNotValued"):
        missing.append(f"{exp['openNotValued']} abierta(s) sin valuación: su no realizado no está")
    if whatif:
        missing.append(f"el reparto de {_usd(capital)} es aparte de lo abierto en SHADOW (que va contra {_usd(base)})")
    else:
        missing.append(f"el reparto no descuenta lo ya abierto ({_usd(exp['openMaxRisk'])} en riesgo): hoy entra riesgo "
                       f"nuevo por {_usd(exp['availableForNewRiskUsd'])}, y cada apuesta abierta ya usa parte de su tope")
    repartos = [split(p, a) for a, p in plans]
    return {"al": exp.get("asOf"), "limites": lim, "disponible": available(exp), "concentracion": concentration(exp),
            "reparto": repartos[0] if whatif else repartos, "faltantes": missing,
            "montos_simulados": [{"estrategia": n, "version": a["version"], "aprobada": a["aprobada"],
                                  "corriendo": a["corriendo"], "monto_usd": a["monto"]}
                                 for n, a in sorted(amounts.items())],
            "fuente": "GaleCore GET /App/Runtime/Exposure y /App/Runtime/Allocation; " + source}
