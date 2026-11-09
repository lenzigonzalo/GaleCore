"""BF-0003: chart rules are published after the shared CLI writes, without a market scan."""

import json
from datetime import timedelta

import pytest

from galecore_ai.adapters import cli, galecore_space
from galecore_ai.adapters.galecore_space import SpaceError
from galecore_ai.application import space, supervisor, watch
from tests.unit.test_knowledge import NOW, kb  # noqa: F401
from tests.unit.test_space import galecore  # noqa: F401
from tests.unit.test_watch import IN_SESSION, add, reader


def test_publish_only_active_rules_preserves_monitor_content(kb, galecore):  # noqa: F811
    fake, client = galecore
    met = add(kb, threshold=780)
    supervisor.scan(kb, reader(mid=775), IN_SESSION)
    cancelled = add(kb, threshold=750)
    watch.cancel(kb, cancelled.id, words="sacala", prompt="sacala", now=NOW)
    expired = add(kb, threshold=740, until=NOW + timedelta(hours=1))
    active = [add(kb, threshold=n) for n in (715, 700, 690)]
    active.append(add(kb, metric="put_wall", threshold=700))
    old = {"watches": [{"id": cancelled.id}], "alerts": [{"id": "aviso"}],
           "responses": {"aviso": {"choice": "visto"}}, "unwatch": {"pendiente": {"at": "hoy"}},
           "names": {"instancia": "Mi estrategia"}, "last_run": {"at": "ayer", "failed": True}}
    client.put("agent", "supervisor", title="Supervisor", content=json.dumps(old), fmt="json")
    result = space.publish_watches(client, kb, NOW + timedelta(hours=2))
    content = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert result["updated"] == ["agent/supervisor"]
    assert {r["id"] for r in content["watches"]} == {r.id for r in active}
    assert {met.id, cancelled.id, expired.id}.isdisjoint(r["id"] for r in content["watches"])
    assert {k: v for k, v in content.items() if k != "watches"} == {k: v for k, v in old.items() if k != "watches"}
    assert space.publish_watches(client, kb, NOW + timedelta(hours=2))["unchanged"] == ["agent/supervisor"]


def test_first_publication_does_not_invent_a_supervisor_pass(kb, galecore):  # noqa: F811
    fake, client = galecore
    rule = add(kb)
    space.publish_watches(client, kb, NOW)
    content = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert content["state"] == "PENDING" and content["last_run"] is None
    assert [r["id"] for r in content["watches"]] == [rule.id]


def test_publication_defers_if_the_monitor_writes_during_refresh(kb, galecore, monkeypatch):  # noqa: F811
    fake, client = galecore
    add(kb)
    client.put("agent", "supervisor", title="Supervisor", content='{"watches":[]}', fmt="json")
    original = space.active_watches

    def racing(*args):
        content = '{"watches":[],"responses":{"new":"visto"}}'
        client.put("agent", "supervisor", title="Supervisor", content=content, fmt="json")
        return original(*args)

    monkeypatch.setattr(space, "active_watches", racing)
    result = space.publish_watches(client, kb, NOW)
    assert result["deferred"] == ["agent/supervisor"]
    assert json.loads(fake.rows[("agent", "supervisor")]["content"])["responses"] == {"new": "visto"}


@pytest.mark.parametrize("pending", [False, True])
def test_shared_cli_watch_then_unwatch_publishes_or_reports_pending(kb, galecore, monkeypatch, capsys, pending):  # noqa: F811
    fake, client = galecore
    monkeypatch.setattr(cli, "_build_knowledge_base", lambda: kb)
    monkeypatch.setattr(galecore_space, "SpaceClient", lambda: client)
    if pending:
        def unavailable(*args, **kwargs):
            raise SpaceError("an error that must not be echoed")
        monkeypatch.setattr(client, "items", unavailable)
    monkeypatch.setattr("sys.argv", ["galecore-ai", "supervise", "watch", "--symbol", "SPY", "--below", "715",
                                     "--text", "avisame", "--prompt", "avisame"])
    with pytest.raises(SystemExit) as exit_:
        cli.main()
    out = json.loads(capsys.readouterr().out)
    assert exit_.value.code == 0 and out["status"] == "WATCHING"
    assert out["publication"]["status"] == ("PENDING" if pending else "PUBLISHED")
    assert "must not be echoed" not in json.dumps(out)
    rule_id = out["rule"]
    assert watch.view(kb)[0]["status"] == "active"
    if not pending:
        assert json.loads(fake.rows[("agent", "supervisor")]["content"])["watches"][0]["id"] == rule_id
    monkeypatch.setattr("sys.argv", ["galecore-ai", "supervise", "unwatch", rule_id, "--prompt", "sacala"])
    with pytest.raises(SystemExit) as exit_:
        cli.main()
    out = json.loads(capsys.readouterr().out)
    assert exit_.value.code == 0 and out["status"] == "CANCELLED"
    assert out["publication"]["status"] == ("PENDING" if pending else "PUBLISHED")
    assert watch.view(kb)[0]["status"] == "cancelled"
    if not pending:
        assert json.loads(fake.rows[("agent", "supervisor")]["content"])["watches"] == []


