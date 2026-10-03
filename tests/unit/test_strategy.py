"""Strategy proposal -> spec check -> approval -> deploy check (GC-AI-0008)."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import KNOWLEDGE_DIR_ENV, parse_ref
from galecore_ai.application.knowledge import KnowledgeError, save_evidence, search, show
from galecore_ai.application.strategy import (
    approve,
    check_proposal,
    deploy_check,
    galecore_spec_hash,
    save_proposal,
)
from galecore_ai.contracts.strategy import ProposalContent
from galecore_ai.harness.catalog import load_catalog
from tests.unit.test_evidence import evidence
from tests.unit.test_knowledge import HOST, NOW, content, kb, save  # noqa: F401  (kb is a fixture)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SPECS = FIXTURES / "galecore" / "runtime_specs"
NAME = "spy_prima_varianza_30_45d"
KEY = f"{NAME}/1.0.3"
# Hashes GaleCore computed at load and persisted in GaleCore Dev (strategy_specs.content_hash, 27/09).
GALECORE_HASHES = {
    "shadow_runtime_test_v1.json": "sha256:68add468f142baaca705797e34ca4ad40fcc1bf4d20e20578e996b5daaacd076",
    "shadow_runtime_test_v2.json": "sha256:c8b1ead18771deaff19721f32bd335183dc6a5172b7803d4a8588b5b05caad15",
    # The candidate submitted for approval; GaleCore's StrategySpecVersionTests pins the same value.
    f"{NAME}.json": "sha256:19884e779e3722f6221cf86c03b411307cdc41e04880e26f8f88395cf960bc51",
}


def spec_text(name: str = f"{NAME}.json") -> str:
    return (SPECS / name).read_bytes().decode("utf-8-sig")


def spec_with(**changes) -> str:
    """The candidate spec with dotted-path changes (value None deletes nothing; it sets null)."""
    data = json.loads(spec_text())
    for path, value in changes.items():
        node = data
        *parents, leaf = path.split(".")
        for p in parents:
            node = node[p]
        node[leaf] = value
    return json.dumps(data, indent=2)


def proposal_data() -> dict:
    return json.loads((FIXTURES / "strategy" / f"proposal_{NAME}.json").read_text(encoding="utf-8"))


def proposal(mutate=None, research_ref: str | None = None) -> ProposalContent:
    data = proposal_data()
    if research_ref:
        data["research_refs"] = [research_ref]
        data["hypothesis"]["sources"] = []
        for rule in data["rules"]:
            rule["sources"] = []
            if rule["basis"] == "grounded":
                rule["basis"] = "design_choice"
            if rule["basis"] in ("pending_parameter", "design_choice") and not rule.get("rationale"):
                rule["rationale"] = "test"
    if mutate:
        mutate(data)
    return ProposalContent.model_validate(data)


def check(p: ProposalContent | None = None, text: str | None = None, file: str = f"{NAME}.json"):
    return check_proposal(p or proposal(), text if text is not None else spec_text(), file)


# ── GaleCore's hash ──────────────────────────────────────────────


@pytest.mark.parametrize("file_name", sorted(GALECORE_HASHES))
def test_hash_equals_the_one_galecore_computed(file_name):
    assert galecore_spec_hash(spec_text(file_name)) == GALECORE_HASHES[file_name]


def test_hash_ignores_formatting_but_keeps_number_literals():
    text = spec_text()
    reformatted = text.replace("\n", "").replace("  ", "")
    assert galecore_spec_hash(reformatted) == galecore_spec_hash(text)
    assert galecore_spec_hash(text.replace('"width": 5.0', '"width": 5')) != galecore_spec_hash(text)


def test_escapes_follow_galecore_for_separators_astral_and_controls():
    """Forms observed from .NET's UnsafeRelaxedJsonEscaping (internal review R1, dotnet run)."""
    from galecore_ai.application.strategy import _escape
    bs = chr(92)
    assert _escape(chr(0x2028) + chr(0x2029)) == f'"{bs}u2028{bs}u2029"'
    assert _escape(chr(0x1F642)) == f'"{bs}uD83D{bs}uDE42"'
    assert _escape(chr(0x85) + chr(8) + chr(12)) == f'"{bs}u0085{bs}b{bs}f"'
    assert _escape("días") == '"días"'


def test_non_ascii_spec_text_is_refused():
    report = check(text=spec_with(**{"metadata.notes": "estrategia con acentos: días"}))
    assert any("must be ASCII" in e for e in report.errors)  # also when written as \u escapes


def test_hash_excludes_content_hash():
    assert galecore_spec_hash(spec_with(content_hash="sha256:x")) == galecore_spec_hash(spec_with())


