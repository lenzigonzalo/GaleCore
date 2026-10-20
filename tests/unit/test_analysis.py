"""P1-05 (U-04, U-07…U-09): on-demand analysis packs — macro, technical, fundamental and flow, gathered by code from
GaleCore with labelled descriptive numbers; consensus and estimates are declared missing."""
# ruff: noqa: F811  (pytest fixtures imported from other test modules)

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta

from galecore_ai.application import analysis
from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.contracts.regime_record import RecordHost
from tests.unit.test_knowledge import kb  # noqa: F401  (kb is a fixture)

TODAY = date(2026, 10, 6)


def fred(values: list[float | None]) -> dict:
    days = [(date(2026, 7, 1) + timedelta(days=i)).isoformat() for i in range(len(values))]
    return {"data": {"id": "X", "observations": [{"date": d, "value": v} for d, v in zip(days, values, strict=True)]}}


def bls(series_id: str, values: dict[str, float], prelim: str | None = None) -> dict:
    obs = [{"year": int(m[:4]), "period": f"M{m[5:]}", "value": v,
            "footnotes": ["preliminary"] if m == prelim else []} for m, v in values.items()]
    obs.append({"year": 2025, "period": "M13", "value": 1.0, "footnotes": []})     # annual average: left out
    return {"seriesId": series_id, "observations": obs}


def test_fred_view_takes_the_last_value_and_changes_in_bp_skipping_gaps():
    v = analysis._fred_view(fred([4.0] * 16 + [None] + [4.0] * 4 + [4.5]))
    assert v["value"] == 4.5 and v["chg_5obs_bp"] == 50.0 and v["chg_20obs_bp"] == 50.0 and "chg_60obs_bp" not in v
    assert analysis._fred_view(fred([None])) is None


def test_bls_view_inflation_rates_payrolls_and_the_month_never_published():
    months = {f"2025-{m:02d}": 100 + m for m in range(1, 13) if m != 10} | {"2026-01": 113.0, "2026-02": 113.0,
                                                                            "2026-03": 114.0, "2026-04": 115.0,
                                                                            "2026-05": 116.0, "2026-06": 117.0,
                                                                            "2026-07": 118.0, "2026-08": 119.0}
    cpi = analysis._bls_view("CUSR0000SA0", analysis._months(bls("CUSR0000SA0", months)))
    assert cpi["month"] == "2026-08" and cpi["mom_pct"] == round((119 / 118 - 1) * 100, 2)
    assert cpi["yoy_pct"] == round((119 / 108 - 1) * 100, 2)
    assert cpi["three_month_annualized_pct"] == round(((119 / 116) ** 4 - 1) * 100, 2)
    assert cpi["months_without_value"] == ["2025-10"]
    nfp = analysis._bls_view("CES0000000001", analysis._months(
        bls("CES0000000001", {"2026-06": 1000.0, "2026-07": 1030.0, "2026-08": 1060.0, "2026-09": 1090.0},
            prelim="2026-09")))
    assert nfp["change_thousands"] == 30 and nfp["avg_change_3m_thousands"] == 30 and nfp["preliminary"]


def test_technical_view_trend_levels_and_realized_against_iv():
    bars = [((date(2025, 9, 1) + timedelta(days=i)).isoformat(), 100.0 + i * 0.5 + (i % 2) * 0.3, 0.2)
            for i in range(260)]
    t = analysis.technical_view(bars)
    assert t["trend"] == "arriba de las medias de 50 y 200" and t["sma200"] < t["sma50"] < t["close"]
    assert t["from_high_250_pct"] == 0.0 and t["iv_pct"] == 20.0
    assert t["iv_minus_rv20_pts"] == round(20.0 - t["realized_vol_20d_pct"], 2)
    assert analysis.technical_view(bars[:10]) is None


def q(start: str, end: str, value: float, filed: str = "2026-08-26") -> dict:
    return {"start": start, "end": end, "value": value, "filed": filed, "unit": "USD", "form": "10-Q",
            "fiscalYear": 2027, "fiscalPeriod": "Q"}


