"""GC-AI-0024: the day's market pack — gathered by code from GaleCore, compared with the previous one, kept as
evidence; the scheduled market story gets it before the model."""
# ruff: noqa: F811  (pytest fixtures imported from other test modules)

from __future__ import annotations

import asyncio
import json
from datetime import UTC, date, datetime, timedelta

from galecore_ai.application import story
from galecore_ai.capabilities.dispatcher import CapabilityResult
from galecore_ai.contracts.regime_record import RecordHost
from tests.unit.test_knowledge import kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_tasks import env  # noqa: F401  (env is a fixture)

TODAY = date(2026, 10, 2)


def candles(closes: list[float], start=date(2026, 9, 1)) -> dict:
    """GaleCore's raw DXLink answer: newest first, with a duplicate of the last day as DXLink sends it."""
    days = [start + timedelta(days=i) for i in range(len(closes))]
    events = [{"eventType": "Candle", "timeStamp": f"{d.isoformat()}T00:00:00", "close": c}
              for d, c in zip(days, closes, strict=True)]
    events.append({"eventType": "Candle", "timeStamp": f"{days[-1].isoformat()}T00:00:00", "close": closes[-1]})
    events.append({"eventType": "Candle", "timeStamp": "2026-08-01T00:00:00", "close": "NaN"})
    return {"type": "FEED_DATA", "data": list(reversed(events))}


GEX = {"symbol": "SPY", "timestamp": "2026-10-02T20:00:00Z",
       "gex": {"global": {"spot": 770.0, "callGex": 5.0, "putGex": -3.0, "netGex": 2.0, "gammaZeroLevel": 760.0,
                          "callWall": 780.0, "putWall": 750.0, "coveragePct": 98.0}}}


class FakeDispatcher:
    def __init__(self, fail: set[str] = frozenset(), gex=GEX, close=100.0):
        self.fail, self.gex, self.close, self.calls = fail, gex, close, []

    async def invoke(self, cap, params):
        self.calls.append((cap, params))
        if cap in self.fail or params.get("symbol") in self.fail:
            return CapabilityResult(cap, error="HTTP 502")
        data = {
            "market_data.candles": candles([self.close - 20 + i for i in range(22)]),
            "compute.put_skew": {"symbol": "SPY", "putSkew25d": 1.09, "atmIV": 0.1375, "levelOk": True,
                                 "levelThreshold": 1.3, "expiration": "2026-11-20", "dte": 47, "spot": 770.0},
            "compute.implied_volatility": {"symbol": "SPY", "iV30_30d": 15.5, "iV30_90d": 17.5},
            "compute.iv_rank": {"symbol": "SPY", "ivRank": 16.4, "currentIV": 0.15,
                                "history": [{"date": "2026-09-21", "iv": 0.14}]},
            "market_data.volatility_metrics": {"items": [{"symbol": "SPY", "historicalVolatility30Day": 10.3,
                                                          "ivHv30DayDifference": 5.06, "beta": 1.0}]},
            "compute.gex_analysis": self.gex,
            "calendar.macro_releases": {"data": [{"releaseId": 10, "releaseName": "Consumer Price Index",
                                                  "date": "2026-10-14"}]},
            "calendar.fomc_meetings": {"data": [{"start": "2026-09-15", "end": "2026-09-16"},
                                                {"start": "2026-10-27", "end": "2026-10-28"}]},
        }[cap]
        return CapabilityResult(cap, data=data)


def gather(**kw):
    return asyncio.run(story.gather(FakeDispatcher(**kw), today=TODAY))


