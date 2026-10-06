"""P1-05 (U-03/U-05): what moves the symbol — reaction to the releases against the IV of the evening before,
co-movement with the story's assets, and what today's IV pays for the releases ahead. Pure functions."""

from __future__ import annotations

import math
from datetime import date, timedelta

from galecore_ai.application import drivers

TODAY = date(2026, 10, 6)
SQ = math.sqrt(drivers.TRADING_DAYS)


def raw(rows: list[tuple[str, float, float | str]]) -> dict:
    """GaleCore's raw DXLink candles, newest first, with a NaN candle as DXLink sends at the start of the range."""
    data = [{"timeStamp": f"{d}T00:00:00", "close": c, "impVolatility": iv} for d, c, iv in rows]
    data.append({"timeStamp": "2026-03-01T00:00:00", "close": "NaN", "impVolatility": "NaN"})
    return {"data": list(reversed(data))}


def test_daily_bars_keep_close_and_iv_and_drop_nan_and_the_open_day():
    bars = drivers.daily_bars(raw([("2026-10-01", 100.0, 0.16), ("2026-10-02", 101.0, "NaN"),
                                   ("2026-10-06", 102.0, 0.15)]), exclude="2026-10-06")
    assert bars == [("2026-10-01", 100.0, 0.16), ("2026-10-02", 101.0, None)]


def test_release_events_group_kinds_by_day_and_take_the_last_day_of_the_fomc():
    events = drivers.release_events(
        [{"releaseId": 50, "date": "2026-09-04"}, {"releaseId": 9, "date": "2026-09-04"},
         {"releaseId": 999, "date": "2026-09-05"}],
        [{"start": "2026-09-15", "end": "2026-09-16"}])
    assert events == {"2026-09-04": ["Empleo (NFP)", "Ventas minoristas"], "2026-09-16": ["FOMC"]}


def bars_with(moves: dict[str, float], iv=0.16, n=40):
    """n sessions from 01/08 at 100 with a flat IV; `moves` sets the return of given days (others move 0.1 %)."""
    out, close = [], 100.0
    start = date(2026, 8, 1)
    for i in range(n):
        d = (start + timedelta(days=i)).isoformat()
        if i:
            close *= 1 + moves.get(d, 0.001)
        out.append((d, round(close, 6), iv))
    return out


def test_reaction_against_the_implied_of_the_evening_before_and_against_days_without_data():
    implied = 0.16 / SQ                                   # ≈ 1.01 % a day
    cpi_days = ["2026-08-05", "2026-08-10", "2026-08-15", "2026-08-20"]
    bars = bars_with({d: 0.1 * implied for d in cpi_days} | {"2026-08-25": 2 * implied})
    events = {d: ["CPI"] for d in cpi_days} | {"2026-08-25": ["FOMC", "PPI"], "2026-10-14": ["CPI"]}
    r = drivers.reactions(bars, events, TODAY)
    cpi = r["by_release"]["CPI"]
    assert cpi["n"] == 4 and cpi["median_ratio"] == 0.1 and cpi["exceeded_implied"] == 0
    assert cpi["premium"].startswith("la IV pagó de más: 0 de 4")
    assert cpi["vs_days_without_data"].startswith("como un día sin dato")   # the fixture's other days move 0.1 % too
    assert r["days_without_data"]["median_ratio"] == round(0.001 / implied, 2)
    assert r["days_without_data"]["exceeded_implied"] == 0
    # Two kinds on the same day share the move: each one says so, the move is not split.
    fomc = r["by_release"]["FOMC"]
    assert fomc["events"][0]["same_day"] == ["PPI"] and fomc["events"][0]["ratio"] == 2.0
    assert fomc["premium"] == "sin veredicto: 1 datos"
    # A release in the future is not a reaction.
    assert all(e["date"] < TODAY.isoformat() for e in cpi["events"])


def test_vs_days_without_data_and_premium_conventions():
    assert drivers._vs_normal(1.0, 0.5).startswith("mueve más que un día sin dato (2.00×)")
    assert drivers._vs_normal(0.3, 0.5).startswith("mueve menos")
    assert drivers._vs_normal(0.5, 0.5).startswith("como un día sin dato")
    assert drivers._vs_normal(None, 0.5) is None
    assert drivers._premium(3, 5).startswith("la IV pagó de menos")
    assert drivers._premium(2, 6).startswith("en línea")


def test_without_iv_the_ratio_is_none_and_not_counted():
    bars = [(d, c, None) for d, c, _ in bars_with({"2026-08-05": 0.02})]
    r = drivers.reactions(bars, {"2026-08-05": ["CPI"]}, TODAY)
    cpi = r["by_release"]["CPI"]
    assert cpi["n"] == 0 and cpi["median_ratio"] is None and cpi["events"][0]["move_pct"] == 2.0
    assert r["days_without_data"]["median_ratio"] is None


def test_co_movement_ranks_by_correlation_now_and_shows_the_change():
    days = [(date(2026, 8, 1) + timedelta(days=i)).isoformat() for i in range(45)]
    spy_r = [0.01 * math.sin(i * 1.3) for i in range(45)]

    def series(rets):
        c, out = 100.0, []
        for d, r in zip(days, rets, strict=True):
            c *= 1 + r
            out.append((d, c))
        return out

    # TLT tracks SPY only in the last 20 sessions; GLD always against it.
    tlt = [0.0005 * math.cos(i * 2.1) if i < 25 else spy_r[i] for i in range(45)]
    gld = [-x for x in spy_r]
    co = drivers.co_movement({"SPY": series(spy_r), "TLT": series(tlt), "GLD": series(gld)}, "SPY",
                             {"TLT": "bonos largos"})
    assert co["window_sessions"] == 20 and co["to"] == days[-1]
    first, second = co["assets"]
    assert {first["asset"], second["asset"]} == {"TLT", "GLD"}
    by = {a["asset"]: a for a in co["assets"]}
    assert by["GLD"]["corr_last"] == -1.0 and by["GLD"]["corr_change"] == 0.0
    assert by["TLT"]["corr_last"] == 1.0 and by["TLT"]["corr_change"] > 0.5 and by["TLT"]["what"] == "bonos largos"


def test_co_movement_needs_enough_sessions():
    days = [(date(2026, 9, 1) + timedelta(days=i)).isoformat() for i in range(10)]
    assert drivers.co_movement({"SPY": [(d, 100.0 + i) for i, d in enumerate(days)]}, "SPY", {}) is None


def test_upcoming_says_what_today_iv_pays_and_what_the_past_ones_moved():
    bars = [("2026-10-05", 670.0, 0.1587)]
    by_release = {"CPI": {"n": 7, "median_move_pct": 0.25, "premium": "la IV pagó de más: 1 de 7 …"}}
    events = {"2026-10-14": ["CPI"], "2026-10-28": ["FOMC"], "2026-10-01": ["PPI"]}
    up = drivers.upcoming(events, by_release, bars, TODAY, 14)
    assert up == [{"date": "2026-10-14", "release": "CPI", "implied_today_pct": round(0.1587 / SQ * 100, 2),
                   "implied_today_usd": round(670 * 0.1587 / SQ, 2), "past_median_move_pct": 0.25, "past_n": 7,
                   "past_premium": "la IV pagó de más: 1 de 7 …"}]
    assert drivers.upcoming(events, by_release, [("2026-10-05", 670.0, None)], TODAY, 14) == []
