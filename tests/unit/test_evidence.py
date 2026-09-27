"""Evidence kept with its provenance and cited from an investigation (GC-AI-0007)."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import KNOWLEDGE_DIR_ENV, parse_ref
from galecore_ai.application.knowledge import KnowledgeError, save_evidence, search, show
from galecore_ai.contracts.evidence import EvidenceContent
from galecore_ai.harness.catalog import load_catalog
from tests.unit.test_knowledge import HOST, NOW, kb, save  # noqa: F401  (kb is a fixture)

PAYLOAD = '[{"date":"2026-09-25","year2":4.81,"year10":5.17}]'


def evidence(**overrides) -> EvidenceContent:
    data = {
        "source": "fmp",
        "tool": "mcp__claude_ai_FMP__economics endpoint=treasury-rates",
        "params": {"endpoint": "treasury-rates", "from_date": "2026-09-18", "to_date": "2026-09-26"},
        "retrieved_at": (NOW - timedelta(minutes=5)).isoformat(),
        "series": [{"name": "year10", "unit": "percent", "frequency": "daily",
                    "observation_dates": "2026-09-18..2026-09-25"}],
        "payload": PAYLOAD,
        "payload_scope": "full",
    }
    data.update(overrides)
    return EvidenceContent.model_validate(data)


def add(kb, slug="ust-curve", **overrides):  # noqa: F811
    return save_evidence(kb=kb, slug=slug, prompt="Contexto de tasas para SPY", host=HOST,
                         content=evidence(**overrides), now=NOW)


def test_saved_evidence_is_host_declared_hashed_and_readable(kb):  # noqa: F811
    document, path = add(kb)
    assert path == kb.base / "evidence" / "2026-09-23-ust-curve.json"
    assert document.provenance == "HOST_DECLARED"
    shown = show(kb, "evidence:2026-09-23-ust-curve")
    assert shown["kind"] == "evidence"
    assert shown["content"]["payload"] == PAYLOAD
    assert shown["content_hash"] == document.content_hash


def test_evidence_is_never_overwritten(kb):  # noqa: F811
    add(kb)
    with pytest.raises(KnowledgeError, match="already exists"):
        add(kb)


@pytest.mark.parametrize("param", ["apikey", "api_key", "Token", "client_secret", "Authorization"])
def test_parameters_that_may_carry_credentials_are_refused(param):
    with pytest.raises(ValidationError, match="credentials"):
        evidence(params={param: "x"})


@pytest.mark.parametrize("payload", ["https://x/obs?series_id=A&api_key=abcdef1234567890",
                                     '{"Authorization": "Bearer0123456789abc"}', "apikey: ZZZZ9999YYYY",
                                     '{"token":"SECRETSECRET"}', "Cookie: sessionid=abcdefgh1234",
                                     "X-API-KEY: 0123456789abcdef", "https://x?access_token=abcdefgh123",
                                     '{"session":"SECRETSECRET"}', "Session: SECRETSECRET"])
def test_payload_with_an_echoed_credential_is_refused(payload):
    with pytest.raises(ValidationError, match="credential"):
        evidence(payload=payload)


def test_parameter_values_carrying_credentials_are_refused():
    with pytest.raises(ValidationError, match="credentials"):
        evidence(params={"url": "https://api.x/obs?api_key=abcdef1234567890"})


def test_payload_mentioning_token_counts_is_not_a_credential():
    assert evidence(payload='{"full_data_tokens":350272,"max_tokens_exceeded":true}').payload


def test_nested_host_provenance_cannot_claim_galecore_verification(kb):  # noqa: F811
    from galecore_ai.contracts.regime_record import RecordHost

    with pytest.raises(KnowledgeError):
        save_evidence(kb=kb, slug="x", prompt="p", host=RecordHost(provenance="GALECORE_VERIFIED"),
                      content=evidence(), now=NOW)
    with pytest.raises(ValidationError, match="host provenance"):
        document, _ = add(kb)
        type(document).model_validate({**document.model_dump(mode="json"),
                                       "host": {"provenance": "GALECORE_VERIFIED"}})


def test_excerpt_needs_a_note_and_series_are_required():
    with pytest.raises(ValidationError, match="excerpt_note"):
        evidence(payload_scope="excerpt")
    with pytest.raises(ValidationError, match="at least one series"):
        evidence(series=[])
    with pytest.raises(ValidationError, match="timezone"):
        evidence(retrieved_at="2026-09-23T21:00:00")


def test_retrieval_in_the_future_is_refused(kb):  # noqa: F811
    with pytest.raises(KnowledgeError, match="future"):
        add(kb, retrieved_at=(NOW + timedelta(hours=1)).isoformat())


def test_edited_evidence_is_integrity_failed_and_cannot_be_cited(kb):  # noqa: F811
    _, path = add(kb)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["content"]["payload"] = PAYLOAD.replace("5.17", "4.17")
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        show(kb, "evidence:2026-09-23-ust-curve")
    with pytest.raises(KnowledgeError, match="not usable"):
        save(kb, statements=[{"kind": "fact", "text": "El 10 años cerró arriba de 5 %",
                              "sources": ["evidence:2026-09-23-ust-curve"]}])
    assert search(kb, text="treasury")["integrity_failed"][0]["ref"] == "evidence:2026-09-23-ust-curve"


def test_investigation_cites_evidence_and_evidence_shows_the_backlink(kb):  # noqa: F811
    add(kb)
    document, _ = save(kb, statements=[{"kind": "fact", "text": "El 10 años cerró arriba de 5 %",
                                        "sources": ["evidence:2026-09-23-ust-curve"]}])
    resolved = {r.ref: r for r in document.current.resolved_refs}
    assert resolved["evidence:2026-09-23-ust-curve"].path.endswith("knowledge/evidence/2026-09-23-ust-curve.json")
    assert show(kb, "evidence:2026-09-23-ust-curve")["cited_by"] == [f"research:{document.id}"]


def test_missing_evidence_cannot_be_cited_and_file_refs_into_evidence_are_refused(kb):  # noqa: F811
    with pytest.raises(KnowledgeError, match="no such evidence"):
        save(kb, statements=[{"kind": "fact", "text": "x", "sources": ["evidence:2026-09-23-nada"]}])
    add(kb)
    with pytest.raises(KnowledgeError, match="evidence:"):
        save(kb, statements=[{"kind": "fact", "text": "x",
                              "sources": ["file:knowledge/evidence/2026-09-23-ust-curve.json"]}])


def test_search_finds_evidence_by_source_and_series(kb):  # noqa: F811
    add(kb)
    found = search(kb, text="fmp year10", kind="evidence")
    assert [r["ref"] for r in found["results"]] == ["evidence:2026-09-23-ust-curve"]
    assert search(kb, text="fmp", status="unfinished")["count"] == 0  # evidence has no status


def test_evidence_reference_is_parsed():
    assert str(parse_ref("evidence:2026-09-27-fmp-ust")) == "evidence:2026-09-27-fmp-ust"
    with pytest.raises(Exception, match="evidence"):
        parse_ref("evidence:../x")


def test_cli_evidence_add_and_show(kb, monkeypatch):  # noqa: F811
    monkeypatch.setenv(KNOWLEDGE_DIR_ENV, str(kb.base))
    request = {"content": evidence(retrieved_at=datetime.now(UTC).isoformat()).model_dump(mode="json"),
               "host_provider": "claude-code", "host_model": "test"}

    def cli(*args, stdin=None):
        return subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], input=stdin,
                              capture_output=True, text=True, encoding="utf-8", check=False)

    added = cli("evidence", "add", "--slug", "ust", "--prompt", "Contexto", stdin=json.dumps(request))
    assert added.returncode == 0, added.stdout
    out = json.loads(added.stdout)
    assert out["provenance"] == "HOST_DECLARED"
    shown = cli("kb", "show", out["ref"])
    assert json.loads(shown.stdout)["content"]["source"] == "fmp"
    bad = {**request, "content": {**request["content"], "params": {"apikey": "x"}}}
    refused = cli("evidence", "add", "--slug", "ust2", "--prompt", "Contexto", stdin=json.dumps(bad))
    assert refused.returncode == 3


def test_catalog_offers_context_research():
    entry = load_catalog().get("context_research")
    assert entry.output_contract == "galecore_ai.contracts.research.ResearchContent"
    assert any("evidence add" in step for step in entry.flow)


def test_revision_records_the_method_followed(kb):  # noqa: F811
    from galecore_ai.application.knowledge import save_research
    from tests.unit.test_knowledge import content

    document, _ = save_research(kb=kb, slug="ctx", prompt="Contexto SPY", host=HOST, content=content(), now=NOW,
                                capability="context_research")
    assert document.current.skill.asset_id == "context_research"
    for capability, match in (("gex_interpretation", "does not produce an investigation"),
                              ("nope", "Unknown capability")):
        with pytest.raises(KnowledgeError, match=match):
            save_research(kb=kb, slug=f"x-{capability[:3]}", prompt="p", host=HOST, content=content(), now=NOW,
                          capability=capability)