def test_the_fourth_quarter_is_derived_from_the_annual_and_the_pe_uses_four_consecutive_quarters():
    facts = [q("2025-01-27", "2025-04-27", 1.0), q("2025-04-28", "2025-07-27", 1.0), q("2025-07-28", "2025-10-26", 1.0),
             {**q("2025-01-27", "2026-01-25", 5.0), "form": "10-K"},                      # the year: Q4 = 5 - 3
             q("2026-01-26", "2026-04-26", 2.0), q("2026-04-27", "2026-07-26", 2.0),
             q("2025-01-27", "2025-07-27", 2.0)]                                         # a half year: not a quarter
    quarters = analysis._quarters(facts)
    assert [(x["end"], x["value"], x.get("derived")) for x in quarters] == [
        ("2025-04-27", 1.0, None), ("2025-07-27", 1.0, None), ("2025-10-26", 1.0, None),
        ("2026-01-25", 2.0, True), ("2026-04-26", 2.0, None), ("2026-07-26", 2.0, None)]
    view = analysis.fundamental_view({"EarningsPerShareDiluted": facts}, price=70.0)
    eps = view["EarningsPerShareDiluted"]
    assert eps["last_4_quarters"] == 7.0 and "q4_derived" in eps and eps["yoy_pct"] == 100.0
    assert view["pe_trailing"] == 10.0


def test_without_four_consecutive_quarters_there_is_no_sum_nor_pe():
    facts = [q("2025-01-27", "2025-04-27", 1.0), q("2025-04-28", "2025-07-27", 1.0), q("2025-07-28", "2025-10-26", 1.0),
             q("2026-01-26", "2026-04-26", 2.0), q("2026-04-27", "2026-07-26", 2.0)]
    view = analysis.fundamental_view({"EarningsPerShareDiluted": facts}, price=70.0)
    assert view["EarningsPerShareDiluted"]["last_4_quarters"] is None and "pe_trailing" not in view


class Fake:
    def __init__(self, fail=frozenset()):
        self.fail, self.calls = fail, []

    async def invoke(self, cap, params):
        self.calls.append((cap, params))
        if cap in self.fail or params.get("SeriesId") in self.fail:
            return CapabilityResult(cap, error="HTTP 502")
        if cap == "macro.fred_series":
            return CapabilityResult(cap, data=fred([4.0] * 25 + [4.2]))
        if cap == "macro.bls_series":
            return CapabilityResult(cap, data={"data": [bls("LNS14000000", {"2026-06": 4.1, "2026-09": 4.2})]})
        raise AssertionError(cap)


def test_macro_pack_derives_the_curve_and_declares_consensus_and_what_failed():
    d = Fake(fail={"DFII10"})
    pack = asyncio.run(analysis.gather(d, "macro", today=TODAY))
    assert pack["symbol"] == "MACRO" and "DFII10" not in pack["rates_and_credit"]
    assert pack["derived"] == {"curve_2s10s_bp": 0.0, "curve_3m10y_bp": 0.0}       # no real rate: no residual
    assert pack["economy"]["LNS14000000"]["chg_3m_pts"] == 0.1
    assert any(m.startswith("macro.fred_series DFII10: HTTP 502") for m in pack["missing"])
    assert any("CUSR0000SA0: sin valores" in m for m in pack["missing"])
    assert any(m.startswith("consenso") for m in pack["missing"])
    assert {"Ids": ",".join(analysis.BLS), "StartYear": "2024", "EndYear": "2026"} in [p for _, p in d.calls]
    assert analysis.has_data(pack)


