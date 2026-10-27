"""WS-0023 (P1-PPa §C): «revisar el <fecha>» and «reanudar cuando cierren» are reminders the supervisor checks,
with a controlled clock (no waiting for the real date)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from galecore_ai.application import watch
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.contracts.supervision import AlertKind
from tests.unit.test_knowledge import NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_supervisor import IN_SESSION

DECISION = "Pausar entradas hasta que cierren las del 13/11 (C0, 10/10)"


def _remind(kb, **kw):  # noqa: F811
    base = {"words": "revisalo el 30/09", "prompt": "p", "decision": DECISION, "now": NOW}
    return watch.remind(kb, **{**base, **kw})


def positions(n_open):
    def read(path):
        assert path == "/App/Runtime/Instances/inst-9/Positions"
        return [{"status": "OPEN"}] * n_open + [{"status": "CLOSED"}]
    return read


def no_reads(path):
    raise AssertionError(f"a date reminder reads nothing, asked {path}")


def test_a_date_reminder_alerts_once_on_its_day_with_the_decision(kb):  # noqa: F811
    rule = _remind(kb, on=date(2026, 9, 30))
    assert watch.describe(rule) == "fecha ≥ 30/09/2026"
    before = IN_SESSION + timedelta(days=5)        # 28/09 (Monday): not yet
    assert watch.evaluate(kb, no_reads, before)[0] == []
    on_day = IN_SESSION + timedelta(days=7)        # 30/09, in session: the reloj is the test's, not the real one
    [alert] = watch.evaluate(kb, no_reads, on_day)[0]
    assert alert.kind == AlertKind.WATCH and alert.strategy == "Recordatorio"
    assert DECISION in alert.motivo and "revisalo el 30/09" in alert.regla


def test_a_when_closed_reminder_alerts_only_when_the_instance_has_nothing_open(kb):  # noqa: F811
    rule = _remind(kb, instance_id="inst-9", words="reanudá cuando cierren")
    assert watch.describe(rule) == "sin posiciones abiertas en la instancia inst-9"
    assert watch.evaluate(kb, positions(4), IN_SESSION)[0] == []
    [alert] = watch.evaluate(kb, positions(0), IN_SESSION)[0]
    assert alert.instance_id == "inst-9" and alert.dato["instance"] == "inst-9"


def test_an_unread_instance_is_a_problem_never_closed(kb):  # noqa: F811
    _remind(kb, instance_id="inst-9")

    def fails(path):
        raise RuntimeError("HTTP 500")
    alerts, problems, checked = watch.evaluate(kb, fails, IN_SESSION)
    assert alerts == [] and checked == 1 and "HTTP 500" in problems[0]


def test_a_reminder_is_a_date_or_an_instance_with_the_owners_words(kb):  # noqa: F811
    with pytest.raises(KnowledgeError, match="either a date"):
        _remind(kb)
    with pytest.raises(KnowledgeError, match="either a date"):
        _remind(kb, on=date(2026, 9, 30), instance_id="inst-9")
    with pytest.raises(KnowledgeError, match="past"):
        _remind(kb, on=date(2026, 9, 23))
    with pytest.raises(KnowledgeError, match="words"):
        _remind(kb, on=date(2026, 9, 30), words=" ")
    with pytest.raises(KnowledgeError, match="supervise remind"):
        watch.add(kb, symbol="SPY", metric="date", condition="above", threshold=20260930.0, words="w", prompt="p",
                  now=NOW)


# ── WS-0064 AC-6: alert per evaluation, alert at a New York time ─────────────────────────


def _ev(n, ok=True, at=None, gate=None):
    gates = [gate or {"gateId": "g", "label": "EMA20 > EMA50", "status": "PASS" if ok else "FAIL", "value": 8.16,
                      "threshold": 0.0, "operator": "GT"}]
    return {"evaluationId": f"ev-{n:08d}", "instanceId": "inst-9", "symbol": "AAPL", "overallPass": ok,
            "gateResults": gates, "evaluatedAt": (at or IN_SESSION).isoformat()}


def _eval_reader(evals, positions=()):
    def read(path):
        if path == "/App/Runtime/Instances":
            return [{"instanceId": "inst-9", "mode": "SHADOW", "specName": "cruce_de_emas"}]
        if path.startswith("/App/Runtime/Instances/inst-9/Evaluations"):
            return evals if isinstance(evals, list) else {"items": evals["items"]}
        assert path == "/App/Runtime/Instances/inst-9/Positions"
        return list(positions)
    return read


def _pass(kb, read, now):  # noqa: F811 - one supervisor-like pass: dedup by key, as scan does
    from galecore_ai.application import supervisor
    known = {a.key for a in supervisor.alerts(kb)}
    out = [a for a in watch.evaluate(kb, read, now)[0] if a.key not in known]
    for a in out:
        supervisor._write(kb, a)
    return out


def test_an_evaluation_rule_alerts_once_per_new_evaluation_and_stays_active(kb):  # noqa: F811
    rule = _remind(kb, instance_id="inst-9", on_evaluation=True, now=IN_SESSION)
    t = IN_SESSION
    old = _ev(0, at=t - timedelta(minutes=1))                    # before the rule: ignored
    e1, e2 = _ev(1, at=t + timedelta(minutes=1)), _ev(2, ok=False, at=t + timedelta(minutes=2))
    read = _eval_reader([old, e1])
    first = _pass(kb, read, t + timedelta(minutes=5))
    assert [a.dato["evaluation_id"] for a in first] == ["ev-00000001"]
    assert first[0].motivo.startswith("cruce_de_emas evaluó y entró")
    assert _pass(kb, read, t + timedelta(minutes=6)) == []                    # rerun: no duplicates
    second = _pass(kb, _eval_reader({"items": [old, e1, e2]}), t + timedelta(minutes=10))   # {items: [...]} shape too
    assert [a.dato["evaluation_id"] for a in second] == ["ev-00000002"]
    assert second[0].motivo == "cruce_de_emas evaluó y no entró: EMA20 > EMA50 8.16 vs 0."
    assert watch.status(kb, rule, t + timedelta(minutes=10)) == "active"
    assert watch.describe(rule).startswith("cada evaluación")


def test_an_entered_evaluation_says_what_was_opened(kb):  # noqa: F811
    _remind(kb, instance_id="inst-9", on_evaluation=True, now=IN_SESSION)
    at = IN_SESSION + timedelta(minutes=1)
    opened = {"status": "OPEN", "entryAt": (at + timedelta(seconds=1)).isoformat(), "entryKind": "debit",
              "entryAmount": 344.12, "legsText": "BUY 10 AAPL", "legs": []}
    [a] = _pass(kb, _eval_reader([_ev(1, at=at)], [opened]), at + timedelta(minutes=5))
    assert a.motivo == "cruce_de_emas evaluó y entró. BUY 10 AAPL, débito 344.12."
    spread = {"status": "OPEN", "entryAt": (at + timedelta(minutes=1, seconds=1)).isoformat(), "entryCredit": 0.44,
              "legs": [{"side": "SELL", "strike": 733.0, "expiration": "2026-11-13"},
                       {"side": "BUY", "strike": 728.0, "expiration": "2026-11-13"}]}
    [b] = _pass(kb, _eval_reader([_ev(2, at=at + timedelta(minutes=1))], [spread]), at + timedelta(minutes=6))
    assert "733/728 2026-11-13, crédito 0.44" in b.motivo


def test_an_unread_evaluation_feed_is_a_problem_not_silence(kb):  # noqa: F811
    _remind(kb, instance_id="inst-9", on_evaluation=True, now=IN_SESSION)

    def fails(path):
        raise RuntimeError("HTTP 500")
    alerts, problems, _ = watch.evaluate(kb, fails, IN_SESSION + timedelta(minutes=5))
    assert alerts == [] and "HTTP 500" in problems[0]


def test_a_time_reminder_fires_at_or_after_the_minute_in_new_york_and_not_before(kb):  # noqa: F811
    from datetime import time
    # IN_SESSION is Wed 23/09 11:00 New York: 13:50 the same day is still ahead
    rule = _remind(kb, on=date(2026, 9, 23), at=time(13, 50), now=IN_SESSION)
    assert watch.describe(rule) == "el 23/09/2026 a las 13:50 NY"
    assert watch.evaluate(kb, no_reads, IN_SESSION.replace(hour=17, minute=49))[0] == []      # 13:49 NY
    [alert] = watch.evaluate(kb, no_reads, IN_SESSION.replace(hour=17, minute=53))[0]         # 13:53 NY: pass cadence
    assert alert.strategy == "Recordatorio" and "13:50 NY" in alert.motivo
    with pytest.raises(KnowledgeError, match="past"):
        _remind(kb, on=date(2026, 9, 23), at=time(10, 59), now=IN_SESSION)
    with pytest.raises(KnowledgeError, match="--at"):
        _remind(kb, instance_id="inst-9", at=time(13, 50))
