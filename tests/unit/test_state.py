"""WS-0023 (P1-PPa §A): the state is read from GaleCore in the run; data health is three answers, never one «OK»."""

from __future__ import annotations

from datetime import timedelta

from galecore_ai.application import state, supervisor
from tests.unit.test_knowledge import NOW
from tests.unit.test_supervisor import IN_SESSION, position

OUT_OF_SESSION = NOW.replace(hour=23)    # 19:00 New York


def status(instances, *, enabled=False):
    return {"persistence": {"available": True}, "switch": {"enabled": enabled, "source": "platform"},
            "instances": instances, "supportedStructures": ["put_credit_spread", "call_credit_spread", "iron_condor"]}


def inst(iid, state_="RUNNING", name="spy_prima_varianza_30_45d"):
    return {"instanceId": iid, "specName": name, "lifecycleState": state_, "schedulerState": "PAUSED",
            "versionHash": "sha256:x"}


def reader(st, positions_by_iid, *, quote=None, fail_status=False, fail_quote=False, fail_iid=None):
    def read(path):
        if path == "/App/Runtime/Status":
            if fail_status:
                raise supervisor.SupervisorError("GaleCore no respondió en http://localhost:7001: ConnectError")
            return st
        if path.startswith("/App/Runtime/Instances/"):
            iid = path.split("/")[4]
            if iid == fail_iid:
                raise supervisor.SupervisorError(f"GET {path} -> HTTP 500")
            return positions_by_iid[iid]
        if path.startswith("/Data/Tastytrade/MarketData/Quote"):
            if fail_quote:
                raise supervisor.SupervisorError("GET quote -> HTTP 500")
            return quote if quote is not None else {"type": "FEED_DATA", "data": []}
        raise AssertionError(path)
    return read


def four_open_one_closed(valued_at):
    opened = [position(pid=f"p{i}aaaaaaa", symbol="SPY", lastValuedAt=valued_at) for i in range(4)]
    return opened + [position(pid="cclosed00", status="CLOSED", symbol="SPY")]


def test_counts_positions_across_instances_and_reads_switch_and_structures():
    fresh = (IN_SESSION - timedelta(minutes=2)).isoformat()
    st = status([inst("i-run"), inst("i-old", "STOPPED"), inst("i-test", "STOPPED", "shadow_runtime_test_v1")])
    read = reader(st, {"i-run": four_open_one_closed(fresh), "i-old": [position(pid="old", status="CLOSED")],
                       "i-test": []}, quote={"data": [{"midPrice": 778.5}]})
    out = state.snapshot(read, IN_SESSION)
    rt = out["runtime"]
    assert rt["posiciones_abiertas"] == 4
    assert rt["entradas"].startswith("pausadas")
    assert rt["estructuras_ejecutables"] == ["put_credit_spread", "call_credit_spread", "iron_condor"]
    assert [(i["instancia"], i["abiertas"], i["cerradas"]) for i in rt["instancias"]] == [("i-run", 4, 1)]
    assert out["leido_a"] == IN_SESSION.isoformat() and out["sesion"] == "abierta"


def test_data_health_is_three_separate_answers_and_never_a_general_ok():
    fresh = (IN_SESSION - timedelta(minutes=2)).isoformat()
    out = state.snapshot(reader(status([inst("i-run")]), {"i-run": four_open_one_closed(fresh)},
                                quote={"data": [{"midPrice": 778.5}]}), IN_SESSION)
    datos = out["datos"]
    assert set(datos) == {"conectividad", "frescura", "cobertura"}
    assert datos["conectividad"] == [{"fuente": "cotización SPY", "estado": "ok", "mid": 778.5}]
    assert datos["frescura"]["estado"] == "ok" and datos["cobertura"]["estado"] == "ok"
    assert "OK" not in str(out)                      # no summary that turns a probe into «datos OK»


def test_a_source_that_answers_without_a_quote_is_not_connectivity_ok():
    out = state.snapshot(reader(status([inst("i-run")]), {"i-run": four_open_one_closed(IN_SESSION.isoformat())}),
                         OUT_OF_SESSION)
    assert out["datos"]["conectividad"][0]["estado"] == "sin_datos"
    assert out["datos"]["frescura"]["estado"] == "no_se_mide"       # closed market: the last price is the session's


