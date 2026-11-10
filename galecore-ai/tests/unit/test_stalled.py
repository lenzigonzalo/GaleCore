"""WS-0098 inc. 5: the supervisor warns when the same cause stops a strategy day after day."""

from galecore_ai.application import stalled


def skip(day, limit="max_bet", reason="tope por apuesta: supera el tope de 9.00 USD"):
    return {"eventType": "ENTRY_SKIPPED", "timestamp": f"2026-11-{day:02d}T18:45:00Z", "payload": {"limit": limit, "reason": reason}}


def vix(day):
    return {"eventType": "GATES_NOT_PASSED", "timestamp": f"2026-11-{day:02d}T18:45:00Z",
            "payload": {"gates": [{"gate_id": "vix_below_24", "status": "FAIL"}]}}


def test_three_evaluated_days_stopped_by_the_same_cause_raise_it():
    run = stalled.streak([skip(3), skip(4), skip(5), skip(6)])
    assert run["days"] == 4 and run["cause"] == "ENTRY_SKIPPED:max_bet" and run["since"] == "2026-11-03"
    assert "9.00 USD" in run["reason"]


def test_two_days_are_not_enough_and_another_cause_breaks_the_run():
    assert stalled.streak([skip(3), skip(4)]) is None
    assert stalled.streak([skip(3), vix(4), skip(5)]) is None


def test_an_opened_position_ends_the_streak():
    opened = {"eventType": "POSITION_OPENED", "timestamp": "2026-11-05T18:45:30Z", "payload": {}}
    assert stalled.streak([skip(3), skip(4), skip(5), opened]) is None
    assert stalled.streak([skip(3), opened, skip(4), skip(5)]) is None


def test_one_alert_per_streak_and_only_for_running_shadow_instances():
    events = [skip(3), skip(4), skip(5)]
    running = {"instanceId": "i1", "mode": "SHADOW", "lifecycleState": "RUNNING", "specName": "s"}
    stopped = {**running, "instanceId": "i2", "lifecycleState": "STOPPED"}
    drafts, problems = stalled.drafts_for([running, stopped], lambda path: events)
    assert problems == [] and [d["instance_id"] for d in drafts] == ["i1"]
    again, _ = stalled.drafts_for([running], lambda path: events + [skip(6)])
    assert again[0]["key"] == drafts[0]["key"]          # same streak, same key: never raised twice


def test_an_unreadable_instance_is_reported_not_hidden():
    def boom(path):
        raise RuntimeError("down")
    drafts, problems = stalled.drafts_for([{"instanceId": "i1", "mode": "SHADOW", "lifecycleState": "RUNNING", "specName": "s"}], boom)
    assert drafts == [] and "eventos no leídos" in problems[0]


def test_days_stopped_only_by_a_market_filter_do_not_break_a_bet_cap_streak():
    """The Sandwich 1.3.0 (3–10/11): bet cap on 3, 4, 9, 10; the VIX gate alone stopped 5 and 6."""
    run = stalled.streak([skip(3), skip(4), vix(5), vix(6), skip(9), skip(10)])
    assert run["days"] == 4 and run["cause"] == "ENTRY_SKIPPED:max_bet" and run["since"] == "2026-11-03"
    other = {"eventType": "CANDIDATE_NOT_VIABLE", "timestamp": "2026-11-06T18:45:00Z", "payload": {"reason": "crédito 2 menor al mínimo 2.5"}}
    assert stalled.streak([skip(3), skip(4), other, skip(9), skip(10)]) is None   # another candidate-level cause cuts it: 2 days left
