"""What the risk limits of a spec ask of its structure, in USD (WS-0098, increment 2).

The limits are percentages of the simulated capital (per trade, open risk, one bet); the structure loses at most
(width − credit) × 100 per contract. The tightest limit says how much credit a candidate has to collect for one contract to
fit: the SHADOW run of the Sandwich 1.3.0 (9 USD bet cap, 5-point wings) was stopped by that every day for a week. The limits
and their defaults are the engine's (ShadowRiskControls.CapitalOf: what the spec does not declare is 100 %), and without a
simulated capital there are none. Deterministic, no model call; it states what the numbers imply and never changes them.
"""

from __future__ import annotations

import math
from typing import Any

MULTIPLIER = 100
DEFAULT_PCT = 100.0   # ShadowRiskControls.CapitalOf: an undeclared percentage is 100


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def _usd(x: float) -> str:
    whole, _, cents = f"{x:,.2f}".partition(".")
    cents = cents.rstrip("0")
    return whole.replace(",", ".") + ("," + cents if cents else "")


def _width(spec: dict) -> float | None:
    """The widest wing: the loss of the structure is bounded by it, only one side can lose at expiry."""
    legs = (spec.get("candidate_construction") or {}).get("legs") or []
    widths = []
    for leg in legs:
        sel = leg.get("strike_selection") or {}
        w = _num(sel.get("width"))
        if w is None and sel.get("method") == "OFFSET_FROM_LEG":
            w = _num(sel.get("offset_points"))
        if w is not None and str(leg.get("side", "")).upper() == "BUY":
            widths.append(abs(w))
    return max(widths) if widths else None


def limits_usd(spec: dict) -> dict:
    """The spec's limits in USD, as the engine computes them (cents rounded): per trade (the lower of the percentage and
    the fixed USD), open risk, and one bet (a share of the open risk). All None without a simulated capital."""
    rl = spec.get("risk_limits") or {}
    capital = _num(rl.get("simulated_capital_usd"))
    if capital is None:
        return {"capital": None, "por_operacion": None, "riesgo_abierto": None, "por_apuesta": None}
    pct = _num(rl.get("max_risk_per_trade_pct"))
    by_pct = round(capital * (DEFAULT_PCT if pct is None else pct) / 100, 2)
    fixed = _num(rl.get("max_loss_per_trade_usd"))
    per_trade = min(by_pct, fixed) if fixed is not None and fixed > 0 else by_pct
    open_pct = _num(rl.get("max_open_risk_pct"))
    open_risk = round(capital * (DEFAULT_PCT if open_pct is None else open_pct) / 100, 2)
    bet_pct = _num(rl.get("max_bet_pct"))
    return {"capital": capital, "por_operacion": per_trade, "riesgo_abierto": open_risk,
            "por_apuesta": round(open_risk * (DEFAULT_PCT if bet_pct is None else bet_pct) / 100, 2)}


def assess(spec: dict, simulated_amount: float | None = None) -> dict:
    lim = limits_usd(spec)
    width = _width(spec)
    caps = {name: v for name, v in (("por operación", lim["por_operacion"]), ("por apuesta", lim["por_apuesta"]),
                                    ("riesgo abierto", lim["riesgo_abierto"])) if v is not None}
    out = {"limites_usd": lim, "ancho": width, "veredicto": None, "credito_minimo": None}
    if width is None or not caps:
        out["texto"] = ("no se puede cruzar con la pérdida máxima: " +
                        ("la spec no fija el ancho de la estructura" if width is None else "la spec no fija un capital simulado"))
        return out
    name, cap = min(caps.items(), key=lambda kv: kv[1])
    required = width - cap / MULTIPLIER          # credit per contract that keeps the worst loss inside the cap
    out["perdida_maxima_sin_credito_usd"] = width * MULTIPLIER
    out["limite_que_manda"] = {"cual": name, "usd": cap}
    out["credito_minimo"] = max(required, 0.0)
    min_credit = _num((spec.get("candidate_construction") or {}).get("constraints", {}).get("min_credit"))
    if min_credit is not None:
        out["credito_minimo_de_la_spec"] = min_credit
    spec_min = f" (mínimo de la spec: {_usd(min_credit)})" if min_credit is not None else ""
    if required <= 0:
        out["veredicto"] = "pasa"
        out["texto"] = (f"con alas de {width:g} la pérdida máxima ({_usd(width * MULTIPLIER)} USD sin crédito) cabe en el "
                        f"límite {name} de {_usd(cap)} USD aun sin cobrar crédito{spec_min}")
    elif required >= width:
        out["veredicto"] = "no puede entrar nunca"
        out["texto"] = f"no puede entrar nunca: el límite {name} de {_usd(cap)} USD no deja ni el crédito máximo posible ({_usd(width)}){spec_min}"
    else:
        shown = math.ceil(required * 100 - 1e-9) / 100          # least credit that fits, to the cent: 4,91 yes, 4,90 no
        out["veredicto"] = "pasa"
        out["texto"] = (f"con este tope ({name}, {_usd(cap)} USD) necesitás cobrar ≥ {_usd(shown)} por cada {width:g} de ancho"
                        f"{spec_min}")
    return out
