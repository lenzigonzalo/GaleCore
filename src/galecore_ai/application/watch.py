"""Rules the owner asks for (P1-01b, U-69): «avisame si SPY baja a 760».

The host turns the request into a rule with ``add`` and stops there: it never watches. The supervisor's pass (code,
every 5 minutes) calls ``evaluate`` with the same GaleCore reader it uses for SHADOW; each active rule reads one number
from GaleCore and, when the condition holds, raises a WATCH alert once (key ``watch:<rule id>``). The alert is the
rule's end: to keep watching, the owner asks for a new rule.

Rules are evaluated only in the regular session (pre-market quotes are thin; the GEX levels move with the session).
A number GaleCore cannot give (no quote, NaN, a timeout) is reported as a problem of the pass, never as «not met».
"""

from __future__ import annotations

import json
import math
import re
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.strategy import compute_document_hash
from galecore_ai.contracts.supervision import (
    METRIC_LABELS,
    OPTIONS,
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
    """The number of ``metric`` in a GaleCore payload, or None when it is not there (NaN counts as absent)."""
    if metric == WatchMetric.PRICE:
        rows = (payload or {}).get("data") or []
        return _number(rows[0].get("midPrice")) if rows and isinstance(rows[0], dict) else None
    if metric == WatchMetric.IV_RANK:
        return _number((payload or {}).get("ivRank"))
    scope = (((payload or {}).get("gex") or {}).get("global")) or {}
    return _number(scope.get(GEX_FIELDS[metric]))


# ── store ────────────────────────────────────────────────────────


def _fmt(x: float) -> str:
    return f"{x:g}"


def add(kb: KnowledgeBase, *, symbol: str, metric: str, condition: str, threshold: float, words: str, prompt: str,
        until: datetime | None = None, host_model: str | None = None, now: datetime | None = None) -> WatchRule:
    """Store a rule. Refuses an unknown symbol shape, metric or condition, and an empty request."""
    now = now or datetime.now(UTC)
    symbol = symbol.strip().upper()
    if not SYMBOL.match(symbol):
        raise KnowledgeError(f"symbol {symbol!r}: a ticker such as SPY")
    if not words.strip() or not prompt.strip():
        raise KnowledgeError("a rule keeps the owner's words and request (--text, --prompt)")
    if until is not None and until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    if until is not None and until <= now:
        raise KnowledgeError("--until is in the past")
    try:
        rule = WatchRule(id=f"{now.date().isoformat()}-{symbol.lower()}-{metric}-{condition}-{_fmt(threshold)}",
                         created_at=now, symbol=symbol, metric=WatchMetric(metric), condition=WatchCondition(condition),
                         threshold=threshold, words=words, prompt=prompt, until=until, host_model=host_model)
    except (ValueError, ValidationError) as exc:
        raise KnowledgeError(f"Refusing to store the rule: {str(exc)[:200]}") from exc
    same = (rule.symbol, rule.metric, rule.condition, rule.threshold)
    if dup := next((r for r in rules(kb) if (r.symbol, r.metric, r.condition, r.threshold) == same
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


def view(kb: KnowledgeBase, now: datetime | None = None) -> list[dict]:
    met = _met(kb)
    return [{"id": r.id, "status": status(kb, r, now, met), "symbol": r.symbol, "metric": r.metric.value,
             "condition": r.condition.value, "threshold": r.threshold, "words": r.words,
             "created_at": r.created_at.isoformat(), "until": r.until.isoformat() if r.until else None,
             "alert": met.get(r.id)} for r in rules(kb)]


# ── the pass ─────────────────────────────────────────────────────


def describe(rule: WatchRule) -> str:
    sign = "≤" if rule.condition == WatchCondition.BELOW else "≥"
    return f"{METRIC_LABELS[rule.metric]} de {rule.symbol} {sign} {_fmt(rule.threshold)}"


def evaluate(kb: KnowledgeBase, read, now: datetime) -> tuple[list[Alert], list[str], int]:
    """Check every active rule once. Returns (alerts to write, problems, rules checked). One read per source."""
    met = _met(kb)
    active = [r for r in rules(kb) if status(kb, r, now, met) == "active"]
    cache: dict[str, object] = {}
    out, problems = [], []
    for rule in active:
        path = SOURCES[rule.metric].format(symbol=rule.symbol)
        if path not in cache:
            try:
                cache[path] = read(path)
            except Exception as exc:  # noqa: BLE001 - one source unread is reported; the other rules still run
                cache[path] = exc
        payload = cache[path]
        if isinstance(payload, Exception):
            problems.append(f"regla {rule.id}: {str(payload)[:160]}")
            continue
        value = read_metric(payload, rule.metric)
        if value is None:
            problems.append(f"regla {rule.id}: GaleCore no dio {METRIC_LABELS[rule.metric]} de {rule.symbol}")
            continue
        hit = value <= rule.threshold if rule.condition == WatchCondition.BELOW else value >= rule.threshold
        if not hit:
            continue
        alert = Alert(id=f"{now.date().isoformat()}-watch-{rule.id.split('-', 3)[-1]}"[:80],
                      key=f"watch:{rule.id}", kind=AlertKind.WATCH, strategy=f"Alerta {rule.symbol}",
                      strategy_ref=None, instance_id="", position_id=rule.id, detected_at=now,
                      motivo=f"{describe(rule)}: ahora {_fmt(value)}.",
                      dato={"symbol": rule.symbol, "metric": rule.metric.value, "value": value,
                            "threshold": rule.threshold, "condition": rule.condition.value},
                      regla=f"Pedido del owner: «{rule.words}» ({rule.created_at:%d/%m})",
                      propuesta="La alerta se cumplió y deja de vigilarse; pedí otra si querés seguirla.",
                      options=OPTIONS[AlertKind.WATCH], sources=[path.split("?")[0]])
        out.append(alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())}))
    return out, problems, len(active)
