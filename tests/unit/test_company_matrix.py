"""WS-0047 F1b: the selection matrix — four blocks, cumple / no cumple / sin datos / no aplica, no score."""

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


def test_technical_block_meets_the_four_filters_against_spy_and_the_etf():
    cells = cm.technical_block(tech(1.0), tech(0.2), "XLK", tech(0.5))
    assert {k: c["state"] for k, c in cells.items()} == {"T1": "cumple", "T2": "cumple", "T3": "cumple", "T4": "cumple"}
    assert cells["T3"]["value"]["63"]["diff_pts"] > 0


def test_a_stock_weaker_than_its_sector_fails_only_that_filter_and_shows_how_much():
    cells = cm.technical_block(tech(0.5), tech(0.2), "XLK", tech(1.0))
    assert cells["T3"]["state"] == "cumple" and cells["T4"]["state"] == "no cumple"
    assert cells["T4"]["value"]["126"]["diff_pts"] < 0 and cells["T4"]["value"]["reference"] == "XLK"


def test_a_falling_stock_fails_the_averages_and_the_slope():
    cells = cm.technical_block(tech(-0.1, start=200.0), tech(0.2), None, None)
    assert cells["T1"]["state"] == "no cumple" and cells["T2"]["state"] == "no cumple"
    assert cells["T4"]["state"] == "sin datos" and "comparable" in cells["T4"]["note"]


def test_relative_strength_with_another_last_close_is_not_computed():
    spy = tech(0.2, n=300) | {"date": "2026-10-15"}
    cells = cm.technical_block(tech(1.0), spy, None, None)
    assert cells["T3"]["state"] == "sin datos" and "distinto" in cells["T3"]["note"]


def test_no_candles_is_sin_datos_in_every_technical_filter():
    assert {c["state"] for c in cm.technical_block(None, None, None, None).values()} == {"sin datos"}


def test_quality_filters_and_the_cash_net_company_meets_the_debt_test():
    cells, _ = cm.quality_block(statements())
    assert {k: c["state"] for k, c in cells.items()} == {k: "cumple" for k in ("F1", "F2", "F3", "F4", "F5")}
    assert cells["F1"]["value"]["pct"] == 20.0 and cells["F4"]["value"]["change"] == {"pct": -16.67}


def test_a_loss_is_a_category_and_a_reduced_loss_does_not_meet_growth():
    st = statements(OperatingIncomeLoss=growth(-5, -20))
    cells, _ = cm.quality_block(st)
    assert cells["F2"]["state"] == "no cumple" and cells["F2"]["value"]["category"] == "reduce la pérdida"
    cells, _ = cm.quality_block(statements(OperatingIncomeLoss=growth(5, -20)))
    assert cells["F2"]["state"] == "cumple"


def test_debt_in_years_of_cash_flow_and_a_margin_that_falls_more_than_a_point():
    st = statements()
    st["quality"]["net_debt"] = {"date": "d", "net_debt": 50, "years_of_fcf": 5.0}
    st["quality"]["operating_margin"]["change_pts"] = -3.0
    cells, _ = cm.quality_block(st)
    assert cells["F5"]["state"] == "no cumple" and cells["F3"]["state"] == "no cumple"
    st["quality"]["net_debt"] = {"date": "d", "net_debt": 50, "years_of_fcf": None, "reading": "flujo libre no positivo"}
    assert cm.quality_block(st)[0]["F5"]["state"] == "no cumple"


def test_a_bank_is_never_passed_and_a_missing_filing_is_sin_datos():
    cells, _ = cm.quality_block({"NetIncomeLoss": growth(10, 9),
                                 "quality": {"coverage": "evaluación fundamental incompleta con este método: ..."}})
    assert {c["state"] for c in cells.values()} == {"no aplica"}
    cells, _ = cm.quality_block(None)
    assert {c["state"] for c in cells.values()} == {"sin datos"}
    cells, _ = cm.quality_block({"quality": {}})
    assert {c["state"] for c in cells.values()} == {"sin datos"}


