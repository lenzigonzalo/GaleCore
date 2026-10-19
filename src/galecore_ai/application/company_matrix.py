"""Selection matrix (WS-0047 F1b, `analyze company --symbols A,B,C`): the technical and fundamental packs of each symbol,
SPY, the ETF of its sector and the macro, turned by code into one row per company in four blocks — technical fit ·
quality and financial health · valuation · entry and events. Each cell is cumple / no cumple / sin datos / no aplica
(a filter) or dato (it informs, it does not filter) with its number. No score: the rows are ordered by how many of the
two filter blocks are met and each row says which cell fails. The model reads the matrix; it never recomputes it.
"""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, date, datetime

from galecore_ai.application import analysis

MAX_SYMBOLS = 10
PACKS_AT_ONCE = 3           # fundamental packs ask SEC ~30 times each: a few companies at a time
HORIZON = "6 a 12 meses"
CUMPLE, NO_CUMPLE, SIN_DATOS, NO_APLICA, DATO = "cumple", "no cumple", "sin datos", "no aplica", "dato"

# Fixed before seeing results (R6): the industry ETF when the table has it, else the sector one.
INDUSTRY_ETF = (("software", "IGV"), ("semiconductor", "SOXX"), ("retail", "XLY"))
SECTOR_ETF = (("technology", "XLK"), ("financ", "XLF"), ("health", "XLV"), ("energy", "XLE"), ("industrial", "XLI"),
              ("consumer cyclical", "XLY"), ("consumer discretionary", "XLY"), ("consumer non-cyclical", "XLP"),
              ("consumer defensive", "XLP"), ("consumer staples", "XLP"), ("utilit", "XLU"), ("basic materials", "XLB"),
              ("materials", "XLB"), ("real estate", "XLRE"), ("communication", "XLC"), ("telecom", "XLC"))

CRITERIA = {
    "T1": "estructura de medias: precio > media 50 > media 200",
    "T2": "media 200 subiendo: media 200 de hoy contra la de hace 20 ruedas > 0",
    "T3": "fuerza relativa contra SPY: rendimiento del símbolo − el de SPY, 63 y 126 ruedas, ambos > 0",
    "T4": "fuerza relativa contra el ETF de su industria o sector (tabla fija), 63 y 126 ruedas, ambos > 0",
    "F1": "ingresos de 4 trimestres contra los 4 anteriores > 0",
    "F2": "resultado operativo de 4 trimestres contra los 4 anteriores > 0 (pasar de pérdida a ganancia cuenta)",
    "F3": "margen operativo de 4 trimestres no baja más de 1 punto contra los 4 anteriores",
    "F4": "flujo libre (flujo operativo − inversión en activos fijos) de 4 trimestres > 0",
    "F5": "deuda neta (deuda de largo plazo − caja y las inversiones de corto plazo que el informe separa; puede exagerarla si hay muchos títulos de otro tipo) menor a 3 años de flujo libre; caja neta cumple",
    "valoración": "informa, no filtra: es contexto de la tesis; los escenarios son supuestos, no pronóstico",
    "entrada y eventos": "informa, no filtra: dónde está el precio respecto de sus medias y qué viene en el calendario",
}
FILTER_BLOCKS = ("tecnico", "calidad")


def sector_etf(market: dict | None) -> str | None:
    """The comparable for a company, from `volatility_metrics` sector and industry (None when the table has none)."""
    market = market or {}
    industry, sector = (market.get("industry") or "").lower(), (market.get("sector") or "").lower()
    if "health" in sector or "medical" in sector:
        industry = ""                       # "Pharmaceutical Retailers" is not consumer discretionary
    return (next((etf for k, etf in INDUSTRY_ETF if k in industry), None)
            or next((etf for k, etf in SECTOR_ETF if k in sector), None))


def _cell(state: str, value: dict | None = None, note: str | None = None) -> dict:
    return {"state": state, **({"value": value} if value else {}), **({"note": note} if note else {})}