# ── the check ────────────────────────────────────────────────────


def test_candidate_is_valid_with_its_declared_gaps():
    report = check()
    assert report.verdict == "VALID_WITH_DECLARED_GAPS", report.errors
    assert [g.split(":")[0] for g in report.declared_gaps] == ["E3", "E4", "S2", "R2", "M2"]
    assert report.coverage["entry_filters.gate_layer.gates[vix_below_30]"] == ["E2"]


def test_owner_draft_spec_is_refused_for_what_the_runtime_ignores():
    """pcs_spy_16d_v1 declares risk-based sizing and a VRP analytics ref the runtime never uses."""
    def as_draft(d):
        d["name"], d["version"], d["owner_decisions"] = "pcs_spy_16d_v1", "1.0.0", []
    errors = check(proposal(as_draft), spec_text("pcs_spy_16d_v1.json"), "pcs_spy_16d_v1.json").errors
    joined = "\n".join(errors)
    assert "candidate_construction.sizing.method = 'RISK_BASED'" in joined
    assert "risk_limits.max_risk_per_trade_pct = 5.0" in joined
    assert "analytics_refs" in joined


@pytest.mark.parametrize(("change", "expected"), [
    ({"candidate_construction.sizing": {"method": "RISK_BASED", "fixed_contracts": None,
                                        "risk_per_trade_pct": 5.0}}, "runtime ignores it"),
    ({"exits.deterministic.defensive_roll": {"enabled": True}}, "no hace roll"),
    ({"risk_limits.max_portfolio_heat_pct": 7.0}, "no mide heat"),
    ({"data_quality.block_on_crossed_market": False}, "siempre descarta cotizaciones cruzadas"),
    ({"analytics_refs": {"vrp": {"capability_ref": "compute:vrp", "version": "1.0.0"}}}, "analytics_refs"),
])
def test_a_spec_promising_behavior_the_runtime_ignores_is_invalid(change, expected):
    report = check(text=spec_with(**change))
    assert report.verdict == "INVALID"
    assert any(expected in e for e in report.errors), report.errors


def test_an_executed_field_without_a_rule_is_invalid():
    def drop_x3(d):
        d["rules"] = [r for r in d["rules"] if r["id"] != "X3"]
    report = check(proposal(drop_x3))
    assert report.verdict == "INVALID"
    assert any("time_exit.max_dte" in e and "no supported rule" in e for e in report.errors)


def test_a_supported_rule_naming_a_field_the_runtime_does_not_execute_is_invalid():
    def fake(d):
        d["rules"][0]["runtime"]["spec_paths"].append("risk_limits.max_portfolio_heat_pct")
    report = check(proposal(fake))
    assert any("max_portfolio_heat_pct is marked supported but the runtime does not execute it" in e
               for e in report.errors)


def test_a_supported_rule_on_an_empty_field_is_invalid():
    report = check(text=spec_with(**{"risk_limits.max_loss_per_trade_usd": None}))
    assert any("max_loss_per_trade_usd is marked supported but the spec leaves it empty" in e
               for e in report.errors)


def test_entry_spacing_is_executed_and_needs_a_supported_rule():
    """GC-0005: the runtime skips an entry sooner than N minutes after the instance's last one."""
    text = spec_with(**{"risk_limits.min_minutes_between_entries": 1440})
    report = check(text=text)
    assert any("min_minutes_between_entries = 1440" in e and "no supported rule" in e for e in report.errors)

    def explain(d):
        d["rules"].append({"id": "R9", "block": "risk", "text": "Como mucho una entrada por día.",
                           "basis": "design_choice", "rationale": "test",
                           "runtime": {"status": "supported",
                                       "spec_paths": ["risk_limits.min_minutes_between_entries"]}})
    assert check(proposal(explain), text=text).verdict != "INVALID"


def test_entry_spacing_left_null_needs_no_rule():
    assert check(text=spec_with(**{"risk_limits.min_minutes_between_entries": None})).verdict != "INVALID"


def test_an_unmapped_field_fails_closed():
    report = check(text=spec_with(**{"exits.deterministic.trailing_stop": {"pct": 25}}))
    assert any("trailing_stop.pct: not in the runtime support table" in e for e in report.errors)


def test_the_calendar_must_be_declared():
    def undeclare(d):
        d["rules"] = [r for r in d["rules"] if r["id"] != "M2"]
    report = check(proposal(undeclare))
    assert any("operational.calendar" in e and "declare it" in e for e in report.errors)


