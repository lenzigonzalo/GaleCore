"""Rules the owner asks for (P1-01b, U-69): «avisame si SPY baja a 760».

The host turns the request into a rule with ``add`` and stops there: it never watches. The supervisor's pass (code,
every 5 minutes) calls ``evaluate`` with the same GaleCore reader it uses for SHADOW; each active rule reads one number
from GaleCore and, when the condition holds, raises a WATCH alert once (key ``watch:<rule id>``). The alert is the
rule's end: to keep watching, the owner asks for a new rule.

Rules are evaluated only in the regular session (pre-market quotes are thin; the GEX levels move with the session).
A number GaleCore cannot give (no quote, NaN, a timeout) is reported as a problem of the pass, never as «not met».
"""

from __future__ import annotations

import contextlib
import json
import math
import re
from datetime import UTC, date, datetime, time
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.application import project
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.strategy import compute_document_hash
from galecore_ai.contracts.supervision import (
    METRIC_LABELS,
    OPTIONS,
    REMINDERS,
    Alert,
    AlertKind,
    WatchCancel,
    WatchCondition,
    WatchMetric,
    WatchRule,
)

SYMBOL = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")

# Where each metric comes from: (path, how to take the number out of the payload).
QUOTE = "/Data/Tastytrade/MarketData/Quote?symbol={symbol}"
GEX = "/App/Gex/Analysis?symbol={symbol}"
IV_RANK = "/App.Analytics/IVRank?symbol={symbol}"
SOURCES: dict[WatchMetric, str] = {
    WatchMetric.PRICE: QUOTE, WatchMetric.GAMMA_ZERO: GEX, WatchMetric.CALL_WALL: GEX, WatchMetric.PUT_WALL: GEX,
    WatchMetric.IV_RANK: IV_RANK,
}
POSITIONS = "/App/Runtime/Instances/{instance}/Positions"
EVALUATIONS = "/App/Runtime/Instances/{instance}/Evaluations?limit=20"   # newest 20, oldest first; a pass is 5 min
EVENTS = ("/App/Runtime/Instances/{instance}/Events?limit=100&types=POSITION_OPENED,GATES_NOT_PASSED,CANDIDATE_NOT_VIABLE,"
          "ENTRY_SKIPPED,RISK_CHECK_FAILED,ENTRY_ABORTED,METRICS_NO_DATA")   # what the runtime did after an evaluation
INSTANCES = "/App/Runtime/Instances"
TIMED = 99_999_999       # a DATE threshold above YYYYMMDD carries a time (YYYYMMDDHHMM)
GEX_FIELDS = {WatchMetric.GAMMA_ZERO: "gammaZeroLevel", WatchMetric.CALL_WALL: "callWall",
              WatchMetric.PUT_WALL: "putWall"}


def _dir(kb: KnowledgeBase) -> Path:
    return kb.base / "supervision" / "rules"


def _number(value) -> float | None:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else x


def read_metric(payload, metric: WatchMetric) -> float | None:
    """The number of ``metric`` in a GaleCore payload, or None when it is not there (NaN or another shape count as
    absent: a payload GaleCore sends in another shape is a problem of the pass, never a crash of the supervisor)."""
    def get(obj, key):
        return obj.get(key) if isinstance(obj, dict) else None

    if metric == WatchMetric.PRICE:
        rows = get(payload, "data")
        return _number(get(rows[0], "midPrice")) if isinstance(rows, list) and rows else None
    if metric == WatchMetric.IV_RANK:
        return _number(get(payload, "ivRank"))
    return _number(get(get(get(payload, "gex"), "global"), GEX_FIELDS[metric]))


# ── store ────────────────────────────────────────────────────────


def _fmt(x: float) -> str:
    return f"{x:g}"


def _fmt_ar(x: float) -> str:
    """es-AR for what the owner reads (the monitor shows ``describe`` verbatim): 1.188 · 222,29 · 760."""
    text = f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return text.removesuffix(",00") if text.endswith(",00") else text.rstrip("0") if "," in text else text


