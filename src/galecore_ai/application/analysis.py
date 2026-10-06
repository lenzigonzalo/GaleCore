"""On-demand analysis packs (P1-05: U-04 macro, U-07 fundamental, U-08 technical, U-09 flow): gathered by code from
GaleCore, kept as one evidence item, read by the model (`on_demand_analysis`).

Same split as the market story: code asks GaleCore and computes the few descriptive numbers each reading needs
(changes, moving averages, realized volatility, year-on-year growth), labelled with their kind of datum; what failed
or no source here brings (consensus, forecasts) is declared missing. The model separates what is observed, what the
prices imply, the consensus (missing) and its hypothesis, with an alternative and what would invalidate it.
"""

from __future__ import annotations

import asyncio
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
# XBRL concepts (U-07), quarterly values from the 10-Q/10-K.
FACTS = {"Revenues": "ingresos", "NetIncomeLoss": "resultado neto", "EarningsPerShareDiluted": "EPS diluido"}

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
    gaps = [m for m in (f"{y - 1}-{k:02d}" for k in range(1, 13)) if m not in by and m < last_m]
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
    view = technical_view(drivers.daily_bars(raw)) if raw is not None else None
    if raw is not None and view is None:
        missing.append(f"market_data.candles {symbol}: menos de 21 cierres diarios")
    return {"technical": view} if view else {}


# ── fundamental ─────────────────────────────────────────────────────────


def _quarters(facts: list[dict]) -> list[dict]:
    """Quarterly values, one per period end (the latest filing wins). The fourth fiscal quarter usually comes only
    inside the 10-K's annual value: it is derived as the year minus its three quarters and marked `derived`."""
    by_end: dict[str, dict] = {}
    annual: list[dict] = []
    for f in facts:
        start, end = f.get("start"), f.get("end")
        if not (start and end and isinstance(f.get("value"), int | float)):
            continue
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
        if 80 <= days <= 100:
            prev = by_end.get(end)
            if prev is None or (f.get("filed") or "") > (prev.get("filed") or ""):
                by_end[end] = f
        elif 350 <= days <= 380:
            annual.append(f)
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


def fundamental_view(facts_by_tag: dict[str, list[dict]], price: float | None) -> dict:
    out: dict = {}
    for tag, facts in facts_by_tag.items():
        q = _quarters(facts)
        if not q:
            continue
        last = q[-1]
        row = {"what": FACTS[tag], "period_end": last["end"], "value": last["value"], "unit": last.get("unit"),
               "fiscal": f"{last.get('fiscalYear')} {last.get('fiscalPeriod')}", "form": last.get("form"),
               "filed": last.get("filed"), **({"derived": True} if last.get("derived") else {})}
        year_ago = next((x for x in q if abs((date.fromisoformat(last["end"]) - date.fromisoformat(x["end"])).days
                                            - 364) <= 20), None)
        if year_ago and year_ago["value"]:
            row["yoy_pct"] = _round((last["value"] / year_ago["value"] - 1) * 100)
        span = (date.fromisoformat(q[-1]["end"]) - date.fromisoformat(q[-4]["start"])).days if len(q) >= 4 else 0
        if 350 <= span <= 380:                             # four consecutive quarters; Q4 often comes only annual
            row["last_4_quarters"] = round(sum(x["value"] for x in q[-4:]), 4)
            if any(x.get("derived") for x in q[-4:]):
                row["q4_derived"] = ("4.º trimestre = anual del 10-K menos sus tres trimestres (cálculo; en el EPS "
                                     "es aproximado porque cambia la cantidad de acciones)")
        elif len(q) >= 4:
            row["last_4_quarters"] = None
            row["note"] = "sin cuatro trimestres consecutivos (el 4.º fiscal suele venir sólo en el anual del 10-K)"
        out[tag] = row
    eps = out.get("EarningsPerShareDiluted", {}).get("last_4_quarters")
    if price and eps and eps > 0:
        out["pe_trailing"] = round(price / eps, 1)          # cálculo: last close over the last four diluted EPS
    return out


async def _fundamental(ask, symbol: str, today: date, missing: list[str]) -> dict:
    since = (today - timedelta(days=800)).isoformat()
    raws = await asyncio.gather(*(ask("filings.sec_facts", {"Ticker": symbol, "Tag": t, "Taxonomy": "us-gaap",
                                                           "Since": since}) for t in FACTS),
                                ask("filings.sec_filings", {"Ticker": symbol, "Forms": "10-Q,10-K,8-K",
                                                            "Since": (today - timedelta(days=200)).isoformat()}),
                                ask("market_data.volatility_metrics", {"symbol": symbol}),
                                ask("market_data.quote", {"symbol": symbol}))
    *fact_raws, filings, metrics, quote = raws
    facts = {t: ((r or {}).get("data") or {}).get("facts") or [] for t, r in zip(FACTS, fact_raws, strict=True)}
    q = (quote or {}).get("data") if isinstance(quote, dict) else None
    price = next((e["midPrice"] for e in (q if isinstance(q, list) else [])
                  if isinstance(e.get("midPrice"), int | float) and e["midPrice"] > 0), None)
    out: dict = {"statements": fundamental_view(facts, price), "price_used": price}
    for t in FACTS:
        if t not in out["statements"]:
            missing.append(f"filings.sec_facts {symbol} {t}: sin valores trimestrales (la empresa puede usar otro tag)")
    out["recent_filings"] = [{"form": f.get("form"), "date": f.get("filingDate"), "items": f.get("items"),
                              "earnings_release": "2.02" in (f.get("items") or [])}
                             for f in ((filings or {}).get("data") or {}).get("filings") or []][:8]
    item = next(iter((metrics or {}).get("items") or []), {})
    out["market"] = {k: item.get(k) for k in ("beta", "corrSpy3Month", "impliedVolatility30Day",
                                              "historicalVolatility30Day") if item.get(k) is not None} or None
    missing.append("fecha del próximo resultado: GaleCore no la trae; el último comunicado es el 8-K con ítem 2.02")
    missing.append("estimaciones de analistas y guía de la empresa: sin fuente; la valuación es sólo contra lo reportado")
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
