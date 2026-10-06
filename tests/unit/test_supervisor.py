"""WS-0007 (P1-01): the supervisor watches existing rules of what is open in SHADOW and keeps the owner's decision."""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from galecore_ai.application import project, supervisor
from galecore_ai.application.knowledge import KnowledgeError
from tests.unit.test_knowledge import NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_space import galecore  # noqa: F401  (fixture)
from tests.unit.test_strategy import (  # noqa: F401  (research_ref is a fixture)
    KEY,
    NAME,
    research_ref,
    stored,
)

IN_SESSION = NOW.replace(hour=15)          # 11:00 New York, a Wednesday
IID = "inst-1"


def position(pid="aaaaaaaa-1", **kw):
    base = {"positionId": pid, "instanceId": IID, "status": "OPEN", "entryCredit": 0.44, "maxRisk": 456.0,
            "lastSpreadValue": 0.40, "unrealizedPnl": 4.0, "currentDte": 39,
            "lastValuedAt": (IN_SESSION - timedelta(minutes=1)).isoformat(), "entryAt": "2026-09-20T13:31:00Z",
            "legs": [{"side": "SELL", "strike": 733.0, "expiration": "2026-11-13"},
                     {"side": "BUY", "strike": 728.0, "expiration": "2026-11-13"}]}
    return {**base, **kw}


def reader(spec_hash, positions, *, fail=False, releases=(), fomc=(), calendar_fails=False):
    def read(path):
        if fail:
            raise supervisor.SupervisorError("GaleCore no respondió")
        if path.startswith("/Data/"):
            if calendar_fails:
                raise supervisor.SupervisorError("GET calendario -> HTTP 502")
            if path.startswith("/Data/Fred/ReleaseDates"):
                return {"data": [{"date": d, "releaseName": n} for d, n in releases]}
            return {"data": [{"start": d, "end": d} for d in fomc]}
        if path == "/App/Runtime/Instances":
            return [{"instanceId": IID, "mode": "SHADOW", "lifecycleState": "RUNNING", "specName": NAME,
                     "versionHash": spec_hash}]
        assert path == f"/App/Runtime/Instances/{IID}/Positions"
        return positions
    return read


