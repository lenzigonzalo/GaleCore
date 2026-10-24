"""Supervisor of what is open in SHADOW (WS-0007, P1-01): watch the rules that exist, alert, keep the decision.

«Avisame si una posición se complica» — and keep what I decided, with its context, so it can be reviewed later.

Deterministic, no model call. Each pass reads GaleCore's runtime (instances and their positions) through the API,
compares every position with rules that already exist — the strategy's exits (from the spec whose hash GaleCore
runs), the strategy's max loss per trade, and that the position can be priced — and writes one alert per new
condition. An alert is raised once per condition (its ``key``); the monitor shows it with a sound and the owner
answers with one of its options. The answer is a ``decision`` entry of the strategy's project, carrying the alert,
the options, the choice, what the owner expects and when to review it. Nothing here opens, closes or changes a
position: in SHADOW the runtime's exits are mechanical and a decision only records what the owner thinks.

Out of scope here (owner 05/10): management proposals beyond the rule (after P1-02). Thesis invalidations (WS-0016)
are the owner's rules of ``watch`` with a thesis and its strategies. A failed read of GaleCore is reported as such,
never as «nothing to report».
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from galecore_ai.application import project
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.project import PORTFOLIO, DecisionContext
from galecore_ai.contracts.strategy import compute_document_hash
from galecore_ai.contracts.supervision import NEEDS_DECISION, OPTIONS, Alert, AlertKind

NEAR_STOP_MULTIPLE = 1.0        # loss at mid >= 1x credit: half way to the 2x stop (owner 05/10)
NO_PRICE_MINUTES = 10           # in session, without a valuation for longer than this (owner 05/10)
EVENT_BUSINESS_DAYS = 2         # an event before expiration is announced this many business days ahead (owner 05/10)
# FRED releases GaleCore's calendar knows (same set as the market story): employment, CPI, PPI, GDP, PCE, retail.
MACRO_RELEASES = "50,10,46,53,54,9"
NEW_YORK = ZoneInfo("America/New_York")
SESSION = ((9, 30), (16, 0))

Reader = Callable[[str], object]    # GET <path> on GaleCore's API -> parsed JSON (raises on failure)


class SupervisorError(Exception):
    """GaleCore could not be read: the pass did not happen (never reported as «nothing to report»)."""


CALENDAR_TIMEOUT_S = 120.0      # GaleCore asks FRED on a cold cache (observed > 20 s on 06/10); later calls are cached.
                                # Also quotes and a GEX for a rule (P1-01b): a cold GEX past this is a problem of the pass
SLOW_PATHS = ("/Data/", "/App/Gex/", "/App/Runtime/Structures")   # Structures reads the whole chain: QQQ ~31 s (WS-0028)


def api_reader(base_url: str | None = None, api_key: str | None = None, timeout: float = 20.0) -> Reader:
    import httpx

    base = (base_url or os.environ.get("GALECORE_BASE_URL", "http://localhost:7001")).rstrip("/")
    headers = {"Accept": "application/json"}
    if key := (api_key or os.environ.get("GALECORE_API_KEY")):
        headers["X-Api-Key"] = key

    def get(path: str):
        try:
            r = httpx.get(base + path, headers=headers,
                          timeout=CALENDAR_TIMEOUT_S if path.startswith(SLOW_PATHS) else timeout)
        except httpx.HTTPError as exc:
            raise SupervisorError(f"GaleCore no respondió en {base}: {type(exc).__name__}") from exc
        if r.status_code != 200:
            raise SupervisorError(f"GET {path} -> HTTP {r.status_code}")
        return r.json()

    return get


# ── store ────────────────────────────────────────────────────────


def _dir(kb: KnowledgeBase) -> Path:
    return kb.base / "supervision" / "alerts"


def alerts(kb: KnowledgeBase) -> list[Alert]:
    """Every alert, newest first. An edited one raises instead of being shown."""
    d = _dir(kb)
    out = []
    for path in sorted(d.glob("*.json")) if d.is_dir() else []:
        a = Alert.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if compute_document_hash(a.hashable_content()) != a.content_hash:
            raise KnowledgeError(f"alert {path.name}: INTEGRITY_FAILED (content_hash mismatch)")
        out.append(a)
    return sorted(out, key=lambda a: a.detected_at, reverse=True)


def load_alert(kb: KnowledgeBase, alert_id: str) -> Alert:
    found = [a for a in alerts(kb) if a.id == alert_id]
    if not found:
        raise KnowledgeError(f"no alert {alert_id}")
    return found[0]


def _write(kb: KnowledgeBase, alert: Alert) -> Path:
    d = _dir(kb)
    d.mkdir(parents=True, exist_ok=True)
    n, path = 1, d / f"{alert.id}.json"
    while path.exists():                                   # same kind and position on the same day: a new episode
        n += 1
        alert = alert.model_copy(update={"id": f"{alert.id.rsplit('~', 1)[0]}~{n}"})
        alert = alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())})
        path = d / f"{alert.id}.json"
    with path.open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(alert.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    return path


# ── rules ────────────────────────────────────────────────────────


def _ts(value: str | None) -> datetime | None:
    """A GaleCore timestamp; one without offset is UTC (GaleCore stores UTC)."""
    if not value:
        return None
    t = datetime.fromisoformat(value)
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def _in_session(now: datetime) -> bool:
    # NYSE holidays are not known here: on one, a position without price may alert (declared limitation).
    et = now.astimezone(NEW_YORK)
    return et.weekday() < 5 and SESSION[0] <= (et.hour, et.minute) < SESSION[1]


def _spec(kb: KnowledgeBase, version_hash: str) -> tuple[str | None, dict]:
    """(strategy:<name>/<version>, spec) of the knowledge version whose spec GaleCore runs; (None, {}) if none."""
    for key in kb.strategies.versions():
        doc = kb.strategies.load(key)
        if doc is not None and doc.spec_hash == version_hash:
            return f"strategy:{key}", json.loads(doc.spec_json)
    return None, {}


EVENT_ALIASES = {"cpi": "consumer price index", "ppi": "producer price index", "nfp": "employment situation",
                 "pce": "personal income", "gdp": "gross domestic product", "fed": "fomc"}


def _event_matches(query: str, name: str) -> bool:
    """«CPI 14/10» finds «Consumer Price Index»: hosts write the event as the trader says it (WS-0028)."""
    name = name.lower()
    words = [w for w in query.lower().split() if not w[0].isdigit()]
    return query.lower() in name or any(EVENT_ALIASES.get(w, w) in name for w in words)


def _business_days(start: date, end: date) -> int:
    """Weekdays after ``start`` up to and including ``end`` (NYSE holidays not known)."""
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        n += d.weekday() < 5
    return n


def calendar(read: Reader, today: date) -> list[tuple[date, str]]:
    """Macro releases and FOMC decisions from today on (the window covers a 45-day position). Raises on failure."""
    end = today + timedelta(days=60)
    rel = read(f"/Data/Fred/ReleaseDates?From={today.isoformat()}&To={end.isoformat()}&ReleaseIds={MACRO_RELEASES}")
    fomc = read(f"/Data/Fed/FomcMeetings?Years={today.year},{end.year}")
    events = [(date.fromisoformat(r["date"]), r["releaseName"]) for r in (rel or {}).get("data") or []]
    events += [(date.fromisoformat(m["end"]), "Decisión del FOMC") for m in (fomc or {}).get("data") or []
               if m.get("end") and m["end"] >= today.isoformat()]
    return sorted(set(events))


def evaluate(position: dict, *, strategy: str, strategy_ref: str | None, spec: dict, now: datetime,
             events: list[tuple[date, str]] | None = None) -> list[dict]:
    """The conditions this position meets now, as alert drafts (no id or hash yet). Pure: no I/O."""
    exits = (spec.get("exits") or {}).get("deterministic") or {}
    max_loss = (spec.get("risk_limits") or {}).get("max_loss_per_trade_usd")
    pid = position.get("positionId", "")
    credit = position.get("entryCredit")
    base = {"strategy": strategy, "strategy_ref": strategy_ref, "instance_id": position.get("instanceId", ""),
            "position_id": pid}
    legs = position.get("legs") or []
    shorts = [f"{leg.get('strike'):g}" for leg in legs if leg.get("side") == "SELL" and leg.get("strike") is not None]
    longs = [f"{leg.get('strike'):g}" for leg in legs if leg.get("side") == "BUY" and leg.get("strike") is not None]
    label = f"{'/'.join(shorts + longs)} {legs[0].get('expiration', '') if legs else ''}".strip()
    if position.get("structure") == "long_equity" or any(leg.get("type") == "STOCK" for leg in legs):
        # Stocks have no strike or expiration: «BUY 10 AAPL» as GaleCore writes it, or the symbol with the shares.
        shares = next((leg.get("quantity") for leg in legs if leg.get("quantity") is not None), None)
        label = (position.get("legsText") or " ".join(str(x) for x in (shares, position.get("symbol")) if x is not None)
                 or label).strip()
    out = []
    if position.get("status") == "CLOSED":
        reason = position.get("exitReason") or "sin motivo informado"
        out.append({**base, "key": f"closed:{pid}", "kind": AlertKind.CLOSED,
                    "motivo": f"SHADOW cerró {label} por {reason}.",
                    "dato": {"exit_reason": reason, "entry_credit": credit, "exit_debit": position.get("exitDebit"),
                             "realized_pnl_usd": position.get("realizedPnl"), "dte": position.get("currentDte"),
                             "exit_at": position.get("exitAt")},
                    "regla": "Salidas de la estrategia (stop, objetivo, tiempo), ejecutadas por el runtime SHADOW",
                    "propuesta": "Revisar el resultado contra lo que se esperaba al abrir."})
        return out
    stop_pct = ((exits.get("stop_loss") or {}).get("pct_of_credit"))
    value = position.get("lastSpreadValue")
    if isinstance(credit, int | float) and credit > 0 and isinstance(value, int | float):
        loss_multiple = (value - credit) / credit
        if loss_multiple >= NEAR_STOP_MULTIPLE:
            stop = f"stop a {stop_pct / 100:g}× el crédito" if isinstance(stop_pct, int | float) else "stop sin dato"
            out.append({**base, "key": f"near_stop:{pid}", "kind": AlertKind.NEAR_STOP,
                        "motivo": f"{label}: la pérdida a mid llegó a {loss_multiple:.2f}× el crédito.",
                        "dato": {"entry_credit": credit, "spread_value": value, "loss_multiple": round(loss_multiple, 2),
                                 "unrealized_pnl_usd": position.get("unrealizedPnl"),
                                 "dte": position.get("currentDte"), "valued_at": position.get("lastValuedAt")},
                        "regla": f"Aviso a {NEAR_STOP_MULTIPLE:g}× el crédito; {stop} ({strategy_ref or 'spec sin versión'})",
                        "propuesta": "Revisar si se deja que decida el stop o se cierra antes."})
    valued_at = position.get("lastValuedAt")
    last = _ts(valued_at)
    since = last or (_ts(position["entryAt"])
                     if position.get("entryAt") else None)
    if since is not None:                     # yesterday's last valuation does not count before today's open
        et = now.astimezone(NEW_YORK)
        since = max(since, et.replace(hour=SESSION[0][0], minute=SESSION[0][1], second=0, microsecond=0))
    if _in_session(now) and since is not None and now - since > timedelta(minutes=NO_PRICE_MINUTES):
        out.append({**base, "key": f"no_price:{pid}:{valued_at or 'never'}", "kind": AlertKind.NO_PRICE,
                    "motivo": f"{label}: sin valuación desde hace {int((now - since).total_seconds() // 60)} min en sesión.",
                    "dato": {"last_valued_at": valued_at,
                             "problems": "; ".join(position.get("valuationProblems") or []) or None},
                    "regla": f"Más de {NO_PRICE_MINUTES} min sin precio en sesión: las salidas no se evalúan",
                    "propuesta": "Revisar la conexión de datos de GaleCore."})
    raw_exp = next((leg.get("expiration") for leg in legs if leg.get("expiration")), None)
    try:                                       # a strange expiration skips E4 only, never the other rules
        expiration = date.fromisoformat(str(raw_exp)[:10]) if raw_exp else None
    except ValueError:
        expiration = None
    today = now.astimezone(NEW_YORK).date()
    for day, name in events or []:
        if not expiration or not (today <= day <= expiration):
            continue
        ahead = _business_days(today, day)
        if ahead > EVENT_BUSINESS_DAYS:
            continue
        when = "hoy" if ahead == 0 else ("mañana" if ahead == 1 else f"en {ahead} días hábiles")
        out.append({**base, "key": f"event:{pid}:{day.isoformat()}:{name}", "kind": AlertKind.EVENT,
                    "motivo": f"{label}: {name} {when} ({day:%d/%m}), antes del vencimiento.",
                    "dato": {"event": name, "event_date": day.isoformat(), "business_days": ahead,
                             "dte": position.get("currentDte"), "unrealized_pnl_usd": position.get("unrealizedPnl")},
                    "regla": f"E4 de la estrategia: datos macro y FOMC antes del vencimiento, aviso a "
                             f"{EVENT_BUSINESS_DAYS} días hábiles (calendario de GaleCore; sin feriados ni balances)",
                    "propuesta": "Tener presente el dato; las salidas siguen siendo las de la regla."})
    risk = position.get("maxRisk")
    if isinstance(max_loss, int | float) and isinstance(risk, int | float) and risk > max_loss:
        out.append({**base, "key": f"risk_limit:{pid}", "kind": AlertKind.RISK_LIMIT,
                    "motivo": f"{label}: el riesgo máximo ({risk:g} USD) supera el límite por operación.",
                    "dato": {"max_risk_usd": risk, "limit_usd": max_loss},
                    "regla": f"Pérdida máxima por operación de la spec ({strategy_ref or 'spec sin versión'})",
                    "propuesta": "Revisar el tamaño o el ancho del spread."})
    return out


def bet_limits(kb: KnowledgeBase, read: Reader) -> tuple[list[dict], list[str]]:
    """WS-0023: the cap per bet each strategy declares in its design, **watched** (an alert), not executed — the runtime
    does not block by it. GaleCore groups what is open by bet and checks it (``/App/Runtime/Exposure``); here only the
    broken ones become drafts. A strategy that declares no limits is a problem of the pass, never «within the cap»."""
    from galecore_ai.application import capital
    names = sorted({k.split("/")[0] for k in kb.strategies.versions()})
    amounts = capital._simulated_amounts(kb, names, capital._running_hashes(read))
    ready = {n: a for n, a in amounts.items() if not a["limites"]["no_leidos"]}
    # A strategy that declares no limits at all has nothing to watch; one that declares some but not all is said.
    unread = [f"{n} ({', '.join(a['limites']['no_leidos'])})" for n, a in sorted(amounts.items())
              if n not in ready and a["doc"] is not None and a["doc"].content.limits is not None]
    problems = ["tope por apuesta sin verificar: la estrategia no declara en su diseño " + x for x in unread]
    if not ready:
        return [], problems
    first = min(ready)
    lim = ready[first]["limites"]
    try:
        exp = read("/App/Runtime/Exposure?" + capital._query(sum(a["monto"] for a in ready.values()), lim))
    except Exception as exc:  # noqa: BLE001 - reported, the rest of the pass stands
        return [], problems + [f"tope por apuesta sin verificar: {str(exc)[:160]}"]
    drafts = []
    for check in (exp or {}).get("checks") or []:
        if not str(check.get("limit", "")).startswith("bet:") or check.get("ok"):
            continue
        bet = check["limit"][4:]
        if not all(isinstance(check.get(k), int | float) for k in ("used", "max")):
            problems.append(f"tope por apuesta {bet}: GaleCore no dio lo usado o el tope")
            continue
        drafts.append({"strategy": "cartera", "strategy_ref": None, "instance_id": "", "position_id": bet,
                       "key": f"bet_limit:{bet}", "kind": AlertKind.BET_LIMIT,
                       "motivo": f"La apuesta SHADOW (simulada) {bet} usa {check.get('used'):g} USD frente a un tope de referencia "
                                  f"de su diseño de {check.get('max'):g}; no es exposición real.",
                       "dato": {"apuesta": bet, "usado_usd": check.get("used"), "tope_usd": check.get("max"),
                                "margen_usd": check.get("headroom")},
                       "regla": f"Tope por apuesta declarado en el diseño de {first} como referencia de la simulación: vigilado por el "
                                "supervisor; el runtime no lo bloquea",
                       "propuesta": "Revisar si se acepta la exposición o se reduce; nada se cierra solo por esto."})
    return drafts, problems


# ── the pass ─────────────────────────────────────────────────────


QUOTE = "/Data/Tastytrade/MarketData/Quote?symbol={symbol}"


def _underlying(read: Reader, symbol: str, cache: dict[str, dict], now: datetime) -> dict:
    """BL-024: the underlying's price when an alert fires, read once per symbol and pass. A quote GaleCore cannot give
    is kept as None with its reason, never filled in."""
    if symbol not in cache:
        out: dict = {"underlying_symbol": symbol, "underlying_price": None, "underlying_read_at": now.isoformat()}
        try:
            rows = (read(QUOTE.format(symbol=symbol)) or {}).get("data")
            row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}
            out["underlying_price"] = row.get("midPrice")
            if out["underlying_price"] is None:
                out["underlying_note"] = "GaleCore respondió sin cotización"
        except Exception as exc:  # noqa: BLE001 - the alert still fires; the missing price is declared
            out["underlying_note"] = f"sin cotización: {str(exc)[:100]}"
        cache[symbol] = out
    return cache[symbol]


def scan(kb: KnowledgeBase, read: Reader, now: datetime | None = None) -> dict:
    """Read GaleCore, raise the new alerts, and return {new, checked, problems}. Raises SupervisorError if unread."""
    now = now or datetime.now(UTC)
    try:
        instances = read("/App/Runtime/Instances")
    except SupervisorError:
        raise
    except Exception as exc:
        raise SupervisorError(f"GaleCore no se pudo leer: {type(exc).__name__}") from exc
    known = {a.key for a in alerts(kb)}
    new, checked, problems = [], 0, []
    quotes: dict[str, dict] = {}
    events: list[tuple[date, str]] | None = None
    if not isinstance(instances, list):
        raise SupervisorError("GaleCore devolvió instancias sin forma de lista")
    for inst in instances:
        if inst.get("mode") != "SHADOW":
            continue
        iid = inst.get("instanceId", "")
        path = f"/App/Runtime/Instances/{iid}/Positions"
        try:
            positions = read(path)
            if not isinstance(positions, list):
                raise SupervisorError("posiciones sin forma de lista")
        except Exception as exc:  # noqa: BLE001 - one instance unread is reported, the rest still checked
            problems.append(f"{inst.get('specName')}: {str(exc)[:160]}")
            continue
        strategy_ref, spec = _spec(kb, inst.get("versionHash", ""))
        for pos in positions:                # a stopped instance's open positions still exit (observed 05/10)
            checked += 1
            if events is None and pos.get("status") == "OPEN":
                try:
                    events = calendar(read, now.astimezone(NEW_YORK).date())
                except Exception as exc:  # noqa: BLE001 - without calendar the other rules still run; declared
                    events = []
                    problems.append(f"calendario: {str(exc)[:160]}")
            try:
                drafts = evaluate(pos, strategy=inst.get("specName", ""), strategy_ref=strategy_ref, spec=spec, now=now,
                                  events=events if pos.get("status") == "OPEN" else None)
            except (TypeError, ValueError, KeyError) as exc:   # a position GaleCore sent in another shape
                problems.append(f"posición {str(pos.get('positionId'))[:8]}: no se pudo leer ({str(exc)[:120]})")
                continue
            for draft in drafts:
                if draft["key"] in known:
                    continue
                if draft["kind"] == AlertKind.CLOSED and not _recent_close(pos, now):
                    known.add(draft["key"])   # closed before the supervisor existed: history, not news
                    continue
                kind = draft["kind"]
                sources = ["/App/Runtime/Instances", path]
                if kind != AlertKind.CLOSED and pos.get("symbol"):   # BL-024: how the underlying was when it fired
                    draft = {**draft, "dato": {**draft["dato"], **_underlying(read, pos["symbol"], quotes, now)}}
                    sources.append(QUOTE.format(symbol=pos["symbol"]))
                alert = Alert(id=f"{now.date().isoformat()}-{kind.value}-{draft['position_id'][:8]}",
                              detected_at=now, options=OPTIONS[kind], sources=sources, **draft)
                alert = alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())})
                _write(kb, alert)
                known.add(alert.key)
                new.append(alert)
    if events is not None:                       # something is open: the cap per bet is watched too (WS-0023)
        drafts, bet_problems = bet_limits(kb, read)
        problems.extend(bet_problems)
        for draft in drafts:
            if draft["key"] in known:
                continue
            slug = re.sub(r"[^A-Za-z0-9-]+", "-", draft["position_id"]).strip("-")
            alert = Alert(id=f"{now.date().isoformat()}-bet_limit-{slug}"[:80], detected_at=now,
                          options=OPTIONS[AlertKind.BET_LIMIT], sources=["/App/Runtime/Exposure"], **draft)
            alert = alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())})
            _write(kb, alert)
            known.add(alert.key)
            new.append(alert)
    watched = 0
    if _in_session(now):                         # P1-01b: the owner's rules, only in the regular session
        from galecore_ai.application import watch
        drafts, watch_problems, watched = watch.evaluate(kb, read, now)
        problems.extend(watch_problems)
        for alert in drafts:
            if alert.key not in known:
                _write(kb, alert)
                known.add(alert.key)
                new.append(alert)
    return {"at": now.isoformat(), "new": [a.id for a in new], "checked": checked, "watched": watched,
            "problems": problems}


def event_exposure(kb: KnowledgeBase, read: Reader, now: datetime | None = None, symbol: str | None = None,
                   event: str | None = None) -> dict:
    """«¿Las dejo abiertas antes de <evento>?» — the numbers, computed here (WS-0027 AC-6): per open SHADOW position,
    the loss if the rule's stop runs (stop% × credit × 100), the structural maximum ((width − credit) × 100) if it gaps
    through the stop, the mark-to-market now, and the next calendar event before its expiration. No proposal: the host
    reasons over these and the rules, citing the figures as given."""
    now = now or datetime.now(UTC)
    today = now.astimezone(NEW_YORK).date()
    events = calendar(read, today)
    instances = read("/App/Runtime/Instances")
    if not isinstance(instances, list):
        raise SupervisorError("GaleCore devolvió instancias sin forma de lista")
    rows, missing = [], []
    for inst in instances:
        if inst.get("mode") != "SHADOW":
            continue
        try:
            positions = read(f"/App/Runtime/Instances/{inst.get('instanceId', '')}/Positions")
        except Exception as exc:  # noqa: BLE001 - one instance unread is declared, the rest still counted
            missing.append(f"{inst.get('specName')}: posiciones sin leer ({str(exc)[:100]})")
            continue
        strategy_ref, spec = _spec(kb, inst.get("versionHash", ""))
        exits = (spec.get("exits") or {}).get("deterministic") or {}
        stop_pct = (exits.get("stop_loss") or {}).get("pct_of_credit")
        target_pct = (exits.get("take_profit") or {}).get("pct_of_credit")
        for pos in positions if isinstance(positions, list) else []:
            if pos.get("status") != "OPEN" or (symbol and pos.get("symbol") != symbol.upper()):
                continue
            credit, risk = pos.get("entryCredit"), pos.get("maxRisk")
            raw_exp = next((leg.get("expiration") for leg in pos.get("legs") or [] if leg.get("expiration")), None)
            try:
                expiration = date.fromisoformat(str(raw_exp)[:10]) if raw_exp else None
            except ValueError:
                expiration = None
            nxt = next(((d, n) for d, n in events if today <= d and (expiration is None or d <= expiration)
                        and (not event or _event_matches(event, n))), None)
            stop_loss = round(stop_pct / 100 * credit * 100, 2) if isinstance(stop_pct, int | float) and \
                isinstance(credit, int | float) else None
            if stop_loss is None:
                missing.append(f"{pos.get('symbol')} {str(pos.get('positionId'))[:8]}: sin stop o crédito en la spec")
            rows.append({"scope": "SHADOW", "position_id": pos.get("positionId"), "strategy": inst.get("specName"),
                         "strategy_ref": strategy_ref, "symbol": pos.get("symbol"),
                         "structure": pos.get("structure"), "expiration": raw_exp,
                         "short_strikes": sorted(leg["strike"] for leg in pos.get("legs") or []
                                                 if leg.get("side") == "SELL" and isinstance(leg.get("strike"), int | float)), "dte": pos.get("currentDte"),
                         "entry_credit": credit, "max_risk_usd": risk, "stop_loss_usd": stop_loss,
                         "stop_rule": f"stop a {stop_pct / 100:g}× el crédito" if isinstance(stop_pct, int | float) else None,
                         "take_profit_pct": target_pct, "unrealized_pnl_usd": pos.get("unrealizedPnl"),
                         "valued_at": pos.get("lastValuedAt"),
                         "event": {"name": nxt[1], "date": nxt[0].isoformat(),
                                   "business_days": _business_days(today, nxt[0])} if nxt else None})
    num = [r for r in rows if isinstance(r["max_risk_usd"], int | float)]
    stops = [r["stop_loss_usd"] for r in rows if r["stop_loss_usd"] is not None]
    return {"at": now.isoformat(), "positions": rows, "count": len(rows),
            "totals": {"if_stops_run_usd": round(sum(stops), 2) if len(stops) == len(rows) else None,
                       "if_gap_through_stops_usd": round(sum(r["max_risk_usd"] for r in num), 2)
                       if len(num) == len(rows) else None,
                       "unrealized_pnl_usd": round(sum(r["unrealized_pnl_usd"] or 0 for r in rows), 2)},
            "missing": missing + ([] if rows else ["no hay posiciones abiertas que cumplan el filtro"]),
            "note": "El stop limita la pérdida sólo si ejecuta al precio de la regla; un gap lo atraviesa y el peor caso "
                    "es el riesgo máximo estructural. Ambos montos son SHADOW (simulación), no cuenta real."}


CLOSED_NEWS_DAYS = 3        # a close older than this when first seen is history, not news (first pass, downtime)


def _recent_close(position: dict, now: datetime) -> bool:
    exit_at = position.get("exitAt")
    return bool(exit_at) and _ts(exit_at) >= now - timedelta(days=CLOSED_NEWS_DAYS)


# ── the owner's answer ───────────────────────────────────────────


def decisions(kb: KnowledgeBase) -> dict[str, dict]:
    """alert id -> the decision that answered it (from every project's log)."""
    out = {}
    names = sorted({k.split("/")[0] for k in kb.strategies.versions()}) + [PORTFOLIO]
    for name in names:
        log = project.load_log(kb, name)       # a damaged log raises: its alerts must not look unanswered
        for e in log.entries:
            if e.context is not None:
                out[e.context.alert] = {"project": name, "at": e.at.isoformat(), "choice": e.context.choice,
                                        "words": e.words, "expected": e.context.expected,
                                        "review_by": e.context.review_by.isoformat() if e.context.review_by else None,
                                        "hash": e.hash[:19]}
    return out


def decide(*, kb: KnowledgeBase, alert_id: str, choice: str, words: str, prompt: str, expected: str = "",
           review_by: date | None = None, source: str = "session", host_model: str | None = None,
           now: datetime | None = None) -> dict:
    """Record the owner's answer to an alert as a decision of its strategy's project (portfolio if unknown)."""
    alert = load_alert(kb, alert_id)
    if alert_id in decisions(kb):
        raise KnowledgeError(f"alert {alert_id} already has a decision; a new one is a new entry in the project")
    if choice not in alert.options:
        raise KnowledgeError(f"choice is one of {alert.options}")
    try:
        ctx = DecisionContext(alert=alert.id, alert_hash=alert.content_hash, options=alert.options, choice=choice,
                              expected=expected, review_by=review_by, source=source)
    except ValidationError as exc:
        raise KnowledgeError("Refusing to record", [e["msg"] for e in exc.errors()]) from exc
    name = alert.strategy_ref.removeprefix("strategy:").split("/")[0] if alert.strategy_ref else PORTFOLIO
    refs = [alert.strategy_ref] if alert.strategy_ref else []
    entry, path = project.add(kb=kb, name=name, kind="decision", words=words or choice, prompt=prompt, refs=refs,
                              host_model=host_model, now=now, context=ctx)
    return {"project": name, "hash": entry.hash, "path": str(path)}


# How the monitor reads an alert in one second (WS-0036): a category with its color, a plain title and one detail
# line. The stored alert is not touched; this is only presentation.
EVENT_NAMES = {
    "consumer price index": "Inflación de EE. UU. (CPI)",
    "producer price index": "Precios mayoristas de EE. UU. (PPI)",
    "advance monthly sales for retail and food services": "Ventas minoristas de EE. UU.",
    "employment situation": "Empleo de EE. UU. (nóminas)",
    "gross domestic product": "PIB de EE. UU.",
    "personal income and outlays": "Ingreso y gasto personal de EE. UU. (PCE)",
    "decisión del fomc": "Decisión de tasas de la Fed (FOMC)",
}
EXIT_REASONS = {"TAKE_PROFIT": "toma de ganancia", "STOP_LOSS": "stop", "TIME_EXIT": "salida por tiempo",
                "EXPIRED": "vencimiento", "MANUAL": "cierre manual"}
CATEGORY = {AlertKind.EVENT: "eeuu", AlertKind.WATCH: "mercado"}      # the rest are about a SHADOW strategy
_LABEL = re.compile(r"(?P<strikes>\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)*) (?P<exp>\d{4}-\d{2}-\d{2})")
_WEEKDAYS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")


def _position_label(a: Alert) -> str:
    """«TLT 77/75 · vence 20/11» instead of «77/75 2026-11-20»."""
    prefix = a.strategy.split("_")[0]
    symbol = str(a.dato.get("underlying_symbol") or (prefix if len(prefix) <= 5 else "")).upper()
    m = _LABEL.search(a.motivo)
    if not m:
        return symbol
    exp = date.fromisoformat(m["exp"])
    return f"{symbol} {m['strikes']} · vence {exp:%d/%m}".strip()


def _day(iso: str, today: date) -> str:
    d = date.fromisoformat(iso)
    return "hoy" if d == today else "mañana" if d == today + timedelta(days=1) else f"el {_WEEKDAYS[d.weekday()]} {d:%d/%m}"


def _money(v) -> str:
    return f"{'+' if v >= 0 else '−'}${abs(v):,.0f}" if isinstance(v, int | float) else ""


def _readable(a: Alert, today: date) -> tuple[str, str]:
    """(title, detail) in plain words."""
    label, d = _position_label(a), a.dato
    if a.kind == AlertKind.CLOSED:
        reason = EXIT_REASONS.get(str(d.get("exit_reason")), str(d.get("exit_reason") or "sin motivo").lower())
        pnl = _money(d.get("realized_pnl_usd"))
        return f"{label}: SHADOW la cerró por {reason}" + (f", {pnl}" if pnl else ""), "Revisá el resultado contra lo que esperabas al abrir."
    if a.kind == AlertKind.NEAR_STOP:
        return f"{label}: la pérdida llegó a {d.get('loss_multiple')}× el crédito", a.propuesta
    if a.kind == AlertKind.RISK_LIMIT:
        return f"{label}: riesgo máximo ${d.get('max_risk_usd'):g} sobre el límite de ${d.get('limit_usd'):g}", a.propuesta
    if a.kind == AlertKind.WATCH and d.get("metric") == "price" and isinstance(d.get("value"), int | float):
        below = d.get("condition") == "below"
        return (f"{d.get('symbol')} {'bajó a' if below else 'subió a'} {d['value']:,.2f}",
                f"Pediste aviso {'por debajo' if below else 'por encima'} de {d.get('threshold'):g}. {a.propuesta}")
    if a.kind == AlertKind.BET_LIMIT and isinstance(d.get("usado_usd"), int | float):
        sym, direction, week = (str(d.get("apuesta") or "").split(" ") + ["", "", ""])[:3]
        side = {"bullish": "alcista", "bearish": "bajista"}.get(direction, direction)
        title = (f"Apuesta {sym} {side}{f', semana {week[-2:]}' if week else ''}: ${d['usado_usd']:,.0f} en riesgo, "
                 f"tope ${d.get('tope_usd'):,.0f}")
        return title, a.propuesta
    return a.motivo, a.propuesta


def view(kb: KnowledgeBase, limit: int = 20, today: date | None = None, today_only: bool = False) -> list[dict]:
    """The latest alerts with their decision, newest first: what the monitor shows.

    A macro release is one line however many positions it touches (it used to be one per position and per day:
    «mañana» and then «hoy» for each one), and the positions without a price on one day are one line too.
    """
    today = today or datetime.now(NEW_YORK).date()
    answered = decisions(kb)
    out: list[dict] = []
    groups: dict[tuple, dict] = {}
    for a in alerts(kb):
        if today_only and a.kind != AlertKind.EVENT and a.detected_at.astimezone(NEW_YORK).date() != today:
            continue                                  # the monitor shows today's alerts only (owner 15/10); a release
                                                      # counts by its own date, so all its positions stay in its line
        group = (("event", a.dato.get("event"), a.dato.get("event_date")) if a.kind == AlertKind.EVENT
                 else ("no_price", a.detected_at.date()) if a.kind == AlertKind.NO_PRICE else None)
        if a.kind == AlertKind.EVENT and str(a.dato.get("event_date") or "9999") < today.isoformat():
            continue                                  # the release already happened: history, not news
        label = _position_label(a)
        if group and group in groups:
            shown = groups[group]
            if label not in shown["positions"]:
                shown["positions"].append(label)
            continue
        if len(out) >= limit:
            continue
        title, detail = _readable(a, today)
        item = {"id": a.id, "kind": a.kind.value, "category": CATEGORY.get(a.kind, "estrategia"),
                "strategy": a.strategy, "strategy_ref": a.strategy_ref, "position_id": a.position_id,
                "detected_at": a.detected_at.isoformat(), "title": title, "detail": detail,
                "motivo": a.motivo, "dato": a.dato, "regla": a.regla,
                "propuesta": a.propuesta, "options": a.options, "needs_decision": a.kind in NEEDS_DECISION,
                "decision": answered.get(a.id), "positions": [label]}
        if group:
            groups[group] = item
        out.append(item)
    for item in groups.values():
        n = len(item["positions"])
        if n > 3:                                     # «TLT 4, IWM 5» reads faster than nine strikes
            symbols = [p.split(" ")[0] if "/" not in p.split(" ")[0] else "otra" for p in item["positions"]]
            positions = ", ".join(f"{s} {symbols.count(s)}" for s in dict.fromkeys(symbols))
        else:
            positions = ", ".join(item["positions"])
        word = "posiciones" if n > 1 else "posición"
        if item["kind"] == AlertKind.EVENT.value:
            name = str(item["dato"].get("event") or "")
            item["title"] = (f"{EVENT_NAMES.get(name.lower(), name)} {_day(str(item['dato'].get('event_date')), today)}"
                             f" · {n} {word} de SHADOW {'vencen' if n > 1 else 'vence'} después")
            item["detail"] = (f"Antes del vencimiento de {n} {word} de SHADOW ({positions}). "
                              "Las salidas siguen siendo las de la regla.")
        else:
            item["title"] = f"Sin precio para {n} {word} de SHADOW en sesión ({positions})"
            item["detail"] = (f"{positions}. Mientras no haya precio, las salidas no se evalúan; "
                              "suele ser la conexión de datos de GaleCore.")
    return out
