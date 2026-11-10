"""Can this spec ever enter? Its risk limits in USD against the worst loss of its structure (WS-0098, increment 2).

The limits are percentages of the simulated capital (per trade, open risk, one bet); the structure loses at most
(width − credit) × 100 per contract. A cap that only a credit close to the whole width could meet never lets a position
open: the SHADOW run of the Sandwich 1.3.0 (9 USD bet cap, 5-point wings) blocked for 10 days for that. Deterministic,
no model call; it says what the numbers imply and never changes them. What the spec does not fix is listed, not guessed.
"""

from __future__ import annotations

import math
from typing import Any

IMPOSSIBLE_CREDIT_SHARE = 0.9   # proposed default, to confirm with the owner: collecting 90 % of the width never happens
MULTIPLIER = 100


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


def limits_usd(spec: dict, simulated_amount: float | None) -> dict:
    """The spec's limits in USD: per trade, open risk and one bet (a share of the open risk)."""
    rl = spec.get("risk_limits") or {}
    capital = _num(rl.get("simulated_capital_usd")) or simulated_amount
    out: dict = {"capital": capital}
    per_trade = _num(rl.get("max_loss_per_trade_usd"))
    pct = _num(rl.get("max_risk_per_trade_pct"))
    if per_trade is None and capital and pct is not None:
        per_trade = capital * pct / 100
    out["por_operacion"] = per_trade
    open_pct = _num(rl.get("max_open_risk_pct"))
    out["riesgo_abierto"] = capital * open_pct / 100 if capital and open_pct is not None else None
    bet_pct = _num(rl.get("max_bet_pct"))
    out["por_apuesta"] = (out["riesgo_abierto"] * bet_pct / 100
                          if out["riesgo_abierto"] is not None and bet_pct is not None else None)
    return out


def assess(spec: dict, simulated_amount: float | None = None) -> dict:
    lim = limits_usd(spec, simulated_amount)
    width = _width(spec)
    caps = {name: v for name, v in (("por operación", lim["por_operacion"]), ("por apuesta", lim["por_apuesta"]),
                                    ("riesgo abierto", lim["riesgo_abierto"])) if v is not None}
    out = {"limites_usd": lim, "ancho": width, "veredicto": None, "credito_minimo": None}
    if width is None or not caps:
        out["texto"] = ("no se puede cruzar con la pérdida máxima: " +
                        ("la spec no fija el ancho de la estructura" if width is None else "la spec no fija límites en USD"))
        return out
    name, cap = min(caps.items(), key=lambda kv: kv[1])
    required = width - cap / MULTIPLIER          # credit per contract that keeps the worst loss inside the cap
    out["perdida_maxima_sin_credito_usd"] = width * MULTIPLIER
    out["limite_que_manda"] = {"cual": name, "usd": cap}
    out["credito_minimo"] = max(required, 0.0)
    if required <= 0:
        out["veredicto"] = "pasa"
        out["texto"] = (f"con alas de {width:g} la pérdida máxima ({_usd(width * MULTIPLIER)} USD sin crédito) cabe en el "
                        f"límite {name} de {_usd(cap)} USD aun sin cobrar crédito")
        return out
    share = required / width
    # Rounded up to the cent: «4,91» is the least credit that fits, 4,90 does not.
    shown = math.ceil(required * 100 - 1e-9) / 100
    ask = f"el límite {name} de {_usd(cap)} USD exige un crédito ≥ {_usd(shown)} con alas de {width:g}"
    if share >= IMPOSSIBLE_CREDIT_SHARE:
        out["veredicto"] = "no puede entrar nunca"
        out["texto"] = f"no puede entrar nunca: {ask} ({share * 100:.0f} % del ancho)"
    else:
        out["veredicto"] = "pasa"
        out["texto"] = f"puede entrar: {ask} ({share * 100:.0f} % del ancho)"
    min_credit = _num((spec.get("candidate_construction") or {}).get("constraints", {}).get("min_credit"))
    if min_credit is not None:
        out["credito_minimo_de_la_spec"] = min_credit
    return out