def _num(d: dict | None, k: str) -> float | None:
    v = (d or {}).get(k)
    return v if isinstance(v, int | float) else None


def _rs(tech: dict, ref: dict | None, ref_name: str) -> dict:
    """Relative strength 63 and 126 sessions against a reference (percentage points)."""
    if not ref:
        return _cell(SIN_DATOS, note=f"sin velas de {ref_name}")
    if ref.get("date") != tech.get("date"):
        return _cell(SIN_DATOS, note=f"último cierre distinto: {tech.get('date')} contra {ref_name} {ref.get('date')}")
    pts = {}
    for n in (63, 126):
        a, b = _num(tech, f"chg_{n}d_pct"), _num(ref, f"chg_{n}d_pct")
        if a is None or b is None:
            return _cell(SIN_DATOS, note=f"menos de {n + 1} cierres")
        pts[f"{n}"] = {"symbol_pct": a, f"{ref_name}_pct": b, "diff_pts": round(a - b, 2)}
    return _cell(CUMPLE if all(v["diff_pts"] > 0 for v in pts.values()) else NO_CUMPLE, {"reference": ref_name, **pts})


def technical_block(tech: dict | None, spy: dict | None, etf: str | None, etf_tech: dict | None,
                    symbol: str = "") -> dict:
    if not tech:
        return {k: _cell(SIN_DATOS, note="sin velas diarias") for k in ("T1", "T2", "T3", "T4")}
    cells: dict = {}
    c, s50, s200 = tech["close"], tech.get("sma50"), tech.get("sma200")
    cells["T1"] = (_cell(SIN_DATOS, note="menos de 200 cierres") if not (s50 and s200) else
                   _cell(CUMPLE if c > s50 > s200 else NO_CUMPLE,
                         {"close": c, "sma50": s50, "sma200": s200, "date": tech["date"]}))
    slope = _num(tech, "sma200_chg_20d_pct")
    cells["T2"] = (_cell(SIN_DATOS, note="menos de 220 cierres") if slope is None else
                   _cell(CUMPLE if slope > 0 else NO_CUMPLE, {"sma200_chg_20d_pct": slope}))
    cells["T3"] = _rs(tech, spy, "SPY") if symbol != "SPY" else _cell(NO_APLICA, note="es la referencia")
    cells["T4"] = (_cell(NO_APLICA, note="es su propia referencia") if etf == symbol else
                   _rs(tech, etf_tech, etf) if etf else
                   _cell(SIN_DATOS, note="la tabla no tiene comparable para este sector o industria"))
    return cells


def _growth(row: dict | None, key: str = "last_4_change") -> tuple[str, dict] | None:
    """(state, value) for a 'grew against the previous four quarters' test; categories instead of a % on a loss."""
    ch = (row or {}).get(key)
    if not ch:
        return None
    value = {**ch, "last_4": row.get("last_4_quarters"), "prior_4": row.get("prior_4_quarters"),
             "quarter_yoy": row.get("quarter_yoy")}
    cat = ch.get("category")
    if cat and cat.startswith("sin base"):
        return SIN_DATOS, value
    if cat:
        return (CUMPLE if cat == "pasa de pérdida a ganancia" else NO_CUMPLE), value
    return (CUMPLE if ch["pct"] > 0 else NO_CUMPLE), value


