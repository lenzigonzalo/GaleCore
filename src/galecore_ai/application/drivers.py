"""What moves the symbol today (P1-05, U-03/U-05): computed by code from GaleCore's answers, read by the model.

Two measurements and one comparison, each labelled with its kind of datum:

- Reaction to the data (`releases`): for each macro release and FOMC decision of the last months, the symbol's move
  that day (close against the previous close: releases come out at 8:30 ET and the FOMC at 14:00, both before the
  close) against the move its implied volatility priced the evening before (IV / √252). The IV is the one DXLink
  stamps on the daily candle, read as a 30-day IV: it carries no event premium of its own, so «what the options
  paid» is an estimate, not the straddle of the day. Grouped by kind of release and compared with the days without
  data. Several releases on the same day share the move: declared, never split.
- Co-movement (`co_movement`): correlation and beta of the symbol's daily returns with each asset of the story over
  the last 20 sessions and the 20 before. Which asset moves with the symbol now, and which one changed, is a
  candidate driver; twenty points are noisy, and a correlation is not a cause.
- Ahead (`upcoming`): for each release in the calendar window, what today's IV pays for one day and how much the
  symbol moved on the last releases of that kind.

Thresholds are conventions, written here so the model quotes them instead of inventing its own.
"""

from __future__ import annotations

import math
import statistics
from datetime import date, timedelta
from itertools import pairwise

# FRED release ids GaleCore's calendar knows and the names the owner reads.
RELEASE_NAMES = {50: "Empleo (NFP)", 10: "CPI", 46: "PPI", 53: "PIB", 54: "Ingresos y gastos (PCE)",
                 9: "Ventas minoristas"}
FOMC = "FOMC"
REACTION_DAYS = 180         # GaleCore's calendar answers at most 180 days per call
WINDOW = 20                 # sessions of each co-movement window
TRADING_DAYS = 252
# A fair 1-day implied is exceeded about 32 % of the days (|z| > 1). Below 20 % of the releases, the IV paid more
# than the release moved; above 45 %, less. With fewer than 4 releases of a kind there is no verdict.
FAIR_EXCEED = 0.32
OVERPAID_BELOW, UNDERPAID_ABOVE, MIN_SAMPLE = 0.20, 0.45, 4
# A kind of release moves the symbol more (less) than a day without data when its median ratio is 25 % above
# (20 % below) the median of those days.
MORE_THAN_NORMAL, LESS_THAN_NORMAL = 1.25, 0.80

KINDS = {
    "releases": "hecho: fecha de cada publicación (FRED vía GaleCore) y cierres; cálculo: movimiento y cociente",
    "implied": "estimación: IV de la vela diaria leída como IV a 30 días; no es el straddle del día del dato",
    "co_movement": "cálculo: correlación y beta de retornos diarios; no prueba causa",
}


def daily_bars(raw, exclude: str | None = None) -> list[tuple[str, float, float | None]]:
    """(date, close, iv) per day, oldest first, from GaleCore's raw DXLink candles; iv None when the feed gives none."""
    events = (raw or {}).get("data") if isinstance(raw, dict) else None
    by_day: dict[str, tuple[float, float | None]] = {}
    for e in events or []:
        stamp, close, iv = e.get("timeStamp"), e.get("close"), e.get("impVolatility")
        if not (isinstance(stamp, str) and stamp[:10] != exclude and isinstance(close, int | float)
                and math.isfinite(close) and close > 0):
            continue
        ok_iv = isinstance(iv, int | float) and math.isfinite(iv) and iv > 0
        by_day[stamp[:10]] = (float(close), float(iv) if ok_iv else None)
    return [(d, c, v) for d, (c, v) in sorted(by_day.items())]


def release_events(releases: list[dict], fomc: list[dict]) -> dict[str, list[str]]:
    """Kinds of release on each day: FRED releases by id and the last day of each FOMC meeting."""
    out: dict[str, list[str]] = {}
    for r in releases:
        name = RELEASE_NAMES.get(r.get("releaseId"))
        if name and isinstance(r.get("date"), str):
            out.setdefault(r["date"], []).append(name)
    for m in fomc:
        if isinstance(m.get("end"), str):
            out.setdefault(m["end"], []).append(FOMC)
    return {d: sorted(set(k)) for d, k in out.items()}


def _ratios(bars) -> dict[str, dict]:
    """Per session (from the second): move against the previous close and against the IV of the previous evening."""
    out = {}
    for (_, prev_close, prev_iv), (day, close, _) in pairwise(bars):
        move = abs(close / prev_close - 1)
        implied = prev_iv / math.sqrt(TRADING_DAYS) if prev_iv else None
        out[day] = {"move_pct": round(move * 100, 2),
                    "implied_pct": round(implied * 100, 2) if implied else None,
                    "ratio": round(move / implied, 2) if implied else None}
    return out


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 2) if values else None


