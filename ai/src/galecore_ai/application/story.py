"""The day's market pack for the market story (GC-AI-0024): gathered by code, read by the model.

Gathering is cheap and deterministic, so it is code: one call per GaleCore capability, the few numbers the story
needs computed here from GaleCore's answers (changes over 1/5/20 sessions, distance to the 20-session high, the VIX
term ratios), what failed declared as missing, and the differences against the previous pack so a change of story is
visible without the model re-reading yesterday. Interpreting is the model's job (`market_story`).

The pack is kept as one evidence item (source galecore, payload = the pack): the story cites it.
"""

from __future__ import annotations

import asyncio
import json
import math
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from galecore_ai.application import drivers
from galecore_ai.application.knowledge import KnowledgeBase, save_evidence
from galecore_ai.capabilities.galecore_dtos import GaleCoreGexAnalysisResponse
from galecore_ai.contracts.evidence import EvidenceContent, EvidenceSeries, PayloadScope
from galecore_ai.contracts.regime_record import RecordHost

# What each asset says about the story (rates, credit, dollar, commodities, breadth, growth).
CROSS_ASSET = {"SPY": "S&P 500", "QQQ": "Nasdaq 100 (crecimiento y tecnología)", "IWM": "Russell 2000 (amplitud)",
               "TLT": "bonos largos del Tesoro (tasas)", "HYG": "crédito high yield", "UUP": "dólar",
               "GLD": "oro", "USO": "petróleo"}
VOL_INDICES = {"VIX9D": "volatilidad implícita del S&P a 9 días", "VIX": "a 30 días", "VIX3M": "a 3 meses",
               "VVIX": "volatilidad del VIX"}
# FRED release ids GaleCore's calendar knows: employment, CPI, PPI, GDP, personal income and outlays, retail sales.
MACRO_RELEASES = "50,10,46,53,54,9"
CALENDAR_DAYS = 14
RECENT_DAYS = 7             # releases of the last week: what the last sessions already reacted to
HISTORY_DAYS = 75           # calendar days of daily candles: two windows of 20 sessions with holidays (drivers)
GEX_TIMEOUT_S = 240         # a cold global GEX can take minutes; past this it is declared missing. The dispatcher's
                            # own HTTP cap (GALECORE_TIMEOUT_SECONDS, 120 s by default) applies first when lower
SLUG_PREFIX = "historia"
NEW_YORK = ZoneInfo("America/New_York")


def _closes(raw, exclude: str | None = None) -> list[tuple[str, float]]:
    """Daily closes, oldest first, one per date, from GaleCore's raw DXLink candles; `exclude` is a date whose candle
    is still open (today, before the close)."""
    events = (raw or {}).get("data") if isinstance(raw, dict) else None
    by_day: dict[str, float] = {}
    for e in events or []:
        stamp, close = e.get("timeStamp"), e.get("close")
        if (isinstance(stamp, str) and stamp[:10] != exclude and isinstance(close, int | float)
                and math.isfinite(close) and close > 0):
            by_day[stamp[:10]] = float(close)
    return sorted(by_day.items())


def _pct(a: float, b: float) -> float:
    return round((a / b - 1) * 100, 2)


def price_view(closes: list[tuple[str, float]]) -> dict | None:
    if len(closes) < 2:
        return None
    last_day, last = closes[-1]
    vals = [c for _, c in closes]
    window = vals[-20:]
    view = {"date": last_day, "close": last, "chg_1d_pct": _pct(last, vals[-2])}
    if len(vals) > 5:
        view["chg_5d_pct"] = _pct(last, vals[-6])
    if len(vals) > 20:
        view["chg_20d_pct"] = _pct(last, vals[-21])
    view["from_20d_high_pct"] = _pct(last, max(window))
    view["from_20d_low_pct"] = _pct(last, min(window))
    return view


