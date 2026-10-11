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