def quality_block(statements: dict | None, financial: bool = False) -> tuple[dict, dict]:
    """The five fundamental filters and the figures that go beside them (data, not filters)."""
    names = ("F1", "F2", "F3", "F4", "F5")
    if not statements or not any(t in statements for t in analysis.FACTS):
        return {k: _cell(SIN_DATOS, note="sin valores trimestrales de la SEC") for k in names}, {}
    qd = statements.get("quality") or {}
    if qd.get("coverage") or financial:
        return {k: _cell(NO_APLICA, note="evaluación fundamental incompleta con este método") for k in names}, {}
    rev = next((statements[t] for t in analysis.REVENUE_TAGS if t in statements), None)
    cells: dict = {}
    for name, row in (("F1", rev), ("F2", statements.get("OperatingIncomeLoss"))):
        g = _growth(row)
        cells[name] = _cell(g[0], g[1]) if g else _cell(SIN_DATOS, note="sin cuatro trimestres contra cuatro")
    om = qd.get("operating_margin") or {}
    pts = _num(om, "change_pts")
    cells["F3"] = (_cell(SIN_DATOS, note="sin margen operativo de dos años") if pts is None else
                   _cell(CUMPLE if pts >= -1 else NO_CUMPLE, {"last_4_pct": om["last_4_pct"], "prior_4_pct": om["prior_4_pct"],
                                                              "change_pts": pts}))
    fcf = qd.get("free_cash_flow")
    cells["F4"] = (_cell(SIN_DATOS, note="sin flujo operativo o inversión en activos fijos") if not fcf else
                   _cell(CUMPLE if fcf["last_4"] > 0 else NO_CUMPLE,
                         {"last_4": fcf["last_4"], "prior_4": fcf["prior_4"], "change": fcf["change"],
                          "margin_pct": fcf["margin_pct"]}))
    nd = qd.get("net_debt")
    if not nd:
        cells["F5"] = _cell(SIN_DATOS, note="sin deuda o caja en el último informe")
    else:
        years = nd.get("years_of_fcf")
        unknown = nd["net_debt"] > 0 and years is None and not nd.get("reading", "").startswith("flujo libre no positivo")
        ok = nd["net_debt"] <= 0 or (years is not None and years < 3)
        cells["F5"] = _cell(SIN_DATOS if unknown else CUMPLE if ok else NO_CUMPLE, {"net_debt": nd["net_debt"], "years_of_fcf": years,
                                                            "reading": nd.get("reading"), "date": nd["date"]})
    data = {k: qd[k] for k in ("gross_margin", "capex_to_revenue", "cash_conversion", "dilution_yoy_pct",
                               "stock_comp_to_revenue_pct", "interest_coverage") if k in qd}
    return cells, data


def valuation_block(statements: dict | None) -> dict:
    v = (statements or {}).get("valuation") or {}
    if not v:
        return {"state": SIN_DATOS, "note": "sin valoración (cierre viejo o sin informes)"}
    ph, sc = v.get("pe_history") or {}, (v.get("scenarios_12m") or {}).get("cases") or []
    return {"state": DATO, "close": v.get("close"), "close_date": v.get("close_date"), "pe_trailing": v.get("pe_trailing"),
            "pe_note": v.get("pe_note"), "pe_percentile_own_history": ph.get("percentile_today"),
            "pe_median_own_history": ph.get("median"),
            **{k: v.get(k) for k in ("fcf_yield_pct", "ev_to_ebit", "ev_to_sales", "ev_to_fcf", "price_to_book",
                                     "shareholder_yield_pct") if v.get(k) is not None},
            **({"scenarios_12m_return_pct": {c["case"]: c["return_pct"] for c in sc}} if sc else {})}


def entry_block(tech: dict | None, pack: dict | None, today: date) -> dict:
    out: dict = {"state": DATO}
    if tech:
        s200, avg = tech.get("sma200"), tech.get("avg_move_20d_pct")
        ext = _num(tech, "vs_sma50_pct")
        out["extension"] = {"vs_sma50_pct": ext, "in_daily_moves": round(ext / avg, 1) if ext is not None and avg else None,
                            "avg_move_20d_pct": avg, "from_high_250_pct": tech.get("from_high_250_pct"),
                            "note": "movimiento diario medio calculado con cierres (no hay máximos ni mínimos)"}
        if s200:
            out["technical_invalidation"] = {"level": "media 200", "sma200": s200,
                                             "distance_pct": round((s200 / tech["close"] - 1) * 100, 2)}
        out["volatility"] = {k: tech.get(k) for k in ("realized_vol_20d_pct", "iv_pct", "iv_minus_rv20_pts")
                             if tech.get(k) is not None}
    ne = (pack or {}).get("next_earnings")
    if ne:
        out["next_earnings"] = {**ne, "days": (date.fromisoformat(ne["date"]) - today).days}
    else:
        out["next_earnings"] = {"state": SIN_DATOS, "note": "GaleCore no trae la próxima fecha de resultados"}
    if not tech:
        out["state"] = SIN_DATOS
    return out


