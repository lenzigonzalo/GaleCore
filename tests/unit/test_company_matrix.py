"""WS-0047: several companies side by side — figures only, no states, thresholds nor ordering."""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import ClassVar

import pytest

from galecore_ai.application import analysis
from galecore_ai.application import company_matrix as cm
from galecore_ai.capabilities.dispatcher import CapabilityResult
from tests.unit.test_analysis import bal, eight

TODAY = date(2026, 10, 19)


def bars(step: float, n: int = 300, start: float = 100.0) -> list[tuple[str, float, float]]:
    first = date(2026, 10, 16) - timedelta(days=n - 1)
    return [((first + timedelta(days=i)).isoformat(), start + i * step, 0.25) for i in range(n)]


def tech(step: float, **kw) -> dict:
    return analysis.technical_view(bars(step, **kw))


def growth(now: float, before: float) -> dict:
    return {"last_4_quarters": now, "prior_4_quarters": before, "last_4_change": analysis.change(now, before),
            "quarter_yoy": analysis.change(now, before)}


def statements(**over) -> dict:
    base = {"Revenues": growth(120, 100), "OperatingIncomeLoss": growth(30, 25),
            "quality": {"operating_margin": {"last_4_pct": 25.0, "prior_4_pct": 25.0, "change_pts": 0.0},
                        "free_cash_flow": {"last_4": 10, "prior_4": 12, "change": {"pct": -16.67}, "margin_pct": 8.3},
                        "net_debt": {"date": "2026-06-30", "net_debt": -5, "years_of_fcf": None,
                                     "reading": "caja neta: la caja supera la deuda"}}}
    return base | over


def test_the_technical_view_brings_returns_the_200_slope_and_the_average_move():
    t = tech(0.5)
    assert t["chg_63d_pct"] and t["chg_126d_pct"] and t["sma200_chg_20d_pct"] > 0 and t["avg_move_20d_pct"] > 0
    assert "sma200_chg_20d_pct" not in tech(0.5, n=210)


def test_relative_strength_is_points_against_the_reference_and_only_on_the_same_close():
    vs = cm.relative(tech(0.5), tech(1.0))
    assert vs["126d_pts"] < 0 and set(vs) == {"63d_pts", "126d_pts"}
    other_day = {**tech(1.0), "date": "2026-10-15"}
    assert cm.relative(tech(0.5), other_day) is None and cm.relative(tech(0.5), None) is None


def test_a_row_is_figures_side_by_side_with_no_state_nor_verdict():
    st = statements(valuation={"close": 100.0, "close_date": "2026-10-16", "pe_trailing": 20.0,
                               "non_operating_share_pct": 33.3, "pe_history": {"median": 18.0}})
    row = cm.build_row("AAA", {"statements": st, "market": {"sector": "Technology"},
                               "next_earnings": {"date": "2026-10-28", "time": "AMC"}},
                       tech(1.0), tech(0.2), "XLK", tech(0.5), TODAY)
    assert row["tecnico"]["vs_spy"]["63d_pts"] > 0 and row["tecnico"]["vs_etf"]["126d_pts"] > 0
    assert row["fundamentales"]["revenue"]["last_4_change"] == {"pct": 20.0}
    assert row["fundamentales"]["net_debt"]["net_debt"] == -5
    assert row["valoracion"]["non_operating_share_pct"] == 33.3 and row["valoracion"]["pe_own_history"]["median"] == 18.0
    assert row["proximo_balance"]["days"] == 9 and row["comparable"]["etf"] == "XLK"
    flat = str(row)
    assert all(w not in flat for w in ("cumple", "no aplica", "state", "fails"))


def test_a_symbol_is_never_compared_with_itself_and_missing_data_is_absent_not_filled():
    row = cm.build_row("XLK", None, tech(1.0), tech(1.0), "XLK", tech(1.0), TODAY)
    assert "vs_etf" not in row["tecnico"] and row["proximo_balance"] is None
    assert row["fundamentales"] == {"revenue": None, "operating_income": None} and row["valoracion"] == {}
    assert "vs_spy" not in cm.build_row("SPY", None, tech(1.0), tech(1.0), None, None, TODAY)["tecnico"]


