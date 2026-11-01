"""GC-AI-0025: the model of each capability comes from the kind of work; the choice is shown and recorded."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from galecore_ai.application import model_run as mr
from galecore_ai.application.route import match
from galecore_ai.harness.catalog import WORK_MODELS, Schedulable, load_catalog


@pytest.mark.parametrize(("work", "model"), sorted(WORK_MODELS.items()))
def test_the_work_picks_the_model(work, model):
    s = Schedulable(runs="model", work=work, max_turns=5)
    assert s.model == model and s.route_reason() == f"{work} → {model} (política GC-AI-0025)"


def test_a_model_run_must_say_its_work_and_cannot_pick_another_model():
    with pytest.raises(ValidationError, match="declares its work"):
        Schedulable(runs="model", max_turns=5)
    with pytest.raises(ValidationError, match="does not match the policy"):
        Schedulable(runs="model", work="reading", model="opus", max_turns=5)
    assert Schedulable(runs="model", work="reading", model="sonnet", max_turns=5).model == "sonnet"


def test_a_code_run_calls_no_model():
    with pytest.raises(ValidationError, match="calls no model"):
        Schedulable(runs="code", work="simple")
    assert Schedulable(runs="code").route_reason() is None


def test_the_real_catalog_routes_all_readings_to_sonnet():
    models = {e.id: e.schedulable.model for e in load_catalog().entries if e.schedulable}
    assert models == {"strategy_followup": None, "daily_attention": "sonnet", "market_watch": "sonnet", "scheduled_report": "sonnet", "knowledge_curator": "sonnet",
                      "market_story": "sonnet", "revisar_swing_etfs": "sonnet"}


def test_the_runner_never_gets_a_fallback_model():
    # A provider failure or missing quota never moves the run to another (costlier) model.
    cmd = mr.ClaudeCodeClient(binary="claude", model="haiku").command(allowed=[], max_turns=3, schema={},
                                                                        add_dir=Path("."))
    assert "--fallback-model" not in cmd and cmd[cmd.index("--model") + 1] == "haiku"


def test_match_says_which_model_the_work_needs():
    found = {m["capability"]: m["model"] for m in match("contame la historia del mercado hoy", load_catalog())["matches"]}
    assert found.get("market_story") == "reading → sonnet (política GC-AI-0025)"
    in_session = {m["capability"]: m["model"] for m in match("analizá el gex de spy", load_catalog())["matches"]}
    assert in_session.get("gex_interpretation") == "el de la sesión (en sesión)"
