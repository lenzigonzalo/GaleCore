"""GC-AI-0019: the data map — GaleCore data the harness can now ask for, and sources requested to GaleCore."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.source_registry_store import load_source_registry
from galecore_ai.adapters.source_status_store import FileSourceStatusStore
from galecore_ai.application.source_query import query_sources
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
from galecore_ai.capabilities.dispatcher import _ROUTE_TABLE
from galecore_ai.contracts.sources import AccessType, DataSource, Usage

NEW = ["market_data.option_chains", "compute.iv_rank", "compute.implied_volatility",
       "market_data.volatility_metrics", "market_data.candles", "market_data.option_greeks"]


@pytest.fixture
def status_store(tmp_path) -> FileSourceStatusStore:
    return FileSourceStatusStore(tmp_path / "sources")


def test_every_declared_capability_has_a_route_and_is_read_only():
    declared = {c.capability_id: c for c in KNOWN_CAPABILITIES}
    for cid in NEW:
        assert cid in declared and cid in _ROUTE_TABLE, cid
        assert declared[cid].is_phase3_allowed(), cid
    assert set(declared) <= set(_ROUTE_TABLE)


@pytest.mark.parametrize("need", ["IV rank de NVDA", "velas de QQQ", "cadena de opciones de SPY",
                                  "griegas de un contrato"])
def test_galecore_data_that_existed_is_now_found(status_store, need):
    result = query_sources(need, load_source_registry(), status_store)
    assert not result.missing and result.matches[0].id == "galecore", need


@pytest.mark.parametrize("need,source", [("fundamentales de NVDA", "sec_edgar"), ("historia del VIX", "cboe")])
def test_a_need_only_a_requested_source_covers_is_missing_and_says_who_brings_it(status_store, need, source):
    result = query_sources(need, load_source_registry(), status_store)
    assert result.missing and [m.id for m in result.matches] == [source]
    assert "GaleCore" in result.matches[0].usage_note


def test_requested_goes_with_requested_usage_and_no_probe():
    base = {"id": "pedida_ejemplo", "display_name": "X", "cost": "gratis", "preference": 1,
            "covers": [{"category": "c", "description": "d"}], "probe": {"description": "p"}}
    DataSource(**base, access_type=AccessType.REQUESTED, usage=Usage.REQUESTED)
    with pytest.raises(ValidationError):
        DataSource(**base, access_type=AccessType.REQUESTED, usage=Usage.FREE)
    with pytest.raises(ValidationError):
        DataSource(**{**base, "probe": {"description": "p", "command": "run"}},
                   access_type=AccessType.REQUESTED, usage=Usage.REQUESTED)


def _cli(*args, env=None):
    return subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args],
                          capture_output=True, text=True, encoding="utf-8", env=env, check=False)


def test_galecore_list_names_every_capability():
    out = json.loads(_cli("galecore", "list").stdout)
    assert {c["id"] for c in out["capabilities"]} == {c.capability_id for c in KNOWN_CAPABILITIES}


def test_a_scheduled_run_cannot_write_outside_its_directory(tmp_path):
    import os
    env = {**os.environ, "GALECORE_AI_RUN_DIR": str(tmp_path / "run"), "GALECORE_BASE_URL": "http://localhost:9"}
    proc = _cli("galecore", "get", "compute.iv_rank", "--symbol", "SPY", "--out", str(tmp_path / "elsewhere.json"),
                env=env)
    assert proc.returncode != 0 and not (tmp_path / "elsewhere.json").exists()
