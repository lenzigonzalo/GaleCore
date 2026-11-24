"""WS-0107 (D-0017): a ficha in stage ready is activated in Seguimiento after the trader's yes; the supervisor watches
its entry and invalidation rules, leaves a run per pass, raises health and invalidation alerts, and `explain` answers
«¿por qué no entré?» from those runs and the market clock. Code only."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from galecore_ai.application import seguimiento, supervisor, watch
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.application.strategy import save_proposal
from galecore_ai.contracts.strategy import ProposalContent, Rule
from galecore_ai.contracts.supervision import AlertKind
from tests.unit.test_knowledge import HOST, NOW, kb  # noqa: F401  (kb is a fixture)

NAME = "xle_rebote_petroleo"
IN_SESSION = NOW.replace(hour=15)          # Wed 23/09 11:00 New York
WATCHED = {"supported": {"status": "supported", "spec_paths": ["supervisor.watch"]},
           "no": {"status": "unsupported", "note": "la serie de WTI está vacía en GaleCore"}}


def rule(rid, block, runtime="supported", watch_=None, text="x"):
    return {"id": rid, "block": block, "text": text, "basis": "design_choice", "rationale": "r",
            "runtime": WATCHED.get(runtime) if isinstance(runtime, str) else runtime, **({"watch": watch_} if watch_ else {})}


def ficha(version="0.2.0", stage="ready", entry=60.99, inv=57.0, inv_runs=True):
    rules = [rule("E1", "entry", watch_={"symbol": "XLE", "condition": "above", "threshold": entry},
                  text=f"XLE recupera {entry}"),
             rule("I1", "invalidation", "supported" if inv_runs else "no",
                  watch_={"symbol": "XLE", "condition": "below", "threshold": inv} if inv_runs else None,
                  text=f"XLE pierde {inv}"),
             rule("M1", "monitoring", {"status": "not_applicable", "note": "lo mira el supervisor"})]
    return ProposalContent.model_validate({
        "name": NAME, "version": version, "display_name": "XLE · rebote del petróleo", "stage": stage,
        "symbol": "XLE", "horizon": "semanas", "thesis": "Las energéticas rebotan",
        "hypothesis": {"mechanism": "sobreventa frente al crudo", "failure_conditions": ["pierde el mínimo"]},
        "rules": rules})


def save(kb, **kw):  # noqa: F811
    return save_proposal(kb=kb, prompt="ficha", host=HOST, content=ficha(**kw), now=NOW)


def activate(kb, now=IN_SESSION):  # noqa: F811
    return seguimiento.activate(kb, NAME, words="sí, activala", prompt="activá el seguimiento", now=now)


def quote(mid):
    return {"type": "FEED_DATA", "data": [{"eventType": "Quote", "eventSymbol": "XLE", "midPrice": mid}]}


def reader(mid=58.0, fail=False):
    def read(path):
        if path == "/App/Runtime/Instances":
            return []
        if path.startswith("/Data/Tastytrade/MarketData/Quote"):
            if fail:
                raise supervisor.SupervisorError("GET quote -> HTTP 502")
            return quote(mid)
        raise AssertionError(path)
    return read


def test_the_watch_condition_is_additive_and_old_fichas_keep_their_hash(kb):  # noqa: F811
    doc, _ = save(kb)
    assert doc.content.rules[0].watch.symbol == "XLE"
    plain = Rule.model_validate(rule("R9", "exit", {"status": "not_applicable", "note": "n"}))
    assert plain.watch is None and "watch" not in doc.hashable_content()["content"]["rules"][2]
    with pytest.raises(ValueError, match="only entry and invalidation"):
        Rule.model_validate(rule("R9", "exit", watch_={"symbol": "XLE", "condition": "above", "threshold": 1}))
    with pytest.raises(ValueError, match="reminder"):
        Rule.model_validate(rule("R9", "entry", watch_={"symbol": "XLE", "metric": "date", "condition": "above",
                                                        "threshold": 1}))


def test_activate_needs_the_latest_version_ready(kb):  # noqa: F811
    with pytest.raises(KnowledgeError, match="no hay estrategia"):
        activate(kb)
    save(kb, stage="rules")
    with pytest.raises(KnowledgeError, match="etapa rules"):
        activate(kb)
    save(kb, version="0.3.0")                 # ready, newer
    assert activate(kb)["ref"] == f"strategy:{NAME}/0.3.0"
    with pytest.raises(KnowledgeError, match="ya fue activada"):
        activate(kb)
    with pytest.raises(KnowledgeError, match="palabras del trader"):
        seguimiento.activate(kb, NAME, words=" ", prompt="p")


def test_activate_needs_a_watchable_entry_and_a_declared_invalidation(kb):  # noqa: F811
    data = ficha().model_dump(mode="json")
    data["rules"][0]["watch"] = None
    save_proposal(kb=kb, prompt="p", host=HOST, content=ProposalContent.model_validate(data), now=NOW)
    with pytest.raises(KnowledgeError, match="regla de entrada con condición vigilable"):
        activate(kb)


def test_avisos_are_created_with_their_role_and_what_does_not_run_is_said(kb):  # noqa: F811
    save(kb, inv_runs=False)
    out = activate(kb)
    assert [(a["rol"], a["vigila"]) for a in out["avisos"]] == [("entrada", "precio de XLE ≥ 60,99")]
    assert out["reglas_que_no_corren"][0]["reason"] == "la serie de WTI está vacía en GaleCore"
    assert out["cadencia"]["tokens"] == 0 and "5 minutos" in out["cadencia"]["cada"]
    [stored] = watch.rules(kb)
    assert stored.role == "entry" and stored.strategies == [NAME] and stored.words == "sí, activala"
    assert seguimiento.is_active(kb, NAME)


def test_a_new_version_cancels_the_avisos_of_the_previous_one(kb):  # noqa: F811
    save(kb)
    first = activate(kb)
    save(kb, version="0.3.0", entry=62.0, inv=56.0)
    second = activate(kb, IN_SESSION + timedelta(hours=1))
    assert sorted(second["avisos_de_la_version_anterior_cancelados"]) == sorted(a["rule"] for a in first["avisos"])
    status = {r["threshold"]: r["status"] for r in watch.view(kb, IN_SESSION + timedelta(hours=2))}
    assert status == {60.99: "cancelled", 57.0: "cancelled", 62.0: "active", 56.0: "active"}


def test_supervise_watch_tied_to_a_strategy_not_in_seguimiento_is_refused(kb):  # noqa: F811
    save(kb)
    args = {"symbol": "XLE", "metric": "price", "condition": "above", "threshold": 61.0, "words": "avisame",
            "prompt": "avisame", "now": NOW, "thesis": "rebote", "strategies": [NAME]}
    with pytest.raises(KnowledgeError, match="strategy activate"):
        watch.add(kb, **args)
    activate(kb)
    assert watch.add(kb, **args).strategies == [NAME]
    # loose avisos without strategy are untouched
    assert watch.add(kb, **{**args, "thesis": "", "strategies": [], "threshold": 70.0}).strategies == []


def test_every_pass_leaves_a_run_and_the_entry_alerts_once(kb):  # noqa: F811
    save(kb)
    activate(kb)
    supervisor.scan(kb, reader(mid=58.0), IN_SESSION + timedelta(minutes=5))
    out = supervisor.scan(kb, reader(mid=61.2), IN_SESSION + timedelta(minutes=10))
    lines = seguimiento.runs(kb, NAME)
    assert [(x["role"], x["outcome"], x["value"]) for x in lines] == [
        ("entry", "not_met", 58.0), ("invalidation", "not_met", 58.0), ("entry", "met", 61.2),
        ("invalidation", "not_met", 61.2)]
    assert set(lines[0]) == {"at", "rule", "role", "outcome", "value", "threshold"}
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and alert.strategy == NAME and "se dio la regla de entrada" in alert.motivo
    supervisor.scan(kb, reader(mid=61.5), IN_SESSION + timedelta(minutes=15))
    assert len(supervisor.alerts(kb)) == 1


def test_a_closed_market_leaves_no_run(kb):  # noqa: F811
    save(kb)
    activate(kb)
    supervisor.scan(kb, reader(), NOW.replace(hour=12))     # 08:00 New York
    assert seguimiento.runs(kb, NAME) == []


def test_a_failed_read_is_a_run_and_one_health_alert_per_rule_and_day(kb):  # noqa: F811
    save(kb)
    activate(kb)
    for minutes in (5, 10):
        supervisor.scan(kb, reader(fail=True), IN_SESSION + timedelta(minutes=minutes))
    alerts = supervisor.alerts(kb)
    assert len(alerts) == 2 and all(a.kind == AlertKind.WATCH and a.dato["salud"] == "falló" for a in alerts)
    assert all("Falló la lectura" in a.motivo and "HTTP 502" in a.motivo for a in alerts)
    assert [x["outcome"] for x in seguimiento.runs(kb, NAME)] == ["failed"] * 4
    assert "HTTP 502" in seguimiento.runs(kb, NAME)[0]["reason"]
    supervisor.scan(kb, reader(fail=True), IN_SESSION + timedelta(days=1))     # next day: again, once per rule
    assert len(supervisor.alerts(kb)) == 4
    assert {r["status"] for r in watch.view(kb, IN_SESSION)} == {"active"}      # a failure is not «met»


def test_a_met_invalidation_alerts_stops_the_other_avisos_and_says_to_rearm(kb):  # noqa: F811
    save(kb)
    activate(kb)
    out = supervisor.scan(kb, reader(mid=56.5), IN_SESSION + timedelta(minutes=5))
    [alert] = supervisor.alerts(kb)
    assert out["new"] == [alert.id] and "quedó invalidada" in alert.motivo and "re-armarla" in alert.propuesta
    assert {r["threshold"]: r["status"] for r in watch.view(kb, IN_SESSION)} == {57.0: "met", 60.99: "cancelled"}
    assert not seguimiento.is_active(kb, NAME)
    supervisor.scan(kb, reader(mid=70.0), IN_SESSION + timedelta(minutes=10))     # the cancelled entry no longer fires
    assert len(supervisor.alerts(kb)) == 1


def test_explain_says_if_it_was_met_how_close_it_got_and_where_the_holes_are(kb):  # noqa: F811
    save(kb)
    activate(kb)
    supervisor.scan(kb, reader(mid=58.0), IN_SESSION + timedelta(minutes=5))
    supervisor.scan(kb, reader(mid=60.0), IN_SESSION + timedelta(minutes=10))        # the closest one
    supervisor.scan(kb, reader(fail=True), IN_SESSION + timedelta(minutes=15))
    now = datetime(2026, 9, 25, 22, 0, tzinfo=UTC)                                   # Friday 18:00 New York
    out = seguimiento.explain(kb, NAME, now)
    [entry] = out["entrada"]
    assert entry["cumplida"] is False and entry["lecturas_validas"] == 2
    assert entry["lectura_mas_cercana"]["value"] == 60.0
    assert entry["lectura_mas_cercana"]["distancia"] == 0.99 and entry["lectura_mas_cercana"]["distancia_pct"] == 1.62
    assert out["invalidacion"]["cumplida"] is False and out["estado"] == "vigilando"
    assert out["huecos"]["ruedas_sin_lectura_valida"] == ["2026-09-24", "2026-09-25"]
    assert [(f["veces"], f["dia"]) for f in out["huecos"]["fallas"]] == [(1, "2026-09-23")] * 2   # one per rule
    assert all("HTTP 502" in f["motivo"] for f in out["huecos"]["fallas"])
    assert out["version_activa"] == "0.2.0" and out["versiones"][0]["activada"] == IN_SESSION.isoformat()


def test_explain_after_the_entry_and_after_an_invalidation(kb):  # noqa: F811
    save(kb)
    activate(kb)
    supervisor.scan(kb, reader(mid=61.0), IN_SESSION + timedelta(minutes=5))
    out = seguimiento.explain(kb, NAME, IN_SESSION + timedelta(hours=1))
    assert out["entrada"][0]["cumplida"] is True and out["entrada"][0]["cuando"] == (IN_SESSION + timedelta(minutes=5)).isoformat()
    assert out["huecos"]["ruedas_sin_lectura_valida"] == []
    supervisor.scan(kb, reader(mid=56.0), IN_SESSION + timedelta(minutes=10))
    out = seguimiento.explain(kb, NAME, IN_SESSION + timedelta(days=2))
    assert out["estado"] == "invalidada" and out["invalidacion"]["cumplida"] is True
    assert out["hasta"] == (IN_SESSION + timedelta(minutes=10)).isoformat()
    with pytest.raises(KnowledgeError, match="nunca se activó"):
        seguimiento.explain(kb, "otra_estrategia_sin_activar")


def test_the_cli_activates_and_explains(kb, capsys, monkeypatch):  # noqa: F811
    import asyncio

    from galecore_ai.adapters import cli
    save(kb)
    monkeypatch.setattr(cli, "_publish_watches", lambda _kb: {"status": "OFF"})
    args = cli.build_parser().parse_args(["strategy", "activate", NAME, "--mode", "seguimiento",
                                          "--prompt", "activá", "--text", "dale"])
    with pytest.raises(SystemExit):
        asyncio.run(cli._cmd_strategy(args))
    printed = json.loads(capsys.readouterr().out)
    assert printed["status"] == "ACTIVA" and len(printed["avisos"]) == 2
    args = cli.build_parser().parse_args(["strategy", "explain", NAME])
    with pytest.raises(SystemExit):
        asyncio.run(cli._cmd_strategy(args))
    assert json.loads(capsys.readouterr().out)["version_activa"] == "0.2.0"


def test_the_design_view_carries_the_board_of_a_strategy_in_seguimiento(kb):  # noqa: F811
    from galecore_ai.application import project
    save(kb)
    assert project._seguimiento(kb, NAME, IN_SESSION) is None                  # not activated: no board
    activate(kb)
    supervisor.scan(kb, reader(mid=58.0), IN_SESSION + timedelta(minutes=5))
    board = project._seguimiento(kb, NAME, IN_SESSION + timedelta(minutes=6))
    assert board["estado"] == "vigilando" and board["version_activa"] == "0.2.0"
    assert board["ultima"]["value"] == 58.0 and board["mercado_abierto"] and board["proxima"] is None
    closed = project._seguimiento(kb, NAME, IN_SESSION + timedelta(hours=10))     # 21:00 New York
    assert not closed["mercado_abierto"] and closed["proxima"].startswith("2026-09-24T09:30")
    assert "seguimiento" in project.strategy_design_view(kb, NAME)