def test_the_default_comparable_is_a_small_table_industry_first():
    assert cm.sector_etf({"sector": "Technology", "industry": "Software & Programming"}) == "IGV"
    assert cm.sector_etf({"sector": "Technology", "industry": "Semiconductors"}) == "SOXX"
    assert cm.sector_etf({"sector": "Technology", "industry": "Computer Hardware"}) == "XLK"
    assert cm.sector_etf({"sector": "Services", "industry": "Business Services"}) == "XLC"
    assert cm.sector_etf({"sector": "Services", "industry": "Retail (Specialty)"}) == "XLY"
    assert cm.sector_etf({"sector": "Medical", "industry": "Pharmaceutical Retailers"}) is None
    assert cm.sector_etf({"sector": "Mystery"}) is None and cm.sector_etf(None) is None


def test_symbols_are_cleaned_deduplicated_capped_and_dots_refused():
    assert cm.parse_symbols(" msft, AAPL ,msft,") == ["MSFT", "AAPL"]
    with pytest.raises(ValueError, match="al menos"):
        cm.parse_symbols(" , ")
    with pytest.raises(ValueError, match="hasta 10"):
        cm.parse_symbols(",".join(f"S{i}" for i in range(11)))
    with pytest.raises(ValueError, match="no admitido"):
        cm.parse_symbols("MSFT,BRK.B")


class Market:
    """Candles for any symbol (rising twice as fast as SPY for UP), the volatility metrics with a sector, nothing else."""

    SLOPES: ClassVar[dict[str, float]] = {"SPY": 0.2, "XLK": 0.5, "UP": 1.0, "DOWN": -0.1}

    async def invoke(self, cap, params):
        if cap == "market_data.candles":
            sym = params["symbol"]
            data = [{"timeStamp": d + "T00:00:00", "close": c, "impliedVolatility": iv}
                    for d, c, iv in bars(self.SLOPES[sym], start=200.0 if sym == "DOWN" else 100.0)]
            return CapabilityResult(cap, data={"data": data})
        if cap == "market_data.volatility_metrics":
            return CapabilityResult(cap, data={"items": [{"sector": "Technology", "industry": "Computer Hardware"}]})
        return CapabilityResult(cap, error="sin fuente en la prueba")


def test_the_command_gathers_each_symbol_the_etf_spy_and_macro_in_the_order_asked():
    pack = asyncio.run(cm.gather(Market(), ["DOWN", "UP"], today=TODAY))
    assert pack["kind"] == "company" and pack["symbol"] == "DOWN-UP" and pack["references"]["sector_etfs"] == {
        "DOWN": "XLK", "UP": "XLK"}
    assert [r["symbol"] for r in pack["matrix"]] == ["DOWN", "UP"]
    down, up = pack["matrix"]
    assert up["tecnico"]["vs_etf"]["126d_pts"] > 0 and down["tecnico"]["vs_sma200_pct"] < 0
    assert up["fundamentales"]["revenue"] is None and "UP: " in " ".join(pack["missing"])
    assert "no es una búsqueda en el mercado" in pack["universe"] and analysis.has_data(pack)


def test_an_unknown_free_cash_flow_is_not_a_negative_one_and_the_alias_capex_concept_is_read():
    view = analysis.fundamental_view(
        {"Revenues": eight([100.0] * 8), "OperatingIncomeLoss": eight([20.0] * 8),
         "NetCashProvidedByUsedInOperatingActivities": eight([30.0] * 8)}, None,
        {"LongTermDebt": [bal("2026-06-30", 50.0)], "CashAndCashEquivalentsAtCarryingValue": [bal("2026-06-30", 10.0)]})
    nd = view["quality"]["net_debt"]
    assert nd["years_of_fcf"] is None and nd["reading"].startswith("sin flujo libre")
    with_alias = analysis.fundamental_view(
        {"Revenues": eight([100.0] * 8), "NetCashProvidedByUsedInOperatingActivities": eight([30.0] * 8),
         "PaymentsToAcquireProductiveAssets": eight([10.0] * 8)}, None, {})
    assert with_alias["quality"]["free_cash_flow"]["last_4"] == 80.0


def test_the_capex_concept_with_the_latest_quarter_wins_when_both_are_present():
    old = [{**x, "end": x["end"].replace("2026", "2020").replace("2025", "2019").replace("2024", "2018"),
            "start": x["start"].replace("2026", "2020").replace("2025", "2019").replace("2024", "2018")}
           for x in eight([99.0] * 8)]
    view = analysis.fundamental_view(
        {"Revenues": eight([100.0] * 8), "NetCashProvidedByUsedInOperatingActivities": eight([30.0] * 8),
         "PaymentsToAcquirePropertyPlantAndEquipment": old,
         "PaymentsToAcquireProductiveAssets": eight([10.0] * 8)}, None, {})
    assert view["quality"]["free_cash_flow"]["last_4"] == 80.0