def add(kb: KnowledgeBase, *, symbol: str, metric: str, condition: str, threshold: float, words: str, prompt: str,
        until: datetime | None = None, host_model: str | None = None, now: datetime | None = None,
        thesis: str = "", strategies: list[str] | None = None) -> WatchRule:
    """Store a rule. Refuses an unknown symbol shape, metric or condition, and an empty request.

    With ``thesis`` (U-65) the rule is the observable condition that invalidates it: it names the strategies that
    depend on it, each of which gets the condition in its project (kind thesis), and the alert says which. The project
    entries follow the rule's write: if one fails, the rule stays stored and the error says so."""
    now = now or datetime.now(UTC)
    if metric in {m.value for m in REMINDERS}:
        raise KnowledgeError(f"{metric} is a reminder: use `supervise remind`")
    symbol = symbol.strip().upper()
    if not SYMBOL.match(symbol):
        raise KnowledgeError(f"symbol {symbol!r}: a ticker such as SPY")
    if not math.isfinite(threshold):
        raise KnowledgeError("the level is a finite number")
    if not words.strip() or not prompt.strip():
        raise KnowledgeError("a rule keeps the owner's words and request (--text, --prompt)")
    strategies = sorted(set(strategies or []))
    if bool(thesis.strip()) != bool(strategies):
        raise KnowledgeError("a thesis invalidation names the thesis (--thesis) and the strategies that depend on it "
                             "(--strategy)")
    known = {k.split("/")[0] for k in kb.strategies.versions()}
    if unknown := [x for x in strategies if x not in known]:
        raise KnowledgeError(f"no strategy named {unknown} in the knowledge base")
    if until is not None and until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    if until is not None and until <= now:
        raise KnowledgeError("--until is in the past")
    try:
        rule = WatchRule(id=f"{now.date().isoformat()}-{symbol.lower()}-{metric}-{condition}-{_fmt(threshold)}",
                         created_at=now, symbol=symbol, metric=WatchMetric(metric), condition=WatchCondition(condition),
                         threshold=threshold, words=words, prompt=prompt, until=until, host_model=host_model,
                         thesis=thesis.strip(), strategies=strategies)
    except (ValueError, ValidationError) as exc:
        raise KnowledgeError(f"Refusing to store the rule: {str(exc)[:200]}") from exc
    rule = _store(kb, rule, now)
    if rule.thesis:
        for name in rule.strategies:
            project.add(kb=kb, name=name, kind="thesis", prompt=prompt, host_model=host_model, now=now,
                        words=f"Deja de servir «{rule.thesis}» si {describe(rule)} (lo vigila el supervisor: regla "
                              f"{rule.id}). Pedido: «{words}»")
    return rule


def _store(kb: KnowledgeBase, rule: WatchRule, now: datetime) -> WatchRule:
    same = (rule.symbol, rule.metric, rule.condition, rule.threshold, rule.instance_id)
    if dup := next((r for r in rules(kb) if (r.symbol, r.metric, r.condition, r.threshold, r.instance_id) == same
                    and status(kb, r, now) == "active"), None):
        raise KnowledgeError(f"the same rule is already active: {dup.id}")
    d = _dir(kb)
    d.mkdir(parents=True, exist_ok=True)
    n, path = 1, d / f"{rule.id}.json"
    while path.exists():
        n += 1
        rule = rule.model_copy(update={"id": f"{rule.id.rsplit('~', 1)[0]}~{n}"})
        path = d / f"{rule.id}.json"
    rule = rule.model_copy(update={"content_hash": compute_document_hash(rule.hashable_content())})
    with path.open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rule.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    return rule


def rules(kb: KnowledgeBase) -> list[WatchRule]:
    """Every rule, newest first. An edited one raises instead of being watched."""
    d = _dir(kb)
    out = []
    for path in sorted(d.glob("*.json")) if d.is_dir() else []:
        if path.name.endswith(".cancelled.json"):
            continue
        r = WatchRule.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if compute_document_hash(r.hashable_content()) != r.content_hash:
            raise KnowledgeError(f"rule {path.name}: INTEGRITY_FAILED (content_hash mismatch)")
        out.append(r)
    return sorted(out, key=lambda r: r.created_at, reverse=True)


