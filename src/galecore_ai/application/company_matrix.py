"""Comparison of several companies (WS-0047, `analyze company --symbols A,B,C`): the technical and fundamental packs
of each symbol, SPY, the ETF of its sector and the macro, gathered by code in one call and put side by side as
figures. No states, thresholds nor ordering: the request brings the criterion and the reader applies it.
"""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, date, datetime

from galecore_ai.application import analysis

MAX_SYMBOLS = 10
PACKS_AT_ONCE = 3           # fundamental packs ask SEC ~30 times each: a few companies at a time

# A default comparable to gather with the rest: the industry ETF when listed, else the sector one. When it represents
# the business poorly (GaleCore files NVDA as «Computer Hardware»), the reader asks for the technical pack of a better one.
INDUSTRY_ETF = (("software", "IGV"), ("semiconductor", "SOXX"), ("retail", "XLY"))
SECTOR_ETF = (("technology", "XLK"), ("financ", "XLF"), ("health", "XLV"), ("energy", "XLE"), ("industrial", "XLI"),
              ("consumer cyclical", "XLY"), ("consumer discretionary", "XLY"), ("consumer non-cyclical", "XLP"),
              ("consumer defensive", "XLP"), ("consumer staples", "XLP"), ("utilit", "XLU"), ("basic materials", "XLB"),
              ("materials", "XLB"), ("real estate", "XLRE"), ("communication", "XLC"), ("telecom", "XLC"),
              ("services", "XLC"))      # GaleCore files GOOGL under «Services»; retail goes first by industry
TECH_FIELDS = ("date", "close", "sma50", "sma200", "vs_sma50_pct", "vs_sma200_pct", "sma200_chg_20d_pct",
               "from_high_250_pct", "chg_63d_pct", "chg_126d_pct", "avg_move_20d_pct", "realized_vol_20d_pct", "iv_pct",
               "iv_minus_rv20_pts")
QUALITY_FIELDS = ("operating_margin", "gross_margin", "free_cash_flow", "capex_to_revenue", "cash_conversion",
                  "net_debt", "interest_coverage", "dilution_yoy_pct", "stock_comp_to_revenue_pct", "roe_pct",
                  "non_operating", "coverage")
VALUATION_FIELDS = ("close", "close_date", "pe_trailing", "pe_note", "non_operating_share_pct", "fcf_yield_pct",
                    "price_to_fcf", "ev_to_ebit", "ev_to_ebitda", "ev_to_sales", "ev_note", "price_to_book",
                    "price_to_tangible_book", "shareholder_yield_pct")


def sector_etf(market: dict | None) -> str | None:
    """The default comparable, from `volatility_metrics` industry and sector (None when the table has none)."""
    market = market or {}
    industry, sector = (market.get("industry") or "").lower(), (market.get("sector") or "").lower()
    if "health" in sector or "medical" in sector:
        industry = ""                       # "Pharmaceutical Retailers" is not consumer discretionary
    return (next((etf for k, etf in INDUSTRY_ETF if k in industry), None)
            or next((etf for k, etf in SECTOR_ETF if k in sector), None))


def _pick(d: dict | None, keys: tuple[str, ...]) -> dict:
    return {k: d[k] for k in keys if (d or {}).get(k) is not None}


def relative(tech: dict | None, ref: dict | None) -> dict | None:
    """Return of the symbol minus the reference's, 63 and 126 sessions, in points; only on the same last close."""
    if not tech or not ref or ref.get("date") != tech.get("date"):
        return None
    out = {f"{n}d_pts": round(tech[f"chg_{n}d_pct"] - ref[f"chg_{n}d_pct"], 2) for n in (63, 126)
           if isinstance(tech.get(f"chg_{n}d_pct"), int | float) and isinstance(ref.get(f"chg_{n}d_pct"), int | float)}
    return out or None


def _growth(row: dict | None) -> dict | None:
    if not row:
        return None
    return _pick(row, ("last_4_quarters", "prior_4_quarters", "last_4_change", "quarter_yoy")) or None