def reactions(bars, events: dict[str, list[str]], today: date) -> dict:
    """How the symbol moved on each kind of release against its IV and against the days without data."""
    per_day = _ratios(bars)
    normal = [r["ratio"] for d, r in per_day.items() if d not in events and r["ratio"] is not None]
    normal_median = _median(normal)
    kinds: dict[str, dict] = {}
    for day in sorted(events):
        r = per_day.get(day)
        if day >= today.isoformat() or r is None:
            continue
        for kind in events[day]:
            k = kinds.setdefault(kind, {"events": []})
            shared = [x for x in events[day] if x != kind]
            k["events"].append({"date": day, **r, **({"same_day": shared} if shared else {})})
    for kind, k in kinds.items():
        ratios = [e["ratio"] for e in k["events"] if e["ratio"] is not None]
        k["n"] = len(ratios)
        k["median_ratio"] = _median(ratios)
        k["median_move_pct"] = _median([e["move_pct"] for e in k["events"]])
        k["exceeded_implied"] = sum(1 for x in ratios if x > 1)
        k["premium"] = _premium(k["exceeded_implied"], k["n"])
        k["vs_days_without_data"] = _vs_normal(k["median_ratio"], normal_median)
    return {"kinds_of_datum": KINDS,
            "days_without_data": {"n": len(normal), "median_ratio": normal_median,
                                  "exceeded_implied": sum(1 for x in normal if x > 1)},
            "by_release": kinds,
            "conventions": {"fair_share_exceeding_implied": FAIR_EXCEED, "overpaid_below": OVERPAID_BELOW,
                            "underpaid_above": UNDERPAID_ABOVE, "min_sample": MIN_SAMPLE,
                            "more_than_normal": MORE_THAN_NORMAL, "less_than_normal": LESS_THAN_NORMAL}}


def _premium(exceeded: int, n: int) -> str:
    if n < MIN_SAMPLE:
        return f"sin veredicto: {n} datos"
    share = exceeded / n
    if share < OVERPAID_BELOW:
        return f"la IV pagó de más: {exceeded} de {n} superaron el implícito (justo ≈ 32 %)"
    if share > UNDERPAID_ABOVE:
        return f"la IV pagó de menos: {exceeded} de {n} superaron el implícito (justo ≈ 32 %)"
    return f"en línea: {exceeded} de {n} superaron el implícito (justo ≈ 32 %)"


def _vs_normal(kind_median: float | None, normal_median: float | None) -> str | None:
    if kind_median is None or not normal_median:
        return None
    rel = kind_median / normal_median
    if rel >= MORE_THAN_NORMAL:
        return f"mueve más que un día sin dato ({rel:.2f}×)"
    if rel <= LESS_THAN_NORMAL:
        return f"mueve menos que un día sin dato ({rel:.2f}×)"
    return f"como un día sin dato ({rel:.2f}×)"


def _returns(closes: list[tuple[str, float]]) -> dict[str, float]:
    return {d: b / a - 1 for (_, a), (d, b) in pairwise(closes)}


def _corr_beta(xs: list[float], ys: list[float]) -> tuple[float, float] | None:
    if len(xs) < 3:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return None
    return cov / math.sqrt(vx * vy), cov / vx          # corr(sym, asset); beta of the symbol on the asset


def co_movement(closes: dict[str, list[tuple[str, float]]], symbol: str, labels: dict[str, str]) -> dict | None:
    """Correlation and beta of the symbol with each other series, last WINDOW sessions against the WINDOW before."""
    base = _returns(closes.get(symbol) or [])
    days = sorted(base)
    if len(days) < WINDOW + 3:
        return None
    windows = {"last": days[-WINDOW:], "previous": days[-2 * WINDOW:-WINDOW]}
    rows = []
    for other, series in closes.items():
        if other == symbol:
            continue
        rets = _returns(series)
        row: dict = {"asset": other, "what": labels.get(other, other)}
        for name, span in windows.items():
            common = [d for d in span if d in rets]
            cb = _corr_beta([rets[d] for d in common], [base[d] for d in common])
            if cb:
                row[f"corr_{name}"] = round(cb[0], 2)
                row[f"beta_{name}"] = round(cb[1], 2)
            row[f"sessions_{name}"] = len(common)
        if "corr_last" not in row:
            continue
        if "corr_previous" in row:
            row["corr_change"] = round(row["corr_last"] - row["corr_previous"], 2)
        rows.append(row)
    rows.sort(key=lambda r: -abs(r["corr_last"]))
    return {"window_sessions": WINDOW, "from": windows["last"][0], "to": windows["last"][-1],
            "kind": KINDS["co_movement"], "assets": rows}


def upcoming(events: dict[str, list[str]], by_release: dict, bars, today: date, days: int) -> list[dict]:
    """Releases in the window: what today's IV pays for one day and what the last ones of that kind moved."""
    if not bars or bars[-1][2] is None:
        return []
    _, close, iv = bars[-1]
    implied = iv / math.sqrt(TRADING_DAYS)
    end = (today + timedelta(days=days)).isoformat()
    out = []
    for day in sorted(d for d in events if today.isoformat() <= d <= end):
        for kind in events[day]:
            past = by_release.get(kind) or {}
            out.append({"date": day, "release": kind,
                        "implied_today_pct": round(implied * 100, 2), "implied_today_usd": round(close * implied, 2),
                        "past_median_move_pct": past.get("median_move_pct"), "past_n": past.get("n", 0),
                        "past_premium": past.get("premium")})
    return out
