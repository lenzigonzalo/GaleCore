"""GC-AI-0021: the trader's space in GaleCore, read and written as the trader (against a fake GaleCore)."""

from __future__ import annotations

import json

import httpx
import pytest

from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
from galecore_ai.application import space
from tests.unit.test_knowledge import kb  # noqa: F401  (fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (fixture)
from tests.unit.test_tasks import env  # noqa: F401  (fixture)


class FakeGaleCore:
    """Login + /App/GaleCore/Space with the API's rules: own pieces editable, shared from others read-only."""

    def __init__(self):
        self.rows: dict[tuple, dict] = {}
        self.puts = 0
        self.rows[("skill", "ajena")] = {"kind": "skill", "key": "ajena", "title": "De otro", "content": "x",
                                         "format": "markdown", "visibility": "shared", "version": 1, "isOwn": False,
                                         "owner": "otro"}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/App/GaleCore/Auth/Login":
            body = json.loads(request.content)
            ok = body == {"username": "demo", "password": "secreto"}
            return httpx.Response(200 if ok else 401, json={"accessToken": "tok"} if ok else {"error": "no"})
        if request.headers.get("Authorization") != "Bearer tok":
            return httpx.Response(401)
        if request.method == "GET" and path == "/App/GaleCore/Space":
            kind = request.url.params.get("kind")
            rows = [r for r in self.rows.values() if kind in (None, r["kind"])]
            return httpx.Response(200, json={"items": [r for r in rows if r["isOwn"]],
                                             "shared": [r for r in rows if not r["isOwn"]]})
        kind, key = path.split("/")[-2:]
        if request.method == "PUT":
            self.puts += 1
            body = json.loads(request.content)
            old = self.rows.get((kind, key))
            version = (old["version"] + 1) if old else 1
            self.rows[(kind, key)] = {"kind": kind, "key": key, **body, "version": version, "isOwn": True,
                                      "owner": "demo"}
            return httpx.Response(200, json={"kind": kind, "key": key, "version": version})
        if request.method == "DELETE":
            self.rows.pop((kind, key))
            return httpx.Response(204)
        return httpx.Response(405)


@pytest.fixture
def galecore(monkeypatch):
    monkeypatch.setenv("GALECORE_USERNAME", "demo")
    monkeypatch.setenv("GALECORE_PASSWORD", "secreto")
    fake = FakeGaleCore()
    return fake, SpaceClient("http://galecore.test", "k", transport=httpx.MockTransport(fake))


PIECES = [
    {"kind": "profile", "key": "perfil", "title": "Perfil (profile:v5)", "format": "json", "visibility": "private",
     "content": json.dumps({"version": 5, "reference_capital": {"amount": 10000, "currency": "USD"},
                            "horizon": "30 a 45 días", "risk_limits": ["5 % por operación"]})},
    {"kind": "objective", "key": "retorno", "title": "Retorno anual de 10 a 15 %", "content": "Retorno anual de 10 a 15 %",
     "format": "markdown", "visibility": "private"},
    {"kind": "agent", "key": "oportunidades", "title": "oportunidades (market_watch)", "content": "{}",
     "format": "json", "visibility": "private"},
]


def test_import_writes_only_what_changed(galecore):
    fake, client = galecore
    first = space.sync(client, PIECES)
    assert len(first["created"]) == 3 and fake.puts == 3
    again = space.sync(client, PIECES)
    assert again["created"] == [] and again["updated"] == [] and fake.puts == 3      # nothing new: no version bump
    changed = [{**PIECES[1], "content": "Retorno anual de 12 %"}]
    assert space.sync(client, changed)["updated"] == ["objective/retorno"]
    assert fake.rows[("objective", "retorno")]["version"] == 2


def test_the_session_starts_with_who_the_trader_is(galecore):
    _, client = galecore
    space.sync(client, PIECES)
    client.login()
    text = space.context(client)
    assert "demo: 3 piezas propias, 1 compartidas" in text
    assert "perfil v5" in text and "30 a 45 días" in text
    assert "objetivos: Retorno anual de 10 a 15 %" in text and "agentes: oportunidades" in text
    assert "compartido: skill (1)" in text