def test_the_sector_comparable_is_a_fixed_table_industry_first():
    assert cm.sector_etf({"sector": "Technology", "industry": "Software & Programming"}) == "IGV"
    assert cm.sector_etf({"sector": "Technology", "industry": "Semiconductors"}) == "SOXX"
    assert cm.sector_etf({"sector": "Technology", "industry": "Computer Hardware"}) == "XLK"
    assert cm.sector_etf({"sector": "Consumer Cyclical", "industry": "Internet Retail"}) == "XLY"
    assert cm.sector_etf({"sector": "Mystery"}) is None and cm.sector_etf(None) is None
    # GaleCore's real labels: GOOGL is «Services», NVDA «Computer Hardware» (the symbol table decides semiconductors)
    assert cm.sector_etf({"sector": "Services", "industry": "Business Services"}, "GOOGL") == "XLC"
    assert cm.sector_etf({"sector": "Technology", "industry": "Computer Hardware"}, "NVDA") == "SOXX"
    assert cm.sector_etf({"sector": "Technology", "industry": "Computer Hardware"}, "AAPL") == "XLK"


def test_a_row_orders_by_filter_blocks_met_names_what_fails_and_has_no_score():
    spy, etf = tech(0.2), tech(0.5)
    good = cm.build_row("AAA", {"statements": statements(), "market": {"sector": "Technology"}}, tech(1.0), spy, "XLK",
                        etf, TODAY)
    weak_st = statements(Revenues=growth(90, 100))
    weak = cm.build_row("BBB", {"statements": weak_st}, tech(1.0), spy, "XLK", etf, TODAY)
    nodata = cm.build_row("CCC", None, None, spy, None, None, TODAY)
    assert good["block_states"] == {"tecnico": "cumple", "calidad": "cumple"} and good["fails"] == []
    assert weak["block_states"]["calidad"] == "no cumple" and weak["fails"] == ["calidad:F1"]
    assert nodata["block_states"] == {"tecnico": "sin datos", "calidad": "sin datos"} and len(nodata["without_data"]) == 9
    assert [r["symbol"] for r in sorted([nodata, weak, good], key=cm.order_key)] == ["AAA", "BBB", "CCC"]
    assert "score" not in good and good["valoracion"]["state"] == "sin datos"


def test_entry_block_reports_extension_invalidation_and_the_days_to_earnings():
    t = tech(1.0)
    e = cm.entry_block(t, {"next_earnings": {"date": "2026-10-28", "time": "AfterMarket", "confirmed": True,
                                             "consensus_eps": 4.7}}, TODAY)
    assert e["next_earnings"]["days"] == 9 and e["technical_invalidation"]["distance_pct"] < 0
    assert e["extension"]["in_daily_moves"] == round(t["vs_sma50_pct"] / t["avg_move_20d_pct"], 1)
    assert cm.entry_block(t, {}, TODAY)["next_earnings"]["state"] == "sin datos"


def test_valuation_block_is_data_with_the_own_range():
    v = {"valuation": {"close": 100.0, "close_date": "2026-10-16", "pe_trailing": 20.0, "fcf_yield_pct": 3.0,
                       "pe_history": {"percentile_today": 80.0, "median": 18.0}}}
    out = cm.valuation_block(v)
    assert out["state"] == "dato" and out["pe_percentile_own_history"] == 80.0
    assert out["pe_median_own_history"] == 18.0 and "scenarios_12m_return_pct" not in out


def test_symbols_are_cleaned_deduplicated_and_capped():
    assert cm.parse_symbols(" msft, AAPL ,msft,") == ["MSFT", "AAPL"]
    with pytest.raises(ValueError, match="al menos"):
        cm.parse_symbols(" , ")
    with pytest.raises(ValueError, match="hasta 10"):
        cm.parse_symbols(",".join(f"S{i}" for i in range(11)))


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


def test_the_command_gathers_each_symbol_the_etf_spy_and_macro_and_orders_the_rows():
    pack = asyncio.run(cm.gather(Market(), ["DOWN", "UP"], today=TODAY))
    assert pack["kind"] == "company" and pack["symbol"] == "DOWN-UP" and pack["references"]["sector_etfs"] == {
        "DOWN": "XLK", "UP": "XLK"}
    assert [r["symbol"] for r in pack["matrix"]] == ["UP", "DOWN"]
    up, down = pack["matrix"]
    assert up["tecnico"]["T4"]["state"] == "cumple" and down["tecnico"]["T1"]["state"] == "no cumple"
    assert up["calidad"]["F1"]["state"] == "sin datos" and "UP: " in " ".join(pack["missing"])
    assert "no es una búsqueda en el mercado" in pack["universe"] and analysis.has_data(pack)