def _gex_view(raw) -> dict:
    dto = GaleCoreGexAnalysisResponse.model_validate(raw)
    g = dto.gex.global_scope
    if g.spot <= 0 or g.coverage_pct <= 0:   # the DTO's defaults are zeros: an empty answer is not data
        raise ValueError(f"sin datos globales (spot {g.spot}, cobertura {g.coverage_pct})")
    out = {"spot": g.spot, "net_gex": g.net_gex, "gamma_zero_level": g.gamma_zero_level, "call_wall": g.call_wall,
           "put_wall": g.put_wall, "coverage_pct": g.coverage_pct,
           "as_of": dto.timestamp.isoformat() if dto.timestamp else None,
           "macro_signal": dto.macro_regime.signal if getattr(dto, "macro_regime", None) else None}
    if g.gamma_zero_level:
        out["spot_vs_zero_gamma_pct"] = _pct(g.spot, g.gamma_zero_level)
    return out


def _metrics_view(raw) -> dict:
    item = next(iter((raw or {}).get("items") or []), {})
    keep = ("impliedVolatilityIndex", "impliedVolatilityIndex5DayChange", "impliedVolatilityPercentile",
            "historicalVolatility30Day", "historicalVolatility90Day", "ivHv30DayDifference", "updatedAt")
    return {k: item.get(k) for k in keep if item.get(k) is not None}


def _iv_rank_view(raw) -> dict:
    keep = ("currentIV", "ivRank", "ivPercentile")
    hist = (raw or {}).get("history") or []
    out = {k: raw.get(k) for k in keep if raw.get(k) is not None}
    out["history_from"] = hist[0]["date"] if hist else None       # GaleCore keeps IV only since 21/09/2026
    return out


def open_session_day(today: date) -> str | None:
    """Today, when its daily candle is still open (before 16:15 New York): that candle is not a close."""
    et = datetime.now(UTC).astimezone(NEW_YORK)
    return today.isoformat() if et.date() == today and (et.hour, et.minute) < (16, 15) else None


