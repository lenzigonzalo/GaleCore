"""Evaluable record: write, append outcome/review, query, integrity (GC-AI-0002 AC-03..05)."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from galecore_ai.adapters.record_store import (
    FileRecordStore,
    RecordIntegrityError,
    RecordStoreError,
    default_records_dir,
)
from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.accept_interpretation import accept_interpretation
from galecore_ai.application.prepare_regime import fetch_regime_facts
from galecore_ai.application.record_regime import (
    RecordError,
    query_records,
    record_accepted,
    record_date_for,
    record_outcome,
    record_review,
)
from galecore_ai.contracts.agent_run import RunStatus
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest
from galecore_ai.contracts.regime_record import ReviewVerdict
from tests.unit.regime_support import (
    RegimeFakeDispatcher,
    regime_snapshot,
    valid_regime_interpretation,
)

PROMPT = "Analizá el régimen de hoy de SPY y guardalo"


@pytest.fixture
def snapshot_store(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


@pytest.fixture
def records(tmp_path):
    return FileRecordStore(tmp_path / "records")


def _accepted(snapshot_store, snapshot, interpretation=None):
    snapshot_store.save(snapshot)
    result = accept_interpretation(
        store=snapshot_store,
        request=AcceptanceRequest(run_id=snapshot.run_id,
                                  interpretation=interpretation or valid_regime_interpretation(),
                                  host_provider="claude-code", host_model="claude-opus-5"),
        allow_unknown_freshness=True,
    )
    assert result.status == RunStatus.SUCCESS, result.error_detail
    return result


def _record(snapshot_store, records, snapshot=None):
    snapshot = snapshot or regime_snapshot()
    result = _accepted(snapshot_store, snapshot)
    entry, path = record_accepted(store=records, snapshot=snapshot, result=result, prompt=PROMPT)
    return snapshot, result, entry, path


async def _fetched():
    return await fetch_regime_facts(symbol="SPY", dispatcher=RegimeFakeDispatcher(),
                                    max_staleness_seconds=600)


class TestRecordDate:
    def test_date_uses_convention_timezone(self):
        # 2026-09-17 00:30 UTC is still 2026-09-16 in New York
        assert record_date_for(datetime(2026, 9, 17, 0, 30, tzinfo=UTC), "America/New_York") == "2026-09-16"
        assert record_date_for(datetime(2026, 9, 17, 0, 30, tzinfo=UTC), "UTC") == "2026-09-17"

    def test_unknown_timezone_fails_closed(self):
        with pytest.raises(RecordError):
            record_date_for(datetime.now(UTC), "Mars/Olympus")


class TestRecordAccepted:
    def test_writes_markdown_with_authoritative_frontmatter(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        assert text.startswith("---\n")
        assert "schema_version: '1'" in text and "symbol: SPY" in text
        assert PROMPT in text
        assert Path(path).name == record_date_for(snapshot.prepared_at, "America/New_York") + ".md"
        doc = records.load("SPY", Path(path).stem)
        assert doc is not None and [e.entry_id for e in doc.entries] == [snapshot.run_id]

    def test_entry_carries_the_full_trace_identity(self, snapshot_store, records):
        snapshot, result, entry, _ = _record(snapshot_store, records)
        assert entry.snapshot.facts_hash == snapshot.facts_hash
        assert entry.snapshot.conventions_hash == snapshot.conventions_hash
        assert entry.facts == snapshot.facts
        assert entry.effective_assets == snapshot.effective_assets
        assert entry.host.provider == "claude-code" and entry.host.provenance == "HOST_DECLARED"
        assert entry.accepted_payload == result.result
        assert entry.trace.trace_id == result.trace.trace_id
        assert entry.trace.accepted_at == result.trace.accepted_at
        assert [c.capability_id for c in entry.trace.capabilities] == [
            c.capability_id for c in result.trace.capabilities_invoked]
        assert entry.outcomes == [] and entry.human_reviews == []
        assert entry.entry_hash.startswith("sha256:")

    def test_same_day_second_run_appends_never_overwrites(self, snapshot_store, records):
        first, *_ = _record(snapshot_store, records)
        second, *_ = _record(snapshot_store, records, regime_snapshot(prepared_at=first.prepared_at))
        doc = records.load("SPY", record_date_for(first.prepared_at, "America/New_York"))
        assert [e.entry_id for e in doc.entries] == [first.run_id, second.run_id]

    def test_same_run_id_cannot_be_recorded_twice(self, snapshot_store, records):
        snapshot, result, *_ = _record(snapshot_store, records)
        with pytest.raises(RecordError, match="already recorded"):
            record_accepted(store=records, snapshot=snapshot, result=result, prompt=PROMPT)

    def test_rejected_result_is_never_recorded(self, snapshot_store, records):
        snapshot = regime_snapshot()
        snapshot_store.save(snapshot)
        result = accept_interpretation(
            store=snapshot_store,
            request=AcceptanceRequest(run_id=snapshot.run_id,
                                      interpretation=valid_regime_interpretation(tail_pricing="elevated")),
            allow_unknown_freshness=True,
        )
        assert result.status == RunStatus.VALIDATION_ERROR
        with pytest.raises(RecordError, match="Only SUCCESS"):
            record_accepted(store=records, snapshot=snapshot, result=result, prompt=PROMPT)
        assert records.dates("SPY") == []

    def test_result_from_another_snapshot_rejected(self, snapshot_store, records):
        snapshot_a = regime_snapshot()
        result_a = _accepted(snapshot_store, snapshot_a)
        snapshot_b = regime_snapshot()
        with pytest.raises(RecordError, match="does not belong"):
            record_accepted(store=records, snapshot=snapshot_b, result=result_a, prompt=PROMPT)

    def test_gex_snapshot_is_not_recorded(self, snapshot_store, records):
        snapshot = regime_snapshot(skill_id="gex_interpretation")
        snapshot_store.save(snapshot)
        with pytest.raises(RecordError, match="Only regime_interpretation"):
            record_accepted(store=records, snapshot=snapshot,
                            result=accept_interpretation(store=snapshot_store,
                                                         request=AcceptanceRequest(run_id=snapshot.run_id,
                                                                                   interpretation={}),
                                                         allow_unknown_freshness=True),
                            prompt=PROMPT)

    def test_empty_prompt_rejected(self, snapshot_store, records):
        snapshot = regime_snapshot()
        result = _accepted(snapshot_store, snapshot)
        with pytest.raises(RecordError, match="prompt"):
            record_accepted(store=records, snapshot=snapshot, result=result, prompt="   ")

    def test_no_secrets_or_raw_logs_in_file(self, snapshot_store, records, monkeypatch):
        monkeypatch.setenv("GALECORE_API_KEY", "super-secret-key-value")
        _, _, _, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        assert "super-secret-key-value" not in text
        assert "X-API-KEY" not in text


class TestOutcomeAndReview:
    async def test_outcome_appends_galecore_verified_facts(self, snapshot_store, records):
        snapshot, _, entry, _ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        ids, _ = record_outcome(store=records, symbol="SPY", day=day, fetched=await _fetched())
        assert ids == [entry.entry_id]
        doc = records.load("SPY", day)
        outcome = doc.entries[0].outcomes[0]
        assert outcome.facts_provenance == "GALECORE_VERIFIED"
        assert outcome.facts["spot"] == 757.43 and len(outcome.capabilities) == 4
        assert doc.entries[0].entry_hash == entry.entry_hash  # immutable part untouched

    async def test_outcome_targets_one_run_id_when_given(self, snapshot_store, records):
        first, *_ = _record(snapshot_store, records)
        second, *_ = _record(snapshot_store, records, regime_snapshot(prepared_at=first.prepared_at))
        day = record_date_for(first.prepared_at, "America/New_York")
        ids, _ = record_outcome(store=records, symbol="SPY", day=day, fetched=await _fetched(),
                                run_id=second.run_id)
        assert ids == [second.run_id]
        doc = records.load("SPY", day)
        assert [len(e.outcomes) for e in doc.entries] == [0, 1]

    async def test_outcome_for_unknown_run_id_or_day_fails(self, snapshot_store, records):
        snapshot, *_ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        with pytest.raises(RecordError, match="not found"):
            record_outcome(store=records, symbol="SPY", day=day, fetched=await _fetched(), run_id="nope")
        with pytest.raises(RecordError, match="No record"):
            record_outcome(store=records, symbol="SPY", day="1999-01-01", fetched=await _fetched())

    def test_review_appends_verdict_and_keeps_payload(self, snapshot_store, records):
        snapshot, result, entry, _ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        record_review(store=records, symbol="SPY", day=day, run_id=entry.entry_id,
                      verdict=ReviewVerdict.DISAGREE, comment="Skew moved against the read")
        doc = records.load("SPY", day)
        e = doc.entries[0]
        assert e.human_reviews[0].verdict == ReviewVerdict.DISAGREE
        assert e.accepted_payload == result.result and e.entry_hash == entry.entry_hash

    def test_review_requires_comment(self, snapshot_store, records):
        snapshot, _, entry, _ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        with pytest.raises(RecordError, match="comment"):
            record_review(store=records, symbol="SPY", day=day, run_id=entry.entry_id,
                          verdict=ReviewVerdict.AGREE, comment=" ")


class TestQueryAndIntegrity:
    def _tamper(self, path: str, old: str, new: str) -> None:
        text = Path(path).read_text(encoding="utf-8")
        assert old in text
        Path(path).write_text(text.replace(old, new), encoding="utf-8")

    def test_query_returns_what_was_said_and_what_happened(self, snapshot_store, records):
        snapshot, _, entry, _ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        record_review(store=records, symbol="SPY", day=day, run_id=entry.entry_id,
                      verdict=ReviewVerdict.AGREE, comment="ok")
        items = query_records(store=records, symbol="SPY", since=date.fromisoformat(day))
        assert len(items) == 1 and items[0]["status"] == "OK"
        e = items[0]["entries"][0]
        assert e["prompt"] == PROMPT and e["accepted_payload"]["gamma_regime"] == "negative_gamma"
        assert e["facts_hash"] == snapshot.facts_hash and e["human_reviews"][0]["verdict"] == "agree"

    def test_query_filters_by_date_range(self, snapshot_store, records):
        snapshot, *_ = _record(snapshot_store, records)
        day = date.fromisoformat(record_date_for(snapshot.prepared_at, "America/New_York"))
        assert query_records(store=records, symbol="SPY", since=day.replace(year=day.year + 1)) == []
        assert query_records(store=records, symbol="SPY", since=day, until=day) != []
        assert query_records(store=records, symbol="QQQ", since=day) == []

    def test_tampered_payload_is_integrity_failed_not_skipped(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        self._tamper(path, "gamma_regime: negative_gamma", "gamma_regime: positive_gamma")
        day = date.fromisoformat(record_date_for(snapshot.prepared_at, "America/New_York"))
        items = query_records(store=records, symbol="SPY", since=day)
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("entry_hash mismatch" in p for p in items[0]["problems"])

    def test_tampered_facts_report_facts_hash_mismatch(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        self._tamper(path, "    vix: 17.71\n", "    vix: 27.71\n")
        day = date.fromisoformat(record_date_for(snapshot.prepared_at, "America/New_York"))
        items = query_records(store=records, symbol="SPY", since=day)
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("facts_hash mismatch" in p for p in items[0]["problems"])

    def test_corrupt_frontmatter_yaml_is_integrity_failed(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        self._tamper(path, "\nentries:\n", "\nentries: {\n")
        day = date.fromisoformat(record_date_for(snapshot.prepared_at, "America/New_York"))
        items = query_records(store=records, symbol="SPY", since=day)
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("YAML invalid" in p or "record contract" in p for p in items[0]["problems"])

    def test_incomplete_frontmatter_is_integrity_failed(self, records, tmp_path):
        folder = records.base_dir / "SPY"
        folder.mkdir()
        (folder / "2026-09-16.md").write_text("---\nsymbol: SPY\n---\nprose only\n", encoding="utf-8")
        items = query_records(store=records, symbol="SPY", since=date(2026, 9, 1))
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("record contract" in p for p in items[0]["problems"])

    def test_later_steps_refuse_to_touch_a_tampered_file(self, snapshot_store, records):
        snapshot, _, entry, path = _record(snapshot_store, records)
        self._tamper(path, "gamma_regime: negative_gamma", "gamma_regime: positive_gamma")
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        with pytest.raises(RecordError, match="cannot be trusted"):
            record_review(store=records, symbol="SPY", day=day, run_id=entry.entry_id,
                          verdict=ReviewVerdict.AGREE, comment="x")
        another = regime_snapshot(prepared_at=snapshot.prepared_at)
        with pytest.raises(RecordError, match="cannot be trusted"):
            record_accepted(store=records, snapshot=another,
                            result=_accepted(snapshot_store, another), prompt=PROMPT)

    def test_store_refuses_to_write_inconsistent_document(self, snapshot_store, records):
        snapshot, *_ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        doc = records.load("SPY", day)
        doc.entries[0].accepted_payload["gamma_regime"] = "positive_gamma"
        with pytest.raises(RecordStoreError, match="inconsistent"):
            records.save(doc)

    def test_load_rejects_document_in_wrong_location(self, snapshot_store, records):
        _, _, _, path = _record(snapshot_store, records)
        moved = records.base_dir / "QQQ" / "2020-01-01.md"
        moved.parent.mkdir()
        moved.write_text(Path(path).read_text(encoding="utf-8"), encoding="utf-8")
        with pytest.raises(RecordIntegrityError, match="does not match file location"):
            records.load("QQQ", "2020-01-01")

    def test_path_validation(self, records):
        with pytest.raises(RecordStoreError):
            records.path_for("../etc", "2026-09-16")
        with pytest.raises(RecordStoreError):
            records.path_for("SPY", "16-09-2026")


class TestRecordsDir:
    def test_env_override_wins(self, monkeypatch, tmp_path):
        monkeypatch.setenv("GALECORE_RECORDS_DIR", str(tmp_path / "r"))
        assert default_records_dir() == (tmp_path / "r").resolve()

    def test_default_points_at_sibling_galecore_research(self, monkeypatch):
        monkeypatch.delenv("GALECORE_RECORDS_DIR", raising=False)
        sibling = Path(default_records_dir.__globals__["__file__"]).resolve().parents[3].parent / "GaleCore" / "research"
        if not sibling.is_dir():
            pytest.skip("no sibling GaleCore checkout on this machine")
        path = default_records_dir()
        assert path.name == "regime" and path.parent.name == "research"

    def test_without_sibling_and_without_env_fails_closed(self, monkeypatch, tmp_path):
        monkeypatch.delenv("GALECORE_RECORDS_DIR", raising=False)
        monkeypatch.setattr(Path, "is_dir", lambda self: False)
        with pytest.raises(RecordStoreError, match="GALECORE_RECORDS_DIR"):
            default_records_dir()


class TestDocumentSchema:
    def test_document_round_trips_through_its_json_dump(self, snapshot_store, records):
        snapshot, *_ = _record(snapshot_store, records)
        day = record_date_for(snapshot.prepared_at, "America/New_York")
        doc = records.load("SPY", day)
        from galecore_ai.contracts.regime_record import RegimeRecordDocument

        again = RegimeRecordDocument.model_validate(json.loads(doc.model_dump_json()))
        assert again == doc


class TestReviewRoundFixes:
    """Internal review round 1: frontmatter integrity, marker injection, dotted symbols, stale outcome."""

    def _day(self, snapshot):
        return record_date_for(snapshot.prepared_at, "America/New_York")

    @pytest.mark.parametrize("old,new,problem", [
        ("\nsymbol: SPY\n", "\nsymbol: QQQ\n", "does not match file location"),
        ("\ndate: '", "\ndate: '1999-", "does not match file location"),
        ("\nschema_version: '1'\n", "\nschema_version: 'x'\n", "record contract"),
    ])
    def test_frontmatter_disagreeing_with_record_is_integrity_failed(self, snapshot_store, records, old, new, problem):
        snapshot, _, _, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        assert old in text
        Path(path).write_text(text.replace(old, new, 1), encoding="utf-8")
        items = query_records(store=records, symbol="SPY", since=date.fromisoformat(self._day(snapshot)))
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any(problem in p for p in items[0]["problems"])

    def test_frontmatter_yaml_syntax_error_is_integrity_failed(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        Path(path).write_text(text.replace("\nentries:\n", "\nentries: [\n", 1), encoding="utf-8")
        items = query_records(store=records, symbol="SPY", since=date.fromisoformat(self._day(snapshot)))
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("YAML invalid" in p or "does not match the record contract" in p for p in items[0]["problems"])

    def test_edited_markdown_body_is_integrity_failed(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        assert "**Gamma regime:** negative_gamma" in text
        Path(path).write_text(text.replace("**Gamma regime:** negative_gamma", "**Gamma regime:** positive_gamma"),
                              encoding="utf-8")
        items = query_records(store=records, symbol="SPY", since=date.fromisoformat(self._day(snapshot)))
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("markdown body disagrees" in p for p in items[0]["problems"])

    def test_frontmatter_holds_the_whole_record(self, snapshot_store, records):
        """AC-03: request, run_id, snapshot, facts/hashes, assets, host, payload, trace, outcome and review live in the frontmatter."""
        import yaml

        snapshot, _, entry, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        fm = yaml.safe_load(text.split("\n---\n", 1)[0][4:])
        e = fm["entries"][0]
        assert {"request", "snapshot", "facts", "effective_assets", "host", "accepted_payload", "trace",
                "entry_hash", "outcomes", "human_reviews"} <= set(e)
        assert e["snapshot"]["run_id"] == snapshot.run_id and e["entry_hash"] == entry.entry_hash
        assert e["facts"]["vix"] == 17.71 and e["snapshot"]["facts_hash"] == snapshot.facts_hash

    def test_missing_frontmatter_is_integrity_failed(self, snapshot_store, records):
        snapshot, _, _, path = _record(snapshot_store, records)
        text = Path(path).read_text(encoding="utf-8")
        body = text.split("\n---\n", 1)[1]
        Path(path).write_text(body, encoding="utf-8")
        items = query_records(store=records, symbol="SPY", since=date.fromisoformat(self._day(snapshot)))
        assert items[0]["status"] == "INTEGRITY_FAILED"
        assert any("frontmatter missing" in p for p in items[0]["problems"])

    def test_yaml_dangerous_prose_round_trips(self, snapshot_store, records):
        snapshot = regime_snapshot()
        result = _accepted(snapshot_store, snapshot)
        evil = "---\nentries: []\n---\n# not a heading: {a: [b]} 'quoted' \"dq\" 2026-09-17 1e3 yes"
        record_accepted(store=records, snapshot=snapshot, result=result, prompt=evil)
        doc = records.load("SPY", self._day(snapshot))
        assert doc.entries[0].request.prompt == evil

    def test_marker_and_fence_in_prompt_do_not_brick_the_day(self, snapshot_store, records):
        snapshot = regime_snapshot()
        result = _accepted(snapshot_store, snapshot)
        evil = "quote:\n---\nentries: []\n---\nend"
        record_accepted(store=records, snapshot=snapshot, result=result, prompt=evil)
        day = self._day(snapshot)
        doc = records.load("SPY", day)
        assert [e.entry_id for e in doc.entries] == [snapshot.run_id]
        assert doc.entries[0].request.prompt == evil
        record_review(store=records, symbol="SPY", day=day, run_id=snapshot.run_id,
                      verdict=ReviewVerdict.AGREE, comment="---\nentries: []\n---")
        items = query_records(store=records, symbol="SPY", since=date.fromisoformat(day))
        assert items[0]["status"] == "OK" and len(items[0]["entries"][0]["human_reviews"]) == 1

    @pytest.mark.parametrize("symbol", [".", "..", "...", "", "sp y"])
    def test_dotted_or_empty_symbols_rejected_everywhere(self, records, symbol):
        with pytest.raises(RecordStoreError):
            records.path_for(symbol, "2026-09-16")
        with pytest.raises(RecordStoreError):
            records.dates(symbol)
        with pytest.raises(RecordError):
            query_records(store=records, symbol=symbol, since=date(2026, 1, 1))

    def test_parent_directory_is_not_listed_as_a_symbol(self, records, tmp_path):
        (tmp_path / "2026-09-16.md").write_text("outside", encoding="utf-8")
        with pytest.raises(RecordError):
            query_records(store=records, symbol="..", since=date(2026, 1, 1))

    async def test_stale_outcome_is_rejected_not_labelled(self, snapshot_store, records):
        from tests.unit.regime_support import stale, trade_payload

        snapshot, *_ = _record(snapshot_store, records)
        dispatcher = RegimeFakeDispatcher()
        dispatcher.responses[("market_data.trade", "VIX")] = trade_payload("VIX", price=17.71, at=stale(7 * 86400))
        fetched = await fetch_regime_facts(symbol="SPY", dispatcher=dispatcher, max_staleness_seconds=600)
        assert fetched.facts.sources["vix"].freshness_status.value == "STALE"
        with pytest.raises(RecordError, match=r"stale for source\(s\) \['vix'\]"):
            record_outcome(store=records, symbol="SPY", day=self._day(snapshot), fetched=fetched)
        doc = records.load("SPY", self._day(snapshot))
        assert doc.entries[0].outcomes == []