def _cancel_path(kb: KnowledgeBase, rule_id: str) -> Path:
    return _dir(kb) / f"{rule_id}.cancelled.json"


def _met(kb: KnowledgeBase) -> dict[str, str]:
    from galecore_ai.application import supervisor
    return {a.key.removeprefix("watch:"): a.id for a in supervisor.alerts(kb) if a.kind == AlertKind.WATCH}


def status(kb: KnowledgeBase, rule: WatchRule, now: datetime | None = None, met: dict[str, str] | None = None) -> str:
    """active · met · cancelled · expired."""
    if _cancel_path(kb, rule.id).exists():
        return "cancelled"
    if rule.id in (met if met is not None else _met(kb)):
        return "met"
    if rule.until is not None and (now or datetime.now(UTC)) > rule.until:
        return "expired"
    return "active"


def cancel(kb: KnowledgeBase, rule_id: str, *, words: str, prompt: str, now: datetime | None = None) -> WatchCancel:
    found = [r for r in rules(kb) if r.id == rule_id]
    if not found:
        raise KnowledgeError(f"no rule {rule_id}")
    if (st := status(kb, found[0], now)) != "active":
        raise KnowledgeError(f"rule {rule_id} is {st}; only an active rule is cancelled")
    mark = WatchCancel(rule=rule_id, rule_hash=found[0].content_hash, at=now or datetime.now(UTC),
                       words=words or "cancelar", prompt=prompt)
    with _cancel_path(kb, rule_id).open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(mark.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    return mark


def remind(kb: KnowledgeBase, *, words: str, prompt: str, on: date | None = None, at: time | None = None,
           instance_id: str = "", on_evaluation: bool = False, decision: str = "", host_model: str | None = None,
           now: datetime | None = None) -> WatchRule:
    """WS-0023: a decision's «revisar el <fecha>» or «reanudar cuando cierren» kept as a rule the supervisor checks,
    so it does not depend on someone remembering a project's `pending`. Exactly one of ``on`` (a date, New York; with
    ``at`` a time that day, New York, which may be today if still ahead), ``instance_id`` alone (alerts when that
    instance has no open position) or ``instance_id`` with ``on_evaluation`` (alerts at each new evaluation of that
    instance, WS-0064). All but the last alert once."""
    from galecore_ai.application.supervisor import NEW_YORK
    now = now or datetime.now(UTC)
    if (on is None) == (not instance_id.strip()) or (on_evaluation and on is not None) or             (on_evaluation and not instance_id.strip()):
        raise KnowledgeError("a reminder is either a date (--on [--at]), an instance whose positions close (--when-closed) "
                             "or an instance's evaluations (--on-evaluation --instance)")
    if at is not None and on is None:
        raise KnowledgeError("--at goes with --on (a date)")
    if not words.strip() or not prompt.strip():
        raise KnowledgeError("a reminder keeps the owner's words and request (--text, --prompt)")
    if on is not None and at is not None:
        stamp = f"{on:%Y%m%d}{at:%H%M}"
        if stamp <= now.astimezone(NEW_YORK).strftime("%Y%m%d%H%M"):
            raise KnowledgeError("--on/--at is in the past (New York time)")
        metric, condition, threshold, tag = WatchMetric.DATE, WatchCondition.ABOVE, float(stamp), "hora"
    elif on is not None:
        if on <= now.astimezone(NEW_YORK).date():
            raise KnowledgeError("--on is today or in the past")
        metric, condition, threshold, tag = WatchMetric.DATE, WatchCondition.ABOVE, float(on.strftime("%Y%m%d")), "fecha"
    elif on_evaluation:
        metric, condition, threshold, tag = WatchMetric.EVALUATION, WatchCondition.ABOVE, 0.0, f"eval-{instance_id.strip()[:8]}"
    else:
        metric, condition, threshold, tag = WatchMetric.OPEN_POSITIONS, WatchCondition.BELOW, 0.0, instance_id[:8]
    rule = WatchRule(id=f"{now.date().isoformat()}-recordatorio-{tag}-{int(threshold)}", created_at=now, symbol="",
                     metric=metric, condition=condition, threshold=threshold, words=words, prompt=prompt,
                     host_model=host_model, instance_id=instance_id.strip(), decision=decision.strip())
    return _store(kb, rule, now)


def view(kb: KnowledgeBase, now: datetime | None = None) -> list[dict]:
    met = _met(kb)
    return [{"id": r.id, "status": status(kb, r, now, met), "symbol": r.symbol, "metric": r.metric.value,
             "condition": r.condition.value, "threshold": r.threshold, "words": r.words,
             "created_at": r.created_at.isoformat(), "until": r.until.isoformat() if r.until else None,
             "alert": met.get(r.id)} for r in rules(kb)]


# ── the pass ─────────────────────────────────────────────────────


def describe(rule: WatchRule, names: dict[str, str] | None = None) -> str:
    """The rule in the owner's words; ``names`` (instance id -> strategy name) puts the strategy instead of the id."""
    name = (names or {}).get(rule.instance_id)
    if rule.metric == WatchMetric.DATE:
        t = int(rule.threshold)
        if t > TIMED:
            return f"el {date(t // 100000000, t // 1000000 % 100, t // 10000 % 100):%d/%m/%Y} a las {t // 100 % 100:02d}:{t % 100:02d} NY"
        return f"fecha ≥ {date(t // 10000, t // 100 % 100, t % 100):%d/%m/%Y}"
    if rule.metric == WatchMetric.EVALUATION:
        return f"cada evaluación de {name}" if name else f"cada evaluación de la instancia {rule.instance_id[:8]}"
    if rule.metric == WatchMetric.OPEN_POSITIONS:
        return (f"sin posiciones abiertas en {name}" if name
                else f"sin posiciones abiertas en la instancia {rule.instance_id[:8]}")
    sign = "≤" if rule.condition == WatchCondition.BELOW else "≥"
    return f"{METRIC_LABELS[rule.metric]} de {rule.symbol} {sign} {_fmt_ar(rule.threshold)}"


def _reminder_alert(rule: WatchRule, now: datetime, path: str) -> Alert:
    alert = Alert(id=f"{now.date().isoformat()}-watch-{rule.id.split('-', 3)[-1]}"[:80],
                  key=f"watch:{rule.id}", kind=AlertKind.WATCH, strategy="Recordatorio", strategy_ref=None,
                  instance_id=rule.instance_id, position_id=rule.id, detected_at=now,
                  motivo=f"Se cumplió: {describe(rule)}." + (f" Decisión: {rule.decision}" if rule.decision else ""),
                  dato={"metric": rule.metric.value, "threshold": rule.threshold, "instance": rule.instance_id or None},
                  regla=f"Recordatorio pedido por el owner: «{rule.words}» ({rule.created_at:%d/%m})",
                  propuesta="Revisá la decisión con lo que pasó; reanudar o cambiar algo lo decidís vos.",
                  options=OPTIONS[AlertKind.WATCH], sources=[path.split("?")[0]])
    return alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())})


