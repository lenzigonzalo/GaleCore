"""Local read-only regime record viewer (GC-AI-0003): view model and loopback HTTP adapter."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

import pytest

from galecore_ai.adapters import regime_viewer as viewer
from galecore_ai.adapters.record_store import FileRecordStore, RecordStoreError
from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.accept_interpretation import accept_interpretation
from galecore_ai.application.prepare_regime import fetch_regime_facts
from galecore_ai.application.record_regime import (
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
SINCE = date(2000, 1, 1)


@pytest.fixture
def records(tmp_path):
    return FileRecordStore(tmp_path / "records")


@pytest.fixture
def snapshots(tmp_path):
    return FileSnapshotStore(base_dir=tmp_path / "snapshots")


def _record(snapshots, records):
    snapshot = regime_snapshot()
    snapshots.save(snapshot)
    result = accept_interpretation(
        store=snapshots,
        request=AcceptanceRequest(run_id=snapshot.run_id, interpretation=valid_regime_interpretation(),
                                  host_provider="claude-code", host_model="claude-opus-5"),
        allow_unknown_freshness=True,
    )
    assert result.status == RunStatus.SUCCESS, result.error_detail
    entry, path = record_accepted(store=records, snapshot=snapshot, result=result, prompt=PROMPT)
    return entry, record_date_for(snapshot.prepared_at, "America/New_York"), Path(path)


def _tamper(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "gamma_regime: negative_gamma" in text
    path.write_text(text.replace("gamma_regime: negative_gamma", "gamma_regime: positive_gamma"), encoding="utf-8")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TestBuildView:
    def test_no_records_is_an_explicit_empty_result(self, records):
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        assert view["count"] == 0 and view["records"] == [] and view["integrity_failed"] == []
        assert view["records_dir"] == str(records.base_dir) and view["queried_at"]

    def test_pending_states_come_from_the_record(self, snapshots, records):
        entry, _, _ = _record(snapshots, records)
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        [rec] = view["records"]
        [e] = rec["entries"]
        assert rec["status"] == "OK" and e["run_id"] == entry.entry_id
        assert e["states"] == {"outcome_pending": True, "review_pending": True}
        assert e["comparisons"] == [] and e["annotation"] is None
        # detail added from the same load: snapshot identity, assets, guardrail trace, hashes
        assert e["snapshot"]["facts_hash"] == e["facts_hash"] == entry.snapshot.facts_hash
        assert e["entry_hash"] == entry.entry_hash
        assert e["effective_assets"]["skills"]["regime_interpretation"]["version"] == "1.0.0"
        assert all(g["passed"] for g in e["trace"]["guardrails"]) and e["trace"]["guardrails"]
        assert e["recorded_at"] and e["request"]["prompt"] == PROMPT
        # claims and evidence are resolved server side against the entry's own facts
        assert all(c["matches"] and c["fact_value"] == c["value"] for c in e["claims"]) and len(e["claims"]) == 3
        assert {ev["fact_path"]: ev["fact_value"] for ev in e["evidence"]} == {
            "facts.net_gex": -1473.4, "facts.put_skew_level_ok": True}

    def test_missing_records_dir_fails_closed_and_is_never_created(self, tmp_path, monkeypatch):
        missing = tmp_path / "nope" / "regime"
        monkeypatch.setenv("GALECORE_RECORDS_DIR", str(missing))
        assert viewer.main(["--port", "0"]) == 1
        assert not missing.exists() and not missing.parent.exists()
        store = FileRecordStore(tmp_path / "records")
        shutil.rmtree(store.base_dir)
        with pytest.raises(RecordStoreError, match="does not exist"):
            viewer.build_view(store=store, symbol="SPY", since=SINCE, annotations=[])
        with pytest.raises(RecordStoreError, match="does not exist"):
            viewer.build_meta(store, annotations=[])
        assert not store.base_dir.exists()

    async def test_outcome_and_review_are_shown_and_compared(self, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        fetched = await fetch_regime_facts(symbol="SPY", dispatcher=RegimeFakeDispatcher(),
                                           max_staleness_seconds=600)
        record_outcome(store=records, symbol="SPY", day=day, fetched=fetched)
        record_review(store=records, symbol="SPY", day=day, run_id=entry.entry_id,
                      verdict=ReviewVerdict.PARTIAL, comment="skew held, gex did not")
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        [e] = view["records"][0]["entries"]
        assert e["states"] == {"outcome_pending": False, "review_pending": False}
        assert e["human_reviews"][0]["verdict"] == "partial"
        [cmp] = e["comparisons"]
        assert cmp["observed_at"] == e["outcomes"][0]["observed_at"]
        rows = {r["metric"]: r for r in cmp["rows"]}
        assert set(rows) == set(viewer.COMPARED_METRICS)
        assert rows["spot"]["before"] == 757.43 and rows["spot"]["after"] == 757.43 and rows["spot"]["delta"] == 0
        assert rows["net_gex"]["before"] == entry.facts["net_gex"]

    def test_compare_facts_handles_missing_and_non_numeric(self):
        rows = {r["metric"]: r for r in viewer.compare_facts({"spot": 1.5, "vix": "n/a"}, {"spot": 2.0})}
        assert rows["spot"]["delta"] == 0.5
        assert rows["vix"] == {"metric": "vix", "before": "n/a", "after": None, "delta": None}

    def test_tampered_record_is_integrity_failed_without_content(self, snapshots, records):
        _, day, path = _record(snapshots, records)
        _tamper(path)
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        [rec] = view["records"]
        assert rec["status"] == "INTEGRITY_FAILED" and view["integrity_failed"] == [day]
        assert "entries" not in rec and any("entry_hash mismatch" in p for p in rec["problems"])
        assert "positive_gamma" not in json.dumps(view)

    def test_reading_leaves_files_byte_identical(self, snapshots, records):
        _, _, path = _record(snapshots, records)
        before = _sha(path)
        viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        viewer.build_meta(records, annotations=[])
        assert _sha(path) == before

    def test_filters_mirror_query(self, snapshots, records):
        _, day, _ = _record(snapshots, records)
        d = date.fromisoformat(day)
        assert viewer.build_view(store=records, symbol="spy", since=d, until=d, annotations=[])["count"] == 1
        assert viewer.build_view(store=records, symbol="SPY", since=d.replace(year=d.year + 1), annotations=[])["count"] == 0
        assert viewer.build_view(store=records, symbol="QQQ", since=SINCE, annotations=[])["count"] == 0

    def test_invalid_arguments_fail_closed(self, records):
        with pytest.raises(viewer.ViewerArgumentError, match="symbol"):
            viewer.build_view(store=records, symbol="  ", since=SINCE, annotations=[])
        with pytest.raises(viewer.ViewerArgumentError, match="Invalid symbol"):
            viewer.build_view(store=records, symbol="../x", since=SINCE, annotations=[])
        with pytest.raises(viewer.ViewerArgumentError, match="until"):
            viewer.build_view(store=records, symbol="SPY", since=date(2026, 1, 2), until=date(2026, 1, 1),
                              annotations=[])


class TestTwoReadConsistency:
    """The detail read must show exactly what query_records saw, or nothing."""

    @staticmethod
    def _altered_loader(records, *, alter, times=None):
        real_load = records.load
        calls = {"n": 0}

        def load(symbol, day):
            document = real_load(symbol, day)
            calls["n"] += 1
            # query_records reads first (odd calls); the detail read follows (even calls)
            if document is not None and calls["n"] % 2 == 0 and (times is None or calls["n"] // 2 <= times):
                alter(document)
            return document

        return load

    def test_transient_change_between_reads_is_retried_and_rendered(self, snapshots, records, monkeypatch):
        entry, _, _ = _record(snapshots, records)

        def alter(document):
            document.entries[0].request.prompt = "REPLACED between reads"

        monkeypatch.setattr(records, "load", self._altered_loader(records, alter=alter, times=1))
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        [rec] = view["records"]
        assert rec["status"] == "OK" and view["read_inconsistent"] == []
        [e] = rec["entries"]
        assert e["prompt"] == PROMPT == e["request"]["prompt"] and e["entry_hash"] == entry.entry_hash

    def test_persistent_change_is_read_inconsistent_without_content(self, snapshots, records, monkeypatch):
        _, day, _ = _record(snapshots, records)

        def alter(document):
            document.entries[0].request.prompt = "REPLACED between reads"

        monkeypatch.setattr(records, "load", self._altered_loader(records, alter=alter))
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        [rec] = view["records"]
        assert rec["status"] == "READ_INCONSISTENT" and view["read_inconsistent"] == [day]
        assert set(rec) == {"date", "status", "path", "problems"} and "REPLACED" not in json.dumps(view)

    def test_entry_missing_on_second_read_is_read_inconsistent(self, snapshots, records, monkeypatch):
        _record(snapshots, records)
        monkeypatch.setattr(records, "load", self._altered_loader(records, alter=lambda d: d.entries.clear()))
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        assert view["records"][0]["status"] == "READ_INCONSISTENT"
        assert "states" not in json.dumps(view)


class TestAnnotations:
    def _note(self, entry, day, **overrides) -> viewer.RecordAnnotation:
        data = {
            "symbol": "SPY", "date": day, "entry_hash": entry.entry_hash, "kind": "observed_history",
            "label": "Observed history", "note": "kept as history", "source": "work item X, F-7",
            "decided_on": "2026-09-19",
        }
        data.update(overrides)
        return viewer.RecordAnnotation(**data)

    def test_annotation_bound_to_hash_is_shown_separately_from_the_record(self, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE,
                                 annotations=[self._note(entry, day)])
        [rec] = view["records"]
        [e] = rec["entries"]
        assert rec["status"] == "OK" and e["annotation"]["kind"] == "observed_history"
        assert e["annotation"]["source"] == "work item X, F-7"
        assert "annotation" not in e["accepted_payload"] and e["states"]["review_pending"] is True

    def test_annotation_with_other_hash_or_day_is_not_shown(self, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        wrong_hash = self._note(entry, day, entry_hash="sha256:" + "0" * 64)
        wrong_day = self._note(entry, "1999-01-01")
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[wrong_hash, wrong_day])
        assert view["records"][0]["entries"][0]["annotation"] is None

    def test_annotation_on_tampered_record_is_not_shown(self, snapshots, records):
        entry, day, path = _record(snapshots, records)
        _tamper(path)
        view = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[self._note(entry, day)])
        assert view["records"][0]["status"] == "INTEGRITY_FAILED" and "annotation" not in view["records"][0]

    def test_shipped_annotations_file_is_valid_and_names_the_observed_history_record(self):
        notes = viewer.load_annotations()
        f7 = [n for n in notes if n.symbol == "SPY" and n.date == "2026-09-17"]
        assert len(f7) == 1 and f7[0].kind == "observed_history"
        assert f7[0].entry_hash.startswith("sha256:") and len(f7[0].entry_hash) == 71
        assert "F-7" in f7[0].source and "AC-08" in f7[0].label

    def test_missing_file_is_empty_and_invalid_file_fails_closed(self, tmp_path):
        assert viewer.load_annotations(tmp_path / "none.yaml") == []
        bad = tmp_path / "bad.yaml"
        bad.write_text("annotations:\n  - symbol: SPY\n    surprise: 1\n", encoding="utf-8")
        with pytest.raises(RecordStoreError, match="Invalid annotations file"):
            viewer.load_annotations(bad)


@pytest.fixture
def server(records):
    srv = viewer.serve(records, port=0, annotations=[])
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()


class TestHttpAdapter:
    @staticmethod
    def _get(server, path: str, method: str = "GET", host_header: str | None = None):
        host, port = server.server_address[:2]
        req = urllib.request.Request(f"http://{host}:{port}{path}", method=method)
        if host_header is not None:
            req.add_unredirected_header("Host", host_header)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()

    def test_binds_loopback_only(self, server):
        assert server.server_address[0] == "127.0.0.1"

    def test_page_is_self_contained(self, server):
        status, headers, body = self._get(server, "/")
        page = body.decode("utf-8")
        assert status == 200 and headers["Content-Type"].startswith("text/html")
        assert "<script" in page and "http://" not in page and "https://" not in page
        assert 'src="http' not in page and 'href="http' not in page

    def test_meta_and_records(self, server, snapshots, records):
        _, day, _ = _record(snapshots, records)
        status, _, body = self._get(server, "/api/meta")
        meta = json.loads(body)
        assert status == 200 and meta["symbols"] == ["SPY"] and meta["read_only"] is True
        status, headers, body = self._get(server, f"/api/records?symbol=spy&since={day}&until={day}")
        view = json.loads(body)
        assert status == 200 and headers["Cache-Control"] == "no-store"
        assert view["count"] == 1 and view["records"][0]["entries"][0]["states"]["outcome_pending"] is True

    def test_integrity_failure_is_not_a_success_response(self, server, snapshots, records):
        _, day, path = _record(snapshots, records)
        _tamper(path)
        status, _, body = self._get(server, f"/api/records?symbol=SPY&since={day}")
        view = json.loads(body)
        assert status == 422 and view["integrity_failed"] == [day]
        assert view["records"][0]["status"] == "INTEGRITY_FAILED" and "entries" not in view["records"][0]

    def test_records_dir_removed_after_start_is_500_not_empty(self, server, records):
        shutil.rmtree(records.base_dir)
        status, _, body = self._get(server, "/api/records?symbol=SPY&since=2026-01-01")
        assert status == 500 and "does not exist" in json.loads(body)["error"]
        assert self._get(server, "/api/meta")[0] == 500
        assert not records.base_dir.exists()

    def test_read_inconsistency_is_409_not_success(self, server, records, snapshots, monkeypatch):
        _, day, _ = _record(snapshots, records)
        real_load = records.load
        calls = {"n": 0}

        def load(symbol, d):
            document = real_load(symbol, d)
            calls["n"] += 1
            if document is not None and calls["n"] % 2 == 0:
                document.entries[0].request.prompt = "REPLACED"
            return document

        monkeypatch.setattr(records, "load", load)
        status, _, body = self._get(server, f"/api/records?symbol=SPY&since={day}")
        view = json.loads(body)
        assert status == 409 and view["read_inconsistent"] == [day] and "REPLACED" not in body.decode()

    def test_error_responses_carry_time_and_directory(self, server, records):
        status, _, body = self._get(server, "/api/records?symbol=SPY&since=nope")
        assert status == 400 and json.loads(body)["at"]
        shutil.rmtree(records.base_dir)
        status, _, body = self._get(server, "/api/meta")
        err = json.loads(body)
        assert status == 500 and err["at"] and err["records_dir"] == str(records.base_dir)

    def test_foreign_host_header_is_refused(self, server):
        assert self._get(server, "/api/meta", host_header="evil.example:80")[0] == 403
        assert self._get(server, "/api/meta", host_header="localhost:1")[0] == 200

    def test_bad_arguments_are_400_not_500(self, server):
        assert self._get(server, "/api/records?symbol=SPY")[0] == 400
        assert self._get(server, "/api/records?symbol=SPY&since=nope")[0] == 400
        assert self._get(server, "/api/records?symbol=..&since=2026-01-01")[0] == 400
        assert self._get(server, "/api/records?symbol=SPY&since=2026-01-02&until=2026-01-01")[0] == 400

    def test_unknown_paths_and_writes_are_rejected(self, server):
        assert self._get(server, "/etc/passwd")[0] == 404
        assert self._get(server, "/api/records/../x")[0] == 404
        status, _, body = self._get(server, "/api/records?symbol=SPY&since=2026-01-01", method="POST")
        assert status == 404 and "not found" in json.loads(body)["error"]
        status, _, body = self._get(server, "/api/reviews", method="POST")  # no config → reviews disabled
        assert status == 403 and "disabled" in json.loads(body)["error"]
        status, headers, _ = self._get(server, "/api/meta", method="DELETE")
        assert status == 405 and headers["Allow"] == "GET, POST, OPTIONS"
        assert self._get(server, "/", method="HEAD")[0] == 405
        assert self._get(server, "/api/meta", method="OPTIONS")[0] == 405
        assert self._get(server, "/", method="TRACE")[0] == 405
        assert self._get(server, "/", method="CONNECT")[0] == 405
        assert self._get(server, "/", method="BREW")[0] == 405


REVIEW_TOKEN = "test-token-not-a-secret"
MONITOR_ORIGIN = "http://localhost:3039"


@pytest.fixture
def review_server(records):
    config = viewer.ViewerConfig(timezone="America/New_York", allowed_origins=frozenset({MONITOR_ORIGIN}),
                                 review_token=REVIEW_TOKEN)
    srv = viewer.serve(records, port=0, annotations=[], config=config)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()


def _call(server, path: str, *, method: str = "GET", headers: dict | None = None, body: dict | None = None):
    host, port = server.server_address[:2]
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"http://{host}:{port}{path}", method=method, data=data)
    for k, v in (headers or {}).items():
        req.add_unredirected_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.headers, err.read()


def _review_headers(token: str = REVIEW_TOKEN, origin: str = MONITOR_ORIGIN) -> dict:
    return {"Origin": origin, viewer.REVIEW_TOKEN_HEADER: token, "Content-Type": "application/json"}


class TestTodayAndMeta:
    def test_meta_exposes_today_in_the_convention_timezone(self, review_server, records):
        status, _, body = _call(review_server, "/api/meta")
        meta = json.loads(body)
        assert status == 200 and meta["reviews_enabled"] is True and meta["read_only"] is False
        assert meta["timezone"] == "America/New_York" and len(meta["today"]) == 10

    def test_today_without_record_is_explicit(self, review_server):
        status, _, body = _call(review_server, "/api/today?symbol=SPY")
        today = json.loads(body)
        assert status == 200 and today["status"] == "NO_RECORD" and today["record"] is None
        assert today["date"] == json.loads(_call(review_server, "/api/meta")[2])["today"]

    def test_today_with_record_carries_its_states(self, snapshots, records, monkeypatch):
        _, day, _ = _record(snapshots, records)
        monkeypatch.setattr(viewer, "record_date_for", lambda *_: day)
        today = viewer.build_today(store=records, symbol="SPY", timezone="America/New_York", annotations=[])
        assert today["status"] == "OK" and today["record"]["entries"][0]["states"]["review_pending"] is True

    def test_convention_timezone_comes_from_the_asset(self):
        assert viewer.convention_timezone() == "America/New_York"


class TestCors:
    def test_allowed_origin_gets_cors_headers_and_preflight(self, review_server):
        status, headers, _ = _call(review_server, "/api/meta", headers={"Origin": MONITOR_ORIGIN})
        assert status == 200 and headers["Access-Control-Allow-Origin"] == MONITOR_ORIGIN and headers["Vary"] == "Origin"
        status, headers, _ = _call(review_server, "/api/reviews", method="OPTIONS",
                                   headers={"Origin": MONITOR_ORIGIN, "Access-Control-Request-Method": "POST"})
        assert status == 204 and "X-Review-Token" in headers["Access-Control-Allow-Headers"]

    def test_other_origins_get_no_cors_and_no_preflight(self, review_server):
        status, headers, _ = _call(review_server, "/api/meta", headers={"Origin": "http://evil.example"})
        assert status == 200 and headers.get("Access-Control-Allow-Origin") is None
        status, _, _ = _call(review_server, "/api/reviews", method="OPTIONS",
                             headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
        assert status == 405
        assert _call(review_server, "/api/meta", method="OPTIONS")[0] == 405

    def test_allowed_origins_from_env(self, monkeypatch):
        monkeypatch.delenv(viewer.ALLOWED_ORIGINS_ENV, raising=False)
        assert viewer.allowed_origins_from_env() == frozenset(viewer.DEFAULT_ALLOWED_ORIGINS)
        monkeypatch.setenv(viewer.ALLOWED_ORIGINS_ENV, "http://localhost:3000/, http://127.0.0.1:3000")
        assert viewer.allowed_origins_from_env() == {"http://localhost:3000", "http://127.0.0.1:3000"}


class TestReviewEndpoint:
    def _body(self, day, run_id, **over):
        body = {"symbol": "SPY", "date": day, "run_id": run_id, "verdict": "partial",
                "comment": "skew held, gex did not"}
        body.update(over)
        return body

    def test_review_is_appended_through_record_review_and_reread(self, review_server, snapshots, records):
        entry, day, path = _record(snapshots, records)
        before = viewer.build_view(store=records, symbol="SPY", since=SINCE, annotations=[])
        assert before["records"][0]["entries"][0]["states"]["review_pending"] is True
        status, _, body = _call(review_server, "/api/reviews", method="POST", headers=_review_headers(),
                                body=self._body(day, entry.entry_id))
        out = json.loads(body)
        assert status == 201 and out["recorded"] == {"run_id": entry.entry_id, "path": str(path), "verdict": "partial"}
        e = out["record"]["entries"][0]
        assert e["states"]["review_pending"] is False and e["human_reviews"][0]["comment"] == "skew held, gex did not"
        assert e["entry_hash"] == entry.entry_hash  # hashed part untouched
        # what the CLI path reads back agrees
        doc = records.load("SPY", day)
        assert doc.entries[0].human_reviews[0].verdict == ReviewVerdict.PARTIAL

    def test_review_requires_token_origin_and_loopback_host(self, review_server, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        body = self._body(day, entry.entry_id)
        assert _call(review_server, "/api/reviews", method="POST", headers=_review_headers(token="nope"), body=body)[0] == 401
        assert _call(review_server, "/api/reviews", method="POST",
                     headers={**_review_headers(), viewer.REVIEW_TOKEN_HEADER: ""}, body=body)[0] == 401
        assert _call(review_server, "/api/reviews", method="POST",
                     headers=_review_headers(origin="http://evil.example"), body=body)[0] == 403
        no_origin = {k: v for k, v in _review_headers().items() if k != "Origin"}
        assert _call(review_server, "/api/reviews", method="POST", headers=no_origin, body=body)[0] == 403
        assert _call(review_server, "/api/reviews", method="POST",
                     headers={**_review_headers(), "Host": "evil.example"}, body=body)[0] == 403
        assert _call(review_server, "/api/reviews", method="POST",
                     headers={**_review_headers(), "Content-Type": "text/plain"}, body=body)[0] == 415
        assert records.load("SPY", day).entries[0].human_reviews == []

    def test_review_rejects_bad_requests_without_writing(self, review_server, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        cases = [
            (self._body(day, entry.entry_id, verdict="maybe"), 400),
            (self._body(day, entry.entry_id, comment="   "), 400),
            (self._body(day, entry.entry_id, extra="x"), 400),
            (self._body("2026-13-40", entry.entry_id), 400),
            (self._body(day, "not-a-run"), 404),
            (self._body("1999-01-01", entry.entry_id), 404),
        ]
        for body, expected in cases:
            status, _, out = _call(review_server, "/api/reviews", method="POST", headers=_review_headers(), body=body)
            assert status == expected, (body, status, out)
        assert records.load("SPY", day).entries[0].human_reviews == []

    def test_review_on_tampered_record_is_refused(self, review_server, snapshots, records):
        entry, day, path = _record(snapshots, records)
        _tamper(path)
        status, _, body = _call(review_server, "/api/reviews", method="POST", headers=_review_headers(),
                                body=self._body(day, entry.entry_id))
        assert status == 422 and "cannot be trusted" in json.loads(body)["error"]

    def test_oversized_or_empty_body_is_refused(self, review_server):
        headers = _review_headers()
        status, _, _ = _call(review_server, "/api/reviews", method="POST",
                             headers={**headers, "Content-Length": "0"}, body=None)
        assert status == 413
        big = {"symbol": "SPY", "date": "2026-01-01", "run_id": "x", "verdict": "agree", "comment": "c" * 20000}
        assert _call(review_server, "/api/reviews", method="POST", headers=headers, body=big)[0] == 413

    def test_invalid_symbol_or_date_is_400_before_any_file_is_touched(self, review_server, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        for body in (self._body("20260919", entry.entry_id), self._body("2026-W38-5", entry.entry_id),
                     self._body(day, entry.entry_id, symbol="../TEST"), self._body(day, entry.entry_id, symbol="..")):
            status, _, out = _call(review_server, "/api/reviews", method="POST", headers=_review_headers(), body=body)
            assert status == 400 and "cannot be trusted" not in json.loads(out)["error"], (body, status, out)
        assert records.load("SPY", day).entries[0].human_reviews == []

    def test_concurrent_reviews_on_the_same_day_all_land(self, review_server, snapshots, records):
        entry, day, _ = _record(snapshots, records)
        results: list[int] = []

        def post(i: int) -> None:
            status, _, _ = _call(review_server, "/api/reviews", method="POST", headers=_review_headers(),
                                 body=self._body(day, entry.entry_id, comment=f"concurrent {i}"))
            results.append(status)

        threads = [threading.Thread(target=post, args=(i,)) for i in range(6)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=30)
        assert results.count(201) == 6, results
        reviews = records.load("SPY", day).entries[0].human_reviews
        assert sorted(r.comment for r in reviews) == sorted(f"concurrent {i}" for i in range(6))

    def test_write_failure_is_503_not_422(self, review_server, snapshots, records, monkeypatch):
        entry, day, _ = _record(snapshots, records)

        def failing_save(document):
            raise OSError("disk says no")

        monkeypatch.setattr(records, "save", failing_save)
        status, _, body = _call(review_server, "/api/reviews", method="POST", headers=_review_headers(),
                                body=self._body(day, entry.entry_id))
        assert status == 503 and "Record write failed" in json.loads(body)["error"]

    def test_under_sent_body_is_408_and_nothing_is_written(self, review_server, snapshots, records):
        import socket

        entry, day, _ = _record(snapshots, records)
        host, port = review_server.server_address[:2]
        payload = json.dumps(self._body(day, entry.entry_id)).encode()
        crlf = "\r\n"
        head = crlf.join([
            "POST /api/reviews HTTP/1.1", "Host: 127.0.0.1", f"Origin: {MONITOR_ORIGIN}",
            f"{viewer.REVIEW_TOKEN_HEADER}: {REVIEW_TOKEN}", "Content-Type: application/json",
            f"Content-Length: {len(payload) + 50}", "Connection: close", "", "",
        ])
        with socket.create_connection((host, port), timeout=viewer.REQUEST_TIMEOUT_SECONDS + 10) as s:
            s.sendall(head.encode() + payload)  # 50 bytes short of the declared length, then silence
            status_line = s.recv(4096).decode(errors="replace").split(crlf, 1)[0]
        assert " 408 " in status_line, status_line
        assert records.load("SPY", day).entries[0].human_reviews == []


    def test_no_reviews_flag_disables_the_write(self, monkeypatch, snapshots, records):
        # main() with --no-reviews builds a config without a token; a server with that config
        # refuses the POST with 403 and reports reviews_enabled: false
        monkeypatch.setenv("GALECORE_RECORDS_DIR", str(records.base_dir))
        captured: dict = {}

        class _Stub:
            server_address = ("127.0.0.1", 0)

            def serve_forever(self):
                raise KeyboardInterrupt  # main() treats this as Ctrl+C and returns 0

            def server_close(self):
                pass

        def fake_serve(store, *, port, annotations, config):
            captured["config"] = config
            return _Stub()

        monkeypatch.setattr(viewer, "serve", fake_serve)
        assert viewer.main(["--no-reviews", "--port", "0"]) == 0
        config = captured["config"]
        assert config.review_token is None and config.reviews_enabled is False
        monkeypatch.undo()  # restore the real serve
        srv = viewer.serve(records, port=0, annotations=[], config=config)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            status, _, body = _call(srv, "/api/reviews", method="POST", headers=_review_headers(), body={})
            assert status == 403 and "disabled" in json.loads(body)["error"]
            assert json.loads(_call(srv, "/api/meta")[2])["reviews_enabled"] is False
        finally:
            srv.shutdown()
            srv.server_close()

    def test_empty_env_token_counts_as_unset(self, monkeypatch):
        monkeypatch.setenv(viewer.REVIEW_TOKEN_ENV, "")
        assert not os.environ.get(viewer.REVIEW_TOKEN_ENV)  # main() generates and prints one in this case


class TestPageBehaviour:
    """Runs only where Playwright + Chromium are installed (dev machines); the HTTP tests above are the gate."""

    @pytest.fixture
    def page_factory(self):
        pw = pytest.importorskip("playwright.sync_api")
        with pw.sync_playwright() as p:
            try:
                browser = p.chromium.launch()
            except pw.Error as exc:  # no browser binary
                pytest.skip(f"chromium not available: {exc}")
            yield lambda: browser.new_page(viewport={"width": 1200, "height": 800})
            browser.close()

    @staticmethod
    def _url(server) -> str:
        host, port = server.server_address[:2]
        return f"http://{host}:{port}/"

    def test_records_dir_gone_shows_error_with_directory_and_time(self, page_factory, server, records):
        shutil.rmtree(records.base_dir)
        page = page_factory()
        page.goto(self._url(server))
        page.wait_for_selector(".card.bad")
        assert "no disponible" in page.locator("#detail").inner_text().lower()
        assert str(records.base_dir) in page.locator("#dir").inner_text()
        assert "HTTP 500" in page.locator("#queried").inner_text()
        assert "no tiene carpetas" not in page.locator("#symbols").inner_text()

    def test_tampered_and_intact_days_render_their_states(self, page_factory, server, snapshots, records):
        _, day, path = _record(snapshots, records)
        page = page_factory()
        page.goto(self._url(server))
        page.wait_for_selector(".day")
        assert page.locator(".day").count() == 1
        text = page.locator("#detail").inner_text()
        assert "outcome pendiente" in text and "review pendiente" in text and PROMPT in text
        _tamper(path)
        page.fill("#since", day)
        page.click("#go")
        page.wait_for_selector(".card.bad")
        text = page.locator("#detail").inner_text()
        assert "INTEGRIDAD FALLIDA" in text and "entry_hash mismatch" in text and "positive_gamma" not in text

    def test_invalid_query_keeps_time_and_directory(self, page_factory, server, records):
        page = page_factory()
        page.goto(self._url(server))
        page.wait_for_selector("#dir")
        page.fill("#symbol", "../x")
        page.click("#go")
        page.wait_for_selector(".card.bad")
        assert "parámetros inválidos" in page.locator("#detail").inner_text().lower()
        assert "HTTP 400" in page.locator("#queried").inner_text()
        assert str(records.base_dir) in page.locator("#dir").inner_text()