def test_cli_reports_a_deferred_publication(kb, monkeypatch):  # noqa: F811
    monkeypatch.setattr(space, "publish_watches", lambda *args: {"deferred": ["agent/supervisor"]})
    assert cli._publish_watches(kb)["status"] == "PENDING"


def test_shared_cli_remind_publishes_without_a_market_scan(kb, galecore, monkeypatch, capsys):  # noqa: F811
    fake, client = galecore
    monkeypatch.setattr(cli, "_build_knowledge_base", lambda: kb)
    monkeypatch.setattr(galecore_space, "SpaceClient", lambda: client)
    monkeypatch.setattr("sys.argv", ["galecore-ai", "supervise", "remind", "--on", "2099-01-01",
                                     "--text", "revisalo", "--prompt", "revisalo"])
    with pytest.raises(SystemExit) as exit_:
        cli.main()
    out = json.loads(capsys.readouterr().out)
    assert exit_.value.code == 0 and out["status"] == "REMINDING"
    assert out["publication"]["status"] == "PUBLISHED"
    content = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert content["watches"][0]["id"] == out["rule"]
    assert content["last_run"] is None


def test_plain_agent_sync_retries_rule_publication_without_a_scan(kb, galecore):  # noqa: F811
    fake, client = galecore
    old = {"watches": [], "alerts": [{"id": "old"}], "last_run": {"at": "old", "failed": True},
           "responses": {"old": {"choice": "visto"}}}
    client.put("agent", "supervisor", title="Supervisor", content=json.dumps(old), fmt="json")
    rule = add(kb)
    space.publish_agents(client, kb, None, now=NOW)
    content = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert [r["id"] for r in content["watches"]] == [rule.id]
    assert {k: v for k, v in content.items() if k != "watches"} == {k: v for k, v in old.items() if k != "watches"}
    watch.cancel(kb, rule.id, words="sacala", prompt="sacala", now=NOW)
    space.publish_agents(client, kb, None, now=NOW)
    assert json.loads(fake.rows[("agent", "supervisor")]["content"])["watches"] == []


def test_plain_sync_keeps_a_damaged_supervisor_and_publishes_other_agents(kb, galecore, monkeypatch):  # noqa: F811
    fake, client = galecore
    old = {"watches": [{"id": "old"}], "last_run": {"at": "old"}}
    client.put("agent", "supervisor", title="Supervisor", content=json.dumps(old), fmt="json")
    rule = add(kb)
    (kb.base / "supervision" / "rules" / f"{rule.id}.json").write_text("{}", encoding="utf-8")
    other = {"kind": "agent", "key": "otro", "title": "Otro", "content": "{}",
             "format": "json", "visibility": "private"}
    monkeypatch.setattr(space, "local_pieces", lambda *args: [other])
    result = space.publish_agents(client, kb, None, now=NOW)
    assert result["created"] == ["agent/otro"]
    assert result["responses"][0]["result"] == "refused"
    assert json.loads(fake.rows[("agent", "supervisor")]["content"]) == old


def test_plain_sync_defers_when_monitor_writes_between_its_first_two_reads(kb, galecore, monkeypatch):  # noqa: F811
    fake, client = galecore
    add(kb)
    client.put("agent", "supervisor", title="Supervisor", content='{"watches":[]}', fmt="json")
    original = client.items
    reads = 0

    def racing(*args, **kwargs):
        nonlocal reads
        result = original(*args, **kwargs)
        reads += 1
        if reads == 1:
            client.put("agent", "supervisor", title="Supervisor",
                       content='{"watches":[],"responses":{"new":"visto"}}', fmt="json")
        return result

    monkeypatch.setattr(client, "items", racing)
    result = space.publish_agents(client, kb, None, now=NOW)
    assert result["deferred"] == ["agent/supervisor"]
    assert json.loads(fake.rows[("agent", "supervisor")]["content"])["responses"] == {"new": "visto"}


def test_rule_refresh_keeps_a_reminders_published_strategy_name(kb, galecore):  # noqa: F811
    fake, client = galecore
    rule = watch.remind(kb, words="revisalo", prompt="revisalo", instance_id="instancia-123", now=NOW)
    old = {"watches": [{"id": rule.id, "label": "sin posiciones abiertas en Mi estrategia"}]}
    client.put("agent", "supervisor", title="Supervisor", content=json.dumps(old), fmt="json")
    space.publish_watches(client, kb, now=NOW)
    content = json.loads(fake.rows[("agent", "supervisor")]["content"])
    assert content["watches"][0]["label"] == "sin posiciones abiertas en Mi estrategia"