def test_the_pack_has_prices_changes_volatility_options_and_calendar():
    pack = gather()
    spy = pack["prices"]["SPY"]
    # 22 sessions 80..101: one close per day (the duplicate and the NaN dropped), newest last.
    assert spy["close"] == 101.0 and spy["date"] == "2026-09-22"
    assert spy["chg_1d_pct"] == round((101 / 100 - 1) * 100, 2) and spy["chg_5d_pct"] == round((101 / 96 - 1) * 100, 2)
    assert spy["chg_20d_pct"] == round((101 / 81 - 1) * 100, 2) and spy["from_20d_high_pct"] == 0.0
    assert set(pack["prices"]) == set(story.CROSS_ASSET) and set(story.VOL_INDICES) <= set(pack["volatility"])
    assert pack["volatility"]["term"] == {"VIX9D_over_VIX": 1.0, "VIX3M_over_VIX": 1.0}
    opts = pack["options"]
    assert opts["put_skew"]["putSkew25d"] == 1.09 and "spot" not in opts["put_skew"]
    assert opts["iv_rank"]["history_from"] == "2026-09-21" and opts["iv_vs_hv"]["ivHv30DayDifference"] == 5.06
    assert opts["gex"]["net_gex"] == 2.0 and opts["gex"]["spot_vs_zero_gamma_pct"] == round((770 / 760 - 1) * 100, 2)
    assert pack["calendar"]["macro_releases"] == [{"date": "2026-10-14", "name": "Consumer Price Index"}]
    assert [m["start"] for m in pack["calendar"]["next_fomc"]] == ["2026-10-27"]     # a past meeting is left out
    assert pack["missing"] == []


def test_the_calendar_asks_for_the_releases_that_matter_in_the_window():
    d = FakeDispatcher()
    asyncio.run(story.gather(d, today=TODAY))
    asked = [p for c, p in d.calls if c == "calendar.macro_releases"]
    assert {"From": "2026-10-02", "To": "2026-10-16", "ReleaseIds": story.MACRO_RELEASES} in asked
    assert {"From": "2026-09-25", "To": "2026-10-01", "ReleaseIds": story.MACRO_RELEASES} in asked   # the last week


def test_what_fails_is_declared_missing_never_filled():
    pack = gather(fail={"compute.gex_analysis", "HYG"})
    assert "gex" not in pack["options"] and "HYG" not in pack["prices"]
    assert any(m.startswith("compute.gex_analysis SPY: HTTP 502") for m in pack["missing"])
    assert any(m.startswith("market_data.candles HYG") for m in pack["missing"])


def test_a_gex_answer_with_another_shape_is_declared_not_guessed():
    pack = gather(gex={"symbol": "SPY", "gex": {"global": {"spot": "mucho"}}})
    assert "gex" not in pack["options"] and any("otra forma" in m for m in pack["missing"])


def test_a_slow_gex_is_cut_and_declared(monkeypatch):
    class Slow(FakeDispatcher):
        async def invoke(self, cap, params):
            if cap == "compute.gex_analysis":
                await asyncio.sleep(5)
            return await super().invoke(cap, params)

    monkeypatch.setattr(story, "GEX_TIMEOUT_S", 0.1)
    pack = asyncio.run(story.gather(Slow(), today=TODAY))
    assert "gex" not in pack["options"] and any("sin respuesta" in m for m in pack["missing"])


def _save(kb, pack, at):
    pack = {**pack, "gathered_at": at.isoformat()}
    return story.save_pack(kb, pack, prompt="historia", host=RecordHost(provider="test"), now=at + timedelta(minutes=1))


def test_the_pack_is_kept_as_evidence_and_compared_with_the_previous(kb):
    first_at = datetime(2026, 10, 1, 21, 20, tzinfo=UTC)
    ref1, pack1 = _save(kb, gather(), first_at)
    assert ref1 == "evidence:2026-10-01-historia-spy-2120" and pack1["since_previous"] is None
    doc = kb.evidence.load(ref1.removeprefix("evidence:"))
    assert doc.content.source == "galecore" and json.loads(doc.content.payload)["prices"]["SPY"]["close"] == 101.0
    later = gather(close=90.0, gex={**GEX, "gex": {"global": {**GEX["gex"]["global"], "netGex": -1.0}}})
    ref2, pack2 = _save(kb, later, first_at + timedelta(days=1))
    since = pack2["since_previous"]
    assert since["ref"] == ref1 and since["moves"]["SPY.close"] == {"before": 101.0, "now": 91.0, "change": -10.0,
                                                                    "change_pct": round((91 / 101 - 1) * 100, 2)}
    assert since["sign_flips"] == {"gex.net_gex": "cambió de signo"}
    assert json.loads(kb.evidence.load(ref2.removeprefix("evidence:")).content.payload)["since_previous"] == since