def _when(value) -> datetime | None:
    try:
        t = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def _entry_text(positions, at: datetime) -> str:
    """What the instance opened at/after an evaluation, from the fields GaleCore's Positions give (legs, entry credit or
    debit; Positions carries no costs of its own); empty when it opened nothing."""
    opened = [p for p in positions if isinstance(p, dict) and (_when(p.get("entryAt")) or datetime.min.replace(tzinfo=UTC)) >= at]
    if not opened:
        return ""
    p = opened[0]
    legs = p.get("legs") or []
    strikes = "/".join(f"{leg['strike']:g}" for leg in legs if leg.get("side") == "SELL" and leg.get("strike")) +         ("/" + "/".join(f"{leg['strike']:g}" for leg in legs if leg.get("side") == "BUY" and leg.get("strike"))
         if any(leg.get("side") == "BUY" and leg.get("strike") for leg in legs) else "")
    what = p.get("legsText") or " ".join(x for x in (strikes.strip("/"), str((legs[0] or {}).get("expiration") or "")[:10])
                                         if x)
    amount = p.get("entryAmount")
    credit = p.get("entryCredit")
    money = (f"{'crédito' if p.get('entryKind') == 'credit' else 'débito'} {_fmt(amount)}" if amount is not None else
             f"crédito {_fmt(credit)}" if isinstance(credit, int | float) else "")
    return " " + ", ".join(x for x in (what, money) if x) + "." if what or money else ""