@pytest.mark.parametrize(("change", "expected"), [
    ({"universe.mode": "DYNAMIC"}, "universe.mode"),
    ({"structure.selection_method": "AI_RECOMMENDED"}, "structure.selection_method"),
    ({"universe.instrument_types": ["EQUITY_OPTION", "FUTURE"]}, "universe.instrument_types"),
    ({"exits.deterministic.defensive_roll": {"enabled": False, "min_dte_remaining": 21}}, "defensive_roll.min_dte"),
])
def test_fields_with_a_single_runtime_semantics_are_fixed(change, expected):
    """Codex C1 BLOCKER: these reproduced VALID_WITH_DECLARED_GAPS as 'informational'."""
    assert any(expected in e for e in check(text=spec_with(**change)).errors)


def test_a_leg_selection_method_the_builder_does_not_use_is_invalid():
    data = json.loads(spec_text())
    data["candidate_construction"]["legs"][1]["strike_selection"]["method"] = "DELTA"
    assert any("strike_selection.method" in e for e in check(text=json.dumps(data)).errors)


@pytest.mark.parametrize(("mutate", "expected"), [
    (lambda g: g.update(cooldown_minutes=30), "never reads"),
    (lambda g: g.update(threshold={}), "numeric threshold.value"),
    (lambda g: g.update(threshold={"value": 30, "max": 40}), "no min/max"),
    (lambda g: g.update(operator="BETWEEN"), "BETWEEN needs"),
    (lambda g: g.update(threshold={"value": 30, "unit": "points"}), "threshold properties never read"),
])
def test_every_gate_leaf_is_validated(mutate, expected):
    """Codex C1 BLOCKER: gates were checked as whole objects."""
    data = json.loads(spec_text())
    mutate(data["entry_filters"]["gate_layer"]["gates"][0])
    assert any(expected in e for e in check(text=json.dumps(data)).errors)


def test_a_gate_on_a_metric_the_runtime_cannot_resolve_is_invalid():
    data = json.loads(spec_text())
    data["entry_filters"]["gate_layer"]["gates"][0]["metric_ref"] = "capability:compute.vrp.SPY.ratio"
    report = check(text=json.dumps(data))
    assert any("NO_DATA forever" in e for e in report.errors)


def test_a_gate_that_passes_without_data_is_invalid():
    data = json.loads(spec_text())
    data["entry_filters"]["gate_layer"]["gates"][0]["on_no_data"] = "PASS"
    assert any("fail-closed" in e for e in check(text=json.dumps(data)).errors)


def test_identity_and_file_name_must_match():
    report = check(file="other.json")
    assert any("GaleCore deploys by file name" in e for e in report.errors)
    report = check(text=spec_with(**{"identity.version": "9.9.9"}))
    assert any("is not the proposal's" in e for e in report.errors)


def test_only_shadow_and_put_credit_spreads():
    assert check(text=spec_with(**{"deployment_constraints.eligible_modes": ["SHADOW", "PAPER"]})).verdict == "INVALID"
    data = json.loads(spec_text())
    data["candidate_construction"]["legs"][1]["type"] = "CALL"
    assert any("exactly one SELL PUT and one BUY PUT" in e for e in check(text=json.dumps(data)).errors)


# ── the proposal contract ────────────────────────────────────────


def test_every_block_needs_a_rule():
    def no_adjustment(d):
        d["rules"] = [r for r in d["rules"] if r["block"] != "adjustment"]
    with pytest.raises(ValidationError, match="adjustment"):
        proposal(no_adjustment)


def test_grounded_rules_cite_and_unsupported_rules_explain():
    def grounded_without_source(d):
        d["rules"][0].update(basis="grounded", sources=[])
    with pytest.raises(ValidationError, match="cites at least one source"):
        proposal(grounded_without_source)

    def silent_unsupported(d):
        d["rules"][2]["runtime"]["note"] = ""
    with pytest.raises(ValidationError, match="says why"):
        proposal(silent_unsupported)


def test_evaluation_plan_needs_dependence_and_sample_sufficiency():
    def no_sample(d):
        d["evaluation_plan"]["sample_sufficiency"] = " "
    with pytest.raises(ValidationError, match="blank"):
        proposal(no_sample)


# ── store, approval, deploy check ────────────────────────────────


@pytest.fixture
def research_ref(kb):  # noqa: F811
    document, _ = save(kb)
    return f"research:{document.id}"


def stored(kb, research_ref):  # noqa: F811
    return save_proposal(kb=kb, prompt="Desarrollá la estrategia hasta SHADOW", host=HOST,
                         content=proposal(research_ref=research_ref), spec_json=spec_text(),
                         spec_file=f"{NAME}.json", now=NOW)


