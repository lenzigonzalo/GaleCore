"""WS-0079: agentes en la nube (rutinas de claude.ai) registrados en el espacio; sin tocar claude.ai (todo con dobles)."""

from __future__ import annotations

import json
import sys
from datetime import UTC, date, datetime

import pytest

from galecore_ai.adapters import cli
from galecore_ai.application import agent_cloud as ac
from galecore_ai.application import space
from galecore_ai.contracts.task import Schedule
from tests.unit.test_knowledge import kb  # noqa: F401  (fixture)
from tests.unit.test_space import _now, galecore  # noqa: F401  (fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (fixture)
from tests.unit.test_tasks import env  # noqa: F401  (fixture)

DAILY = {"frequency": "daily", "time": "08:00", "timezone": "America/New_York"}
NOV = date(2026, 11, 9)       # New York is UTC-5


def piece_of(fake, key="resumen-diario"):
    return json.loads(fake.rows[("agent", key)]["content"])


@pytest.fixture
def lab(monkeypatch, tmp_path):
    monkeypatch.setenv("GALECORE_LAB_LOCAL", str(tmp_path))
    monkeypatch.setenv("GALECORE_BASE_URL", "https://api.galecore.test")
    monkeypatch.setenv("GALECORE_ALLOWED_BASE_URL", "https://api.galecore.test")
    monkeypatch.setenv("GALECORE_API_KEY", "svc-key")
    return tmp_path


def configured(lab):
    (lab / "agents.json").write_text(json.dumps({"environment_id": "env_019kKR4kEzW7JcDZJA7LHMAM"}), encoding="utf-8")


def test_cron_goes_to_utc_and_moves_the_weekdays_with_the_date():
    assert ac.cron_utc(Schedule.model_validate(DAILY), NOV) == "0 13 * * *"
    late = Schedule.model_validate({"frequency": "days", "days": ["wed", "mon"], "time": "22:30", "timezone": "America/New_York"})
    assert ac.cron_utc(late, NOV) == "30 3 * * 2,4"          # 22:30 NY is 03:30 UTC of the next day
    sun = Schedule.model_validate({"frequency": "days", "days": ["sun", "sat"], "time": "23:00", "timezone": "America/New_York"})
    assert ac.cron_utc(sun, NOV) == "0 4 * * 0,1"            # Sat, Sun -> Sun, Mon (cron 0 = Sunday)
    ba = Schedule.model_validate({"frequency": "weekdays", "time": "09:00", "timezone": "America/Argentina/Buenos_Aires"})
    assert ac.cron_utc(ba, NOV) == "0 12 * * 1,2,3,4,5"
    early = Schedule.model_validate({"frequency": "weekdays", "time": "00:30", "timezone": "Europe/Madrid"})
    assert ac.cron_utc(early, NOV) == "30 23 * * 0,1,2,3,4"  # 00:30 Madrid (UTC+1) is 23:30 UTC of the day before
    with pytest.raises(ac.AgentCloudError, match="una vez por día"):
        ac.cron_utc(Schedule.model_validate({"frequency": "every_minutes", "minutes": 30, "timezone": "UTC"}), NOV)


def test_the_routine_body_has_the_test_routine_format_and_always_reports():
    piece = {"id": "Resumen diario", "objective": "Resumí SPY y VIX", "status": "active", "schedule_spec": DAILY}
    body = ac.routine_body(piece, "env_x1", NOV)
    assert body == ac.routine_body(piece, "env_x1", NOV)                       # deterministic
    assert body["name"] == "GaleCore - Resumen diario" and body["cron_expression"] == "0 13 * * *" and body["enabled"] is True
    ccr = body["job_config"]["ccr"]
    assert ccr["environment_id"] == "env_x1"
    assert ccr["session_context"] == {"allowed_tools": ["Bash", "Read", "Glob", "Grep"], "model": "claude-sonnet-5",
                                      "sources": [{"git_repository": {"url": "https://github.com/lenzigonzalo/GaleCore"}}]}
    text = ccr["events"][0]["data"]["message"]["content"]
    assert "cd galecore-ai && python3 -m pip install -q -e ." in text and "Tarea: Resumí SPY y VIX" in text
    assert "agent report resumen-diario --status ok|error|skipped --summary-file /tmp/resumen.md" in text
    assert text.index("Tarea:") < text.index("agent report")
    assert ac.routine_body({**piece, "status": "paused", "model": "claude-haiku"}, "env_x1", NOV)["enabled"] is False