def test_an_unknown_free_cash_flow_is_not_a_negative_one_and_the_alias_capex_concept_is_read():
    view = analysis.fundamental_view(
        {"Revenues": eight([100.0] * 8), "OperatingIncomeLoss": eight([20.0] * 8),
         "NetCashProvidedByUsedInOperatingActivities": eight([30.0] * 8)}, None,
        {"LongTermDebt": [bal("2026-06-30", 50.0)], "CashAndCashEquivalentsAtCarryingValue": [bal("2026-06-30", 10.0)]})
    nd = view["quality"]["net_debt"]
    assert nd["years_of_fcf"] is None and nd["reading"].startswith("sin flujo libre")
    cells, _ = cm.quality_block(view)
    assert cells["F4"]["state"] == "sin datos" and cells["F5"]["state"] == "sin datos"
    with_alias = analysis.fundamental_view(
        {"Revenues": eight([100.0] * 8), "NetCashProvidedByUsedInOperatingActivities": eight([30.0] * 8),
         "PaymentsToAcquireProductiveAssets": eight([10.0] * 8)}, None, {})
    assert with_alias["quality"]["free_cash_flow"]["last_4"] == 80.0


def test_retail_industries_map_to_the_consumer_discretionary_etf():
    assert cm.sector_etf({"sector": "Services", "industry": "Retail (Specialty)"}) == "XLY"


def test_the_capex_concept_with_the_latest_quarter_wins_when_both_are_present():
    old = [{**x, "end": x["end"].replace("2026", "2020").replace("2025", "2019").replace("2024", "2018"),
            "start": x["start"].replace("2026", "2020").replace("2025", "2019").replace("2024", "2018")}
           for x in eight([99.0] * 8)]
    view = analysis.fundamental_view(
        {"Revenues": eight([100.0] * 8), "NetCashProvidedByUsedInOperatingActivities": eight([30.0] * 8),
         "PaymentsToAcquirePropertyPlantAndEquipment": old,
         "PaymentsToAcquireProductiveAssets": eight([10.0] * 8)}, None, {})
    assert view["quality"]["free_cash_flow"]["last_4"] == 80.0


def test_a_financial_sector_is_never_passed_even_if_it_reports_revenue_and_operating_income():
    cells, _ = cm.quality_block(statements(), financial=True)
    assert {c["state"] for c in cells.values()} == {"no aplica"}
    row = cm.build_row("JPM", {"statements": statements(), "market": {"sector": "Finance (Financials)"}}, tech(1.0),
                       tech(0.2), "XLF", tech(0.5), TODAY)
    assert row["block_states"]["calidad"] == "no aplica"


def test_a_symbol_that_is_its_own_reference_is_not_compared_with_itself():
    cells = cm.technical_block(tech(1.0), tech(1.0), "XLK", tech(1.0), "XLK")
    assert cells["T4"]["state"] == "no aplica"
    assert cm.technical_block(tech(1.0), tech(1.0), None, None, "SPY")["T3"]["state"] == "no aplica"


def test_a_zero_base_is_sin_datos_and_the_thresholds_hold_at_the_edge():
    cells, _ = cm.quality_block(statements(OperatingIncomeLoss=growth(5, 0)))
    assert cells["F2"]["state"] == "sin datos"
    st = statements()
    st["quality"]["operating_margin"]["change_pts"] = -1.0
    st["quality"]["net_debt"] = {"date": "d", "net_debt": 30, "years_of_fcf": 3.0}
    cells, _ = cm.quality_block(st)
    assert cells["F3"]["state"] == "cumple" and cells["F5"]["state"] == "no cumple"
    st["quality"]["net_debt"] = {"date": "d", "net_debt": 30, "years_of_fcf": None}
    assert cm.quality_block(st)[0]["F5"]["state"] == "sin datos"


def test_symbols_with_dots_are_refused_and_a_health_retailer_has_no_discretionary_comparable():
    with pytest.raises(ValueError, match="no admitido"):
        cm.parse_symbols("MSFT,BRK.B")
    assert cm.sector_etf({"sector": "Medical", "industry": "Pharmaceutical Retailers"}) is None