def test_saved_version_keeps_the_exact_spec_and_its_hash(kb, research_ref):  # noqa: F811
    doc, path = stored(kb, research_ref)
    assert Path(path) == kb.base / "strategies" / NAME / "1.0.3.proposal.json"
    assert doc.spec_json == spec_text()
    assert doc.spec_hash == galecore_spec_hash(spec_text())
    assert doc.check.verdict == "VALID_WITH_DECLARED_GAPS"
    shown = show(kb, f"strategy:{KEY}")
    assert shown["approval"] is None and shown["spec_hash"] == doc.spec_hash
    found = search(kb, text="prima varianza", kind="strategy")
    assert [r["ref"] for r in found["results"]] == [f"strategy:{KEY}"]
    assert found["results"][0]["approved"] is False


def test_a_version_is_create_only(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="new version"):
        stored(kb, research_ref)


def test_invalid_proposals_and_unresolved_refs_are_not_stored(kb, research_ref):  # noqa: F811
    with pytest.raises(KnowledgeError, match="runtime ignores"):
        save_proposal(kb=kb, prompt="x", host=HOST, content=proposal(research_ref=research_ref),
                      spec_json=spec_with(**{"risk_limits.max_portfolio_heat_pct": 7.0}),
                      spec_file=f"{NAME}.json", now=NOW)
    with pytest.raises(KnowledgeError, match="no such investigation"):
        save_proposal(kb=kb, prompt="x", host=HOST, content=proposal(research_ref="research:2026-01-01-nada"),
                      spec_json=spec_text(), spec_file=f"{NAME}.json", now=NOW)
    assert not (kb.base / "strategies").exists()


def test_approval_needs_the_exact_hash(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="is not this version's"):
        approve(kb=kb, key=KEY, spec_hash=GALECORE_HASHES["shadow_runtime_test_v2.json"],
                owner_words="apruebo", host=HOST, now=NOW)
    approval, _ = approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo la 1.0.3 para SHADOW",
                          host=HOST, now=NOW)
    assert approval.scope == "SHADOW:galecore-dev" and approval.proposal_hash == doc.content_hash
    with pytest.raises(KnowledgeError, match="already exists"):
        approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="otra vez", host=HOST, now=NOW)
    assert search(kb, kind="strategy")["results"][0]["approved"] is True


def test_approval_words_naming_another_version_are_refused(kb, research_ref):  # noqa: F811
    """Codex C2 MAJOR: 1.0.1 asked for approval of 1.0.0."""
    doc, _ = stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="name version"):
        approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo la 1.0.0", host=HOST, now=NOW)


def test_owner_decisions_cannot_ask_about_another_version():
    def stale(d):
        d["owner_decisions"][0]["question"] = f"¿Aprobás {NAME}/1.0.0?"
    assert any("mentions other versions" in e for e in check(proposal(stale)).errors)

    def stale_plan(d):  # Codex C3 MAJOR
        d["evaluation_plan"]["question"] = "¿Estas reglas (v1.0.0) tienen resultado positivo?"
    assert any("mentions other versions" in e for e in check(proposal(stale_plan)).errors)

    def history(d):
        d["limitations"].append("1.0.0 nunca se aprobó")
    assert not any("mentions other versions" in e for e in check(proposal(history)).errors)


def test_versions_saved_before_the_rule_stay_readable(kb, research_ref):  # noqa: F811
    """Fresh-session test (27/09): the rule lived in the contract, so 1.0.1/1.0.2 became unreadable history."""
    _, path = stored(kb, research_ref)
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    data["content"]["owner_decisions"][0]["question"] = f"¿Aprobás {NAME}/1.0.0?"   # what 1.0.1 really stored
    from galecore_ai.contracts.strategy import StrategyDocument, compute_document_hash
    old = StrategyDocument.model_validate(data)
    old = old.model_copy(update={"content_hash": compute_document_hash(old.hashable_content())})
    Path(path).write_text(json.dumps(old.model_dump(mode="json")), encoding="utf-8")
    assert search(kb, kind="strategy")["integrity_failed"] == []
    assert show(kb, f"strategy:{KEY}")["content"]["owner_decisions"][0]["question"].endswith("1.0.0?")


def test_deploy_is_refused_without_approval_or_with_another_hash(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="no recorded approval"):
        deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash)
    approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo", host=HOST, now=NOW)
    with pytest.raises(KnowledgeError, match="GaleCore loaded"):
        deploy_check(kb=kb, key=KEY, galecore_hash=GALECORE_HASHES["shadow_runtime_test_v2.json"])
    with pytest.raises(KnowledgeError, match="does not hash"):
        deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash, galecore_spec_json=spec_text("pcs_spy_16d_v1.json"))
    allowed = deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash, galecore_spec_json=spec_text())
    assert allowed["status"] == "DEPLOY_ALLOWED" and allowed["spec_file"] == f"{NAME}.json"