async def gather(dispatcher, *, symbol: str = "SPY", today: date | None = None) -> dict:
    """Ask GaleCore for everything the story reads. Never raises for a failed call: it goes to `missing`."""
    today = today or datetime.now(UTC).date()
    start = (today - timedelta(days=HISTORY_DAYS)).isoformat()
    missing: list[str] = []

    async def ask(cap: str, params: dict, timeout: float | None = None):
        try:
            call = dispatcher.invoke(cap, params)
            res = await (asyncio.wait_for(call, timeout) if timeout else call)
        except TimeoutError:
            missing.append(f"{cap} {params.get('symbol', '')}: sin respuesta en {int(timeout or 0)} s".strip())
            return None
        if not res.ok:
            missing.append(f"{cap} {params.get('symbol', '')}: {str(res.error)[:160]}".strip())
            return None
        return res.data

    # Market closed (weekend): GaleCore's global GEX does not answer (observed 04/10, >240 s); not asked.
    closed = today.weekday() >= 5

    async def skip_gex():
        missing.append(f"compute.gex_analysis {symbol}: no se pide con el mercado cerrado (fin de semana)")

    open_day = open_session_day(today)

    symbols = list(dict.fromkeys([symbol, *CROSS_ASSET]))
    # The symbol goes back REACTION_DAYS: its reaction to the releases of the last months (drivers).
    reaction_start = (today - timedelta(days=drivers.REACTION_DAYS)).isoformat()
    candles = await asyncio.gather(*(ask("market_data.candles", {"symbol": s, "interval": "1d",
                                                                 "fromTime": reaction_start if s == symbol else start})
                                     for s in [*symbols, *VOL_INDICES]))
    prices, vol, closes = {}, {}, {}
    raw_symbol = candles[0]
    for s, raw in zip([*symbols, *VOL_INDICES], candles, strict=True):
        closes[s] = _closes(raw, exclude=open_day) if raw is not None else []
        view = price_view(closes[s]) if raw is not None else None
        if raw is not None and view is None:
            missing.append(f"market_data.candles {s}: menos de dos cierres diarios")
        if view:
            (vol if s in VOL_INDICES else prices)[s] = {"what": VOL_INDICES.get(s) or CROSS_ASSET.get(s, s), **view}
    term = {}
    if "VIX" in vol:
        for other in ("VIX9D", "VIX3M"):
            if other in vol:
                term[f"{other}_over_VIX"] = round(vol[other]["close"] / vol["VIX"]["close"], 3)

    skew, ivterm, ivrank, metrics, gex, releases, past, fomc = await asyncio.gather(
        ask("compute.put_skew", {"symbol": symbol}),
        ask("compute.implied_volatility", {"symbol": symbol}),
        ask("compute.iv_rank", {"symbol": symbol}),
        ask("market_data.volatility_metrics", {"symbol": symbol}),
        skip_gex() if closed else ask("compute.gex_analysis", {"symbol": symbol}, timeout=GEX_TIMEOUT_S),
        ask("calendar.macro_releases", {"From": today.isoformat(),
                                        "To": (today + timedelta(days=CALENDAR_DAYS)).isoformat(),
                                        "ReleaseIds": MACRO_RELEASES}),
        ask("calendar.macro_releases", {"From": reaction_start, "To": (today - timedelta(days=1)).isoformat(),
                                        "ReleaseIds": MACRO_RELEASES}),
        ask("calendar.fomc_meetings", {"Years": f"{today.year - 1},{today.year},{today.year + 1}"}))
    options: dict = {}
    if skew:
        options["put_skew"] = {k: skew.get(k) for k in ("expiration", "dte", "atmIV", "put25DeltaIV", "putSkew25d",
                                                        "levelOk", "levelThreshold") if k in skew}
    if ivterm:
        options["iv_term"] = {k: v for k, v in ivterm.items() if k != "symbol"}
    if ivrank:
        options["iv_rank"] = _iv_rank_view(ivrank)
    if metrics:
        options["iv_vs_hv"] = _metrics_view(metrics)
    if gex:
        try:
            options["gex"] = _gex_view(gex)
        except ValueError as exc:                     # GaleCore changed the shape: declared, not guessed
            missing.append(f"compute.gex_analysis {symbol}: respuesta con otra forma ({str(exc)[:120]})")
    calendar: dict = {}
    if releases is not None:
        calendar["macro_releases"] = [{"date": r.get("date"), "name": r.get("releaseName")}
                                      for r in (releases.get("data") or [])]
    if past is not None:
        week_ago = (today - timedelta(days=RECENT_DAYS)).isoformat()
        calendar["recent_releases"] = [{"date": r.get("date"), "name": r.get("releaseName")}
                                       for r in (past.get("data") or []) if (r.get("date") or "") >= week_ago]
    if fomc is not None:
        upcoming = [m for m in fomc.get("data") or [] if (m.get("end") or "") >= today.isoformat()]
        calendar["next_fomc"] = upcoming[:2]
    pack = {"symbol": symbol, "gathered_at": datetime.now(UTC).isoformat(), "prices": prices,
            "volatility": {**vol, **({"term": term} if term else {})}, "options": options, "calendar": calendar,
            "missing": missing}
    pack["drivers"] = drivers_view(symbol, raw_symbol, closes, past, releases, fomc, today, open_day, missing)
    return pack


