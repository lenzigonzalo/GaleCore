"""Data source registry: declaration, observed access history, and queries (GC-AI-0012)."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import KNOWLEDGE_DIR_ENV
from galecore_ai.adapters.source_registry_store import load_source_registry
from galecore_ai.adapters.source_status_store import (
    SOURCE_STATUS_DIR_ENV,
    FileSourceStatusStore,
    SourceStatusIntegrityError,
    SourceStatusStoreError,
)
from galecore_ai.application.source_query import catalog_summary, query_sources
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.source_status import (
    AccessState,
    ObservationOrigin,
    SourceStatusDocument,
    SourceStatusObservation,
)
from galecore_ai.contracts.sources import (
    AccessType,
    DataSource,
    SourceCoverage,
    SourceProbe,
    SourceRegistry,
)

NOW = datetime(2026, 9, 28, 22, 0, tzinfo=UTC)


def source(**overrides) -> DataSource:
    data = {
        "id": "galecore",
        "display_name": "GaleCore",
        "access_type": AccessType.GALECORE_API,
        "cost": "sin costo",
        "usage": "own",
        "preference": 0,
        "covers": [{"category": "market_data", "description": "cotizaciones y cadenas de opciones"}],
        "probe": {"description": "GET liviano", "command": "python -B -m galecore_ai.adapters.cli sources check"},
    }
    data.update(overrides)
    return DataSource.model_validate(data)


def observation(**overrides) -> SourceStatusObservation:
    data = {"observed_at": NOW, "state": AccessState.AVAILABLE, "origin": ObservationOrigin.CODE_PROBE,
            "note": "respondió 200"}
    data.update(overrides)
    return SourceStatusObservation.model_validate(data)


class _StoreWith:
    """Status store stub that returns one fixed document."""

    def __init__(self, doc: SourceStatusDocument) -> None:
        self._doc = doc

    def load(self, source_id: str) -> SourceStatusDocument:
        return self._doc


@pytest.fixture
def status_store(tmp_path) -> FileSourceStatusStore:
    return FileSourceStatusStore(tmp_path / "sources")


# ── contracts.sources ───────────────────────────────────────────────


class TestDataSourceContract:
    def test_at_least_one_coverage_entry_is_required(self):
        with pytest.raises(ValidationError, match="coverage"):
            source(covers=[])

    def test_id_must_be_lower_snake_case(self):
        with pytest.raises(ValidationError, match="lower_snake_case"):
            source(id="Alpha-Vantage")

    def test_galecore_api_and_api_key_sources_need_a_runnable_probe(self):
        with pytest.raises(ValidationError, match="needs a runnable probe"):
            source(probe={"description": "sin comando", "command": None})

    def test_host_connector_sources_have_no_runnable_command(self):
        with pytest.raises(ValidationError, match="no command"):
            source(access_type=AccessType.HOST_CONNECTOR,
                  probe={"description": "sólo el host puede probarlo",
                         "command": "python -B -m galecore_ai.adapters.cli sources check"})
        assert source(access_type=AccessType.HOST_CONNECTOR,
                     probe={"description": "sólo el host puede probarlo", "command": None})

    def test_registry_rejects_duplicate_ids(self):
        with pytest.raises(ValidationError, match="duplicate source ids"):
            SourceRegistry(sources=[source(), source()])

    def test_registry_get(self):
        registry = SourceRegistry(sources=[source(), source(id="fred", access_type=AccessType.API_KEY,
                                                   covers=[{"category": "rates_curve", "description": "tasas"}])])
        assert registry.get("fred").id == "fred"
        assert registry.get("nope") is None


def test_config_sources_yaml_loads_and_validates():
    registry = load_source_registry()
    ids = {s.id for s in registry.sources}
    assert {"galecore", "fred", "alpha_vantage", "fmp"} <= ids
    galecore = registry.get("galecore")
    assert galecore.preference == 0
    assert galecore.probe.command is not None
    alpha_vantage = registry.get("alpha_vantage")
    assert alpha_vantage.access_type == AccessType.HOST_CONNECTOR
    assert alpha_vantage.probe.command is None


def test_config_sources_yaml_finds_symbols_it_actually_serves(status_store):
    # GC-AI-0012 internal review: a request naming an instrument GaleCore genuinely serves
    # (SPY quotes, VIX/VVIX via market_data.trade — see application/prepare_regime.py) must
    # match, not report missing just because the request names a symbol.
    registry = load_source_registry()
    for need in ("cotizaciones de SPY", "VIX"):
        result = query_sources(need, registry, status_store)
        assert "galecore" in {m.id for m in result.matches}, need


def test_generic_symbol_matches_a_coverage_that_serves_any_symbol(status_store):
    # Codex recheck GC-AI-0012: "cotizaciones de QQQ" reported missing although GaleCore
    # serves any symbol; a bare acronym that only looks like a ticker must not match.
    registry = load_source_registry()
    for need in ("cotizaciones de QQQ", "GEX de QQQ"):
        assert "galecore" in {m.id for m in query_sources(need, registry, status_store).matches}, need
    # "IV" is GaleCore's own vocabulary since GC-AI-0019 (IV rank, IV30), and CPI since WS-0014 (FRED and BLS by GaleCore)
    assert "galecore" not in {m.id for m in query_sources("QQQ", registry, status_store).matches}
    assert [m.id for m in query_sources("datos de CPI", registry, status_store).matches][:2] == ["galecore", "fred"]


# ── contracts.source_status ─────────────────────────────────────────


class TestSourceStatusObservation:
    def test_host_declared_needs_host(self):
        with pytest.raises(ValidationError, match="needs host"):
            observation(origin=ObservationOrigin.HOST_DECLARED)

    def test_code_probe_has_no_host_to_declare(self):
        with pytest.raises(ValidationError, match="no host to declare"):
            observation(host=RecordHost(provider="claude-code", model="m", provenance="HOST_DECLARED"))

    def test_host_declared_with_host_is_valid(self):
        obs = observation(origin=ObservationOrigin.HOST_DECLARED, state=AccessState.DENIED,
                          host=RecordHost(provider="claude-code", model="m", provenance="HOST_DECLARED"))
        assert obs.state == AccessState.DENIED

    def test_naive_timestamp_is_refused(self):
        with pytest.raises(ValidationError, match="timezone"):
            observation(observed_at="2026-09-28T22:00:00")

    @pytest.mark.parametrize("note", ["api_key=abcdef1234567890", "Authorization: Bearer0123456789abc"])
    def test_note_cannot_carry_a_credential(self, note):
        with pytest.raises(ValidationError, match="credential"):
            observation(note=note)


# ── adapters.source_status_store ────────────────────────────────────


class TestFileSourceStatusStore:
    def test_no_observations_yet_is_none(self, status_store):
        assert status_store.load("galecore") is None

    def test_append_then_load_round_trips(self, status_store):
        doc = SourceStatusDocument(source_id="galecore", observations=[observation()])
        path = status_store.append("galecore", doc)
        assert path == status_store.base_dir / "galecore.md"
        loaded = status_store.load("galecore")
        assert loaded == doc
        assert loaded.latest.state == AccessState.AVAILABLE

    def test_second_append_keeps_the_first_observation(self, status_store):
        first = SourceStatusDocument(source_id="galecore", observations=[observation()])
        status_store.append("galecore", first)
        second = SourceStatusDocument(
            source_id="galecore",
            observations=[*first.observations, observation(observed_at=NOW + timedelta(hours=1),
                                                            state=AccessState.DOWN, note="timeout")])
        status_store.append("galecore", second)
        loaded = status_store.load("galecore")
        assert len(loaded.observations) == 2
        assert loaded.latest.state == AccessState.DOWN

    def test_latest_is_by_observed_at_not_append_order(self, status_store):
        # A backdated append (seeding an older finding after a newer one is already on file)
        # must not make the older state look current.
        newer = SourceStatusDocument(source_id="galecore", observations=[
            observation(observed_at=NOW + timedelta(hours=1), state=AccessState.DOWN, note="mas reciente")])
        status_store.append("galecore", newer)
        older_appended_second = SourceStatusDocument(source_id="galecore", observations=[
            *newer.observations,
            observation(observed_at=NOW, state=AccessState.AVAILABLE, note="mas viejo, anexado despues")])
        status_store.append("galecore", older_appended_second)
        assert status_store.load("galecore").latest.state == AccessState.DOWN

    @pytest.mark.parametrize("order", [(AccessState.AVAILABLE, AccessState.DENIED),
                                       (AccessState.DENIED, AccessState.AVAILABLE)])
    def test_same_time_conflict_resolves_to_the_worse_state_in_any_order(self, order):
        # Codex recheck GC-AI-0012: equal observed_at must not depend on append order.
        doc = SourceStatusDocument(source_id="fmp", observations=[
            observation(state=order[0], note="a"), observation(state=order[1], note="b")])
        assert doc.latest.state == AccessState.DENIED
        view = query_sources("cotizaciones", SourceRegistry(sources=[source(id="fmp")]),
                             _StoreWith(doc)).matches[0].last_status
        assert view.state == "denied"

    def test_rewriting_an_existing_observation_is_refused(self, status_store):
        doc = SourceStatusDocument(source_id="galecore", observations=[observation()])
        status_store.append("galecore", doc)
        tampered = SourceStatusDocument(source_id="galecore", observations=[observation(note="reescrito")])
        with pytest.raises(SourceStatusStoreError, match="pure append"):
            status_store.append("galecore", tampered)

    def test_append_with_no_new_observation_is_refused(self, status_store):
        doc = SourceStatusDocument(source_id="galecore", observations=[observation()])
        status_store.append("galecore", doc)
        with pytest.raises(SourceStatusStoreError, match="at least one"):
            status_store.append("galecore", doc)

    def test_edited_file_is_integrity_failed(self, status_store):
        doc = SourceStatusDocument(source_id="galecore", observations=[observation()])
        path = status_store.append("galecore", doc)
        # Tamper only the YAML frontmatter's first "available" (the state); the rendered
        # Markdown body below keeps saying "available", so the two now disagree.
        path.write_text(path.read_text(encoding="utf-8").replace("available", "denied", 1), encoding="utf-8")
        with pytest.raises(SourceStatusIntegrityError):
            status_store.load("galecore")

    def test_invalid_id_is_refused(self, status_store):
        with pytest.raises(SourceStatusStoreError):
            status_store.path_for("Not-Valid")

    def test_env_override(self, tmp_path, monkeypatch):
        from galecore_ai.adapters.source_status_store import default_source_status_dir

        target = tmp_path / "elsewhere"
        monkeypatch.setenv(SOURCE_STATUS_DIR_ENV, str(target))
        assert default_source_status_dir() == target.resolve()

    def test_missing_knowledge_base_without_override_is_an_error(self, tmp_path, monkeypatch):
        from galecore_ai.adapters.source_status_store import default_source_status_dir

        monkeypatch.delenv(SOURCE_STATUS_DIR_ENV, raising=False)
        monkeypatch.setenv(KNOWLEDGE_DIR_ENV, str(tmp_path / "nope"))
        with pytest.raises(SourceStatusStoreError):
            default_source_status_dir()


# ── application.source_query ────────────────────────────────────────


class TestQuery:
    def registry(self) -> SourceRegistry:
        return SourceRegistry(sources=[
            source(id="galecore", preference=0, cost="a",
                  covers=[SourceCoverage(category="market_data", description="cadenas de opciones de SPY")]),
            source(id="fred", preference=10, cost="b", access_type=AccessType.API_KEY,
                  covers=[SourceCoverage(category="rates_curve", description="tasas del Tesoro")]),
            source(id="alpha_vantage", preference=20, cost="c", access_type=AccessType.HOST_CONNECTOR,
                  covers=[SourceCoverage(category="rates_curve", description="TREASURY_YIELD")],
                  probe=SourceProbe(description="sólo el host puede probarlo", command=None)),
        ])

    def test_matches_are_ordered_by_preference_then_cost(self, status_store):
        result = query_sources("tasas del Tesoro", self.registry(), status_store)
        assert [m.id for m in result.matches] == ["fred"]
        assert result.missing is False

    def test_a_need_with_no_match_is_reported_missing(self, status_store):
        result = query_sources("algo completamente distinto", self.registry(), status_store)
        assert result.missing is True
        assert result.matches == []

    def test_stopwords_alone_do_not_match_everything(self, status_store):
        result = query_sources("la de el", self.registry(), status_store)
        assert result.missing is True

    def test_match_includes_last_known_status(self, status_store):
        status_store.append("galecore", SourceStatusDocument(source_id="galecore", observations=[observation()]))
        result = query_sources("opciones de SPY", self.registry(), status_store)
        assert result.matches[0].last_status.state == "available"

    def test_catalog_summary_groups_by_category(self, status_store):
        summary = catalog_summary(self.registry(), status_store)
        categories = {c.category: c.sources for c in summary.categories}
        assert categories["rates_curve"] == ["fred", "alpha_vantage"]
        assert {s.id for s in summary.sources} == {"galecore", "fred", "alpha_vantage"}

    def test_empty_or_blank_need_is_missing_not_everything(self, status_store):
        for need in ("", "   "):
            result = query_sources(need, self.registry(), status_store)
            assert result.missing is True
            assert result.matches == []

    def test_a_common_word_in_the_query_scaffolding_does_not_cause_a_false_match(self, status_store):
        # "datos" is scaffolding ("¿de dónde saco los datos de X?"), not a coverage's own vocabulary.
        registry = SourceRegistry(sources=[
            source(id="galecore", covers=[SourceCoverage(
                category="options_state", description="GEX calculado por GaleCore sobre sus propios datos")]),
            source(id="fred", access_type=AccessType.API_KEY,
                  covers=[SourceCoverage(category="inflation", description="CPI y breakevens de inflación")]),
        ])
        result = query_sources("datos de inflación", registry, status_store)
        assert [m.id for m in result.matches] == ["fred"]

    def test_short_terms_match_whole_words_not_substrings_of_unrelated_words(self, status_store):
        # A 2-letter term like "iv" must not match inside an unrelated word such as "activity".
        registry = SourceRegistry(sources=[
            source(id="fred", access_type=AccessType.API_KEY,
                  covers=[SourceCoverage(category="activity_employment", description="nonfarm payroll")]),
        ])
        result = query_sources("iv", registry, status_store)
        assert result.missing is True

    def test_status_shown_is_specific_to_the_matched_category(self, status_store):
        registry = SourceRegistry(sources=[
            source(id="fmp", access_type=AccessType.HOST_CONNECTOR,
                  probe=SourceProbe(description="sólo el host puede probarlo", command=None),
                  covers=[SourceCoverage(category="quotes", description="quote de SPY"),
                          SourceCoverage(category="scheduled_events", description="economics-calendar")]),
        ])
        status_store.append("fmp", SourceStatusDocument(source_id="fmp", observations=[
            observation(origin=ObservationOrigin.HOST_DECLARED, state=AccessState.AVAILABLE, category="quotes",
                       host=RecordHost(provider="claude-code", model="m", provenance="HOST_DECLARED")),
            observation(origin=ObservationOrigin.HOST_DECLARED, state=AccessState.DENIED,
                       observed_at=NOW + timedelta(hours=1), category="scheduled_events",
                       host=RecordHost(provider="claude-code", model="m", provenance="HOST_DECLARED")),
        ]))
        result = query_sources("quote de SPY", registry, status_store)
        assert result.matches[0].last_status.state == "available"  # not the later, unrelated "denied"

    def test_integrity_failed_status_is_reported_not_raised(self, status_store):
        status_store.append("galecore", SourceStatusDocument(source_id="galecore", observations=[observation()]))
        path = status_store.base_dir / "galecore.md"
        path.write_text(path.read_text(encoding="utf-8").replace("available", "denied", 1), encoding="utf-8")
        result = query_sources("opciones de SPY", self.registry(), status_store)
        assert result.matches[0].last_status.state == "integrity_failed"
        summary = catalog_summary(self.registry(), status_store)
        galecore = next(s for s in summary.sources if s.id == "galecore")
        assert galecore.last_status.state == "integrity_failed"


# ── application.source_probe ─────────────────────────────────────────


class TestProbeFred:
    # WS-0014: FRED se sondea a través de GaleCore (macro.fred_series); este código ya no usa FRED_API_KEY.
    class _Dispatcher:
        def __init__(self, ok, error=None):
            self.ok, self.error, self.calls = ok, error, []

        async def invoke(self, capability_id, parameters):
            self.calls.append((capability_id, parameters))
            return SimpleNamespace(ok=self.ok, error=self.error, latency_ms=12)

    def test_goes_through_galecore(self, monkeypatch):
        from galecore_ai.application.source_probe import probe_fred

        monkeypatch.delenv("FRED_API_KEY", raising=False)
        d = self._Dispatcher(ok=True)
        obs = asyncio.run(probe_fred(d))
        assert obs.state == AccessState.AVAILABLE and obs.origin == ObservationOrigin.CODE_PROBE
        assert d.calls[0][0] == "macro.fred_series" and d.calls[0][1]["SeriesId"] == "DGS10"

    def test_upstream_down_is_down(self):
        from galecore_ai.application.source_probe import probe_fred

        obs = asyncio.run(probe_fred(self._Dispatcher(ok=False, error="HTTP 502: fred: falta FredApi:Key")))
        assert obs.state == AccessState.DOWN and "FredApi:Key" in obs.note


# ── CLI ───────────────────────────────────────────────────────────


def _cli(*args, stdin=None, env=None):
    import os

    full_env = {**os.environ, **(env or {})}
    return subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], input=stdin,
                          capture_output=True, text=True, encoding="utf-8", check=False, env=full_env)


def test_cli_sources_list_and_query(tmp_path, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    kb_dir = tmp_path / "knowledge"
    kb_dir.mkdir()
    env = {KNOWLEDGE_DIR_ENV: str(kb_dir)}

    listed = _cli("sources", "list", env=env)
    assert listed.returncode == 0, listed.stdout
    out = json.loads(listed.stdout)
    assert any(c["category"] == "market_data" for c in out["categories"])

    found = _cli("sources", "query", "--need", "tasas del Tesoro", env=env)
    assert found.returncode == 0, found.stdout
    assert "fred" in {m["id"] for m in json.loads(found.stdout)["matches"]}

    missing = _cli("sources", "query", "--need", "wibbledorf zzqx inexistente", env=env)
    assert missing.returncode == 2
    assert json.loads(missing.stdout)["missing"] is True


def test_cli_sources_declare_needs_a_host_connector_and_a_resolvable_evidence(tmp_path):
    kb_dir = tmp_path / "knowledge"
    kb_dir.mkdir()
    env = {KNOWLEDGE_DIR_ENV: str(kb_dir)}
    observed_at = "2026-09-27T15:55:00Z"

    wrong_kind = _cli("sources", "declare", "--source", "galecore", "--state", "denied", "--note", "x",
                      "--observed-at", observed_at, "--host-model", "test", env=env)
    assert wrong_kind.returncode == 3
    assert "host_connector" in json.loads(wrong_kind.stdout)["error"]

    bad_ref = _cli("sources", "declare", "--source", "alpha_vantage", "--state", "limited", "--note", "x",
                   "--observed-at", observed_at, "--evidence", "evidence:2026-09-27-nope",
                   "--host-model", "test", env=env)
    assert bad_ref.returncode == 3
    assert "no such evidence" in json.loads(bad_ref.stdout)["error"]

    unknown_category = _cli("sources", "declare", "--source", "alpha_vantage", "--state", "limited", "--note", "x",
                            "--observed-at", observed_at, "--category", "nope", "--host-model", "test", env=env)
    assert unknown_category.returncode == 3
    assert "unknown category" in json.loads(unknown_category.stdout)["error"]

    missing_observed_at = _cli("sources", "declare", "--source", "alpha_vantage", "--state", "limited",
                               "--note", "x", "--host-model", "test", env=env)
    assert missing_observed_at.returncode == 3

    declared = _cli("sources", "declare", "--source", "alpha_vantage", "--state", "limited",
                    "--note", "1 consulta/s y 25/dia", "--observed-at", observed_at,
                    "--category", "rates_curve", "--host-model", "test", env=env)
    assert declared.returncode == 0, declared.stdout
    out = json.loads(declared.stdout)
    assert out["state"] == "limited"
    assert out["origin"] == "host_declared"
    assert out["observed_at"].startswith("2026-09-27T15:55:00")
    assert out["category"] == "rates_curve"

    listed = json.loads(_cli("sources", "list", env=env).stdout)
    av = next(s for s in listed["sources"] if s["id"] == "alpha_vantage")
    assert av["last_status"]["state"] == "limited"
    assert av["last_status"]["observed_at"].startswith("2026-09-27T15:55:00")


def test_cli_sources_declare_rejects_a_credential_without_echoing_it(tmp_path):
    kb_dir = tmp_path / "knowledge"
    kb_dir.mkdir()
    env = {KNOWLEDGE_DIR_ENV: str(kb_dir)}
    secret = "REVIEW_FAKE_CREDENTIAL_123456"

    result = _cli("sources", "declare", "--source", "alpha_vantage", "--state", "limited",
                  "--note", f"api_key={secret}", "--observed-at", "2026-09-27T15:55:00Z",
                  "--host-model", "test", env=env)
    assert result.returncode == 3
    assert secret not in result.stdout
    assert secret not in result.stderr


def test_cli_sources_check_galecore_reports_down_without_a_server(tmp_path):
    kb_dir = tmp_path / "knowledge"
    kb_dir.mkdir()
    env = {KNOWLEDGE_DIR_ENV: str(kb_dir), "GALECORE_BASE_URL": "http://127.0.0.1:1",
          "GALECORE_TIMEOUT_SECONDS": "2"}
    checked = _cli("sources", "check", "--source", "galecore", env=env)
    assert checked.returncode == 0, checked.stdout
    assert json.loads(checked.stdout)["checked"]["galecore"]["state"] == "down"


# ── GC-AI-0014: order by usage (owner's rule, 29/09) ──────────────────


def test_every_usage_has_a_rank():
    from galecore_ai.contracts.sources import USAGE_RANK, Usage

    assert set(USAGE_RANK) == set(Usage)


def test_usage_is_required():
    data = source().model_dump()
    del data["usage"]
    with pytest.raises(ValidationError, match="usage"):
        DataSource.model_validate(data)


def test_free_before_own_before_quota_before_plan_then_preference(status_store):
    registry = SourceRegistry(sources=[
        source(id="plan_src", usage="plan", preference=0, access_type=AccessType.HOST_CONNECTOR,
               probe={"description": "host", "command": None}),
        source(id="quota_src", usage="daily_quota", preference=0, access_type=AccessType.HOST_CONNECTOR,
               probe={"description": "host", "command": None}),
        source(id="own_src", usage="own", preference=0),
        source(id="free_b", usage="free", preference=20, access_type=AccessType.API_KEY),
        source(id="free_a", usage="free", preference=10, access_type=AccessType.API_KEY),
    ])
    result = query_sources("cotizaciones", registry, status_store)
    assert [m.id for m in result.matches] == ["free_a", "free_b", "own_src", "quota_src", "plan_src"]
    notes = {m.id: m.usage_note for m in result.matches}
    assert notes["quota_src"] and "cupo" in notes["quota_src"]
    assert notes["free_a"] is None and notes["plan_src"] is None
    assert catalog_summary(registry, status_store).sources[0].id == "free_a"


def test_real_registry_follows_the_owners_rule(status_store):
    registry = load_source_registry()
    assert [m.id for m in query_sources("curva de tasas", registry, status_store).matches] == [
        "galecore", "fred", "alpha_vantage", "fmp"]
    assert [m.id for m in query_sources("cotizaciones de SPY", registry, status_store).matches] == [
        "galecore", "fmp"]
    assert [m.id for m in query_sources("GEX de SPY", registry, status_store).matches] == ["galecore"]