def test_a_wrong_login_is_an_error_without_the_password(monkeypatch):
    monkeypatch.setenv("GALECORE_USERNAME", "demo")
    monkeypatch.setenv("GALECORE_PASSWORD", "otra-clave")
    client = SpaceClient("http://galecore.test", "k", transport=httpx.MockTransport(FakeGaleCore()))
    with pytest.raises(SpaceError) as exc:
        client.items()
    assert "otra-clave" not in str(exc.value)


def test_local_pieces_bring_profile_objectives_conventions_agents_and_skills(env):  # noqa: F811
    kb_, sch, _ = env
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    make(kb_, sch, task_id="vieja", strategy=None, capability="market_watch", schedule=MARKET)
    t.cancel(kb=kb_, scheduler=sch, task_id="vieja", prompt="ya no")
    kinds = {}
    for p in space.local_pieces(kb_):
        kinds.setdefault(p["kind"], []).append(p)
    assert [p["key"] for p in kinds["agent"]] == ["oportunidades"]          # the cancelled one is history
    assert kinds["convention"][0]["visibility"] == "shared"
    assert all(p["visibility"] == "shared" for p in kinds["skill"]) and len(kinds["skill"]) > 5




def test_two_long_objectives_with_the_same_start_keep_two_keys(env):  # noqa: F811
    kb_, _, _ = env
    from galecore_ai.application.profile import set_profile
    from galecore_ai.contracts.regime_record import RecordHost
    start = "retorno anual buscado de diez a quince por ciento sobre el capital de referencia "
    set_profile(kb_.profile, changes={"objectives": [start + "en SPY", start + "en QQQ"]}, note="dos objetivos",
                prompt="probar", host=RecordHost(provider="test", model="test"))
    keys = [p["key"] for p in space.local_pieces(kb_) if p["kind"] == "objective"]
    assert len(keys) == 2 and len(set(keys)) == 2


# ── GC-AI-0023: the monitor's Agentes screen ─────────────────────


def _now() -> str:
    from datetime import UTC, datetime, timedelta
    return (datetime.now(UTC) + timedelta(seconds=1)).isoformat()


def _agent(fake, key="oportunidades"):
    return json.loads(fake.rows[("agent", key)]["content"])


def test_an_agent_is_published_with_its_last_run_and_findings(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_model_tasks import LATER, model_ok, output
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET,
         objective="Revisá SPY: IV rank > 30")
    first = space.publish_agents(client, kb_, sch, now=LATER)
    assert first["created"] == ["agent/oportunidades"] and _agent(fake)["last_run"] is None
    t_run = __import__("galecore_ai.application.tasks", fromlist=["run"]).run
    t_run(kb=kb_, task_id="oportunidades", commit=False, now=LATER, client=model_ok(output()),
          followup=lambda **kw: None)
    space.publish_agents(client, kb_, sch, now=LATER)
    a = _agent(fake)
    assert a["id"] == "oportunidades" and a["status"] == "active" and a["runs"] == 1
    assert a["last_run"]["result"] == "OK" and a["last_run"]["failed"] is False
    assert a["findings"].startswith("**") and a["result_ref"].startswith("research:")
    again = space.publish_agents(client, kb_, sch, now=LATER)
    assert again["updated"] == [] and again["unchanged"] == ["agent/oportunidades"]   # nothing new: no version bump


