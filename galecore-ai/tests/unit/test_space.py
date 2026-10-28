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
    assert "perfil" not in text and "30 a 45 días" not in text and "además: 1 agentes" in text   # WS-0058: no trading profile
    assert "compartido: skill (1)" in text


def test_the_traders_own_skills_are_named_for_the_chat(galecore):  # WS-0054: created in the monitor, private
    _, client = galecore
    own = {"kind": "skill", "title": "Volatilidad de SPY", "format": "markdown", "visibility": "private",
           "content": "\nResume la volatilidad de SPY en una línea.\n\n## Pasos\n1. Traer los datos."}
    product = {**own, "key": "capital-risk", "title": "Riesgo y capital", "visibility": "shared"}
    space.sync(client, [{**own, "key": "volatilidad-spy"}, product])
    client.login()
    text = space.context(client)
    assert ("skill propia «Volatilidad de SPY» (`space show skill/volatilidad-spy`): "
            "Resume la volatilidad de SPY en una línea.") in text
    assert "Riesgo y capital" not in text                      # the product's skills come through the catalog


def test_the_context_brings_name_interests_and_memory_only(galecore):  # WS-0058
    _, client = galecore
    space.sync(client, [
        {"kind": "convention", "key": "como-te-llamo", "title": "Cómo te llamo", "content": "Llamame «Gonza».",
         "format": "markdown", "visibility": "private"},
        {"kind": "convention", "key": "intereses", "title": "Intereses", "content": "opciones sobre SPY",
         "format": "markdown", "visibility": "private"},
        {"kind": "convention", "key": "formato", "title": "Formato de respuesta", "content": "conclusión primero",
         "format": "markdown", "visibility": "private"},
        {"kind": "memory", "key": "riesgo", "title": "Riesgo por posición",
         "content": "nunca más del 20 % del riesgo del portfolio", "format": "markdown", "visibility": "private"},
    ])
    client.login()
    text = space.context(client)
    assert "nombre: Llamame «Gonza»." in text and "intereses: opciones sobre SPY" in text
    assert "memoria — Riesgo por posición: nunca más del 20 % del riesgo del portfolio" in text
    assert "Formato de respuesta" not in text and "memorias" not in text


def test_a_wrong_login_is_an_error_without_the_password(monkeypatch):
    monkeypatch.setenv("GALECORE_USERNAME", "demo")
    monkeypatch.setenv("GALECORE_PASSWORD", "otra-clave")
    client = SpaceClient("http://galecore.test", "k", transport=httpx.MockTransport(FakeGaleCore()))
    with pytest.raises(SpaceError) as exc:
        client.items()
    assert "otra-clave" not in str(exc.value)


def test_local_pieces_bring_agents_and_skills_and_no_profile(env):  # WS-0058  # noqa: F811
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
    assert not {"profile", "objective", "convention"} & kinds.keys()   # the profile is name, interests and memory
    assert all(p["visibility"] == "shared" for p in kinds["skill"]) and len(kinds["skill"]) > 5


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


