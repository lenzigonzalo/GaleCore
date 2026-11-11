"""WS-0098 inc. 5: the supervisor warns from the API's «stall» when the same cause stops a strategy day after day."""

from galecore_ai.application import stalled

RUNNING = {"instanceId": "i1", "mode": "SHADOW", "lifecycleState": "RUNNING", "specName": "s"}


def card(days, since="2026-11-03"):
    return {"stall": {"days": days, "since": since, "until": "2026-11-10", "cause": "ENTRY_SKIPPED:max_bet",
                      "text": f"{days} días hábiles seguidos sin entrar por tope por apuesta", "reason": "supera el tope de 9.00 USD"}}


def test_three_days_or_more_raise_it_with_the_apis_sentence():
    [draft], problems = stalled.drafts_for([RUNNING], lambda path: card(4))
    assert problems == [] and draft["dato"]["dias"] == 4 and "tope por apuesta" in draft["motivo"] and "9.00 USD" in draft["motivo"]


def test_fewer_than_three_days_or_no_stall_raise_nothing():
    assert stalled.drafts_for([RUNNING], lambda path: card(2))[0] == []
    assert stalled.drafts_for([RUNNING], lambda path: {"stall": None})[0] == []


def test_one_alert_per_streak_and_only_for_running_shadow_instances():
    stopped = {**RUNNING, "instanceId": "i2", "lifecycleState": "STOPPED", "specName": "t"}
    drafts, _ = stalled.drafts_for([RUNNING, stopped], lambda path: card(3))
    assert [d["instance_id"] for d in drafts] == ["i1"]
    again, _ = stalled.drafts_for([RUNNING], lambda path: card(5))
    assert again[0]["key"] == drafts[0]["key"]          # same streak (same cause and start): never raised twice


def test_an_unreadable_card_is_reported_not_hidden():
    def boom(path):
        raise RuntimeError("down")
    drafts, problems = stalled.drafts_for([RUNNING], boom)
    assert drafts == [] and "ficha no leída" in problems[0]