def drivers_view(symbol, raw_symbol, closes, past, releases, fomc, today, open_day, missing) -> dict:
    """What moves the symbol today (P1-05): reaction to the releases, co-movement and what the IV pays ahead."""
    out: dict = {}
    bars = drivers.daily_bars(raw_symbol, exclude=open_day)
    if past is None or fomc is None or not bars:
        missing.append("drivers: sin calendario pasado, FOMC o velas del símbolo; no se mide la reacción a los datos")
    else:
        if all(iv is None for _, _, iv in bars):
            missing.append(f"drivers: las velas de {symbol} no traen IV; no se compara contra el implícito")
        events = drivers.release_events((past.get("data") or []) + ((releases or {}).get("data") or []),
                                        fomc.get("data") or [])
        out["reaction"] = drivers.reactions(bars, events, today)
        out["reaction"]["from"] = bars[0][0]
        out["upcoming"] = drivers.upcoming(events, out["reaction"]["by_release"], bars, today, CALENDAR_DAYS)
    labels = {**CROSS_ASSET, **VOL_INDICES}
    co = drivers.co_movement({s: c for s, c in closes.items() if c}, symbol, labels)
    if co is None:
        missing.append(f"drivers: menos de {drivers.WINDOW + 3} sesiones de {symbol}; sin co-movimiento")
    else:
        out["co_movement"] = co
    return out