def _evaluation_alerts(rule: WatchRule, read, cache: dict, names: dict[str, str], known: set[str],
                       now: datetime, problems: list[str]) -> list[Alert]:
    """One alert per evaluation of the rule's instance newer than the rule (WS-0064). The rule stays active."""
    path = EVALUATIONS.format(instance=rule.instance_id)
    for p in (INSTANCES, path):
        if p not in cache:
            try:
                cache[p] = read(p)
            except Exception as exc:  # noqa: BLE001 - reported; the other rules still run
                cache[p] = exc
    if isinstance(cache[path], Exception):
        problems.append(f"regla {rule.id}: {str(cache[path])[:160]}")
        return []
    payload = cache[path].get("items") if isinstance(cache[path], dict) else cache[path]
    if not isinstance(payload, list):
        problems.append(f"regla {rule.id}: GaleCore no dio las evaluaciones de {rule.instance_id[:8]}")
        return []
    if not names and isinstance(cache[INSTANCES], list):
        names.update({i.get("instanceId"): i.get("specName") or "" for i in cache[INSTANCES] if isinstance(i, dict)})
    name = names.get(rule.instance_id) or f"instancia {rule.instance_id[:8]}"
    out = []
    for ev in payload:
        at = _when(ev.get("evaluatedAt")) if isinstance(ev, dict) else None
        key = f"watch-eval:{rule.id}:{(ev or {}).get('evaluationId')}" if isinstance(ev, dict) else ""
        if at is None or at <= rule.created_at or not ev.get("evaluationId") or key in known:
            continue
        passed = bool(ev.get("overallPass"))
        sources = [path.split("?")[0]]
        if passed:
            entry, pos_path, ev_path, opened, dropped = "", POSITIONS.format(instance=rule.instance_id),                 EVENTS.format(instance=rule.instance_id), False, ""
            with contextlib.suppress(Exception):     # the evaluation is still reported, without the entry
                if pos_path not in cache:
                    cache[pos_path] = read(pos_path)
                entry = _entry_text(cache[pos_path], at)
                sources.append(pos_path)
            with contextlib.suppress(Exception):     # gates PASS is not an entry: the runtime may drop the candidate
                if ev_path not in cache:
                    cache[ev_path] = read(ev_path)
                same = [e for e in cache[ev_path] if isinstance(e, dict) and _when(e.get("timestamp")) == at]
                opened = any(e.get("eventType") == "POSITION_OPENED" for e in same)
                drop = next((e for e in same if e.get("eventType") != "POSITION_OPENED"), None)
                pl = (drop or {}).get("payload") or {}
                dropped = str(pl.get("reason") or "; ".join(map(str, pl.get("errors") or [])) or (drop or {}).get("eventType") or "")
                sources.append(ev_path.split("?")[0])
            motivo = (f"{name} evaluó y entró." + entry if entry or opened else
                      f"{name} evaluó y no entró: {dropped.rstrip('.')}." if dropped else
                      f"{name} evaluó: pasó los filtros; GaleCore no muestra entrada.")
        else:
            gate = next((g for g in ev.get("gateResults") or [] if isinstance(g, dict) and g.get("status") != "PASS"), None)
            why = (f": {gate.get('label') or gate.get('gateId')} {_fmt(gate['value'])} vs {_fmt(gate['threshold'])}"
                   if gate and isinstance(gate.get("value"), int | float) and isinstance(gate.get("threshold"), int | float)
                   else f": {gate.get('label') or gate.get('gateId')}" if gate else "")
            motivo = f"{name} evaluó y no entró{why}."
        alert = Alert(id=f"{now.date().isoformat()}-watch-eval-{rule.instance_id[:8]}-{ev['evaluationId'][:8]}"[:80],
                      key=key, kind=AlertKind.WATCH, strategy=name, strategy_ref=None, instance_id=rule.instance_id,
                      position_id=rule.id, detected_at=now, motivo=motivo,
                      dato={"evaluation_id": ev["evaluationId"], "evaluated_at": ev.get("evaluatedAt"),
                            "passed": "sí" if passed else "no", "symbol": ev.get("symbol")},
                      regla=f"Pedido del owner: «{rule.words}» ({rule.created_at:%d/%m})",
                      propuesta="Es informativo; la estrategia sigue su regla.",
                      options=OPTIONS[AlertKind.WATCH], sources=sources)
        out.append(alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())}))
    return out