def test_the_pack_is_kept_as_evidence_and_points_at_the_previous_one(kb):
    at = datetime(2026, 10, 6, 20, 0, tzinfo=UTC)
    first = {"kind": "technical", "symbol": "QQQ", "gathered_at": at.isoformat(), "technical": {"close": 1.0},
             "missing": [], "kinds_of_datum": analysis.KIND_LABELS}
    ref1, p1 = analysis.save_pack(kb, first, prompt="técnico de QQQ", host=RecordHost(provider="test"), now=at)
    assert p1["previous"] is None and ref1.startswith("evidence:") and "analisis-technical-qqq" in ref1
    later = {**first, "gathered_at": (at + timedelta(hours=1)).isoformat()}
    _, p2 = analysis.save_pack(kb, later, prompt="técnico de QQQ", host=RecordHost(provider="test"),
                               now=at + timedelta(hours=1))
    assert p2["previous"] == ref1
    assert not analysis.has_data({**first, "technical": None})


def test_previous_compares_the_exact_symbol_not_the_slug_prefix(kb):
    at = datetime(2026, 10, 6, 20, 0, tzinfo=UTC)
    host = RecordHost(provider="test")
    base = {"kind": "company", "gathered_at": at.isoformat(), "missing": [], "kinds_of_datum": analysis.KIND_LABELS}
    ref_msft, _ = analysis.save_pack(kb, {**base, "symbol": "MSFT"}, prompt="msft", host=host, now=at)
    ref_pair, _ = analysis.save_pack(kb, {**base, "symbol": "MSFT-AAPL"}, prompt="par", host=host, now=at)
    later = at + timedelta(hours=1)
    assert analysis.previous(kb, "company", "MSFT", later)[0] == ref_msft.removeprefix("evidence:")
    assert analysis.previous(kb, "company", "MSFT-AAPL", later)[0] == ref_pair.removeprefix("evidence:")


def test_non_operating_income_over_the_limit_flags_the_pe_and_under_it_does_not():
    def view(pretax: float):
        facts = {"RevenueFromContractWithCustomerExcludingAssessedTax": eight([100.0] * 8),
                 "OperatingIncomeLoss": eight([40.0] * 8), "NetIncomeLoss": eight([30.0] * 8),
                 "EarningsPerShareDiluted": eight([1.0] * 8),
                 analysis.PRETAX_TAGS[1 if pretax > 50 else 0]: eight([pretax] * 8),
                 "WeightedAverageNumberOfDilutedSharesOutstanding": eight([100.0] * 8)}
        bars = [((date(2026, 1, 1) + timedelta(days=i)).isoformat(), 20.0, 1.0) for i in range(200)]
        return analysis.fundamental_view(facts, None, {}, bars)
    hot = view(60.0)                                   # (60 − 40) ÷ 60 = 33,3 %: both pre-tax names are one concept
    assert hot["quality"]["non_operating"]["share_pct"] == 33.33
    assert hot["valuation"]["non_operating_share_pct"] == 33.33 and "distorsionado" in hot["valuation"]["pe_flag"]
    calm = view(42.0)                                  # 4,76 %
    assert calm["valuation"]["non_operating_share_pct"] == 4.76 and "pe_flag" not in calm["valuation"]


def test_a_change_whose_base_month_is_missing_is_declared_and_never_taken_from_the_neighbour():
    months = {f"2025-{m:02d}": 100.0 + m for m in range(1, 13) if m != 10} | {f"2026-{m:02d}": 120.0 + m for m in range(1, 11)}
    v = analysis._bls_view("CUSR0000SA0", analysis._months(bls("CUSR0000SA0", months)))
    assert v["month"] == "2026-10" and "yoy_pct" not in v and v["change_without_base"] == {"12m": "2025-10"}
    assert v["mom_pct"] is not None and v["three_month_annualized_pct"] is not None
    ok = analysis._bls_view("CUSR0000SA0", analysis._months(bls("CUSR0000SA0", months | {"2025-10": 110.0})))
    assert ok["yoy_pct"] == round((130.0 / 110.0 - 1) * 100, 2) and "change_without_base" not in ok


