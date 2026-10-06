"""P1-05: «oportunidades» screens by code every run (IV rank and the quiet window of releases) and calls the model
only with a finding; what the screen cannot evaluate is never a finding."""
# ruff: noqa: F811  (pytest fixtures imported from other test modules)

from __future__ import annotations

import asyncio
from datetime import date

import pytest
from pydantic import ValidationError

from galecore_ai.application import scan
from galecore_ai.application import tasks as t
from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.contracts.task import ScanRule
from tests.unit.test_knowledge import kb  # noqa: F401  (fixture)
from tests.unit.test_market_watch import MARKET
from tests.unit.test_model_tasks import LATER, model_ok, output
from tests.unit.test_strategy import research_ref  # noqa: F401  (fixture)
from tests.unit.test_tasks import FakeScheduler, env, make  # noqa: F401  (env is a fixture)

MON = date(2026, 10, 12)        # the CPI is on Wednesday 14/10
RULE = ScanRule(symbols=["spy", "QQQ", "IWM"], iv_rank_min=30)


class Fake:
    def __init__(self, ranks: dict[str, float | None], releases=None, fail=frozenset()):
        self.ranks, self.releases, self.fail, self.calls = ranks, releases or [], fail, []

    async def invoke(self, cap, params):
        self.calls.append((cap, params))
        if cap in self.fail:
            return CapabilityResult(cap, error="HTTP 502")
        if cap == "compute.iv_rank":
            rank = self.ranks.get(params["symbol"])
            return CapabilityResult(cap, data={"symbol": params["symbol"]} | ({"ivRank": rank} if rank is not None
                                                                                 else {}))
        if cap == "calendar.macro_releases":
            return CapabilityResult(cap, data={"data": self.releases})
        if cap == "calendar.fomc_meetings":
            return CapabilityResult(cap, data={"data": [{"start": "2026-10-27", "end": "2026-10-28"}]})
        raise AssertionError(cap)


def run(fake, rule=RULE, today=MON):
    return asyncio.run(scan.screen(fake, rule, today))


def test_the_rule_normalizes_symbols_and_rejects_nonsense():
    assert RULE.symbols == ["SPY", "QQQ", "IWM"] and RULE.quiet_business_days == 3
    with pytest.raises(ValidationError):
        ScanRule(symbols=["no es un ticker"], iv_rank_min=30)
    with pytest.raises(ValidationError):
        ScanRule(symbols=["SPY"], iv_rank_min=130)


def test_business_days_skip_the_weekend():
    assert scan.business_days_ahead(date(2026, 10, 9), 3) == ["2026-10-09", "2026-10-12", "2026-10-13",
                                                              "2026-10-14"]


def test_a_finding_needs_the_rank_and_a_quiet_window():
    quiet = run(Fake({"SPY": 35.0, "QQQ": 20.0, "IWM": None}), today=date(2026, 10, 15))
    by = {c["symbol"]: c for c in quiet["checked"]}
    assert quiet["findings"] == ["SPY"] and by["QQQ"]["result"] == "no" and by["IWM"]["result"] == "sin evaluar"
    cpi = [{"releaseId": 10, "releaseName": "Consumer Price Index", "date": "2026-10-14"}]
    busy = run(Fake({"SPY": 35.0, "QQQ": 20.0, "IWM": 40.0}, releases=cpi))
    assert busy["findings"] == [] and busy["blocking_releases"] == [{"date": "2026-10-14", "release": "CPI"}]
    assert {c["symbol"]: c["result"] for c in busy["checked"]} == {"SPY": "cerca", "QQQ": "no", "IWM": "cerca"}


def test_without_a_calendar_nothing_is_a_finding():
    res = run(Fake({"SPY": 35.0, "QQQ": 35.0, "IWM": 35.0}, fail={"calendar.macro_releases"}))
    assert res["findings"] == [] and all(c["result"] == "sin evaluar" for c in res["checked"])
    assert any("calendar.macro_releases" in m for m in res["missing"])


def agent(kb, sch):
    make(kb, sch, task_id="oportunidades", strategy=None, capability="market_watch", schedule=MARKET,
         objective="Revisá SPY, QQQ e IWM: IV rank > 30 y sin evento macro en 3 días")
    return t.set_scan(kb=kb, task_id="oportunidades", rule=RULE, prompt="escaneo en código")


def test_set_scan_is_recorded_and_only_for_agents(env):
    kb, sch, _ = env
    task = agent(kb, sch)
    assert task.scan == RULE and t.load(kb, "oportunidades").scan == RULE
    assert t.events(kb, "oportunidades")[-1]["event"] == "scan_changed"
    make(kb, sch, task_id="seguimiento")
    with pytest.raises(t.TaskError, match="no strategy"):
        t.set_scan(kb=kb, task_id="seguimiento", rule=RULE, prompt="p")


def test_without_a_finding_the_model_is_not_called(env, monkeypatch):
    kb, sch, _ = env
    agent(kb, sch)
    monkeypatch.setattr(t, "_screen", lambda task, now: run(Fake({"SPY": 10.0, "QQQ": 10.0, "IWM": 10.0})))
    model = model_ok(output())
    result = t.run(kb=kb, task_id="oportunidades", commit=False, now=LATER, client=model)
    assert model.calls == [] and result["status"] == "OK" and result["model"] is None
    assert "sin hallazgo" in result["reason"]
    assert "Escaneo por código" in (kb.base / "tasks" / "oportunidades" / "LATEST.md").read_text(encoding="utf-8")


def test_with_a_finding_the_model_gets_only_the_findings(env, monkeypatch):
    kb, sch, _ = env
    agent(kb, sch)
    monkeypatch.setattr(t, "_screen", lambda task, now: run(Fake({"SPY": 35.0, "QQQ": 10.0, "IWM": 10.0}),
                                                            today=date(2026, 10, 15)))
    model = model_ok(output())
    result = t.run(kb=kb, task_id="oportunidades", commit=False, now=LATER, client=model)
    assert len(model.calls) == 1 and result["status"] == "OK"
    assert "Only these are findings: SPY" in model.calls[0]["prompt"]


def test_a_failed_screen_never_calls_the_model(env, monkeypatch):
    kb, sch, _ = env
    agent(kb, sch)

    def down(task, now):
        raise RuntimeError("GaleCore apagado")

    monkeypatch.setattr(t, "_screen", down)
    model = model_ok(output())
    result = t.run(kb=kb, task_id="oportunidades", commit=False, now=LATER, client=model)
    assert model.calls == [] and result["status"] == "INCOMPLETE" and "no corrió" in result["reason"]


def test_a_task_without_a_screen_is_saved_without_the_field(env):
    kb, sch, _ = env
    make(kb, sch, task_id="seguimiento")
    assert "scan" not in (kb.base / "tasks" / "seguimiento" / "task.json").read_text(encoding="utf-8")
    agent(kb, sch)
    t.set_scan(kb=kb, task_id="oportunidades", rule=None, prompt="sin escaneo")
    assert "scan" not in (kb.base / "tasks" / "oportunidades" / "task.json").read_text(encoding="utf-8")