def test_an_edited_approval_blocks_the_deploy(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    _, path = approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo", host=HOST, now=NOW)
    p = Path(path)
    p.write_text(p.read_text(encoding="utf-8").replace("Apruebo", "Apruebo todo"), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="content_hash mismatch"):
        deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash)


def test_an_edited_version_is_integrity_failed(kb, research_ref):  # noqa: F811
    _, path = stored(kb, research_ref)
    p = Path(path)
    p.write_text(p.read_text(encoding="utf-8").replace('"pct_of_credit\\": 50.0', '"pct_of_credit\\": 40.0'),
                 encoding="utf-8")
    assert search(kb, kind="strategy")["integrity_failed"][0]["status"] == "INTEGRITY_FAILED"


def test_research_can_cite_the_strategy_version(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    assert str(parse_ref(f"strategy:{KEY}")) == f"strategy:{KEY}"
    ev, _ = save_evidence(kb=kb, slug="shadow-report", prompt="¿Qué hizo?", host=HOST, content=evidence(), now=NOW)
    doc, _ = save(kb, slug="seguimiento",
                  antecedents=[{"ref": f"strategy:{KEY}", "summary": "versión aprobada",
                                "bearing": "los datos son de esta versión"}],
                  statements=[{"kind": "fact", "text": "Observación", "sources": [f"evidence:{ev.id}"]}])
    assert f"research:{doc.id}" in show(kb, f"strategy:{KEY}")["cited_by"]


# ── catalog and CLI ──────────────────────────────────────────────


def test_catalog_offers_the_strategy_path():
    catalog = load_catalog()
    design = catalog.get("strategy_design")
    assert design.stored_as == "strategy"
    assert design.output_contract == "galecore_ai.contracts.strategy.ProposalContent"
    assert any("deploy-check" in step for step in design.flow)
    followup = catalog.get("strategy_followup")
    assert followup.output_contract == "galecore_ai.contracts.research.ResearchContent"


def _cli(*args, stdin=None, env=None):
    result = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], input=stdin,
                            capture_output=True, text=True, timeout=60, check=False,
                            env={**os.environ, **(env or {})})
    return result.returncode, json.loads(result.stdout)


def test_cli_check_and_hash():
    request = json.dumps({"content": proposal_data()})
    code, report = _cli("strategy", "check", "--spec", str(SPECS / f"{NAME}.json"), stdin=request)
    assert code == 0 and report["verdict"] == "VALID_WITH_DECLARED_GAPS"
    code, out = _cli("strategy", "hash", "--spec", str(SPECS / "shadow_runtime_test_v2.json"))
    assert code == 0 and out["spec_hash"] == GALECORE_HASHES["shadow_runtime_test_v2.json"]
    bad = copy.deepcopy(proposal_data())
    bad["name"], bad["version"], bad["owner_decisions"] = "pcs_spy_16d_v1", "1.0.0", []
    code, report = _cli("strategy", "check", "--spec", str(SPECS / "pcs_spy_16d_v1.json"),
                        stdin=json.dumps({"content": bad}))
    assert code == 3 and report["verdict"] == "INVALID"


def test_cli_save_approve_deploy_check(kb, research_ref):  # noqa: F811
    env = {KNOWLEDGE_DIR_ENV: str(kb.base)}
    request = json.dumps({"content": proposal(research_ref=research_ref).model_dump(mode="json"),
                          "host_provider": "claude-code", "host_model": "test"})
    code, saved = _cli("strategy", "save", "--spec", str(SPECS / f"{NAME}.json"), "--prompt", "Hasta SHADOW",
                       stdin=request, env=env)
    assert code == 0 and saved["status"] == "RECORDED", saved
    code, refused = _cli("strategy", "deploy-check", "--ref", saved["ref"], "--galecore-hash", saved["spec_hash"],
                         env=env)
    assert code == 3 and refused["status"] == "REJECTED"
    code, approved = _cli("strategy", "approve", "--ref", saved["ref"], "--spec-hash", saved["spec_hash"],
                          "--owner-words", "Apruebo", "--host-model", "test", env=env)
    assert code == 0 and approved["status"] == "APPROVED"
    code, allowed = _cli("strategy", "deploy-check", "--ref", saved["ref"], "--galecore-hash", saved["spec_hash"],
                         env=env)
    assert code == 0 and allowed["status"] == "DEPLOY_ALLOWED"