def test_the_monitor_turns_an_agent_off_and_on(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    # What the monitor writes: the piece as it was, plus the request.
    client.put("agent", "oportunidades", title="oportunidades (market_watch)",
               content=json.dumps({**_agent(fake), "request": {"status": "paused", "at": _now()}}),
               fmt="json")
    out = space.publish_agents(client, kb_, sch)
    assert out["requests"] == [{"agent": "oportunidades", "status": "paused", "result": "applied"}]
    assert t.load(kb_, "oportunidades").status == "paused" and sch.tasks[t.SCHEDULER_FOLDER + r"\oportunidades"][
        "enabled"] is False
    paused = [e for e in t.events(kb_, "oportunidades") if e["event"] == "paused"][-1]
    assert "monitor" in paused["prompt"] and "demo" in paused["prompt"]
    assert _agent(fake)["status"] == "paused" and "request" not in _agent(fake)    # applied: the request is gone
    client.put("agent", "oportunidades", title="x", fmt="json",
               content=json.dumps({**_agent(fake), "request": {"status": "active", "at": _now()}}))
    space.publish_agents(client, kb_, sch)
    assert t.load(kb_, "oportunidades").status == "active" and _agent(fake)["status"] == "active"


def test_a_request_that_cannot_be_applied_says_why(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    t.cancel(kb=kb_, scheduler=sch, task_id="oportunidades", prompt="ya no")
    client.put("agent", "oportunidades", title="x", fmt="json",
               content=json.dumps({"id": "oportunidades", "status": "active", "request": {"status": "active", "at": _now()}}))
    out = space.publish_agents(client, kb_, sch)
    assert out["requests"][0]["result"] == "refused" and "cancelado" in out["requests"][0]["error"]
    assert t.load(kb_, "oportunidades").status == "cancelled"
    row = _agent(fake)          # what the monitor reads: no longer running, and why the request did not happen
    assert row["status"] == "cancelled" and "request" not in row and "cancelado" in row["request_error"]


def test_an_old_request_does_not_undo_a_later_decision(env, galecore):  # noqa: F811
    # Internal review 04/10: a «Prender» from Monday applied on Thursday over the owner's Wednesday pause.
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    client.put("agent", "oportunidades", title="x", fmt="json",
               content=json.dumps({**_agent(fake), "request": {"status": "paused", "at": "2020-01-01T00:00:00Z"}}))
    out = space.publish_agents(client, kb_, sch)
    assert out["requests"][0]["result"] == "refused" and "posterior" in out["requests"][0]["error"]
    assert t.load(kb_, "oportunidades").status == "active" and "posterior" in _agent(fake)["request_error"]
    space.publish_agents(client, kb_, sch)
    assert "posterior" in _agent(fake)["request_error"]       # stays until the next request
    client.put("agent", "oportunidades", title="x", fmt="json",
               content=json.dumps({**_agent(fake), "request": {"status": "paused"}}))      # no time: refused
    assert space.publish_agents(client, kb_, sch)["requests"][0]["error"] == "pedido sin hora válida"
    client.put("agent", "oportunidades", title="x", fmt="json",
               content=json.dumps({**_agent(fake), "request": {"status": "paused", "at": "2999-01-01T00:00:00Z"}}))
    assert "futura" in space.publish_agents(client, kb_, sch)["requests"][0]["error"]
    assert t.load(kb_, "oportunidades").status == "active"


def test_a_piece_changed_while_publishing_is_left_for_the_next_pass(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    real_sync = space.sync

    def monitor_writes_meanwhile(c, pieces, seen=None):
        c.put("agent", "oportunidades", title="x", fmt="json",
              content=json.dumps({**_agent(fake), "request": {"status": "paused", "at": _now()}}))
        return real_sync(c, pieces, seen)
    space.sync = monitor_writes_meanwhile
    try:
        out = space.publish_agents(client, kb_, sch)
    finally:
        space.sync = real_sync
    assert out["deferred"] == ["agent/oportunidades"] and _agent(fake)["request"]["status"] == "paused"
    space.publish_agents(client, kb_, sch)
    assert t.load(kb_, "oportunidades").status == "paused"


def test_a_broken_agent_piece_does_not_block_publishing(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    client.put("agent", "oportunidades", title="x", fmt="json", content="no es json")
    assert space.publish_agents(client, kb_, sch)["updated"] == ["agent/oportunidades"]
    assert _agent(fake)["id"] == "oportunidades"


def test_a_piece_whose_id_is_not_its_agent_is_refused(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    _, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    client.put("agent", "otra", title="x", fmt="json",
               content=json.dumps({"id": "oportunidades", "request": {"status": "paused", "at": _now()}}))
    out = space.apply_requests(client, kb_, sch)
    assert out[0]["result"] == "refused" and t.load(kb_, "oportunidades").status == "active"


def test_the_sync_task_runs_every_five_minutes(monkeypatch):
    from galecore_ai.application import tasks as t
    seen = {}
    monkeypatch.setattr(t.WindowsScheduler, "_run", lambda self, args: seen.setdefault("args", args) or "")
    t.WindowsScheduler().create_every(t.SYNC_TASK, t.sync_command(), t.SYNC_MINUTES)
    args = seen["args"]
    assert args[args.index("/tn") + 1] == r"GaleCore-AI\espacio-agentes"
    assert args[args.index("/sc") + 1] == "minute" and args[args.index("/mo") + 1] == "5"
    assert args[args.index("/tr") + 1].endswith("space_sync.py")