def test_a_missing_month_of_this_year_is_listed_and_a_negative_eps_has_no_pe():
    months = {f"2025-{m:02d}": 100.0 + m for m in range(9, 13)} | {"2026-01": 113.0, "2026-03": 114.0}
    v = analysis._bls_view("LNS14000000", analysis._months(bls("LNS14000000", months)))
    assert "2026-02" in v["months_without_value"] and "2025-03" in v["months_without_value"]
    facts = [q("2025-07-28", "2025-10-26", -1.0), q("2025-10-27", "2026-01-25", -1.0),
             q("2026-01-26", "2026-04-26", 0.5), q("2026-04-27", "2026-07-26", 0.4)]
    view = analysis.fundamental_view({"EarningsPerShareDiluted": facts}, price=70.0)
    assert view["pe_trailing"] is None and "no es positivo" in view["pe_note"]


# ── WS-0047: cash, dilution, debt and valuation ────────────────────────


def ytd(start: str, end: str, value: float, fp: str, filed: str) -> dict:
    return {"start": start, "end": end, "value": value, "filed": filed, "unit": "USD",
            "form": "10-K" if fp == "FY" else "10-Q", "fiscalYear": 2026, "fiscalPeriod": fp}


def test_flows_reported_as_amounts_accumulated_since_the_start_of_the_year_become_quarters():
    facts = [ytd("2025-09-28", "2025-12-27", 30.0, "Q1", "2026-01-30"), ytd("2025-09-28", "2026-03-28", 55.0, "Q2", "2026-05-01"),
             ytd("2025-09-28", "2026-06-27", 90.0, "Q3", "2026-07-31"), ytd("2025-09-28", "2026-09-26", 130.0, "FY", "2026-10-30"),
             ytd("2025-09-28", "2026-03-28", 55.0, "Q2", "2027-05-01")]                     # the same, filed again
    qs = analysis._quarters(facts)
    assert [(x["end"], x["value"], x.get("derived")) for x in qs] == [
        ("2025-12-27", 30.0, None), ("2026-03-28", 25.0, True), ("2026-06-27", 35.0, True), ("2026-09-26", 40.0, True)]
    assert qs[1]["start"] == "2025-12-28" and qs[1]["first_filed"] == "2026-05-01" and qs[3]["fiscalPeriod"] == "Q4"
    shares = [ytd("2025-09-28", "2025-12-27", 10.0, "Q1", "2026-01-30"), ytd("2025-09-28", "2026-03-28", 10.0, "Q2", "2026-05-01")]
    assert [x["end"] for x in analysis._quarters(shares, additive=False)] == ["2025-12-27"]   # an average: not derived


def test_growth_against_a_loss_is_a_category_not_a_percentage():
    assert analysis.change(120.0, 100.0) == {"pct": 20.0}
    assert analysis.change(-5.0, 100.0)["category"] == "pasa de ganancia a pérdida"
    assert analysis.change(5.0, -10.0) == {"category": "pasa de pérdida a ganancia"}
    assert analysis.change(-5.0, -10.0) == {"category": "reduce la pérdida"}
    assert analysis.change(-15.0, -10.0) == {"category": "profundiza la pérdida"}
    assert analysis.change(None, 1.0) is None


