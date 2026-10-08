"""P1-01b (U-69): «avisame si SPY baja a 760» is a rule the supervisor checks by code; the model never watches."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from galecore_ai.application import supervisor, watch
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.contracts.supervision import AlertKind
from tests.unit.test_knowledge import NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (a fixture)

IN_SESSION = NOW.replace(hour=15)          # 11:00 New York, a Wednesday
PRE_MARKET = NOW.replace(hour=12)          # 08:00 New York


def quote(mid):
    return {"type": "FEED_DATA", "data": [{"eventType": "Quote", "eventSymbol": "SPY", "midPrice": mid}]}


def reader(*, mid=777.8, gex=None, calls=None, fail_quote=False):
    def read(path):
        if calls is not None:
            calls.append(path)
        if path == "/App/Runtime/Instances":
            return []
        if path.startswith("/Data/Tastytrade/MarketData/Quote"):
            if fail_quote:
                raise supervisor.SupervisorError("GET quote -> HTTP 502")
            return quote(mid)
        if path.startswith("/App/Gex/Analysis"):
            return {"gex": {"global": gex or {}}}
        if path.startswith("/App.Analytics/IVRank"):
            return {"ivRank": 16.5}
        raise AssertionError(path)
    return read


def add(kb, **kw):  # noqa: F811
    args = {"symbol": "SPY", "metric": "price", "condition": "below", "threshold": 760.0,
            "words": "avisame si SPY baja a 760", "prompt": "seteame una alerta si el spy baja a 760", "now": NOW}
    return watch.add(kb, **{**args, **kw})


def test_the_request_is_stored_as_a_rule_with_the_owners_words(kb):  # noqa: F811
    rule = add(kb)
    assert rule.content_hash and rule.words == "avisame si SPY baja a 760"
    [shown] = watch.view(kb, NOW)
    assert shown["status"] == "active" and shown["alert"] is None and shown["threshold"] == 760.0
    assert watch.describe(rule) == "precio de SPY ≤ 760"


def test_bad_symbols_and_the_same_active_rule_are_refused(kb):  # noqa: F811
    add(kb)
    with pytest.raises(KnowledgeError, match="already active"):
        add(kb)
    with pytest.raises(KnowledgeError, match="ticker"):
        add(kb, symbol="spy; rm")
    with pytest.raises(KnowledgeError):
        add(kb, metric="net_gex")
    with pytest.raises(KnowledgeError, match="finite"):
        add(kb, threshold=float("nan"))
    with pytest.raises(KnowledgeError, match="past"):
        add(kb, until=NOW - timedelta(days=1))


def test_above_the_level_is_quiet_and_the_cross_alerts_once(kb):  # noqa: F811
    add(kb)
    out = supervisor.scan(kb, reader(mid=777.8), IN_SESSION)
    assert out["new"] == [] and out["watched"] == 1 and out["problems"] == []
    out = supervisor.scan(kb, reader(mid=759.9), IN_SESSION + timedelta(minutes=5))
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and alert.kind == AlertKind.WATCH
    assert alert.dato["value"] == 759.9 and "precio de SPY ≤ 760: ahora 759.9" in alert.motivo
    assert "avisame si SPY baja a 760" in alert.regla and alert.options == ["visto"]
    again = supervisor.scan(kb, reader(mid=755.0), IN_SESSION + timedelta(minutes=10))
    assert again["new"] == [] and again["watched"] == 0
    assert watch.view(kb, IN_SESSION)[0]["status"] == "met"


def test_only_the_regular_session_is_watched(kb):  # noqa: F811
    add(kb)
    calls = []
    out = supervisor.scan(kb, reader(mid=700.0, calls=calls), PRE_MARKET)
    assert out["new"] == [] and out["watched"] == 0 and calls == ["/App/Runtime/Instances"]


def test_a_number_galecore_cannot_give_is_a_problem_never_not_met(kb):  # noqa: F811
    add(kb)
    out = supervisor.scan(kb, reader(mid="NaN"), IN_SESSION)
    assert out["new"] == [] and "no dio precio de SPY" in out["problems"][0]
    out = supervisor.scan(kb, reader(fail_quote=True), IN_SESSION)
    assert "HTTP 502" in out["problems"][0]


def test_gex_levels_and_one_read_per_source(kb):  # noqa: F811
    add(kb, metric="gamma_zero", condition="above", threshold=770.0)
    add(kb, metric="put_wall", condition="below", threshold=750.0)
    calls = []
    out = supervisor.scan(kb, reader(gex={"gammaZeroLevel": 771.1, "putWall": 755.0}, calls=calls), IN_SESSION)
    assert [c for c in calls if c.startswith("/App/Gex")] == ["/App/Gex/Analysis?symbol=SPY"]
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and alert.dato["metric"] == "gamma_zero"


def test_cancelled_and_expired_rules_are_not_watched(kb):  # noqa: F811
    rule = add(kb)
    add(kb, threshold=750.0, now=IN_SESSION - timedelta(hours=2), until=IN_SESSION - timedelta(hours=1))
    watch.cancel(kb, rule.id, words="sacala", prompt="sacá la alerta de 760", now=NOW)
    with pytest.raises(KnowledgeError, match="cancelled"):
        watch.cancel(kb, rule.id, words="", prompt="otra vez", now=NOW)
    out = supervisor.scan(kb, reader(mid=700.0), IN_SESSION)
    assert out["new"] == [] and out["watched"] == 0
    assert {r["status"] for r in watch.view(kb, IN_SESSION)} == {"cancelled", "expired"}


def test_an_edited_rule_stops_the_pass(kb):  # noqa: F811
    rule = add(kb)
    path = kb.base / "supervision" / "rules" / f"{rule.id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["threshold"] = 900.0
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        supervisor.scan(kb, reader(), IN_SESSION)


def test_the_alert_is_shown_like_the_others_and_its_answer_goes_to_the_portfolio(kb):  # noqa: F811
    add(kb)
    supervisor.scan(kb, reader(mid=759.0), IN_SESSION)
    [shown] = supervisor.view(kb)
    assert shown["kind"] == "watch" and shown["needs_decision"] is False and shown["strategy"] == "Alerta SPY"
    out = supervisor.decide(kb=kb, alert_id=shown["id"], choice="visto", words="", prompt="visto", now=IN_SESSION)
    assert out["project"] == "portfolio"


@pytest.mark.parametrize("payload", [[1], {"gex": "s"}, {"data": "x"}, {"data": [1]}, None])
def test_a_payload_in_another_shape_is_a_problem_not_a_crash(kb, payload):  # noqa: F811
    add(kb)
    add(kb, metric="gamma_zero", condition="above", threshold=770.0)
    out = supervisor.scan(kb, lambda path: [] if path == "/App/Runtime/Instances" else payload, IN_SESSION)
    assert out["new"] == [] and len(out["problems"]) == 2


def test_a_bad_until_is_a_json_error(kb, capsys, monkeypatch):  # noqa: F811
    from galecore_ai.adapters import cli
    monkeypatch.setattr(cli, "_build_knowledge_base", lambda: kb)
    monkeypatch.setattr("sys.argv", ["galecore-ai", "supervise", "watch", "--symbol", "SPY", "--below", "760",
                                     "--until", "31/10", "--text", "x", "--prompt", "x"])
    with pytest.raises(SystemExit):
        cli.main()
    assert "--until" in capsys.readouterr().out


# ── WS-0016 (U-65): the condition that invalidates a thesis ─────


def test_a_thesis_invalidation_names_its_strategies_and_says_so_in_the_alert(kb, research_ref):  # noqa: F811
    from galecore_ai.application import project
    from tests.unit.test_strategy import NAME, stored
    with pytest.raises(KnowledgeError, match="no strategy named"):
        add(kb, thesis="la prima de varianza paga en calma", strategies=[NAME])
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="names the thesis"):
        add(kb, thesis="la prima de varianza paga en calma")
    with pytest.raises(KnowledgeError, match="names the thesis"):
        add(kb, strategies=[NAME])
    rule = add(kb, thesis="la prima de varianza paga en calma", strategies=[NAME],
               words="si SPY pierde 760 la calma se terminó")
    [entry] = project.strategy_project(kb, NAME)["log"]["thesis"]
    assert "Deja de servir «la prima de varianza paga en calma» si precio de SPY ≤ 760" in entry["words"]
    assert rule.id in entry["words"]
    supervisor.scan(kb, reader(mid=759.0), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    assert alert.strategy == NAME
    assert f"Se cumple lo que invalida «la prima de varianza paga en calma»; dependen de esa tesis: {NAME}." in alert.motivo
    assert alert.propuesta.startswith("Revisá esas estrategias")


def test_rules_stored_before_the_thesis_fields_keep_their_hash(kb):  # noqa: F811
    rule = add(kb)
    path = kb.base / "supervision" / "rules" / f"{rule.id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    del data["thesis"], data["strategies"]          # what a rule written before WS-0016 has
    path.write_text(json.dumps(data), encoding="utf-8")
    assert watch.view(kb, NOW)[0]["status"] == "active"