def test_the_pc_never_touches_a_cloud_piece(env, galecore):  # noqa: F811
    kb_, sch, _ = env
    fake, client = galecore
    from galecore_ai.application import tasks as t
    from tests.unit.test_market_watch import MARKET
    from tests.unit.test_tasks import make
    make(kb_, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET)
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    client.put("agent", "resumen-diario", title="Resumen diario", fmt="json", content=json.dumps(
        {**piece_of(fake), "request": {"status": "paused", "settings": {"objective": "otra"}, "at": _now()}}))
    before = dict(fake.rows[("agent", "resumen-diario")])
    for _ in range(2):
        out = space.publish_agents(client, kb_, sch)
        assert out["requests"] == [] and "agent/resumen-diario" not in out["created"] + out["updated"]
    assert fake.rows[("agent", "resumen-diario")] == before                    # not rewritten, request intact
    assert ("agent", "oportunidades") in fake.rows
    assert space.apply_requests(client, kb_, sch) == []
    # With no local task at all the old code deleted every unknown agent piece: a cloud one stays.
    t.cancel(kb=kb_, scheduler=sch, task_id="oportunidades", prompt="ya no")
    space.publish_agents(client, kb_, sch)
    assert ("agent", "oportunidades") not in fake.rows and fake.rows[("agent", "resumen-diario")] == before
    # a local task with the same key does not overwrite it either
    make(kb_, sch, task_id="resumen-diario", strategy=None, capability="market_watch", schedule=MARKET)
    space.publish_agents(client, kb_, sch)
    assert fake.rows[("agent", "resumen-diario")] == before


def test_new_then_body_then_applied_registers_the_routine(galecore, lab):  # noqa: F811
    fake, client = galecore
    assert ac.new(client, "Resumen diario", "Resumí SPY", DAILY, datetime(2026, 11, 9, tzinfo=UTC)) == {
        "agent": "resumen-diario", "status": "pending"}
    p = piece_of(fake)
    assert p["runs_on"] == "cloud" and p["capability"] == "routine" and p["status"] == "pending" and p["trigger_id"] is None
    assert "08:00" in p["schedule"]
    assert p["request"]["create"]["id"] == "Resumen diario"
    assert ac.pending(client) == [{"key": "resumen-diario", "name": "Resumen diario", "requests": ["create"],
                                  "at": "2026-11-09T00:00:00+00:00"}]
    with pytest.raises(ac.AgentCloudError, match="Falta configurar el entorno de los agentes en la nube"):
        ac.body(client, "resumen-diario")
    configured(lab)
    created = ac.body(client, "resumen-diario", NOV)
    assert created["action"] == "create" and "trigger_id" not in created
    assert created["body"]["job_config"]["ccr"]["environment_id"] == "env_019kKR4kEzW7JcDZJA7LHMAM"
    assert "agent report resumen-diario --status" in created["body"]["job_config"]["ccr"]["events"][0]["data"]["message"]["content"]
    done = ac.applied(client, "resumen-diario", "trig_1", "https://claude.ai/code/routines/trig_1")
    assert done["status"] == "active"
    p = piece_of(fake)
    assert p["trigger_id"] == "trig_1" and p["routine_url"].endswith("trig_1") and "request" not in p and p["status"] == "active"
    assert ac.pending(client) == []
    with pytest.raises(ac.AgentCloudError, match="Ya hay un agente"):
        ac.new(client, "resumen diario", "x", DAILY)