# Scalars compared with the previous pack: the ones whose move can change the story.
def _scalars(pack: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for group in ("prices", "volatility"):
        for s, v in (pack.get(group) or {}).items():
            if isinstance(v, dict) and isinstance(v.get("close"), int | float):
                out[f"{s}.close"] = v["close"]
    for k, v in ((pack.get("volatility") or {}).get("term") or {}).items():
        out[f"term.{k}"] = v
    opts = pack.get("options") or {}
    for path in (("put_skew", "putSkew25d"), ("put_skew", "atmIV"), ("iv_rank", "ivRank"), ("gex", "net_gex"),
                 ("gex", "gamma_zero_level"), ("gex", "spot_vs_zero_gamma_pct"), ("iv_vs_hv", "ivHv30DayDifference")):
        v = (opts.get(path[0]) or {}).get(path[1])
        if isinstance(v, int | float):
            out[".".join(path)] = v
    return out


def compare(pack: dict, previous: dict | None) -> dict | None:
    """What moved since the previous pack: each shared scalar with both values and its change."""
    if not previous:
        return None
    now, before = _scalars(pack), _scalars(previous)
    moves = {}
    for k in sorted(now.keys() & before.keys()):
        a, b = now[k], before[k]
        moves[k] = {"before": b, "now": a, "change": round(a - b, 4),
                    **({"change_pct": _pct(a, b)} if b > 0 else {})}   # over a negative base the sign lies
    signs = {}
    for k in ("gex.net_gex", "gex.spot_vs_zero_gamma_pct"):
        if k in now and k in before and now[k] * before[k] < 0:
            signs[k] = "cambió de signo"
    return {"previous_gathered_at": previous.get("gathered_at"), "moves": moves, "sign_flips": signs}


# When the story is worth the strongest model (WS-0025): a verifiable change, decided by code, never by the model.
ESCALATE_PRICE_PCT = {"SPY.close": 2.0, "VIX.close": 10.0}   # move since the previous pack, in percent


def escalation_reason(pack: dict, today: date) -> str | None:
    """Why this pack calls for Opus instead of Sonnet, or None on a quiet day."""
    since = pack.get("since_previous") or {}
    if since.get("sign_flips"):
        return f"cambio de signo: {', '.join(since['sign_flips'])}"
    for key, limit in ESCALATE_PRICE_PCT.items():
        pct = (since.get("moves") or {}).get(key, {}).get("change_pct")
        if pct is not None and abs(pct) >= limit:
            return f"{key} {pct:+.1f}% desde el pack anterior (umbral {limit:g}%)"
    near = {(today - timedelta(days=1)).isoformat(), today.isoformat(), (today + timedelta(days=1)).isoformat()}
    cal = pack.get("calendar") or {}
    hit = [r["name"] for g in ("recent_releases", "macro_releases") for r in cal.get(g) or []
           if (r.get("date") or "")[:10] in near]
    return f"dato macro cerca de hoy: {', '.join(dict.fromkeys(hit))}" if hit else None


def previous_pack(kb: KnowledgeBase, symbol: str, before: datetime) -> tuple[str, dict] | None:
    """The latest stored pack of this symbol gathered before `before`."""
    best = None
    marker = f"-{SLUG_PREFIX}-{symbol.lower()}-"
    for eid in kb.evidence.ids():
        if marker not in eid:
            continue
        try:
            doc = kb.evidence.load(eid)
            pack = json.loads(doc.content.payload) if doc else {}
        except Exception:  # noqa: BLE001 - an unreadable item is skipped, the integrity check reports it elsewhere
            pack = {}
        at = pack.get("gathered_at") or "" if isinstance(pack, dict) else ""
        if not at:
            continue
        if at < before.isoformat() and (best is None or at > best[1].get("gathered_at", "")):
            best = (eid, pack)
    return best


def save_pack(kb: KnowledgeBase, pack: dict, *, prompt: str, host: RecordHost,
              now: datetime | None = None) -> tuple[str, dict]:
    """Compare with the previous pack and keep the result as one evidence item. Returns its ref and the pack."""
    now = now or datetime.now(UTC)
    gathered = datetime.fromisoformat(pack["gathered_at"])
    prev = previous_pack(kb, pack["symbol"], gathered)
    pack = {**pack, "since_previous": {"ref": f"evidence:{prev[0]}", **compare(pack, prev[1])} if prev else None}
    days = sorted({v["date"] for g in ("prices", "volatility") for v in (pack.get(g) or {}).values()
                   if isinstance(v, dict) and v.get("date")})
    content = EvidenceContent(
        source="galecore", tool="story pack (market_data.candles, compute.put_skew, compute.implied_volatility, "
                                "compute.iv_rank, market_data.volatility_metrics, compute.gex_analysis, "
                                "calendar.macro_releases, calendar.fomc_meetings)",
        params={"symbol": pack["symbol"], "candles_from_days": HISTORY_DAYS, "calendar_days": CALENDAR_DAYS},
        retrieved_at=gathered,
        series=[EvidenceSeries(name="cierres diarios y variaciones", unit="usd / index points / percent",
                               frequency="daily", observation_dates=f"{days[0]}..{days[-1]}" if days else "—"),
                EvidenceSeries(name="opciones del símbolo (skew 25Δ, estructura de IV, IV rank, IV vs HV, GEX)",
                               unit="iv decimal / percent / usd", frequency="snapshot",
                               observation_dates=pack["gathered_at"]),
                EvidenceSeries(name="calendario macro y FOMC", unit="date", frequency="scheduled",
                               observation_dates=f"{gathered.date()}..{gathered.date() + timedelta(days=CALENDAR_DAYS)}"),
                EvidenceSeries(name="qué lo mueve: reacción a cada dato contra la IV previa y co-movimiento de 20 "
                                    "sesiones (drivers)", unit="percent / ratio / correlation", frequency="daily",
                               observation_dates=((pack.get("drivers") or {}).get("reaction") or {}).get("from", "—")
                               + f"..{gathered.date()}")],
        payload=json.dumps(pack, ensure_ascii=False), payload_scope=PayloadScope.EXCERPT,
        excerpt_note=("Resumen calculado por código de las respuestas de GaleCore: último cierre y variaciones a 1, 5 y "
                      "20 sesiones, distancia al máximo y mínimo de 20 sesiones, cocientes VIX9D/VIX y VIX3M/VIX, "
                      "campos elegidos de cada capacidad, qué lo mueve (movimiento del símbolo en cada publicación macro "
                      "y FOMC de los últimos meses contra la IV de la víspera, y correlación y beta con cada activo en "
                      "20 sesiones contra las 20 anteriores) y la diferencia con el paquete anterior; se dejan afuera las "
                      "velas completas, la cadena y los vencimientos uno por uno."),
        access_notes=pack["missing"])
    stamp = gathered.strftime("%H%M")
    doc, _ = save_evidence(kb=kb, slug=f"{SLUG_PREFIX}-{pack['symbol'].lower()}-{stamp}", prompt=prompt, host=host,
                           content=content, now=now)
    return f"evidence:{doc.id}", pack