def test_stale_valuation_in_session_and_partial_coverage():
    old = (IN_SESSION - timedelta(minutes=supervisor.NO_PRICE_MINUTES + 5)).isoformat()
    positions = four_open_one_closed(old)
    positions[0]["valuationProblems"] = ["sin cotización de la pata 738P"]
    positions[0]["lastSpreadValue"] = None
    out = state.snapshot(reader(status([inst("i-run")]), {"i-run": positions},
                                quote={"data": [{"midPrice": 778.5}]}), IN_SESSION)
    assert out["datos"]["frescura"]["estado"] == "vieja"
    assert out["datos"]["cobertura"] == {"estado": "parcial", "valuadas": 3, "abiertas": 4, "sin_precio": ["p0aaaaaa"]}


def test_a_valued_position_with_problems_is_a_warning_not_missing_price():
    positions = four_open_one_closed((IN_SESSION - timedelta(minutes=1)).isoformat())
    positions[0]["lastSpreadValue"] = 0.4
    positions[0]["valuationProblems"] = ["salida por condición sin dato: capability:compute.ema_spread.AAPL.20.50"]
    out = state.snapshot(reader(status([inst("i-run")]), {"i-run": positions},
                                quote={"data": [{"midPrice": 778.5}]}), IN_SESSION)
    assert out["datos"]["cobertura"] == {"estado": "ok", "valuadas": 4, "abiertas": 4, "sin_precio": [],
                                         "con_aviso": ["p0aaaaaa"]}


def test_unread_galecore_is_unverified_never_a_repeated_record():
    out = state.snapshot(reader({}, {}, fail_status=True, fail_quote=True), IN_SESSION)
    assert out["runtime"]["estado"] == state.UNVERIFIED and "ConnectError" in out["runtime"]["error"]
    assert out["datos"]["frescura"]["estado"] == state.UNVERIFIED
    assert out["datos"]["conectividad"][0]["estado"] == "error"


def test_one_unread_instance_makes_the_count_incomplete_not_wrong():
    st = status([inst("i-run"), inst("i-two")])
    read = reader(st, {"i-run": four_open_one_closed(IN_SESSION.isoformat())}, fail_iid="i-two",
                  quote={"data": [{"midPrice": 1.0}]})
    rt = state.snapshot(read, IN_SESSION)["runtime"]
    assert rt["posiciones_abiertas"] == "4 (incompleto: 1 instancia(s) sin leer)"
    assert rt["problemas"] and "HTTP 500" in rt["problemas"][0]


def test_says_whether_a_stopped_strategy_still_runs_exits_of_what_is_open():
    """BL-023: from GaleCore's openPositionsManagement, not from reading code; absent field → «sin verificar»."""
    fresh = (IN_SESSION - timedelta(minutes=2)).isoformat()
    st = status([inst("i-stop", "STOPPED"), inst("i-nospec", "STOPPED", "otra"), inst("i-old", "STOPPED", "vieja")])
    st["openPositionsManagement"] = [
        {"instanceId": "i-stop", "exitsManaged": True, "detail": "detener sólo frena entradas nuevas"},
        {"instanceId": "i-nospec", "exitsManaged": False, "detail": "sin la spec de la instancia"}]
    read = reader(st, {"i-stop": four_open_one_closed(fresh), "i-nospec": [position(pid="n1", lastValuedAt=fresh)],
                       "i-old": [position(pid="o1", lastValuedAt=fresh)]}, quote={"data": [{"midPrice": 778.5}]})
    rows = {i["instancia"]: i for i in state.snapshot(read, IN_SESSION)["runtime"]["instancias"]}
    assert rows["i-stop"]["salidas_de_abiertas"].startswith("se ejecutan")
    assert rows["i-nospec"]["salidas_de_abiertas"].startswith("no se ejecutan")
    assert rows["i-old"]["salidas_de_abiertas"] == state.UNVERIFIED