def test_settings_pause_and_run_requests(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    ac.applied(client, "resumen-diario", "trig_1", "https://x/trig_1")

    def ask(**request):
        client.put("agent", "resumen-diario", title="Resumen diario", fmt="json",
                   content=json.dumps({**piece_of(fake), "request": {**request, "at": _now()}}))

    later = {"frequency": "weekdays", "time": "09:00", "timezone": "America/New_York"}
    ask(settings={"objective": "Resumí QQQ", "schedule_spec": later})
    update = ac.body(client, "resumen-diario", NOV)
    assert update["action"] == "update" and update["trigger_id"] == "trig_1"
    assert update["body"]["cron_expression"] == "0 14 * * 1,2,3,4,5" and "Tarea: Resumí QQQ" in update["body"]["job_config"]["ccr"]["events"][0]["data"]["message"]["content"]
    ac.applied(client, "resumen-diario")
    p = piece_of(fake)
    assert p["objective"] == "Resumí QQQ" and p["schedule_spec"] == later and "lunes" in p["schedule"] and p["trigger_id"] == "trig_1"
    ask(status="paused")
    assert ac.body(client, "resumen-diario", NOV)["body"]["enabled"] is False
    ac.applied(client, "resumen-diario")
    assert piece_of(fake)["status"] == "paused"
    ask(run=True)
    assert ac.body(client, "resumen-diario") == {"action": "run", "trigger_id": "trig_1"}
    ac.applied(client, "resumen-diario")
    assert "request" not in piece_of(fake)


def test_delete_pauses_the_routine_and_then_removes_the_piece(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    client.put("agent", "resumen-diario", title="Resumen diario", fmt="json",
               content=json.dumps({**piece_of(fake), "request": {"delete": True, "at": _now()}}))
    assert ac.pending(client)[0]["requests"] == ["delete"]
    with pytest.raises(ac.AgentCloudError):                              # never created: nothing to pause
        ac.body(client, "resumen-diario", NOV)
    ac.applied(client, "resumen-diario", "trig_1", "https://x/trig_1", error="falló")
    assert piece_of(fake)["request_error"] == "falló" and ("agent", "resumen-diario") in fake.rows
    client.put("agent", "resumen-diario", title="Resumen diario", fmt="json",
               content=json.dumps({**piece_of(fake), "trigger_id": "trig_1", "request": {"delete": True, "at": _now()}}))
    assert ac.body(client, "resumen-diario", NOV) == {"action": "update", "trigger_id": "trig_1", "body": {"enabled": False}}
    out = ac.applied(client, "resumen-diario")
    assert out["deleted"] is True and ("agent", "resumen-diario") not in fake.rows


def test_a_run_asked_with_a_change_is_kept_for_the_next_pass(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    ac.applied(client, "resumen-diario", "trig_1", "https://x/trig_1")
    at = _now()
    client.put("agent", "resumen-diario", title="x", fmt="json", content=json.dumps(
        {**piece_of(fake), "request": {"status": "paused", "run": True, "at": at}}))
    ac.applied(client, "resumen-diario")
    ac._save_config({**ac._config(), "agent_key": "gca_old"})
    p = piece_of(fake)
    assert p["status"] == "paused" and p["request"] == {"run": True, "at": at}
    assert ac.body(client, "resumen-diario") == {"action": "run", "trigger_id": "trig_1"}


def test_run_without_a_routine_and_failed_application(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    client.put("agent", "resumen-diario", title="x", fmt="json", content=json.dumps(
        {**piece_of(fake), "request": {"run": True, "at": _now()}}))
    with pytest.raises(ac.AgentCloudError, match="todavía no se creó"):
        ac.body(client, "resumen-diario")
    ac.new(client, "Otro", "x", DAILY)
    ac.applied(client, "otro", error="la API de rutinas rechazó el cuerpo")
    o = piece_of(fake, "otro")
    assert o["status"] == "pending" and "request" not in o and o["request_error"] == "la API de rutinas rechazó el cuerpo"
    assert [(p["key"], p["requests"]) for p in ac.pending(client)] == [("resumen-diario", ["run"])]


def test_a_piece_that_moved_while_applying_is_left_for_the_next_pass(galecore, monkeypatch):  # noqa: F811
    fake, client = galecore
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    real = space.sync

    def moved(c, pieces, seen=None):        # the monitor wrote a new request between our read and our write
        c.put("agent", "resumen-diario", title="x", fmt="json",
              content=json.dumps({**piece_of(fake), "request": {"status": "paused", "at": _now()}}))
        return real(c, pieces, seen)

    monkeypatch.setattr(space, "sync", moved)
    with pytest.raises(ac.AgentCloudError, match="cambió mientras se aplicaba"):
        ac.applied(client, "resumen-diario", "trig_1", "u")
    assert piece_of(fake)["request"]["status"] == "paused" and piece_of(fake)["trigger_id"] is None


def test_new_refuses_what_a_cloud_agent_cannot_do(galecore):  # noqa: F811
    _, client = galecore
    with pytest.raises(ac.AgentCloudError, match="una vez por día"):
        ac.new(client, "Frecuente", "x", {"frequency": "every_minutes", "minutes": 30, "timezone": "UTC"})
    with pytest.raises(ac.AgentCloudError, match="no es válido"):
        ac.new(client, "Roto", "x", {"frequency": "daily"})


def test_environment_is_read_from_the_lab_config(lab, monkeypatch, capsys):
    with pytest.raises(ac.AgentCloudError, match="Falta configurar el entorno"):
        ac.environment_id()
    monkeypatch.setattr(sys, "argv", ["cli", "agent", "env", "--set", "https://claude.ai/code/environments/env_01ABC9?x=1"])
    with pytest.raises(SystemExit):
        cli.main()
    assert json.loads(capsys.readouterr().out)["environment_id"] == "env_01ABC9"
    assert ac.environment_id() == "env_01ABC9" and (lab / "agents.json").is_file()
    with pytest.raises(ac.AgentCloudError, match="No encontré"):
        ac.set_environment("sin id")


def routine_text(out):
    return out["body"]["job_config"]["ccr"]["events"][0]["data"]["message"]["content"]


def test_the_instruction_exports_the_four_variables_and_generates_the_agent_key_once(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "Resumí SPY", DAILY)
    text = routine_text(ac.body(client, "resumen-diario", NOV))
    for line in ("export GALECORE_BASE_URL=https://api.galecore.test\n", "export GALECORE_ALLOWED_BASE_URL=https://api.galecore.test\n",
                 "export GALECORE_API_KEY=svc-key\n", "export GALECORE_AGENT_KEY=gca_key1\n"):
        assert line in text
    assert "cat > ~/.galecore.env" in text and "chmod 600 ~/.galecore.env" in text and "export" not in text.split("~/.galecore.env", 2)[0]
    assert text.count("source ~/.galecore.env && python3 -m galecore_ai.adapters.cli") == 3      # list, get, agent report
    assert "/tmp/resumen.md" in text and "resumen.md" not in text.replace("/tmp/resumen.md", "") and "volvé a exportarlas" not in text
    assert "No hagas commits, ramas ni push en el repositorio: es sólo lectura; el resultado va con `agent report`." in text
    assert text.index("cat > ~/.galecore.env") < text.index("Tarea:") < text.index("agent report")
    cfg = json.loads((lab / "agents.json").read_text(encoding="utf-8"))
    assert cfg == {"environment_id": "env_019kKR4kEzW7JcDZJA7LHMAM", "agent_key": "gca_key1"}
    assert "gca_key1" in routine_text(ac.body(client, "resumen-diario", NOV)) and fake.keys == 1     # reused, not regenerated


def test_a_new_agent_key_leaves_the_other_routines_an_update_request(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    for name in ("Uno", "Dos", "Tres"):
        ac.new(client, name, "x", DAILY)
    ac.applied(client, "uno", "trig_1", "https://x/1")
    ac.applied(client, "dos", "trig_2", "https://x/2")          # "tres" was never created: no routine to rewrite
    assert [p["key"] for p in ac.pending(client)] == ["tres"]
    ac.body(client, "uno", NOV)                                 # first body: the key is generated
    assert fake.keys == 1
    assert [(p["key"], p["requests"]) for p in ac.pending(client)] == [("dos", ["settings"]), ("tres", ["create"])]
    again = ac.body(client, "dos", NOV)
    assert again["action"] == "update" and again["trigger_id"] == "trig_2" and "gca_key1" in routine_text(again)
    ac.applied(client, "dos")
    assert [p["key"] for p in ac.pending(client)] == ["tres"] and fake.keys == 1


def test_a_run_with_a_new_key_rewrites_the_routine_first(galecore, lab):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "x", DAILY)
    ac.applied(client, "resumen-diario", "trig_1", "https://x/1")
    client.put("agent", "resumen-diario", title="x", fmt="json", content=json.dumps(
        {**piece_of(fake), "request": {"run": True, "at": _now()}}))
    out = ac.body(client, "resumen-diario", NOV)
    assert out["action"] == "update" and "gca_key1" in routine_text(out)
    ac.applied(client, "resumen-diario")
    assert piece_of(fake)["request"]["run"] is True
    assert ac.body(client, "resumen-diario") == {"action": "run", "trigger_id": "trig_1"}


def test_a_missing_variable_is_a_clear_error_and_the_key_is_never_printed(galecore, lab, monkeypatch, capsys):  # noqa: F811
    fake, client = galecore
    configured(lab)
    ac.new(client, "Resumen diario", "x", DAILY)
    monkeypatch.delenv("GALECORE_BASE_URL")
    with pytest.raises(ac.AgentCloudError, match="Falta GALECORE_BASE_URL en el entorno del Lab"):
        ac.body(client, "resumen-diario", NOV)
    assert fake.keys == 0
    monkeypatch.setenv("GALECORE_BASE_URL", "https://api.galecore.test")
    ac.body(client, "resumen-diario", NOV)
    assert "gca_key1" not in json.dumps(ac.pending(client)) and "gca_key1" not in json.dumps(piece_of(fake))
    # saving the environment again keeps the key
    ac.set_environment("env_ZZZ1")
    assert json.loads((lab / "agents.json").read_text(encoding="utf-8"))["agent_key"] == "gca_key1"


SKILL_MD = "---\nname: Cierre\ndescription: Cierre de SPY\n---\n# Cierre\n"


def with_skill(client, tmp_path, key="cierre"):
    from galecore_ai.application import skill_space
    folder = tmp_path / "sk"
    (folder / "scripts").mkdir(parents=True)
    (folder / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
    (folder / "scripts" / "cierre.py").write_text("print('{}')\n", encoding="utf-8")
    skill_space.save(client, folder, key=key)


def test_market_hours_cron_is_every_whole_hour_in_session_in_est_and_edt():
    hourly = Schedule.model_validate({"frequency": "market_hours", "minutes": 60, "timezone": "America/New_York"})
    assert ac.cron_utc(hourly, NOV) == "30 14-20 * * 1-5"                    # 9:30 ... 15:30 NY, EST (UTC-5)
    assert ac.cron_utc(hourly, date(2026, 7, 15)) == "30 13-19 * * 1-5"      # EDT (UTC-4)
    two = Schedule.model_validate({"frequency": "market_hours", "minutes": 120, "timezone": "America/New_York"})
    assert ac.cron_utc(two, NOV) == "30 14-20/2 * * 1-5"
    half = Schedule.model_validate({"frequency": "market_hours", "minutes": 90, "timezone": "America/New_York"})
    with pytest.raises(ac.AgentCloudError, match="cada 1 h en rueda"):
        ac.cron_utc(half, NOV)


def test_a_market_hours_agent_builds_its_routine(galecore, lab):  # noqa: F811
    _, client = galecore
    configured(lab)
    when = {"frequency": "market_hours", "minutes": 60, "timezone": "America/New_York"}
    ac.new(client, "Cada hora", "Mirá SPY", when)
    assert ac.body(client, "cada-hora", NOV)["body"]["cron_expression"] == "30 14-20 * * 1-5"
    with pytest.raises(ac.AgentCloudError, match="cada 1 h en rueda"):
        ac.new(client, "Cada 30", "x", {**when, "minutes": 30})


def test_an_agent_with_skills_exports_the_results_dir_and_one_without_does_not(galecore, lab, tmp_path):  # noqa: F811
    _, client = galecore
    configured(lab)
    with_skill(client, tmp_path)
    ac.new(client, "Con skill", "x", DAILY, skills=["cierre"])
    ac.new(client, "Sin skill", "x", DAILY)
    assert "export GALECORE_RESULTS_DIR=/tmp/resultados\n" in routine_text(ac.body(client, "con-skill", NOV))
    assert "GALECORE_RESULTS_DIR" not in routine_text(ac.body(client, "sin-skill", NOV))


def test_an_agent_with_skills_pulls_them_follows_their_skill_md_and_reports_without_evaluating_on_failure(galecore, lab, tmp_path):  # noqa: F811
    fake, client = galecore
    configured(lab)
    with_skill(client, tmp_path)
    ac.new(client, "Cierre SPY", "Decí si cerró arriba", DAILY, skills=["cierre"])
    p = piece_of(fake, "cierre-spy")
    assert p["skills"] == ["cierre"] == p["request"]["create"]["skills"] and "skill" not in p
    text = routine_text(ac.body(client, "cierre-spy", NOV))
    assert "   - `source ~/.galecore.env && python3 -m galecore_ai.adapters.cli skill pull cierre /tmp/skills/cierre`" in text
    assert "leé su `SKILL.md` y seguilo" in text and "skill run <clave> <script>" in text
    assert 'empieza con "Sin evaluar:"' in text and "no repitas ni deduzcas conclusiones de corridas anteriores" in text
    assert "--status error" in text and "galecore get <capacidad>" not in text
    assert text.index("skill pull") < text.index("Tarea: Decí si cerró arriba") < text.index("agent report")


def test_without_skills_the_instruction_is_the_same_as_before():
    text = ac.instruction({"id": "Resumen", "objective": "Resumí SPY"})
    assert "2. Hacé esta tarea del usuario, con GaleCore como fuente de datos (`python3 -m galecore_ai.adapters.cli galecore list` " in text
    assert "skill pull" not in text and "Sin evaluar" not in text
    assert ac.instruction({"id": "Resumen", "objective": "Resumí SPY", "skills": None}) == text


def test_several_skills_are_pulled_one_by_one_and_their_keys_are_quoted():
    text = ac.instruction({"id": "A", "objective": "x", "skills": ["uno", "dos"]})
    assert text.index("skill pull uno /tmp/skills/uno") < text.index("skill pull dos /tmp/skills/dos")
    assert "skill pull 'a b' /tmp/skills/'a b'" in ac.instruction({"id": "A", "objective": "x", "skills": ["a b"]})


def test_new_checks_that_every_skill_exists_and_how_many(galecore, tmp_path):  # noqa: F811
    _, client = galecore
    with_skill(client, tmp_path)
    client.put("skill", "notas", title="Notas", content="# Notas\n", fmt="markdown")
    with pytest.raises(ac.AgentCloudError, match="No encuentro la skill «nada»"):
        ac.new(client, "A", "x", DAILY, skills=["nada"])
    with pytest.raises(ac.AgentCloudError, match="de 1 a 5"):
        ac.new(client, "A", "x", DAILY, skills=["cierre", "cierre"])
    with pytest.raises(ac.AgentCloudError, match="de 1 a 5"):
        ac.new(client, "A", "x", DAILY, skills=[f"s{i}" for i in range(6)])
    made = ac.new(client, "B", "x", DAILY, skills=["cierre", "notas"])      # code and markdown skills both count
    assert made == {"agent": "b", "status": "pending"}


def test_settings_can_set_and_remove_the_skills():
    base = {"id": "A", "objective": "x", "schedule_spec": DAILY}
    on = ac.effective({**base, "request": {"settings": {"skills": ["cierre"]}}})
    assert on["skills"] == ["cierre"]
    off = ac.effective({**base, "skills": ["cierre"], "request": {"settings": {"skills": None}}})
    assert off["skills"] is None and "skill pull" not in ac.instruction({**off, "key": "a"})


def test_cli_agent_new_takes_skill_repeated(galecore, monkeypatch, capsys, tmp_path):  # noqa: F811
    from galecore_ai.adapters import galecore_space
    fake, client = galecore
    with_skill(client, tmp_path)
    client.put("skill", "notas", title="Notas", content="# Notas\n", fmt="markdown")
    monkeypatch.setattr(galecore_space, "SpaceClient", lambda: client)

    def run(*extra):
        monkeypatch.setattr(sys, "argv", ["cli", "agent", "new", "--name", "Cierre SPY", "--what", "x", "--when", json.dumps(DAILY), *extra])
        with pytest.raises(SystemExit) as stop:
            cli.main()
        return stop.value.code, json.loads(capsys.readouterr().out)

    code, out = run("--skill", "cierre", "--skill", "notas")
    assert code == 0 and out["agent"] == "cierre-spy"
    assert piece_of(fake, "cierre-spy")["skills"] == ["cierre", "notas"]
