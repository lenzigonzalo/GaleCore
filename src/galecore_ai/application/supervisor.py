"""Supervisor of what is open in SHADOW (WS-0007, P1-01): watch the rules that exist, alert, keep the decision.

«Avisame si una posición se complica» — and keep what I decided, with its context, so it can be reviewed later.

Deterministic, no model call. Each pass reads GaleCore's runtime (instances and their positions) through the API,
compares every position with rules that already exist — the strategy's exits (from the spec whose hash GaleCore
runs), the strategy's max loss per trade, and that the position can be priced — and writes one alert per new
condition. An alert is raised once per condition (its ``key``); the monitor shows it with a sound and the owner
answers with one of its options. The answer is a ``decision`` entry of the strategy's project, carrying the alert,
the options, the choice, what the owner expects and when to review it. Nothing here opens, closes or changes a
position: in SHADOW the runtime's exits are mechanical and a decision only records what the owner thinks.

Out of scope here (owner 05/10): management proposals beyond the rule (after P1-02) and thesis invalidations (after
P1-05/06). A failed read of GaleCore is reported as such, never as «nothing to report».
"""

from __future__ import annotations

import json
import os
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


def api_reader(base_url: str | None = None, api_key: str | None = None, timeout: float = 20.0) -> Reader:
    import httpx

    base = (base_url or os.environ.get("GALECORE_BASE_URL", "http://localhost:7001")).rstrip("/")
    headers = {"Accept": "application/json"}
    if key := (api_key or os.environ.get("GALECORE_API_KEY")):
        headers["X-Api-Key"] = key

    def get(path: str):
        try:
            r = httpx.get(base + path, headers=headers,
                          timeout=CALENDAR_TIMEOUT_S if path.startswith(("/Data/", "/App/Gex/")) else timeout)
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


# ── the pass ─────────────────────────────────────────────────────


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
                alert = Alert(id=f"{now.date().isoformat()}-{kind.value}-{draft['position_id'][:8]}",
                              detected_at=now, options=OPTIONS[kind],
                              sources=["/App/Runtime/Instances", path], **draft)
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


def view(kb: KnowledgeBase, limit: int = 20) -> list[dict]:
    """The latest alerts with their decision, newest first: what the monitor shows."""
    answered = decisions(kb)
    out = []
    for a in alerts(kb)[:limit]:
        out.append({"id": a.id, "kind": a.kind.value, "strategy": a.strategy, "strategy_ref": a.strategy_ref,
                    "position_id": a.position_id,
                    "detected_at": a.detected_at.isoformat(), "motivo": a.motivo, "dato": a.dato, "regla": a.regla,
                    "propuesta": a.propuesta, "options": a.options, "needs_decision": a.kind in NEEDS_DECISION,
                    "decision": answered.get(a.id)})
    return out