def _block_state(cells: dict) -> str:
    states = {c["state"] for c in cells.values()}
    if NO_CUMPLE in states:
        return NO_CUMPLE
    if states == {NO_APLICA}:
        return NO_APLICA
    return SIN_DATOS if SIN_DATOS in states else CUMPLE


def build_row(symbol: str, fund: dict | None, tech: dict | None, spy: dict | None, etf: str | None,
              etf_tech: dict | None, today: date) -> dict:
    statements = (fund or {}).get("statements")
    quality, data = quality_block(statements, "financ" in ((fund or {}).get("market") or {}).get("sector", "").lower())
    technical = technical_block(tech, spy, etf, etf_tech, symbol)
    context = None
    if etf_tech:
        context = {"etf": etf, "date": etf_tech.get("date"), "vs_sma200_pct": etf_tech.get("vs_sma200_pct"),
                   "chg_126d_pct": etf_tech.get("chg_126d_pct"),
                   "chg_126d_vs_spy_pts": (round(etf_tech["chg_126d_pct"] - spy["chg_126d_pct"], 2)
                                           if spy and spy.get("date") == etf_tech.get("date")
                                           and _num(etf_tech, "chg_126d_pct") is not None
                                           and _num(spy, "chg_126d_pct") is not None else None)}
    blocks = {"tecnico": technical, "calidad": quality}
    states = {name: _block_state(cells) for name, cells in blocks.items()}
    fails = [f"{name}:{k}" for name, cells in blocks.items() for k, c in cells.items() if c["state"] == NO_CUMPLE]
    gaps = [f"{name}:{k}" for name, cells in blocks.items() for k, c in cells.items() if c["state"] == SIN_DATOS]
    return {"symbol": symbol, "block_states": states, "fails": fails, "without_data": gaps,
            "tecnico": technical, "sector": {"etf": etf, "context": context}, "calidad": quality, "calidad_datos": data,
            "valoracion": valuation_block(statements), "entrada_y_eventos": entry_block(tech, fund, today),
            "market": (fund or {}).get("market")}


def order_key(row: dict) -> tuple:
    """No score: more filter blocks met first, then fewer failed cells, then fewer without data."""
    met = sum(row["block_states"][b] == CUMPLE for b in FILTER_BLOCKS)
    return (-met, len(row["fails"]), len(row["without_data"]), row["symbol"])


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
    rows.sort(key=order_key)
    missing = [f"{p['symbol']}: {m}" for p in (*funds, *techs, spy, *etf_packs.values(), macro) for m in p["missing"]]
    return {"kind": "company", "symbol": "-".join(symbols), "symbols": symbols, "gathered_at": datetime.now(UTC).isoformat(),
            "kinds_of_datum": analysis.KIND_LABELS, "profile": f"tendencia alcista con fundamentos que la sostengan ({HORIZON})",
            "universe": f"sólo los {len(symbols)} símbolos pedidos ({', '.join(symbols)}): no es una búsqueda en el mercado",
            "states": "cumple / no cumple / sin datos / no aplica en los filtros; dato donde informa sin filtrar",
            "criteria": CRITERIA, "references": {"spy_date": (view(spy) or {}).get("date"), "sector_etfs": etfs},
            "matrix": rows, "macro": {k: v for k, v in macro.items() if k not in ("kind", "symbol", "kinds_of_datum", "missing")},
            "missing": missing}