def build_row(symbol: str, fund: dict | None, tech: dict | None, spy: dict | None, etf: str | None,
              etf_tech: dict | None, today: date) -> dict:
    statements = (fund or {}).get("statements") or {}
    rev = next((statements[t] for t in analysis.REVENUE_TAGS if t in statements), None)
    technical = _pick(tech, TECH_FIELDS)
    if (vs := relative(tech, spy)) and symbol != "SPY":
        technical["vs_spy"] = vs
    if etf and etf != symbol and (vs := relative(tech, etf_tech)):
        technical["vs_etf"] = vs
    ne = (fund or {}).get("next_earnings")
    return {"symbol": symbol, "market": (fund or {}).get("market"),
            "comparable": {"etf": etf, **({"etf_" + k: v for k, v in _pick(etf_tech, ("date", "vs_sma200_pct",
                                                                                          "chg_126d_pct")).items()})},
            "tecnico": technical,
            "fundamentales": {"revenue": _growth(rev), "operating_income": _growth(statements.get("OperatingIncomeLoss")),
                              **_pick(statements.get("quality"), QUALITY_FIELDS)},
            "valoracion": {**_pick(statements.get("valuation"), VALUATION_FIELDS),
                           **({"pe_own_history": statements["valuation"]["pe_history"]}
                              if (statements.get("valuation") or {}).get("pe_history") else {})},
            "proximo_balance": ({**ne, "days": (date.fromisoformat(ne["date"]) - today).days} if ne else None)}


def parse_symbols(raw: str) -> list[str]:
    out = list(dict.fromkeys(s.strip().upper() for s in raw.split(",") if s.strip()))
    if bad := [x for x in out if not re.fullmatch(r"[A-Z0-9]{1,6}", x)]:
        raise ValueError(f"símbolo no admitido: {', '.join(bad)} (letras y números, hasta 6; sin puntos ni ^)")
    if not out:
        raise ValueError("--symbols necesita al menos un símbolo (A,B,C)")
    if len(out) > MAX_SYMBOLS:
        raise ValueError(f"hasta {MAX_SYMBOLS} símbolos por matriz (pasaron {len(out)})")
    return out


async def gather(dispatcher, symbols: list[str], *, today: date | None = None) -> dict:
    today = today or datetime.now(UTC).date()
    gate = asyncio.Semaphore(PACKS_AT_ONCE)

    async def fundamental(sym: str) -> dict:
        async with gate:
            return await analysis.gather(dispatcher, "fundamental", symbol=sym, today=today)

    async def technical(sym: str) -> dict:
        return await analysis.gather(dispatcher, "technical", symbol=sym, today=today)

    funds, techs, spy, macro = await asyncio.gather(
        asyncio.gather(*(fundamental(s) for s in symbols)), asyncio.gather(*(technical(s) for s in symbols)),
        technical("SPY"), analysis.gather(dispatcher, "macro", today=today))
    etfs = {s: sector_etf(f.get("market")) for s, f in zip(symbols, funds, strict=True)}
    wanted = sorted({e for e in etfs.values() if e and e not in symbols and e != "SPY"})
    etf_packs = dict(zip(wanted, await asyncio.gather(*(technical(e) for e in wanted)), strict=True))
    by_symbol = dict(zip(symbols, techs, strict=True))
    etf_packs |= {e: by_symbol[e] for e in set(etfs.values()) if e in by_symbol}       # a listed ETF is already there

    def view(pack: dict | None) -> dict | None:
        return (pack or {}).get("technical")

    rows = [build_row(s, f, view(t), view(spy), etfs[s], view(etf_packs.get(etfs[s])), today)
            for s, f, t in zip(symbols, funds, techs, strict=True)]
    missing = [f"{p['symbol']}: {m}" for p in (*funds, *techs, spy, *etf_packs.values(), macro) for m in p["missing"]]
    return {"kind": "company", "symbol": "-".join(symbols), "symbols": symbols, "gathered_at": datetime.now(UTC).isoformat(),
            "kinds_of_datum": analysis.KIND_LABELS,
            "universe": f"sólo los {len(symbols)} símbolos pedidos ({', '.join(symbols)}): no es una búsqueda en el mercado",
            "references": {"spy": _pick(view(spy), ("date", "chg_63d_pct", "chg_126d_pct")), "sector_etfs": etfs},
            "matrix": rows, "macro": {k: v for k, v in macro.items() if k not in ("kind", "symbol", "kinds_of_datum", "missing")},
            "missing": missing}