def evaluate(kb: KnowledgeBase, read, now: datetime) -> tuple[list[Alert], list[str], int]:
    """Check every active rule once. Returns (alerts to write, problems, rules checked). One read per source."""
    met = _met(kb)
    active = [r for r in rules(kb) if status(kb, r, now, met) == "active"]
    cache: dict[str, object] = {}
    out, problems = [], []
    from galecore_ai.application import supervisor
    known = {a.key for a in supervisor.alerts(kb)}
    names: dict[str, str] = {}
    for rule in active:
        if rule.metric == WatchMetric.EVALUATION:    # fires per new evaluation, never ends (WS-0064)
            out.extend(_evaluation_alerts(rule, read, cache, names, known, now, problems))
            continue
        if rule.metric == WatchMetric.DATE:          # a reminder by date reads nothing (WS-0023)
            from galecore_ai.application.supervisor import NEW_YORK
            payload, path = None, "reloj"
        else:
            path = (POSITIONS.format(instance=rule.instance_id) if rule.metric == WatchMetric.OPEN_POSITIONS
                    else SOURCES[rule.metric].format(symbol=rule.symbol))
            if path not in cache:
                try:
                    cache[path] = read(path)
                except Exception as exc:  # noqa: BLE001 - one source unread is reported; the other rules still run
                    cache[path] = exc
            payload = cache[path]
            if isinstance(payload, Exception):
                problems.append(f"regla {rule.id}: {str(payload)[:160]}")
                continue
        if rule.metric == WatchMetric.DATE:
            value = float(now.astimezone(NEW_YORK).strftime("%Y%m%d%H%M" if rule.threshold > TIMED else "%Y%m%d"))
        elif rule.metric == WatchMetric.OPEN_POSITIONS:
            value = (float(sum(isinstance(p, dict) and p.get("status") == "OPEN" for p in payload))
                     if isinstance(payload, list) else None)
        else:
            value = read_metric(payload, rule.metric)
        if value is None:
            problems.append(f"regla {rule.id}: GaleCore no dio {METRIC_LABELS[rule.metric]} de "
                            f"{rule.symbol or rule.instance_id[:8]}")
            continue
        hit = value <= rule.threshold if rule.condition == WatchCondition.BELOW else value >= rule.threshold
        if not hit:
            continue
        if rule.metric in REMINDERS:
            out.append(_reminder_alert(rule, now, path))
            continue
        thesis = (f" Se cumple lo que invalida «{rule.thesis}»; dependen de esa tesis: {', '.join(rule.strategies)}."
                  if rule.thesis else "")
        alert = Alert(id=f"{now.date().isoformat()}-watch-{rule.id.split('-', 3)[-1]}"[:80],
                      key=f"watch:{rule.id}", kind=AlertKind.WATCH,
                      strategy=", ".join(rule.strategies) if rule.thesis else f"Alerta {rule.symbol}",
                      strategy_ref=None, instance_id="", position_id=rule.id, detected_at=now,
                      motivo=f"{describe(rule)}: ahora {_fmt(value)}.{thesis}",
                      dato={"symbol": rule.symbol, "metric": rule.metric.value, "value": value,
                            "threshold": rule.threshold, "condition": rule.condition.value},
                      regla=f"Pedido del owner: «{rule.words}» ({rule.created_at:%d/%m})",
                      propuesta=("Revisá esas estrategias: prender, mantener o apagar lo decidís vos; la regla deja de "
                                 "vigilarse." if rule.thesis else
                                 "La alerta se cumplió y deja de vigilarse; pedí otra si querés seguirla."),
                      options=OPTIONS[AlertKind.WATCH], sources=[path.split("?")[0]])
        out.append(alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())}))
    return out, problems, len(active)
