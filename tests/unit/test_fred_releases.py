"""GC-AI-0016: FRED release calendar (tools/fred_query.py --releases), paged and filtered, without network."""

from __future__ import annotations

import json

import pytest

from tools import fred_query


def fake_get(total: int, fail_at: int | None = None):
    calls = []

    def get(endpoint, params, key):
        calls.append(params)
        offset = params["offset"]
        if fail_at is not None and offset >= fail_at:
            return 500, b"error", f"https://x/{endpoint}?offset={offset}"
        rows = [{"release_id": 50 if i % 10 == 0 else 101, "release_name": "r", "date": "2026-10-02"}
                for i in range(offset, min(offset + params["limit"], total))]
        return 200, json.dumps({"count": total, "offset": offset, "release_dates": rows}).encode(), "https://x"
    return get, calls


def test_every_page_is_kept_and_the_excerpt_filters_by_release(tmp_path, monkeypatch):
    get, calls = fake_get(1273)
    monkeypatch.setattr(fred_query, "get", get)
    monkeypatch.setenv("FRED_API_KEY", "k" * 32)
    assert fred_query.releases(str(tmp_path), "2026-09-30", "2026-11-15", ["50"]) == 0
    assert [c["offset"] for c in calls] == [0, 1000]
    full = json.loads((tmp_path / "releases.dates.json").read_text(encoding="utf-8"))
    assert len(full["release_dates"]) == 1273 and full["pages"] == 2
    excerpt = json.loads((tmp_path / "releases.dates.excerpt.json").read_text(encoding="utf-8"))
    assert excerpt["release_ids"] == [50] and len(excerpt["release_dates"]) == 128
    meta = json.loads((tmp_path / "releases.meta.json").read_text(encoding="utf-8"))
    assert meta["complete"] and meta["rows"] == 1273


def test_a_failed_page_is_reported_incomplete(tmp_path, monkeypatch):
    get, _ = fake_get(1273, fail_at=1000)
    monkeypatch.setattr(fred_query, "get", get)
    monkeypatch.setenv("FRED_API_KEY", "k" * 32)
    assert fred_query.releases(str(tmp_path), "2026-09-30", "2026-11-15", []) == 1
    assert not json.loads((tmp_path / "releases.meta.json").read_text(encoding="utf-8"))["complete"]


@pytest.mark.parametrize(("start", "end", "ids"), [("2026-11-15", "2026-09-30", []), ("30/09", "2026-11-15", []),
                                                   ("2026-09-30", "2026-11-15", ["NFP"])])
def test_bad_arguments_are_refused(tmp_path, monkeypatch, start, end, ids):
    monkeypatch.setenv("FRED_API_KEY", "k" * 32)
    with pytest.raises(SystemExit):
        fred_query.releases(str(tmp_path), start, end, ids)


def test_a_response_echoing_the_key_is_not_saved(tmp_path, monkeypatch):
    key = "k" * 32
    monkeypatch.setattr(fred_query, "get", lambda endpoint, params, k: (200, f'{{"url": "{key}"}}'.encode(), "u"))
    monkeypatch.setenv("FRED_API_KEY", key)
    with pytest.raises(SystemExit, match="clave"):
        fred_query.releases(str(tmp_path), "2026-09-30", "2026-11-15", [])
    assert not (tmp_path / "releases.dates.json").exists()