def test_settings_from_monitor_apply_once_and_preserve_schedule(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    task = make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    client.put("agent", task.id, title="x", fmt="json", content=json.dumps({**_agent(fake), "request": {
        "settings": {"objective": "Observar cambios de SPY", "model": "haiku"}, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "applied"
    saved = t.load(kb_, task.id)
    assert saved.model == "haiku" and saved.objective == "Observar cambios de SPY"
    assert saved.schedule == task.schedule and saved.status == task.status and saved.allowed == task.allowed
    assert _agent(fake)["model"] == "haiku" and "request" not in _agent(fake)
    assert _agent(fake)["editable"] and _agent(fake)["model_editable"]
    space.publish_agents(client, kb_, sch)
    assert len([e for e in t.events(kb_, task.id) if e["event"] == "settings_changed"]) == 1


@pytest.mark.parametrize("settings", [{"model": "unknown"}, {"objective": " "}, {"schedule": {}},
                                     {"objective": "x" * 12001}])
def test_invalid_settings_are_refused_without_changing_task(env, galecore, settings):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    task = make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    client.put("agent", task.id, title="x", fmt="json", content=json.dumps({**_agent(fake), "request": {
        "settings": settings, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "refused"
    assert t.load(kb_, task.id) == task
    assert _agent(fake)["request_error"]


def test_history_keeps_each_research_revision_and_does_not_reuse_it_for_failed_attempt(env):  # noqa: F811
    kb_, sch, _ = env
    from datetime import timedelta

    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_model_tasks import LATER, model_ok, output
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    for i, title in enumerate(["Informe primero", "Informe segundo"]):
        t.run(kb=kb_, task_id="oportunidades", commit=False, now=LATER + timedelta(hours=i),
              client=model_ok(output(title=title)), followup=lambda **kw: None)
    t._append(kb_, "oportunidades", "run_finished", LATER + timedelta(hours=3), result="INCOMPLETE",
              reason="output refused: malformed reference")
    state = space.agent_state(kb_, "oportunidades", LATER + timedelta(hours=4))
    assert state["history_total"] == 3
    rows = state["history"]
    assert rows[0]["result"] == "INCOMPLETE" and rows[0]["findings"] is None
    assert "Informe segundo" in rows[1]["findings"] and "Informe primero" in rows[2]["findings"]
    for i in range(25):
        t._append(kb_, "oportunidades", "run_failed", LATER + timedelta(hours=5 + i), error="offline")
    bounded = space.agent_state(kb_, "oportunidades")
    assert len(bounded["history"]) == 20 and bounded["history_total"] == 28


def test_code_agent_rejects_model_selection(env):  # noqa: F811
    kb_, sch, _ = env
    from galecore_ai.application import tasks as t
    from tests.unit.test_tasks import make
    task = make(kb_, sch)
    with pytest.raises(t.TaskError, match="sin modelo"):
        t.set_settings(kb=kb_, task_id=task.id, settings={"model": "opus"}, prompt="monitor",
                       expected_updated_at=task.updated_at)
    assert t.load(kb_, task.id) == task


def test_combined_settings_and_current_status_are_refused_instead_of_discarded(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    task = make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    client.put("agent", task.id, title="x", fmt="json", content=json.dumps({**_agent(fake), "request": {
        "status": "active", "settings": {"objective": "Otra instrucción"}, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "refused"
    assert t.load(kb_, task.id) == task
    assert "por separado" in _agent(fake)["request_error"]


# ── WS-0055: days, tools, delivery and new agents from the monitor ─────


def _market_agent(env_):
    kb_, sch, _ = env_
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    return make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)


def test_schedule_tools_and_delivery_are_edited_from_the_monitor(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    task = _market_agent(env)
    space.publish_agents(client, kb_, sch)
    published = _agent(fake)
    assert published["tools_available"] and published["tools"] == published["tools_available"]
    fewer = published["tools_available"][:2]
    settings = {"schedule": {"frequency": "days", "days": ["wed", "mon"], "time": "10:00",
                             "timezone": "America/New_York"}, "tools": fewer, "delivery": ["historial", "biblioteca"]}
    client.put("agent", task.id, title="x", fmt="json",
               content=json.dumps({**published, "request": {"settings": settings, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "applied"
    saved = t.load(kb_, task.id)
    assert saved.schedule.days == ["mon", "wed"] and saved.tools == fewer and saved.delivery == ["historial", "biblioteca"]
    assert "lunes y miércoles" in saved.schedule.describe()
    assert sch.calls[-1][2] == "days"
    assert _agent(fake)["schedule_spec"]["days"] == ["mon", "wed"]


@pytest.mark.parametrize("settings", [{"tools": ["Bash(rm:*)"]}, {"tools": "abc"}, {"delivery": ["biblioteca"]},
                                     {"schedule": {"frequency": "days", "days": [], "time": "10:00",
                                                   "timezone": "America/New_York"}}])
def test_tools_outside_the_skill_and_bad_schedule_are_refused(env, galecore, settings):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    task = _market_agent(env)
    space.publish_agents(client, kb_, sch)
    client.put("agent", task.id, title="x", fmt="json", content=json.dumps({**_agent(fake), "request": {
        "settings": settings, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "refused"
    assert t.load(kb_, task.id) == task


def test_a_new_agent_is_created_from_a_monitor_request(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    create = {"id": "gamma-qqq", "kind": "market_watch", "objective": "Mirar el gamma de QQQ",
              "schedule": {"frequency": "days", "days": ["tue", "thu"], "time": "09:00", "timezone": "America/New_York"},
              "delivery": ["historial", "biblioteca"]}
    client.put("agent", "gamma-qqq", title="x", fmt="json",
               content=json.dumps({"request": {"create": create, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "applied"
    task = t.load(kb_, "gamma-qqq")
    assert task.kind == "market_watch" and task.schedule.days == ["tue", "thu"] and "Alta desde el monitor" in task.created_by_prompt
    assert _agent(fake, "gamma-qqq")["objective"] == "Mirar el gamma de QQQ"
    bad = {**create, "id": "otro", "kind": "strategy_followup"}
    client.put("agent", "otro", title="x", fmt="json", content=json.dumps({"request": {"create": bad, "at": _now()}}))
    assert space.publish_agents(client, kb_, sch)["requests"][0]["result"] == "refused"
    client.put("agent", "gamma-qqq", title="x", fmt="json", content=json.dumps({"request": {"create": create, "at": _now()}}))
    again = [r for r in space.publish_agents(client, kb_, sch)["requests"] if r["agent"] == "gamma-qqq"]
    assert again and again[0]["result"] == "refused" and "ya existe" in again[0]["error"]


def test_a_cancelled_agent_leaves_the_space(env, galecore):  # noqa: F811
    # WS-0063: a cancelled task is history; it no longer stays listed in the space as «cancelled».
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    assert ("agent", "oportunidades") in fake.rows
    t.cancel(kb=kb_, scheduler=sch, task_id="oportunidades", prompt="ya no")
    space.publish_agents(client, kb_, sch)
    assert ("agent", "oportunidades") not in fake.rows
    client.put("agent", "vieja", title="x", fmt="json", content=json.dumps({"id": "vieja", "status": "cancelled"}))
    space.publish_agents(client, kb_, sch)                      # one already published as cancelled goes too
    assert ("agent", "vieja") not in fake.rows


# -- session token cache (the API allows 10 logins per 5 minutes)

def _jwt(exp: float) -> str:
    import base64
    body = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return f"h.{body}.s"


class CountingGaleCore:
    def __init__(self, token: str):
        self.logins, self.token, self.valid = 0, token, True

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/App/GaleCore/Auth/Login":
            self.logins += 1
            return httpx.Response(200, json={"accessToken": self.token})
        if not self.valid or request.headers.get("Authorization") != f"Bearer {self.token}":
            return httpx.Response(401)
        return httpx.Response(200, json={"items": [], "shared": []})


def _client(fake, monkeypatch, base="http://galecore.test"):
    monkeypatch.setenv("GALECORE_USERNAME", "demo")
    monkeypatch.setenv("GALECORE_PASSWORD", "secreto")
    return SpaceClient(base, "k", transport=httpx.MockTransport(fake))


def test_the_token_is_reused_across_clients_until_it_expires(monkeypatch):
    import time
    fake = CountingGaleCore(_jwt(time.time() + 3600))
    for _ in range(3):                      # three "CLI calls" = three clients
        _client(fake, monkeypatch).items()
    assert fake.logins == 1
    from galecore_ai.adapters.galecore_space import session_file
    assert "secreto" not in session_file().read_text(encoding="utf-8")


def test_a_token_about_to_expire_is_not_reused(monkeypatch):
    import time
    fake = CountingGaleCore(_jwt(time.time() + 30))   # inside the 60 s margin
    _client(fake, monkeypatch).items()
    _client(fake, monkeypatch).items()
    assert fake.logins == 2


def test_expires_in_is_used_when_the_token_has_no_exp(monkeypatch):
    from galecore_ai.adapters import galecore_space as gs
    assert gs._token_expiry("opaque", 120) - __import__("time").time() == pytest.approx(120, abs=2)
    assert gs._token_expiry("opaque") - __import__("time").time() == pytest.approx(gs.SESSION_FALLBACK_TTL, abs=2)


def test_the_cache_is_per_user_and_base_url(monkeypatch):
    import time
    fake = CountingGaleCore(_jwt(time.time() + 3600))
    _client(fake, monkeypatch).items()
    _client(fake, monkeypatch, base="http://otro.test").items()
    assert fake.logins == 2
    _client(fake, monkeypatch).items()
    _client(fake, monkeypatch, base="http://otro.test").items()
    assert fake.logins == 2


def test_a_401_with_a_cached_token_logs_in_once_more(monkeypatch):
    import time
    fake = CountingGaleCore(_jwt(time.time() + 3600))
    _client(fake, monkeypatch).items()
    fake.token = _jwt(time.time() + 7200)           # the server revoked the old one
    _client(fake, monkeypatch).items()
    assert fake.logins == 2


def test_a_persistent_401_raises_after_a_single_retry(monkeypatch):
    import time
    fake = CountingGaleCore(_jwt(time.time() + 3600))
    fake.valid = False
    with pytest.raises(SpaceError) as err:
        _client(fake, monkeypatch).items()
    assert err.value.status == 401 and fake.logins == 2


def test_an_unwritable_cache_does_not_break_the_call(monkeypatch, tmp_path):
    import time
    blocker = tmp_path / "file"
    blocker.write_text("x")
    monkeypatch.setenv("LOCALAPPDATA", str(blocker))    # a file where a folder is needed
    fake = CountingGaleCore(_jwt(time.time() + 3600))
    assert _client(fake, monkeypatch).items() == {"items": [], "shared": []}
