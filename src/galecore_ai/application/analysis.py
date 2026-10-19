"""On-demand analysis packs (P1-05: U-04 macro, U-07 fundamental, U-08 technical, U-09 flow): gathered by code from
GaleCore, kept as one evidence item, read by the model (`on_demand_analysis`).

Same split as the market story: code asks GaleCore and computes the few descriptive numbers each reading needs
(changes, moving averages, realized volatility, year-on-year growth), labelled with their kind of datum; what failed
or no source here brings (consensus, forecasts) is declared missing. The model separates what is observed, what the
prices imply, the consensus (missing) and its hypothesis, with an alternative and what would invalidate it.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import math
import statistics
from datetime import UTC, date, datetime, timedelta

from galecore_ai.application import story
from galecore_ai.application.knowledge import KnowledgeBase, save_evidence
from galecore_ai.contracts.evidence import EvidenceContent, EvidenceSeries, PayloadScope
from galecore_ai.contracts.regime_record import RecordHost

KINDS = ("macro", "technical", "fundamental", "flow")
SLUG_PREFIX = "analisis"
TRADING_DAYS = 252

# FRED daily series and what each one says (U-04).
FRED = {"DGS2": "Tesoro 2 años (%)", "DGS10": "Tesoro 10 años (%)", "DGS3MO": "Tesoro 3 meses (%)",
        "DFII10": "tasa real 10 años, TIPS (%)", "T10YIE": "breakeven de inflación 10 años (%)",
        "DFF": "fed funds efectiva (%)", "BAMLH0A0HYM2": "spread high yield (%)",
        "BAMLC0A0CM": "spread investment grade (%)"}
FRED_DAYS = 120
# BLS monthly official values (U-04).
BLS = {"CUSR0000SA0": "CPI general (índice, desestacionalizado)", "CUSR0000SA0L1E": "CPI núcleo (índice, desest.)",
       "LNS14000000": "desempleo (%)", "CES0000000001": "nóminas no agrícolas (miles)"}
# XBRL concepts (U-07, WS-0047), quarterly values from the 10-Q/10-K. Of the two revenue concepts, the one with the
# latest quarter is used (most companies report under the second).
FACTS = {"Revenues": "ingresos", "RevenueFromContractWithCustomerExcludingAssessedTax": "ingresos",
         "GrossProfit": "resultado bruto", "OperatingIncomeLoss": "resultado operativo",
         "NetIncomeLoss": "resultado neto", "EarningsPerShareDiluted": "EPS diluido",
         "NetCashProvidedByUsedInOperatingActivities": "flujo operativo",
         "PaymentsToAcquirePropertyPlantAndEquipment": "inversión en activos fijos",
         "ShareBasedCompensation": "remuneración en acciones",
         "WeightedAverageNumberOfDilutedSharesOutstanding": "acciones diluidas (promedio del trimestre)",
         "DepreciationDepletionAndAmortization": "amortizaciones", "DepreciationAmortizationAndOther": "amortizaciones",
         "InterestExpenseNonoperating": "intereses pagados", "InterestExpense": "intereses pagados",
         "PaymentsForRepurchaseOfCommonStock": "recompra de acciones",
         "ProceedsFromIssuanceOfCommonStock": "emisión de acciones",
         "PaymentsOfDividends": "dividendos pagados", "PaymentsOfDividendsCommonStock": "dividendos pagados"}
REVENUE_TAGS = ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax")
# Concepts that say the same under different names: the one with the latest quarter is kept.
ALIASES = (REVENUE_TAGS, ("DepreciationDepletionAndAmortization", "DepreciationAmortizationAndOther"),
           ("InterestExpenseNonoperating", "InterestExpense"), ("PaymentsOfDividends", "PaymentsOfDividendsCommonStock"))
NOT_ADDITIVE = {"WeightedAverageNumberOfDilutedSharesOutstanding"}   # an average: never summed nor derived
# Balance sheet concepts: a balance at a date, not a period.
BALANCE = {"LongTermDebt": "deuda de largo plazo (total)", "LongTermDebtNoncurrent": "deuda de largo plazo no corriente",
           "LongTermDebtCurrent": "deuda de largo plazo que vence en 12 meses",
           "CashAndCashEquivalentsAtCarryingValue": "caja", "ShortTermInvestments": "inversiones de corto plazo",
           "MarketableSecuritiesCurrent": "títulos negociables corrientes", "StockholdersEquity": "patrimonio neto",
           "Goodwill": "llave de negocio (goodwill)", "IntangibleAssetsNetExcludingGoodwill": "intangibles"}
FUNDAMENTAL_DAYS = 1500        # ~4 years of filings: four quarters, the four before and the P/E history
PE_HISTORY_DAYS = 1100         # ~3 years of closes for the own P/E range
STALE_CLOSE_DAYS = 5           # a last close older than this is a cut history, not the market

KIND_LABELS = {
    "hecho": "valor publicado por la fuente (FRED, BLS, SEC, Tastytrade vía GaleCore) con su fecha",
    "cálculo": "derivado por código de esos valores (cambios, medias, volatilidad realizada, crecimiento)",
    "estimación": "valor que depende de un modelo o supuesto (IV, GEX, posicionamiento por OI)",
    "faltante": "consenso y pronósticos: ninguna fuente de este ecosistema los trae",
}


def _round(x: float | None, n: int = 2) -> float | None:
    return None if x is None else round(x, n)


# ── macro ───────────────────────────────────────────────────────────────


def _fred_view(raw) -> dict | None:
    obs = [o for o in ((raw or {}).get("data") or {}).get("observations") or []
           if isinstance(o.get("value"), int | float)]
    if not obs:
        return None
    vals = [o["value"] for o in obs]
    view = {"date": obs[-1]["date"], "value": vals[-1]}
    for n in (5, 20, 60):
        if len(vals) > n:
            view[f"chg_{n}obs_bp"] = round((vals[-1] - vals[-1 - n]) * 100, 1)
    return view


def _months(series: dict) -> list[tuple[str, float, bool]]:
    """(YYYY-MM, value, preliminary) oldest first; annual averages (M13) left out."""
    out = []
    for o in series.get("observations") or []:
        period = o.get("period") or ""
        if not period.startswith("M") or period == "M13" or not isinstance(o.get("value"), int | float):
            continue
        out.append((f"{o['year']}-{period[1:]}", float(o["value"]),
                    any("prelim" in str(f).lower() for f in o.get("footnotes") or [])))
    return sorted(out)


def _month_back(y: int, mo: int, k: int) -> str:
    mm = mo - k
    while mm <= 0:
        y, mm = y - 1, mm + 12
    return f"{y}-{mm:02d}"


def _bls_view(series_id: str, months: list[tuple[str, float, bool]]) -> dict | None:
    if not months:
        return None
    by = {m: v for m, v, _ in months}
    last_m, last, prelim = months[-1]
    y, mo = map(int, last_m.split("-"))

    def back(k: int) -> float | None:
        yy, mm = y, mo - k
        while mm <= 0:
            yy, mm = yy - 1, mm + 12
        return by.get(f"{yy}-{mm:02d}")

    view: dict = {"month": last_m, "value": last, "preliminary": prelim}
    if series_id.startswith("CUSR"):                       # price index: inflation rates
        if (m1 := back(1)) is not None:
            view["mom_pct"] = _round((last / m1 - 1) * 100)
        if (m3 := back(3)) is not None:
            view["three_month_annualized_pct"] = _round(((last / m3) ** 4 - 1) * 100)
        if (m12 := back(12)) is not None:
            view["yoy_pct"] = _round((last / m12 - 1) * 100)
    elif series_id == "CES0000000001":                     # level in thousands: monthly change
        if (m1 := back(1)) is not None:
            view["change_thousands"] = _round(last - m1, 0)
        if (m3 := back(3)) is not None:
            view["avg_change_3m_thousands"] = _round((last - m3) / 3, 0)
    else:                                                  # a rate: change in points
        if (m3 := back(3)) is not None:
            view["chg_3m_pts"] = _round(last - m3)
        if (m12 := back(12)) is not None:
            view["chg_12m_pts"] = _round(last - m12)
    gaps = [m for m in (_month_back(y, mo, k) for k in range(12, 0, -1)) if m not in by]   # the last 12 months
    if gaps:
        view["months_without_value"] = gaps                # e.g. a shutdown month the agency never published
    return view


async def _macro(ask, today: date, missing: list[str]) -> dict:
    start = (today - timedelta(days=FRED_DAYS)).isoformat()
    fred_raw = await asyncio.gather(*(ask("macro.fred_series", {"SeriesId": s, "From": start}) for s in FRED))
    rates = {}
    for s, raw in zip(FRED, fred_raw, strict=True):
        if raw is not None and (v := _fred_view(raw)):
            rates[s] = {"what": FRED[s], **v}
    derived = {}
    if "DGS10" in rates and "DGS2" in rates:
        derived["curve_2s10s_bp"] = round((rates["DGS10"]["value"] - rates["DGS2"]["value"]) * 100, 1)
    if "DGS10" in rates and "DGS3MO" in rates:
        derived["curve_3m10y_bp"] = round((rates["DGS10"]["value"] - rates["DGS3MO"]["value"]) * 100, 1)
    if "DGS10" in rates and "DFII10" in rates and "T10YIE" in rates:
        # nominal ≈ real + breakeven: the residual says the three series are of comparable days, not a model
        derived["nominal_minus_real_plus_breakeven_bp"] = round(
            (rates["DGS10"]["value"] - rates["DFII10"]["value"] - rates["T10YIE"]["value"]) * 100, 1)
    bls_raw = await ask("macro.bls_series", {"Ids": ",".join(BLS), "StartYear": str(today.year - 2),
                                             "EndYear": str(today.year)})
    economy = {}
    for s in (bls_raw or {}).get("data") or []:
        sid = s.get("seriesId")
        if sid in BLS and (v := _bls_view(sid, _months(s))):
            economy[sid] = {"what": BLS[sid], **v}
    for sid in BLS:
        if bls_raw is not None and sid not in economy:
            missing.append(f"macro.bls_series {sid}: sin valores")
    missing.append("consenso de cada dato y pronósticos (encuestas, dot plot como serie): sin fuente; la sorpresa "
                   "no se mide")
    return {"rates_and_credit": rates, "derived": derived, "economy": economy}


# ── technical ───────────────────────────────────────────────────────────


def _sma(vals: list[float], n: int) -> float | None:
    return statistics.fmean(vals[-n:]) if len(vals) >= n else None


def _realized(vals: list[float], n: int) -> float | None:
    if len(vals) <= n:
        return None
    rets = [math.log(b / a) for a, b in zip(vals[-n - 1:-1], vals[-n:], strict=True)]
    return statistics.stdev(rets) * math.sqrt(TRADING_DAYS) * 100


def technical_view(bars) -> dict | None:
    """Trend, levels and realized volatility from daily closes (and the candle's IV)."""
    if len(bars) < 21:
        return None
    vals = [c for _, c, _ in bars]
    last_day, last, iv = bars[-1]
    out: dict = {"date": last_day, "close": last, "sessions": len(vals)}
    for n in (20, 50, 200):
        if (m := _sma(vals, n)) is not None:
            out[f"sma{n}"] = round(m, 2)
            out[f"vs_sma{n}_pct"] = _round((last / m - 1) * 100)
    for n in (20, 60, 250):
        if len(vals) >= n:
            window = vals[-n:]
            out[f"high_{n}"], out[f"low_{n}"] = max(window), min(window)
            out[f"from_high_{n}_pct"] = _round((last / max(window) - 1) * 100)
    for n in (5, 20, 60):
        if len(vals) > n:
            out[f"chg_{n}d_pct"] = _round((last / vals[-1 - n] - 1) * 100)
    for n in (20, 60):
        if (rv := _realized(vals, n)) is not None:
            out[f"realized_vol_{n}d_pct"] = round(rv, 2)
    if iv:
        out["iv_pct"] = round(iv * 100, 2)
        if "realized_vol_20d_pct" in out:
            out["iv_minus_rv20_pts"] = round(iv * 100 - out["realized_vol_20d_pct"], 2)
    s50, s200 = out.get("sma50"), out.get("sma200")
    if s50 and s200:
        out["trend"] = ("arriba de las medias de 50 y 200" if last > s50 > s200 else
                        "abajo de las medias de 50 y 200" if last < s50 < s200 else "mixta (precio y medias cruzados)")
    return out


async def _technical(ask, symbol: str, today: date, missing: list[str]) -> dict:
    raw = await ask("market_data.candles", {"symbol": symbol, "interval": "1d",
                                            "fromTime": (today - timedelta(days=400)).isoformat()})
    from galecore_ai.application import drivers
    view = technical_view(drivers.daily_bars(raw, exclude=story.open_session_day(today))) if raw is not None else None
    if raw is not None and view is None:
        missing.append(f"market_data.candles {symbol}: menos de 21 cierres diarios")
    return {"technical": view} if view else {}


# ── fundamental ─────────────────────────────────────────────────────────


def _latest(facts: list[dict]) -> dict[tuple, dict]:
    """One fact per (start, end), the latest filing winning (a restatement), keeping the first filing date."""
    out: dict[tuple, dict] = {}
    for f in facts:
        key = (f.get("start"), f.get("end"))
        filed = f.get("filed") or ""
        prev = out.get(key)
        first = min((x for x in (filed, (prev or {}).get("first_filed")) if x), default=None)
        if prev is None or filed > (prev.get("filed") or ""):
            out[key] = {**f, "first_filed": first or None}
        else:
            prev["first_filed"] = first or None
    return out


def _quarters(facts: list[dict], additive: bool = True) -> list[dict]:
    """Quarterly values, one per period end (the latest filing wins). Many companies report flows only as amounts
    accumulated since the start of the fiscal year (3, 6, 9, 12 months): each quarter is then the accumulated amount
    minus the previous one; the fourth fiscal quarter is the annual minus the nine months, or minus its three quarters.
    Derived quarters are marked `derived`. An average (shares) is never derived."""
    rows = [f for f in _latest(facts).values()
            if f.get("start") and f.get("end") and isinstance(f.get("value"), int | float)]
    days = {id(f): (date.fromisoformat(f["end"]) - date.fromisoformat(f["start"])).days for f in rows}
    by_end = {f["end"]: f for f in rows if 80 <= days[id(f)] <= 100}
    if not additive:
        return [by_end[k] for k in sorted(by_end)]
    by_start: dict[str, list[dict]] = {}
    for f in rows:
        if 80 <= days[id(f)] <= 380:
            by_start.setdefault(f["start"], []).append(f)
    for group in by_start.values():
        group.sort(key=lambda f: f["end"])
        for a, b in itertools.pairwise(group):
            gap = (date.fromisoformat(b["end"]) - date.fromisoformat(a["end"])).days
            if 80 <= gap <= 100 and b["end"] not in by_end:
                start = (date.fromisoformat(a["end"]) + timedelta(days=1)).isoformat()
                by_end[b["end"]] = {**b, "start": start, "value": b["value"] - a["value"], "derived": True,
                                    "fiscalPeriod": "Q4" if b.get("fiscalPeriod") == "FY" else b.get("fiscalPeriod"),
                                    "first_filed": max(a.get("first_filed") or "", b.get("first_filed") or "") or None}
    annual = sorted((f for f in rows if 350 <= days[id(f)] <= 380), key=lambda f: f.get("filed") or "", reverse=True)
    for y in annual:
        if y["end"] in by_end:
            continue
        inside = [q for q in by_end.values() if y["start"] <= q["start"] and q["end"] < y["end"]]
        if len(inside) == 3:
            last_q = max(inside, key=lambda q: q["end"])
            start = (date.fromisoformat(last_q["end"]) + timedelta(days=1)).isoformat()
            by_end[y["end"]] = {**y, "start": start, "value": y["value"] - sum(q["value"] for q in inside),
                                "fiscalPeriod": "Q4", "derived": True}
    return [by_end[k] for k in sorted(by_end)]


def _four(q: list[dict], upto: int) -> float | None:
    """Sum of the four consecutive quarters ending at index `upto` (exclusive), or None."""
    if upto < 4:
        return None
    span = (date.fromisoformat(q[upto - 1]["end"]) - date.fromisoformat(q[upto - 4]["start"])).days
    return round(sum(x["value"] for x in q[upto - 4:upto]), 4) if 350 <= span <= 380 else None


def change(now: float | None, before: float | None) -> dict | None:
    """Growth from `before` to `now`. Against a negative or zero base a percentage misleads: a category instead."""
    if now is None or before is None:
        return None
    if before > 0:
        out = {"pct": _round((now / before - 1) * 100)}
        return out | {"category": "pasa de ganancia a pérdida"} if now < 0 else out
    if before == 0:
        return {"category": "sin base (el período anterior es cero)"}
    if now >= 0:
        return {"category": "pasa de pérdida a ganancia"}
    return {"category": "reduce la pérdida" if now > before else "profundiza la pérdida"}


def _year_ago(q: list[dict]) -> dict | None:
    end = date.fromisoformat(q[-1]["end"])
    return next((x for x in q if abs((end - date.fromisoformat(x["end"])).days - 364) <= 20), None)


def _flow_row(tag: str, q: list[dict]) -> dict:
    last = q[-1]
    row = {"what": FACTS[tag], "concept": tag, "period_end": last["end"], "value": last["value"],
           "unit": last.get("unit"), "fiscal": f"{last.get('fiscalYear')} {last.get('fiscalPeriod')}",
           "form": last.get("form"), "filed": last.get("filed"), **({"derived": True} if last.get("derived") else {})}
    if (ya := _year_ago(q)) and ya["value"]:
        row["yoy_pct"] = _round((last["value"] / ya["value"] - 1) * 100)      # the last quarter against a year ago
        row["quarter_yoy"] = change(last["value"], ya["value"])
    if tag in NOT_ADDITIVE:
        return row
    if len(q) >= 4:
        row["last_4_quarters"] = _four(q, len(q))
        if row["last_4_quarters"] is None:
            row["note"] = "sin cuatro trimestres consecutivos (el 4.º fiscal suele venir sólo en el anual del 10-K)"
        elif any(x.get("derived") for x in q[-4:]):
            row["q4_derived"] = ("trimestre calculado = acumulado del año menos lo anterior (cálculo; en el EPS es "
                                 "aproximado porque cambia la cantidad de acciones)")
        row["prior_4_quarters"] = _four(q, len(q) - 4)
        row["last_4_change"] = change(row["last_4_quarters"], row["prior_4_quarters"])
    return row


def _balance(facts: list[dict]) -> dict | None:
    """A balance at a date: the latest one and the one a year before."""
    rows = sorted((f for f in _latest(facts).values() if f.get("end") and isinstance(f.get("value"), int | float)),
                  key=lambda f: f["end"])
    if not rows:
        return None
    last = rows[-1]
    end = date.fromisoformat(last["end"])
    ya = next((x for x in rows if abs((end - date.fromisoformat(x["end"])).days - 365) <= 20), None)
    return {"date": last["end"], "value": last["value"], "form": last.get("form"), "filed": last.get("filed"),
            **({"year_ago": ya["value"]} if ya else {})}


def _ratio(a: float | None, b: float | None, pct: bool = True) -> float | None:
    return _round(a / b * (100 if pct else 1)) if a is not None and b else None


def _net_debt(balance: dict, fcf: float | None) -> dict | None:
    nc, cur = balance.get("LongTermDebtNoncurrent"), balance.get("LongTermDebtCurrent")
    debt = (nc["value"] + cur["value"] if nc and cur and nc["date"] == cur["date"]
            else (balance.get("LongTermDebt") or {}).get("value"))
    cash_b = balance.get("CashAndCashEquivalentsAtCarryingValue")
    if debt is None or not cash_b:
        return None
    inv = balance.get("ShortTermInvestments") or balance.get("MarketableSecuritiesCurrent")
    cash = cash_b["value"] + (inv["value"] if inv and inv["date"] == cash_b["date"] else 0)
    net = round(debt - cash, 4)
    if net <= 0:
        years, reading = None, "caja neta: la caja supera la deuda"
    elif fcf and fcf > 0:
        years, reading = _ratio(net, fcf, pct=False), None
    else:
        years, reading = None, "flujo libre no positivo: la deuda no se puede medir en años de flujo"
    return {"date": cash_b["date"], "debt": debt, "cash_and_short_term": cash, "net_debt": net,
            "years_of_fcf": years, **({"reading": reading} if reading else {}),
            "formula": "deuda de largo plazo (incl. la que vence en 12 meses) − caja e inversiones de corto plazo; "
                       "÷ flujo libre de 4 trimestres"}


def _quality(out: dict, balance: dict) -> dict:
    """Margins, cash, dilution and debt from the rows (all calculations on reported numbers)."""
    def s(tag, k="last_4_quarters"):
        return (out.get(tag) or {}).get(k)
    rev = next((t for t in REVENUE_TAGS if t in out), None)
    r, rp = (s(rev), s(rev, "prior_4_quarters")) if rev else (None, None)
    qd: dict = {}
    for name, tag in (("gross_margin", "GrossProfit"), ("operating_margin", "OperatingIncomeLoss"),
                      ("net_margin", "NetIncomeLoss")):
        now, before = _ratio(s(tag), r), _ratio(s(tag, "prior_4_quarters"), rp)
        if now is not None:
            qd[name] = {"last_4_pct": now, "prior_4_pct": before,
                        "change_pts": _round(now - before) if before is not None else None}
    ocf, capex = s("NetCashProvidedByUsedInOperatingActivities"), s("PaymentsToAcquirePropertyPlantAndEquipment")
    ocf_p = s("NetCashProvidedByUsedInOperatingActivities", "prior_4_quarters")
    capex_p = s("PaymentsToAcquirePropertyPlantAndEquipment", "prior_4_quarters")
    fcf = round(ocf - capex, 4) if ocf is not None and capex is not None else None
    fcf_p = round(ocf_p - capex_p, 4) if ocf_p is not None and capex_p is not None else None
    if fcf is not None:
        qd["free_cash_flow"] = {"last_4": fcf, "prior_4": fcf_p, "change": change(fcf, fcf_p),
                                "margin_pct": _ratio(fcf, r), "prior_margin_pct": _ratio(fcf_p, rp),
                                "formula": "flujo operativo − inversión en activos fijos, 4 trimestres"}
        qd["capex_to_revenue"] = {"last_4_pct": _ratio(capex, r), "prior_4_pct": _ratio(capex_p, rp)}
    ni = s("NetIncomeLoss")
    if ocf is not None and ni and ni > 0:
        qd["cash_conversion"] = {"ocf_to_net_income": _ratio(ocf, ni, pct=False),
                                 "fcf_to_net_income": _ratio(fcf, ni, pct=False) if fcf is not None else None}
    if (sbc := s("ShareBasedCompensation")) is not None:
        qd["stock_comp_to_revenue_pct"] = _ratio(sbc, r)
    if (sh := out.get("WeightedAverageNumberOfDilutedSharesOutstanding")) and "yoy_pct" in sh:
        qd["dilution_yoy_pct"] = sh["yoy_pct"]
    if nd := _net_debt(balance, fcf):
        qd["net_debt"] = nd
    buy, issue = s("PaymentsForRepurchaseOfCommonStock"), s("ProceedsFromIssuanceOfCommonStock")
    div = s("PaymentsOfDividends") if "PaymentsOfDividends" in out else s("PaymentsOfDividendsCommonStock")
    if buy is not None or div is not None:
        net_buy = (buy or 0) - (issue or 0)
        qd["capital_returned"] = {"dividends_last_4": div, "buybacks_last_4": buy, "issuance_last_4": issue,
                                  "net_buybacks_last_4": round(net_buy, 4),
                                  "share_of_fcf_pct": _ratio((div or 0) + net_buy, fcf) if fcf and fcf > 0 else None,
                                  "formula": "dividendos + recompras − emisión, 4 trimestres; ÷ flujo libre"}
    interest = s("InterestExpenseNonoperating") if "InterestExpenseNonoperating" in out else s("InterestExpense")
    if interest and s("OperatingIncomeLoss") is not None:
        qd["interest_coverage"] = _ratio(s("OperatingIncomeLoss"), interest, pct=False)
    eq = balance.get("StockholdersEquity")
    if eq and ni is not None and eq.get("year_ago"):
        avg = (eq["value"] + eq["year_ago"]) / 2
        qd["roe_pct"] = _ratio(ni, avg) if avg > 0 else None
        tang = eq["value"] - sum((balance.get(t) or {}).get("value") or 0
                                 for t in ("Goodwill", "IntangibleAssetsNetExcludingGoodwill")
                                 if (balance.get(t) or {}).get("date") == eq["date"])
        if tang > 0:
            qd["tangible_equity"] = round(tang, 4)
    if rev is None or "OperatingIncomeLoss" not in out:
        qd.pop("cash_conversion", None)
        qd["coverage"] = ("evaluación fundamental incompleta con este método: la empresa no reporta ingresos o "
                          "resultado operativo con los conceptos habituales (bancos, aseguradoras, modelos especiales)")
    return qd


def _eps_known_at(eps_q: list[dict], day: str) -> float | None:
    """EPS of the last four consecutive quarters already filed on `day` (no look-ahead)."""
    known = [x for x in eps_q if (x.get("first_filed") or x.get("filed") or "9999") <= day]
    return _four(known, len(known)) if len(known) >= 4 else None


def _multiples(cap: float, out: dict, qd: dict) -> dict:
    """What the shareholder pays (P/E elsewhere, price over free cash flow, over book) and what the business is worth
    to everyone who finances it (EV = capitalización + deuda neta) over a coherent magnitude. Each one is meaningful
    for some businesses only; the reading picks two or three by business model."""
    def s(tag):
        return (out.get(tag) or {}).get("last_4_quarters")
    rev = next((s(t) for t in REVENUE_TAGS if t in out), None)
    ebit = s("OperatingIncomeLoss")
    da = next((s(t) for t in ALIASES[1] if t in out), None)
    fcf = (qd.get("free_cash_flow") or {}).get("last_4")
    m: dict = {"market_cap_at_close": round(cap, 0),
               "market_cap_note": "cierre × acciones diluidas promedio del último trimestre (aproximado)"}
    if fcf is not None:
        m["fcf_yield_pct"] = _round(fcf / cap * 100)
        m["price_to_fcf"] = _ratio(cap, fcf, pct=False) if fcf > 0 else None
    if (nd := qd.get("net_debt")) is not None:
        ev = cap + nd["net_debt"]
        m["enterprise_value"] = round(ev, 0)
        m["ev_note"] = "capitalización + deuda neta; no incluye arrendamientos, minoritarios ni preferidas"
        m["ev_to_sales"] = _ratio(ev, rev, pct=False) if rev and rev > 0 else None
        m["ev_to_ebit"] = _ratio(ev, ebit, pct=False) if ebit and ebit > 0 else None
        if ebit is not None and da is not None and ebit + da > 0:
            m["ev_to_ebitda"] = _ratio(ev, ebit + da, pct=False)
        m["ev_to_fcf"] = _ratio(ev, fcf, pct=False) if fcf and fcf > 0 else None
    eq = ((out.get("balance") or {}).get("StockholdersEquity") or {}).get("value")
    if eq and eq > 0:
        m["price_to_book"] = _ratio(cap, eq, pct=False)
    if (tang := qd.get("tangible_equity")) and tang > 0:
        m["price_to_tangible_book"] = _ratio(cap, tang, pct=False)
    if (cr := qd.get("capital_returned")):
        m["shareholder_yield_pct"] = _round(((cr["dividends_last_4"] or 0) + cr["net_buybacks_last_4"]) / cap * 100)
    return m


def valuation(eps_q: list[dict], bars: list, shares: float | None, out: dict, qd: dict) -> dict:
    """P/E on the last close, the own P/E range (EPS known at each date) and 12-month scenarios. Scenarios are
    rules over reported numbers, not a forecast: EPS growth and exit P/E are stated assumptions."""
    if not bars:
        return {}
    day, close = bars[-1][0], bars[-1][1]
    v: dict = {"close": close, "close_date": day}
    if shares:
        v |= _multiples(close * shares, out, qd)
    eps = _four(eps_q, len(eps_q)) if len(eps_q) >= 4 else None
    if eps is None:
        return v
    if eps <= 0:
        return v | {"pe_trailing": None, "pe_note": "sin P/E: el EPS de los últimos cuatro trimestres no es positivo"}
    v["eps_last_4"] = eps
    v["pe_trailing"] = round(close / eps, 1)
    cut = (date.fromisoformat(day) - timedelta(days=PE_HISTORY_DAYS)).isoformat()
    hist = [c / e for d, c, _ in bars if d >= cut and (e := _eps_known_at(eps_q, d)) and e > 0]
    if len(hist) < 120:
        return v
    qs, dec = statistics.quantiles(hist, n=4), statistics.quantiles(hist, n=10)
    ph = {"sessions": len(hist), "from": cut, "min": round(min(hist), 1), "p10": round(dec[0], 1),
          "p25": round(qs[0], 1), "median": round(qs[1], 1), "p75": round(qs[2], 1), "max": round(max(hist), 1),
          "percentile_today": round(sum(x <= v["pe_trailing"] for x in hist) / len(hist) * 100, 1),
          "note": "P/E de cada rueda con el EPS ya publicado ese día; su propia historia no garantiza un valor razonable"}
    v["pe_history"] = ph
    rev = next((out[t] for t in REVENUE_TAGS if t in out), {})
    g_rev = (rev.get("last_4_change") or {}).get("pct")
    g_eps = ((out.get("EarningsPerShareDiluted") or {}).get("last_4_change") or {}).get("pct")
    if g_rev is None:
        return v
    pe = v["pe_trailing"]
    cases = [("adverso", 0.0, min(pe, ph["p10"])), ("central", g_rev, pe),
             ("favorable", max(g_rev, g_eps if g_eps is not None else g_rev), max(pe, ph["p75"]))]
    v["scenarios_12m"] = {
        "rule": ("EPS de 4 trim. × (1 + crecimiento supuesto) × P/E de salida. Adverso: EPS sin crecer y el menor entre "
                 "el P/E de hoy y su percentil 10 · central: crece como los ingresos de 4 trim. y P/E igual al de hoy · "
                 "favorable: el mayor crecimiento entre ingresos y EPS de 4 trim., y el mayor entre el P/E de hoy y su "
                 "percentil 75. Supuestos, no pronóstico; sin dividendos ni probabilidades. Sobre P/E: pertinente "
                 "en empresas no financieras con ganancias estables, no en bancos, cíclicas en su pico ni pérdidas"),
        "cases": [{"case": n, "eps_growth_pct": g, "exit_pe": pe, "price": round(eps * (1 + g / 100) * pe, 2),
                   "return_pct": _round((eps * (1 + g / 100) * pe / close - 1) * 100)} for n, g, pe in cases]}
    return v


def fundamental_view(facts_by_tag: dict[str, list[dict]], price: float | None,
                     balance_facts: dict[str, list[dict]] | None = None, bars: list | None = None) -> dict:
    out: dict = {}
    quarters = {t: q for t, fs in facts_by_tag.items() if (q := _quarters(fs, additive=t not in NOT_ADDITIVE))}
    for group in ALIASES:
        present = [t for t in group if t in quarters]
        for t in present:
            if t != max(present, key=lambda x: quarters[x][-1]["end"]):
                del quarters[t]
    for tag, q in quarters.items():
        out[tag] = _flow_row(tag, q)
    balance = {t: b for t, fs in (balance_facts or {}).items() if (b := _balance(fs))}
    if balance:
        out["balance"] = {t: {"what": BALANCE[t], **b} for t, b in balance.items()}
    if balance_facts is not None:
        out["quality"] = _quality(out, balance)
    eps_q = quarters.get("EarningsPerShareDiluted", [])
    if bars:
        shares = (out.get("WeightedAverageNumberOfDilutedSharesOutstanding") or {}).get("value")
        out["valuation"] = valuation(eps_q, bars, shares, out, out.get("quality") or {})
        price = bars[-1][1]
    eps = (out.get("EarningsPerShareDiluted") or {}).get("last_4_quarters")
    if price and eps and eps > 0:
        out["pe_trailing"] = round(price / eps, 1)          # cálculo: last close over the last four diluted EPS
    elif eps is not None and eps <= 0:
        out["pe_trailing"] = None
        out["pe_note"] = "sin P/E: el EPS de los últimos cuatro trimestres no es positivo"
    return out


async def _fundamental(ask, symbol: str, today: date, missing: list[str]) -> dict:
    since = (today - timedelta(days=FUNDAMENTAL_DAYS)).isoformat()

    def sec(tag: str):
        return ask("filings.sec_facts", {"Ticker": symbol, "Tag": tag, "Taxonomy": "us-gaap", "Since": since})

    def facts_of(r) -> list[dict]:
        return ((r or {}).get("data") or {}).get("facts") or []

    raws = await asyncio.gather(
        *(sec(t) for t in FACTS), *(sec(t) for t in BALANCE),
        ask("filings.sec_filings", {"Ticker": symbol, "Forms": "10-Q,10-K,8-K",
                                    "Since": (today - timedelta(days=200)).isoformat()}),
        ask("market_data.volatility_metrics", {"symbol": symbol}),
        ask("market_data.candles", {"symbol": symbol, "interval": "1d",
                                    "fromTime": (today - timedelta(days=PE_HISTORY_DAYS + 30)).isoformat()}))
    n, m = len(FACTS), len(BALANCE)
    facts = {t: facts_of(r) for t, r in zip(FACTS, raws[:n], strict=True)}
    bal = {t: facts_of(r) for t, r in zip(BALANCE, raws[n:n + m], strict=True)}
    filings, metrics, candles = raws[n + m:]
    from galecore_ai.application import drivers
    def closes(raw) -> list:
        return drivers.daily_bars(raw, exclude=story.open_session_day(today)) if raw is not None else []

    def stale(b: list) -> bool:
        return bool(b) and (today - date.fromisoformat(b[-1][0])).days > STALE_CLOSE_DAYS

    bars = closes(candles)
    if stale(bars):     # once more: the cut is intermittent
        bars = closes(await ask("market_data.candles", {"symbol": symbol, "interval": "1d",
                                                        "fromTime": (today - timedelta(days=PE_HISTORY_DAYS + 30)).isoformat()}))
    if stale(bars):
        # GaleCore once served a long history cut months short (F5, 19/10): never value on an old close
        missing.append(f"market_data.candles {symbol}: el último cierre es del {bars[-1][0]}; sin valoración "
                       "(velas incompletas)")
        bars = []
    view = fundamental_view(facts, None, bal, bars)
    val = view.get("valuation") or {}
    out: dict = {"statements": view, "price_used": val.get("close"), "price_date": val.get("close_date")}
    missing[:] = [x for x in missing if not (x.startswith("filings.sec_facts") and "(404)" in x)]
    group_of = {t: g for g in ALIASES for t in g}
    absent = [FACTS[t] for t in FACTS if t not in view and not any(r in view for r in group_of.get(t, ()))]
    if absent:
        missing.append(f"filings.sec_facts {symbol}: sin valores trimestrales de {', '.join(dict.fromkeys(absent))} "
                       "(la empresa puede usar otros conceptos)")
    out["recent_filings"] = [{"form": f.get("form"), "date": f.get("filingDate"), "items": f.get("items"),
                              "earnings_release": "2.02" in (f.get("items") or [])}
                             for f in ((filings or {}).get("data") or {}).get("filings") or []][:8]
    item = next(iter((metrics or {}).get("items") or []), {})
    out["market"] = {k: item.get(k) for k in ("sector", "industry", "beta", "corrSpy3Month", "impliedVolatility30Day",
                                              "historicalVolatility30Day") if item.get(k) is not None} or None
    e = item.get("earnings")
    if isinstance(e, dict) and (e.get("expectedReportDate") or "") >= today.isoformat():
        out["next_earnings"] = {"date": e.get("expectedReportDate"), "time": e.get("timeOfDay"),
                                "confirmed": not e.get("estimated"), "consensus_eps": e.get("consensusEps")}
    else:
        missing.append("fecha del próximo resultado: GaleCore no la trae para este símbolo (sólo el último publicado)"
                       if isinstance(e, dict) and e.get("expectedReportDate") else
                       "fecha del próximo resultado: GaleCore no la trae para este símbolo")
    missing.append("estimaciones de analistas más allá del próximo EPS y guía de la empresa: sin fuente; la valuación "
                   "es sólo contra lo reportado")
    return out


# ── flow ────────────────────────────────────────────────────────────────


async def _flow(ask, symbol: str, missing: list[str]) -> dict:
    skew, ivterm, ivrank, gex = await asyncio.gather(
        ask("compute.put_skew", {"symbol": symbol}), ask("compute.implied_volatility", {"symbol": symbol}),
        ask("compute.iv_rank", {"symbol": symbol}),
        ask("compute.gex_analysis", {"symbol": symbol}, timeout=story.GEX_TIMEOUT_S))
    out: dict = {}
    if skew:
        out["put_skew"] = {k: skew.get(k) for k in ("expiration", "dte", "atmIV", "put25DeltaIV", "putSkew25d",
                                                    "levelOk", "levelThreshold") if k in skew}
    if ivterm:
        out["iv_term"] = {k: v for k, v in ivterm.items() if k != "symbol"}
    if ivrank:
        out["iv_rank"] = story._iv_rank_view(ivrank)
    if gex:
        try:
            out["gex"] = story._gex_view(gex)
        except ValueError as exc:
            missing.append(f"compute.gex_analysis {symbol}: respuesta con otra forma ({str(exc)[:120]})")
    missing.append("flujo por participante (quién compra o vende cada contrato) y prints de bloques: sin fuente; el "
                   "posicionamiento es una estimación desde OI, GEX y skew")
    return out


# ── gather and keep ─────────────────────────────────────────────────────


async def gather(dispatcher, kind: str, *, symbol: str = "SPY", today: date | None = None) -> dict:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    today = today or datetime.now(UTC).date()
    missing: list[str] = []

    async def ask(cap: str, params: dict, timeout: float | None = None):
        try:
            call = dispatcher.invoke(cap, params)
            res = await (asyncio.wait_for(call, timeout) if timeout else call)
        except TimeoutError:
            missing.append(f"{cap} {params.get('symbol') or params.get('Ticker') or ''}: sin respuesta".strip())
            return None
        if not res.ok:
            what = params.get("symbol") or params.get("Ticker") or params.get("SeriesId") or params.get("Tag") or ""
            missing.append(f"{cap} {what}: {str(res.error)[:160]}".strip())
            return None
        return res.data

    if kind == "macro":
        body = await _macro(ask, today, missing)
        symbol = "MACRO"
    elif kind == "technical":
        body = await _technical(ask, symbol, today, missing)
    elif kind == "fundamental":
        body = await _fundamental(ask, symbol, today, missing)
    else:
        body = await _flow(ask, symbol, missing)
    return {"kind": kind, "symbol": symbol, "gathered_at": datetime.now(UTC).isoformat(), "kinds_of_datum": KIND_LABELS,
            **body, "missing": missing}


def has_data(pack: dict) -> bool:
    return any(v for k, v in pack.items()
               if k not in ("kind", "symbol", "gathered_at", "kinds_of_datum", "missing", "price_used"))


def previous(kb: KnowledgeBase, kind: str, symbol: str, before: datetime) -> tuple[str, dict] | None:
    marker, best = f"-{SLUG_PREFIX}-{kind}-{symbol.lower()}-", None
    for eid in kb.evidence.ids():
        if marker not in eid:
            continue
        try:
            doc = kb.evidence.load(eid)
            p = json.loads(doc.content.payload) if doc else {}
        except Exception:  # noqa: BLE001 - unreadable items are reported by the integrity check
            p = {}
        at = p.get("gathered_at") or "" if isinstance(p, dict) else ""
        if at and at < before.isoformat() and (best is None or at > best[1].get("gathered_at", "")):
            best = (eid, p)
    return best


def save_pack(kb: KnowledgeBase, pack: dict, *, prompt: str, host: RecordHost,
              now: datetime | None = None) -> tuple[str, dict]:
    now = now or datetime.now(UTC)
    gathered = datetime.fromisoformat(pack["gathered_at"])
    prev = previous(kb, pack["kind"], pack["symbol"], gathered)
    pack = {**pack, "previous": f"evidence:{prev[0]}" if prev else None}
    content = EvidenceContent(
        source="galecore", tool=f"analyze pack --kind {pack['kind']}", params={"symbol": pack["symbol"]},
        retrieved_at=gathered,
        series=[EvidenceSeries(name=f"análisis {pack['kind']} de {pack['symbol']}", unit="ver cada campo",
                               frequency="daily / monthly / quarterly / snapshot",
                               observation_dates=pack["gathered_at"])],
        payload=json.dumps(pack, ensure_ascii=False), payload_scope=PayloadScope.EXCERPT,
        excerpt_note=("Resumen calculado por código de las respuestas de GaleCore: último valor de cada serie con su "
                      "fecha y sus cambios, y las cuentas descriptivas rotuladas como cálculo; se dejan afuera las "
                      "series completas."),
        access_notes=pack["missing"])
    doc, _ = save_evidence(kb=kb, slug=f"{SLUG_PREFIX}-{pack['kind']}-{pack['symbol'].lower()}-"
                                       f"{gathered.strftime('%H%M')}", prompt=prompt, host=host, content=content, now=now)
    return f"evidence:{doc.id}", pack
