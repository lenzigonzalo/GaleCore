"""GC-AI-0021: the trader's space in GaleCore, read and written as the trader (against a fake GaleCore)."""

from __future__ import annotations

import json

import httpx
import pytest

from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
from galecore_ai.application import space


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
    kb, sch, _ = env
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    make(kb, sch, task_id="vieja", strategy=None, capability="market_watch", schedule=MARKET)
    t.cancel(kb=kb, scheduler=sch, task_id="vieja", prompt="ya no")
    kinds = {}
    for p in space.local_pieces(kb):
        kinds.setdefault(p["kind"], []).append(p)
    assert [p["key"] for p in kinds["agent"]] == ["oportunidades"]          # the cancelled one is history
    assert kinds["convention"][0]["visibility"] == "shared"
    assert all(p["visibility"] == "shared" for p in kinds["skill"]) and len(kinds["skill"]) > 5


from tests.unit.test_knowledge import kb  # noqa: E402,F401  (fixture)
from tests.unit.test_strategy import research_ref  # noqa: E402,F401  (fixture)
from tests.unit.test_tasks import env  # noqa: E402,F401  (fixture)