def test_a_healthy_position_raises_nothing(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = supervisor.scan(kb, reader(doc.spec_hash, [position()]), IN_SESSION)
    assert out == {"at": IN_SESSION.isoformat(), "new": [], "checked": 1, "watched": 0, "problems": []}


def test_a_close_by_shadow_is_one_alert_with_its_data_and_never_repeats(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    closed = position(status="CLOSED", exitReason="TAKE_PROFIT", exitDebit=0.23, realizedPnl=23.0,
                      exitAt=(IN_SESSION - timedelta(hours=1)).isoformat())
    out = supervisor.scan(kb, reader(doc.spec_hash, [closed]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and alert.kind.value == "closed"
    assert alert.strategy_ref == f"strategy:{KEY}" and alert.dato["realized_pnl_usd"] == 23.0
    assert "TAKE_PROFIT" in alert.motivo and alert.options[0] == "conforme"
    assert supervisor.scan(kb, reader(doc.spec_hash, [closed]), IN_SESSION + timedelta(minutes=5))["new"] == []


def test_an_old_close_is_history_not_news(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    old = position(status="CLOSED", exitReason="STOP_LOSS", exitAt=(IN_SESSION - timedelta(days=10)).isoformat())
    assert supervisor.scan(kb, reader(doc.spec_hash, [old]), IN_SESSION)["new"] == []


def test_half_way_to_the_stop_alerts_with_the_rule_of_the_spec(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    supervisor.scan(kb, reader(doc.spec_hash, [position(lastSpreadValue=0.88)]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert alert.kind.value == "near_stop" and alert.dato["loss_multiple"] == 1.0
    assert "2× el crédito" in alert.regla and alert.options == ["dejar que decida la regla", "cerrar ahora"]


def test_just_below_half_way_is_quiet(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    assert supervisor.scan(kb, reader(doc.spec_hash, [position(lastSpreadValue=0.87)]), IN_SESSION)["new"] == []


def test_no_price_counts_only_in_session(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    stale = position(lastValuedAt=(IN_SESSION - timedelta(minutes=30)).isoformat(),
                     valuationProblems=["sin quote de .SPY261113P728"])
    assert supervisor.scan(kb, reader(doc.spec_hash, [stale]), NOW)["new"] == []        # 18:00 New York
    out = supervisor.scan(kb, reader(doc.spec_hash, [stale]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and alert.kind.value == "no_price" and "sin quote" in alert.dato["problems"]


def test_risk_above_the_spec_limit_alerts(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    supervisor.scan(kb, reader(doc.spec_hash, [position(maxRisk=960.0)]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert alert.kind.value == "risk_limit" and alert.dato == {"max_risk_usd": 960.0, "limit_usd": 500.0}


def test_an_unknown_spec_still_watches_what_needs_no_rule(kb):  # noqa: F811
    supervisor.scan(kb, reader("sha256:" + "0" * 64, [position(lastSpreadValue=0.9)]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert alert.strategy_ref is None and "stop sin dato" in alert.regla


def test_a_failed_read_is_an_error_never_nothing_to_report(kb):  # noqa: F811
    with pytest.raises(supervisor.SupervisorError):
        supervisor.scan(kb, reader("x", [], fail=True), IN_SESSION)


def test_an_edited_alert_is_refused(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    supervisor.scan(kb, reader(doc.spec_hash, [position(maxRisk=960.0)]), IN_SESSION)
    path = next((kb.base / "supervision" / "alerts").glob("*.json"))
    data = json.loads(path.read_text(encoding="utf-8"))
    data["dato"]["max_risk_usd"] = 100.0
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        supervisor.alerts(kb)


def test_the_decision_is_kept_in_the_project_with_its_context(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    supervisor.scan(kb, reader(doc.spec_hash, [position(lastSpreadValue=0.9)]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    out = supervisor.decide(kb=kb, alert_id=alert.id, choice="dejar que decida la regla",
                            words="La dejo: el stop está para esto", expected="Que rebote antes del CPI",
                            review_by=date(2026, 9, 25), source="monitor", prompt="Respuesta desde el monitor",
                            now=IN_SESSION)
    assert out["project"] == NAME
    [entry] = project.load_log(kb, NAME).entries
    assert entry.kind.value == "decision" and entry.refs == [f"strategy:{KEY}"]
    assert entry.context.alert == alert.id and entry.context.alert_hash == alert.content_hash
    assert entry.context.options == alert.options and entry.context.review_by == date(2026, 9, 25)
    [shown] = supervisor.view(kb)
    assert shown["decision"]["choice"] == "dejar que decida la regla"
    with pytest.raises(KnowledgeError, match="already has a decision"):
        supervisor.decide(kb=kb, alert_id=alert.id, choice="cerrar ahora", words="", prompt="otra", now=IN_SESSION)


def test_a_choice_outside_the_options_is_refused(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    supervisor.scan(kb, reader(doc.spec_hash, [position(maxRisk=960.0)]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    with pytest.raises(KnowledgeError, match="choice is one of"):
        supervisor.decide(kb=kb, alert_id=alert.id, choice="duplicar", words="", prompt="x", now=IN_SESSION)


def test_entries_without_context_keep_their_old_hash(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    entry, _ = project.add(kb=kb, name=NAME, kind="decision", words="Mantener", prompt="Anotá", now=NOW)
    assert "context" not in entry.hashable()
    assert project.load_log(kb, NAME).chain_problems() == []


# ── end to end through the trader's space (fake GaleCore) ────────


def test_the_monitor_shows_the_alert_and_its_answer_becomes_a_decision(kb, research_ref, galecore):  # noqa: F811
    from galecore_ai.application import space

    doc, _ = stored(kb, research_ref)
    fake, client = galecore
    closed = position(status="CLOSED", exitReason="TAKE_PROFIT", exitDebit=0.23, realizedPnl=23.0,
                      exitAt=(IN_SESSION - timedelta(hours=1)).isoformat())
    space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, [closed]))
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    [shown] = piece["alerts"]
    assert shown["kind"] == "closed" and shown["decision"] is None and piece["state"] == "CURRENT"
    assert "Nada para decidir" in piece["findings"] and shown["needs_decision"] is False
    # What the monitor writes: the piece as it was, plus the answer.
    answer = {"choice": "conforme", "words": "Salió por objetivo, como se esperaba", "expected": "",
              "review_by": "2026-09-30", "at": IN_SESSION.isoformat()}
    client.put("agent", "supervisor", title="Supervisor", fmt="json",
               content=json.dumps({**piece, "responses": {shown["id"]: answer}}))
    out = space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, [closed]))
    assert out["responses"] == [{"alert": shown["id"], "result": "recorded"}]
    [entry] = project.load_log(kb, NAME).entries
    assert entry.context.choice == "conforme" and entry.context.source == "monitor" and "demo" in entry.prompt
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert piece["alerts"][0]["decision"]["choice"] == "conforme" and "responses" not in piece
    assert "Nada para decidir" in piece["findings"]


def test_a_refused_answer_is_shown_and_galecore_down_is_a_failure(kb, research_ref, galecore):  # noqa: F811
    from galecore_ai.application import space

    doc, _ = stored(kb, research_ref)
    fake, client = galecore
    space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, [position(maxRisk=960.0)]))
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    alert_id = piece["alerts"][0]["id"]
    client.put("agent", "supervisor", title="Supervisor", fmt="json",
               content=json.dumps({**piece, "responses": {alert_id: {"choice": "duplicar"}}}))
    space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader("x", [], fail=True))
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert "choice is one of" in piece["response_errors"][alert_id]
    assert piece["state"] == "FAILED" and piece["last_run"]["failed"] and "no respondió" in piece["state_detail"]


def test_a_partial_read_is_a_failure_not_a_quiet_pass(kb, research_ref, galecore):  # noqa: F811
    from galecore_ai.application import space

    doc, _ = stored(kb, research_ref)
    fake, client = galecore
    space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, None))
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert piece["state"] == "FAILED" and piece["last_run"]["failed"] and "sin forma de lista" in piece["state_detail"]


def test_a_naive_galecore_timestamp_is_utc(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    naive = position(lastValuedAt=(IN_SESSION - timedelta(minutes=30)).replace(tzinfo=None).isoformat())
    out = supervisor.scan(kb, reader(doc.spec_hash, [naive]), IN_SESSION)
    assert out["problems"] == [] and [a.kind.value for a in supervisor.alerts(kb)] == ["no_price"]


def test_no_price_does_not_count_yesterday_before_the_open(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    yesterday = position(lastValuedAt=(IN_SESSION - timedelta(days=1)).isoformat())
    just_open = IN_SESSION.replace(hour=13, minute=35)        # 9:35 New York
    assert supervisor.scan(kb, reader(doc.spec_hash, [yesterday]), just_open)["new"] == []


def test_a_publish_without_the_supervisor_leaves_its_alerts(kb, research_ref, galecore):  # noqa: F811
    from galecore_ai.application import space

    doc, _ = stored(kb, research_ref)
    fake, client = galecore
    space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, [position(maxRisk=960.0)]))
    space.publish_agents(client, kb, None, now=IN_SESSION)
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert piece["status"] == "active" and len(piece["alerts"]) == 1


def test_a_damaged_alert_fails_the_supervisor_not_the_other_agents(kb, research_ref, galecore):  # noqa: F811
    from galecore_ai.application import space

    doc, _ = stored(kb, research_ref)
    fake, client = galecore
    space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, [position(maxRisk=960.0)]))
    path = next((kb.base / "supervision" / "alerts").glob("*.json"))
    path.write_text("{}", encoding="utf-8")
    out = space.publish_agents(client, kb, None, now=IN_SESSION, supervise=reader(doc.spec_hash, []))
    piece = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert piece["state"] == "FAILED" and "dañado" in piece["state_detail"] and len(piece["alerts"]) == 1
    assert out["responses"][0]["result"] == "refused"


# ── E4: a data release or FOMC before expiration (IN_SESSION is Wednesday 23/09) ─


def test_a_release_two_business_days_ahead_is_one_informative_line(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    rd = reader(doc.spec_hash, [position()], releases=[("2026-09-25", "Consumer Price Index")])
    out = supervisor.scan(kb, rd, IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and alert.kind.value == "event" and "en 2 días hábiles (25/09)" in alert.motivo
    assert supervisor.view(kb)[0]["needs_decision"] is False
    later = IN_SESSION + timedelta(hours=3)
    fresh = position(lastValuedAt=later.isoformat())
    rd = reader(doc.spec_hash, [fresh], releases=[("2026-09-25", "Consumer Price Index")])
    assert supervisor.scan(kb, rd, later)["new"] == []                                     # once per event


def test_events_too_far_or_after_expiration_are_quiet(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    rd = reader(doc.spec_hash, [position()], releases=[("2026-09-28", "Consumer Price Index")],   # 3 business days
                fomc=["2026-11-20"])                                                          # after 13/11
    assert supervisor.scan(kb, rd, IN_SESSION)["new"] == []


def test_fomc_over_a_weekend_counts_business_days(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    friday = IN_SESSION + timedelta(days=2)
    pos = position(lastValuedAt=friday.isoformat())
    supervisor.scan(kb, reader(doc.spec_hash, [pos], fomc=["2026-09-28"]), friday)                   # next Monday
    [alert] = supervisor.alerts(kb)
    assert "Decisión del FOMC mañana" in alert.motivo


def test_without_calendar_the_other_rules_still_run_and_the_pass_is_partial(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = supervisor.scan(kb, reader(doc.spec_hash, [position(maxRisk=960.0)], calendar_fails=True), IN_SESSION)
    assert [a.kind.value for a in supervisor.alerts(kb)] == ["risk_limit"]
    assert out["problems"] and out["problems"][0].startswith("calendario")


def test_a_strange_expiration_skips_e4_not_the_other_rules(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    odd = position(maxRisk=960.0, legs=[{"side": "SELL", "strike": 733.0, "expiration": "13/11/2026"}])
    out = supervisor.scan(kb, reader(doc.spec_hash, [odd], releases=[("2026-09-25", "Consumer Price Index")]),
                          IN_SESSION)
    assert out["problems"] == [] and [a.kind.value for a in supervisor.alerts(kb)] == ["risk_limit"]