def test_missing_data_travels_in_the_evidence_access_notes(kb):
    ref, _ = _save(kb, gather(fail={"compute.gex_analysis"}), datetime(2026, 10, 1, 21, 20, tzinfo=UTC))
    notes = kb.evidence.load(ref.removeprefix("evidence:")).content.access_notes
    assert any("compute.gex_analysis" in n for n in notes)


# ── the scheduled market story ──────────────────────────────────


def _story_task(env, monkeypatch):
    from galecore_ai.adapters import cli
    from tests.unit.test_tasks import make

    kb, sch, follow = env
    monkeypatch.setenv("LOCALAPPDATA", str(kb.base.parent / "appdata"))
    monkeypatch.setattr(cli, "_build_dispatcher", lambda: FakeDispatcher())
    make(kb, sch, task_id="historia", capability="market_story", strategy=None, result_slug="historia-spy",
         objective="¿Qué historia está priceando el mercado?")
    return kb, follow


def test_the_runner_gathers_the_pack_before_the_model_and_hands_it_over(env, monkeypatch):
    from galecore_ai.application import model_run as mr
    from galecore_ai.application import tasks as t
    from tests.unit.test_model_tasks import LATER, FakeModel

    kb, follow = _story_task(env, monkeypatch)
    model = FakeModel(mr.ModelReply(ok=False, error="turn cap reached (12)", turns=12, tokens={"output": 5}))
    result = t.run(kb=kb, task_id="historia", followup=follow, commit=False, now=LATER, client=model)
    ref = result["pack"]
    assert ref.startswith("evidence:") and kb.evidence.load(ref.removeprefix("evidence:")) is not None
    prompt = model.calls[0]["prompt"]
    assert ref in prompt and '"SPY"' in prompt and "do not fetch these data again" in prompt
    assert not any("story pack" in a for a in model.calls[0]["allowed"])         # the model never writes the pack
    # No result from the model: the day's pack is still kept, the run is INCOMPLETE, not FAILED.
    assert result["status"] == "INCOMPLETE" and ref in result["reason"] and result["tokens"] == {"output": 5}


def test_without_galecore_the_story_run_says_so(env, monkeypatch):
    from galecore_ai.adapters import cli
    from galecore_ai.application import model_run as mr
    from galecore_ai.application import tasks as t
    from tests.unit.test_model_tasks import LATER, FakeModel

    kb, follow = _story_task(env, monkeypatch)
    down = FakeDispatcher(fail=set(story.CROSS_ASSET) | set(story.VOL_INDICES) | {
        "compute.put_skew", "compute.implied_volatility", "compute.iv_rank", "market_data.volatility_metrics",
        "compute.gex_analysis"})
    monkeypatch.setattr(cli, "_build_dispatcher", lambda: down)
    model = FakeModel(mr.ModelReply(ok=False, error="claude not found on PATH"))
    result = t.run(kb=kb, task_id="historia", followup=follow, commit=False, now=LATER, client=model)
    assert result["status"] == "FAILED" and "GaleCore did not answer" in result["error"]
    assert "could not gather today's data" in model.calls[0]["prompt"]


def test_the_pack_is_gathered_when_the_run_starts_inside_an_event_loop(env, monkeypatch):
    # Real run 04/10: `task run` runs inside asyncio.run and the runner's own asyncio.run failed.
    from galecore_ai.application import model_run as mr
    from galecore_ai.application import tasks as t
    from tests.unit.test_model_tasks import LATER, FakeModel

    kb, follow = _story_task(env, monkeypatch)
    model = FakeModel(mr.ModelReply(ok=False, error="turn cap reached (12)"))

    async def from_the_cli():
        return t.run(kb=kb, task_id="historia", followup=follow, commit=False, now=LATER, client=model)

    result = asyncio.run(from_the_cli())
    assert result["status"] == "INCOMPLETE" and result["pack"].startswith("evidence:")


def test_on_a_weekend_the_gex_is_not_asked():
    d = FakeDispatcher()
    pack = asyncio.run(story.gather(d, today=date(2026, 10, 4)))     # a Sunday
    assert "compute.gex_analysis" not in [c for c, _ in d.calls] and "gex" not in pack["options"]
    assert any("mercado cerrado" in m for m in pack["missing"])