def eight(tag_values: list[float]) -> list[dict]:
    ends = ["2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]
    starts = ["2024-07-01", "2024-10-01", "2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01", "2026-01-01", "2026-04-01"]
    filed = ["2024-10-30", "2025-01-29", "2025-04-30", "2025-07-30", "2025-10-29", "2026-01-28", "2026-04-29", "2026-07-29"]
    return [{**q(s, e, v, f)} for s, e, v, f in zip(starts, ends, tag_values, filed, strict=True)]


def bal(end: str, value: float) -> dict:
    return {"end": end, "value": value, "filed": "2026-07-29", "form": "10-Q", "unit": "USD"}


def test_net_debt_counts_long_term_marketable_securities_only_when_the_report_separates_them():
    base = {"LongTermDebtNoncurrent": [bal("2026-06-30", 90.0)], "LongTermDebtCurrent": [bal("2026-06-30", 10.0)],
            "CashAndCashEquivalentsAtCarryingValue": [bal("2026-06-30", 20.0)]}
    plain = analysis._quality({}, {k: analysis._balance(v) for k, v in base.items()})["net_debt"]
    assert plain["net_debt"] == 80.0 and plain["long_term_securities"] == 0 and "sólo caja" in plain["includes"]
    with_lt = {**base, "MarketableSecuritiesNoncurrent": [bal("2026-06-30", 50.0)]}
    nd = analysis._quality({}, {k: analysis._balance(v) for k, v in with_lt.items()})["net_debt"]
    assert nd["net_debt"] == 30.0 and nd["long_term_securities"] == 50.0 and "largo plazo" in nd["includes"]
    stale = {**base, "MarketableSecuritiesNoncurrent": [bal("2026-03-31", 50.0)]}      # another date: not mixed
    assert analysis._quality({}, {k: analysis._balance(v) for k, v in stale.items()})["net_debt"]["net_debt"] == 80.0


def test_margins_free_cash_flow_dilution_and_net_debt_come_from_four_quarters():
    facts = {"RevenueFromContractWithCustomerExcludingAssessedTax": eight([100.0] * 4 + [120.0] * 4),
             "OperatingIncomeLoss": eight([40.0] * 4 + [50.0] * 4), "NetIncomeLoss": eight([30.0] * 4 + [36.0] * 4),
             "NetCashProvidedByUsedInOperatingActivities": eight([45.0] * 4 + [50.0] * 4),
             "PaymentsToAcquirePropertyPlantAndEquipment": eight([20.0] * 4 + [30.0] * 4),
             "WeightedAverageNumberOfDilutedSharesOutstanding": eight([100.0] * 4 + [98.0] * 4)}
    balance = {"LongTermDebtNoncurrent": [bal("2026-06-30", 90.0)], "LongTermDebtCurrent": [bal("2026-06-30", 10.0)],
               "CashAndCashEquivalentsAtCarryingValue": [bal("2026-06-30", 20.0)],
               "ShortTermInvestments": [bal("2026-06-30", 0.0)]}
    view = analysis.fundamental_view(facts, None, balance)
    rev = view["RevenueFromContractWithCustomerExcludingAssessedTax"]
    assert rev["last_4_quarters"] == 480.0 and rev["prior_4_quarters"] == 400.0 and rev["last_4_change"] == {"pct": 20.0}
    qd = view["quality"]
    assert qd["operating_margin"] == {"last_4_pct": 41.67, "prior_4_pct": 40.0, "change_pts": 1.67}
    assert qd["free_cash_flow"]["last_4"] == 80.0 and qd["free_cash_flow"]["change"] == {"pct": -20.0}
    assert qd["capex_to_revenue"] == {"last_4_pct": 25.0, "prior_4_pct": 20.0} and qd["dilution_yoy_pct"] == -2.0
    assert qd["net_debt"]["net_debt"] == 80.0 and qd["net_debt"]["years_of_fcf"] == 1.0 and "coverage" not in qd
    bank = analysis.fundamental_view({"NetIncomeLoss": eight([30.0] * 8),
                                      "NetCashProvidedByUsedInOperatingActivities": eight([-50.0] * 8)}, None, {})
    assert "incompleta" in bank["quality"]["coverage"] and "cash_conversion" not in bank["quality"]


def test_the_own_pe_uses_only_the_eps_already_filed_and_scenarios_state_their_assumptions():
    eps = eight([1.0] * 4 + [1.5] * 4)
    facts = {"EarningsPerShareDiluted": eps, "RevenueFromContractWithCustomerExcludingAssessedTax": eight([100.0] * 4 + [110.0] * 4)}
    day0 = date(2025, 7, 30)
    bars = [((day0 + timedelta(days=i)).isoformat(), 100.0, None) for i in range(400)]   # past the last filing
    v = analysis.fundamental_view(facts, None, {}, bars)["valuation"]
    assert v["pe_trailing"] == round(100.0 / 6.0, 1)
    # before 2025-10-29 the known EPS is 4.0 (P/E 25); each filing after it lifts the EPS: no look-ahead
    assert v["pe_history"]["max"] == 25.0 and v["pe_history"]["min"] == round(100.0 / 6.0, 1)
    cases = {c["case"]: c for c in v["scenarios_12m"]["cases"]}
    assert cases["central"]["eps_growth_pct"] == 10.0 and cases["central"]["exit_pe"] == v["pe_trailing"]
    assert cases["adverso"]["exit_pe"] <= v["pe_trailing"] <= cases["favorable"]["exit_pe"]
    assert "no pronóstico" in v["scenarios_12m"]["rule"]


def test_enterprise_value_multiples_book_value_and_capital_returned():
    facts = {"RevenueFromContractWithCustomerExcludingAssessedTax": eight([100.0] * 8),
             "OperatingIncomeLoss": eight([40.0] * 8), "NetIncomeLoss": eight([30.0] * 8),
             "DepreciationDepletionAndAmortization": eight([10.0] * 8),
             "NetCashProvidedByUsedInOperatingActivities": eight([45.0] * 8),
             "PaymentsToAcquirePropertyPlantAndEquipment": eight([20.0] * 8),
             "PaymentsForRepurchaseOfCommonStock": eight([10.0] * 8), "ProceedsFromIssuanceOfCommonStock": eight([2.5] * 8),
             "PaymentsOfDividendsCommonStock": eight([5.0] * 8), "InterestExpenseNonoperating": eight([4.0] * 8),
             "WeightedAverageNumberOfDilutedSharesOutstanding": eight([10.0] * 8)}
    balance = {"LongTermDebt": [bal("2026-06-30", 300.0)], "CashAndCashEquivalentsAtCarryingValue": [bal("2026-06-30", 100.0)],
               "StockholdersEquity": [bal("2025-06-30", 500.0), bal("2026-06-30", 700.0)],
               "Goodwill": [bal("2026-06-30", 100.0)]}
    bars = [("2026-08-0" + str(d), 200.0, None) for d in range(1, 6)]
    view = analysis.fundamental_view(facts, None, balance, bars)
    qd, v = view["quality"], view["valuation"]
    assert qd["capital_returned"]["net_buybacks_last_4"] == 30.0 and qd["capital_returned"]["share_of_fcf_pct"] == 50.0
    assert qd["interest_coverage"] == 10.0 and qd["roe_pct"] == 20.0 and qd["tangible_equity"] == 600.0
    # cap = 200 × 10 = 2.000; EV = 2.000 + (300 − 100) = 2.200
    assert v["enterprise_value"] == 2200 and v["ev_to_sales"] == 5.5 and v["ev_to_ebit"] == 13.75
    assert v["ev_to_ebitda"] == 11.0 and "ev_to_fcf" not in v and v["price_to_fcf"] == 20.0 and "accionista" in v["ev_note"]
    assert v["price_to_book"] == round(2000 / 700, 2) and v["price_to_tangible_book"] == round(2000 / 600, 2)
    assert v["shareholder_yield_pct"] == 2.5                                    # (dividendos 20 + recompra neta 30) ÷ 2.000


class Candles:
    """Only what the fundamental pack asks; the candles end months ago (a cut history, F5 19/10)."""

    async def invoke(self, cap, params):
        if cap == "market_data.candles":
            return CapabilityResult(cap, data={"data": [{"timeStamp": "2025-12-31T00:00:00", "close": 483.62}]})
        return CapabilityResult(cap, data={})


def test_an_old_last_close_is_declared_and_never_valued():
    pack = asyncio.run(analysis.gather(Candles(), "fundamental", symbol="MSFT", today=date(2026, 10, 19)))
    assert "valuation" not in pack["statements"] and pack["price_used"] is None
    assert any("2025-12-31" in m and "sin valoración" in m for m in pack["missing"])
