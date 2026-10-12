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
    critique,
    deploy_check,
    galecore_spec_hash,
    save_proposal,
)
from galecore_ai.application.strategy_sheet import diff, sheet
from galecore_ai.contracts.strategy import (
    CritiqueContent,
    ProposalContent,
    VersionChange,
    design_gaps,
)
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
        d["parameters"] = [x for x in d["parameters"] if x["rules"] != ["X3"]]
        d["management"] = [x for x in d["management"] if x["rules"] != ["X3"]]
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


def test_only_shadow_and_credit_spreads_the_runtime_builds():
    assert check(text=spec_with(**{"deployment_constraints.eligible_modes": ["SHADOW", "PAPER"]})).verdict == "INVALID"
    data = json.loads(spec_text())
    data["candidate_construction"]["legs"][1]["type"] = "CALL"
    assert any("one SELL and one BUY per side" in e for e in check(text=json.dumps(data)).errors)
    errors = check(text=spec_with(**{"structure.default_structure": "butterfly"})).errors
    assert any("'butterfly' is not built by the runtime" in e for e in errors)


def _iron_condor(call_delta: float = 0.16) -> dict:
    data = json.loads(spec_text())
    data["structure"]["allowed_strategies"] = ["iron_condor"]
    data["structure"]["default_structure"] = "iron_condor"
    sell, buy = (json.loads(json.dumps(leg)) for leg in data["candidate_construction"]["legs"])
    sell["type"], buy["type"] = "CALL", "CALL"
    sell["strike_selection"]["target_delta"] = call_delta
    data["candidate_construction"]["legs"] += [sell, buy]
    return data


def _call_credit_spread() -> dict:
    data = json.loads(spec_text())
    data["structure"]["allowed_strategies"] = ["call_credit_spread"]
    data["structure"]["default_structure"] = "call_credit_spread"
    for leg in data["candidate_construction"]["legs"]:
        leg["type"] = "CALL"
    data["candidate_construction"]["legs"][0]["strike_selection"]["target_delta"] = 0.16
    return data


def _rules_for(sides: tuple[str, ...]):
    """The candidate's rules, with C2/C3 explaining the legs of these sides."""
    def mutate(d):
        by_id = {r["id"]: r for r in d["rules"]}
        by_id["C2"]["runtime"]["spec_paths"] = [
            *(f"candidate_construction.legs[sell_{s}].strike_selection.{k}" for s in sides
              for k in ("target_delta", "delta_tolerance")),
            "candidate_construction.constraints.min_dte", "candidate_construction.constraints.max_dte"]
        by_id["C3"]["runtime"]["spec_paths"] = [f"candidate_construction.legs[buy_{s}].strike_selection.width"
                                                for s in sides]
    return mutate


@pytest.mark.parametrize("spec, sides", [(_call_credit_spread, ("call",)), (_iron_condor, ("put", "call"))])
def test_call_credit_spread_and_iron_condor_pass_the_check_since_p1_07(spec, sides):
    report = check(proposal(_rules_for(sides)), text=json.dumps(spec()))
    assert report.errors == []
    assert report.verdict == "VALID_WITH_DECLARED_GAPS"   # the candidate's declared gaps (E3, E4, ...)


def test_call_legs_need_a_supported_rule():
    errors = check(text=json.dumps(_iron_condor())).errors
    assert not any("legs must" in e or "not built" in e or "must be positive" in e for e in errors)
    assert any("legs[sell_call].strike_selection.target_delta" in e and "no supported rule" in e for e in errors)

    pcs_legs_as_ccs = json.loads(spec_text())
    pcs_legs_as_ccs["structure"]["default_structure"] = "call_credit_spread"
    assert any("legs must be exactly ['buy_call', 'sell_call']" in e for e in check(text=json.dumps(pcs_legs_as_ccs)).errors)
    assert any("must be positive" in e for e in check(text=json.dumps(_iron_condor(-0.16))).errors)
    for path, value, message in [
        ("candidate_construction.legs.0.strike_selection.target_delta", 0.16, "must be negative (put delta)"),
        ("candidate_construction.legs.0.strike_selection.delta_tolerance", 0, "delta_tolerance must be positive"),
        ("candidate_construction.legs.1.strike_selection.width", -5, "width must be positive"),
    ]:
        data = json.loads(spec_text())
        *parents, leaf = path.split(".")
        node = data
        for part in parents:
            node = node[int(part)] if part.isdigit() else node[part]
        node[leaf] = value
        assert any(message in e for e in check(text=json.dumps(data)).errors), path


def _set(data: dict, path: str, value) -> dict:
    *parents, leaf = path.split(".")
    node = data
    for part in parents:
        node = node[int(part)] if part.isdigit() else node[part]
    node[leaf] = value
    return data


@pytest.mark.parametrize("path, value, message", [
    ("candidate_construction.legs.0.strike_selection.target_delta", "-0.16", "target_delta must be a number"),
    ("candidate_construction.legs.0.strike_selection.target_delta", None, "target_delta must be a number"),
    ("candidate_construction.legs.0.strike_selection.target_delta", True, "target_delta must be a number"),
    ("candidate_construction.legs.0.strike_selection.target_delta", -(10**400), "target_delta must be a number"),
    ("candidate_construction.constraints.min_credit", 10**400, "min_credit must be positive"),
    ("candidate_construction.legs.0.strike_selection.delta_tolerance", None, "delta_tolerance must be positive"),
    ("candidate_construction.legs.1.strike_selection.width", "5", "width must be positive"),
    ("candidate_construction.legs.1.strike_selection", [], "strike_selection must be an object"),
    ("structure.allowed_strategies", ["put_credit_spread", "jade_lizard"], "not built by the runtime"),
    ("structure.allowed_strategies", ["call_credit_spread"], "must be in allowed_strategies"),
    ("structure.forbidden_strategies", ["put_credit_spread"], "both allowed and forbidden"),
    ("candidate_construction.constraints.min_credit", 0, "min_credit must be positive"),
    ("candidate_construction.constraints.min_credit", "0.10", "min_credit must be positive"),
])
def test_malformed_or_inconsistent_values_are_invalid_not_accepted(path, value, message):
    report = check(text=json.dumps(_set(json.loads(spec_text()), path, value)))
    assert report.verdict == "INVALID"
    assert any(message in e for e in report.errors), report.errors


@pytest.mark.parametrize("section", ["structure", "candidate_construction", "identity"])
def test_a_section_that_is_not_an_object_is_invalid_without_crashing(section):
    data = json.loads(spec_text())
    data[section] = ["not", "an", "object"]
    assert check(text=json.dumps(data)).verdict == "INVALID"


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


def stored(kb, research_ref, criticised: bool = True):  # noqa: F811
    saved = save_proposal(kb=kb, prompt="Desarrollá la estrategia hasta SHADOW", host=HOST,
                          content=proposal(research_ref=research_ref), spec_json=spec_text(),
                          spec_file=f"{NAME}.json", now=NOW)
    if criticised:
        critique(kb=kb, key=KEY, content=critique_content(), host=HOST, now=NOW)
    return saved


def critique_content(verdict: str = "seguir") -> CritiqueContent:
    return CritiqueContent.model_validate({
        "verdict": verdict,
        "missing": ["costos reales de entrada y salida"],
        "biases": ["la prima de varianza se midió en un período sin crisis"],
        "alternative_explanation": "la prima cobrada paga un riesgo de cola que todavía no ocurrió",
        "why_not": ["un gap de −5 % se lleva varios meses de crédito"],
        "shutdown_criteria": ["dos stops seguidos con VIX < 20"],
        "closed_trade_review": "comparar la salida con la regla que la disparó y el escenario esperado",
    })


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
        stored(kb, research_ref, criticised=False)


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


# ── WS-0016: parameter table, management tree, critique, sheet ──


def test_save_requires_the_parameter_table_and_the_management_tree(kb, research_ref):  # noqa: F811
    assert design_gaps(proposal()) == []

    def bare(d):
        d["parameters"], d["management"] = [], []
    assert design_gaps(proposal(bare))[:2] == ["the proposal has no parameter table (parameters)",
                                               "the proposal has no management tree (management)"]

    def partial(d):
        d["parameters"] = [p for p in d["parameters"] if p["rules"] != ["X1"]]
        d["management"] = [m for m in d["management"] if m["rules"] != ["A1"]]
    gaps = design_gaps(proposal(partial))
    assert any(g.startswith("rule X1 has parameter") for g in gaps)
    assert any(g.startswith("rule A1 (adjustment)") for g in gaps)
    with pytest.raises(KnowledgeError) as exc:
        save_proposal(kb=kb, prompt="x", host=HOST, content=proposal(bare, research_ref=research_ref),
                      spec_json=spec_text(), spec_file=f"{NAME}.json", now=NOW)
    assert "the proposal has no parameter table (parameters)" in exc.value.problems
    assert not (kb.base / "strategies").exists()


def test_parameters_and_management_name_existing_rules():
    def ghost(d):
        d["management"][0]["rules"] = ["X9"]
    with pytest.raises(ValidationError, match="do not exist"):
        proposal(ghost)

    def grounded_without_source(d):
        d["parameters"][0]["status"] = "grounded"
    with pytest.raises(ValidationError, match="cites at least one source"):
        proposal(grounded_without_source)


def test_versions_stored_without_the_new_fields_keep_their_hash(kb, research_ref):  # noqa: F811
    """1.0.0–1.0.5 were stored before WS-0016: adding the fields must not make them INTEGRITY_FAILED."""
    _, path = stored(kb, research_ref, criticised=False)
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    del data["content"]["parameters"], data["content"]["management"], data["content"]["change"]
    old = {k: v for k, v in data.items() if k != "content_hash"}
    from galecore_ai.contracts.strategy import compute_document_hash
    data["content_hash"] = compute_document_hash(old)   # the hash as the old contract computed it
    Path(path).write_text(json.dumps(data), encoding="utf-8")
    assert search(kb, kind="strategy")["integrity_failed"] == []
    assert "Sin tabla de parámetros" in sheet(kb, KEY)["markdown"]


def test_approval_needs_a_critique_of_this_version(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref, criticised=False)
    with pytest.raises(KnowledgeError, match="no critique"):
        approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo", host=HOST, now=NOW)
    critique(kb=kb, key=KEY, content=critique_content("descartar"), host=HOST, now=NOW)
    with pytest.raises(KnowledgeError, match="descartar"):
        approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo", host=HOST, now=NOW)
    with pytest.raises(KnowledgeError, match="already exists"):
        critique(kb=kb, key=KEY, content=critique_content(), host=HOST, now=NOW)


def test_a_critique_is_not_a_critique_without_reasons(kb):  # noqa: F811
    data = critique_content().model_dump(mode="json")
    data["why_not"] = [" "]
    with pytest.raises(ValidationError, match="not a critique"):
        CritiqueContent.model_validate(data)
    with pytest.raises(KnowledgeError, match="no such strategy version"):
        critique(kb=kb, key=KEY, content=critique_content(), host=HOST, now=NOW)


def test_an_edited_critique_blocks_the_approval(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    path = kb.base / "strategies" / NAME / "1.0.3.critique.json"
    path.write_text(path.read_text(encoding="utf-8").replace("seguir", "descartar"), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="content_hash mismatch"):
        approve(kb=kb, key=KEY, spec_hash=doc.spec_hash, owner_words="Apruebo", host=HOST, now=NOW)


def test_sheet_shows_parameters_management_gaps_and_critique(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    out = sheet(kb, KEY)
    md = out["markdown"]
    assert out["critique"] == "seguir" and out["approved"] is False
    assert f"hash `{out['spec_hash']}`" in md   # the owner retypes the exact hash to approve
    assert "| Stop | 200 | % del crédito | 150–300 |" in md
    assert "| G1 | stop |" in md and md.count("| sí |") >= 3
    assert "| G4 | roll | cualquiera | nada: sin ajustes ni roll | sí (lo hace siempre) |" in md
    assert "| G5 | kill_switch | pérdida acumulada sobre el límite del owner | pausar entradas | no (hueco declarado) |" in md
    assert "**Por qué no:**" in md and "un gap de −5 %" in md


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
    assert code == 0 and report["verdict"] == "VALID_WITH_DECLARED_GAPS" and report["design_gaps"] == []
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
    code, out = _cli("strategy", "approve", "--ref", saved["ref"], "--spec-hash", saved["spec_hash"],
                     "--owner-words", "Apruebo", "--host-model", "test", env=env)
    assert code == 3 and "no critique" in json.dumps(out, ensure_ascii=False)
    code, criticised = _cli("strategy", "critique", "--ref", saved["ref"], env=env,
                            stdin=json.dumps({"content": critique_content().model_dump(mode="json"),
                                              "host_provider": "claude-code", "host_model": "test"}))
    assert code == 0 and criticised["verdict"] == "seguir", criticised
    code, page = _cli("strategy", "sheet", "--ref", saved["ref"], env=env)
    assert code == 0 and page["critique"] == "seguir" and "## Parámetros" in page["markdown"]
    code, refused = _cli("strategy", "deploy-check", "--ref", saved["ref"], "--galecore-hash", saved["spec_hash"],
                         env=env)
    assert code == 3 and refused["status"] == "REJECTED"
    code, approved = _cli("strategy", "approve", "--ref", saved["ref"], "--spec-hash", saved["spec_hash"],
                          "--owner-words", "Apruebo", "--host-model", "test", env=env)
    assert code == 0 and approved["status"] == "APPROVED"
    code, allowed = _cli("strategy", "deploy-check", "--ref", saved["ref"], "--galecore-hash", saved["spec_hash"],
                         env=env)
    assert code == 0 and allowed["status"] == "DEPLOY_ALLOWED"


@pytest.mark.parametrize("case", ["none", "other_version", "descartar", "seguir"])
def test_a_version_approved_before_the_critique_needs_a_valid_one_to_deploy_again(kb, research_ref, case):  # noqa: F811
    """Owner 08/10: the old approval is kept as recorded; a new deploy needs a valid critique of this exact version."""
    doc, _ = stored(kb, research_ref, criticised=False)
    from galecore_ai.contracts.strategy import (
        ApprovalDocument,
        CritiqueDocument,
        compute_document_hash,
    )
    draft = ApprovalDocument(strategy_ref=f"strategy:{KEY}", spec_hash=doc.spec_hash, proposal_hash=doc.content_hash,
                             owner_words="Apruebo", recorded_at=NOW, host=HOST, content_hash="pending")
    approval = draft.model_copy(update={"content_hash": compute_document_hash(draft.hashable_content())})
    kb.strategies.create_approval(KEY, approval)
    if case == "other_version":
        other = CritiqueDocument(strategy_ref=f"strategy:{KEY}", proposal_hash="0" * 64, content=critique_content(),
                                 recorded_at=NOW, host=HOST, content_hash="pending")
        kb.strategies.create_critique(
            KEY, other.model_copy(update={"content_hash": compute_document_hash(other.hashable_content())}))
    elif case != "none":
        critique(kb=kb, key=KEY, content=critique_content(case), host=HOST, now=NOW)
    expected = {"none": "no critique of this version", "other_version": "the critique is for another proposal",
                "descartar": "the critique says «descartar»"}
    if case == "seguir":
        assert deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash)["status"] == "DEPLOY_ALLOWED"
    else:
        with pytest.raises(KnowledgeError) as exc:
            deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash)
        assert any(p.startswith(expected[case]) for p in exc.value.problems)
    assert kb.strategies.load_approval(KEY) == approval   # the historical approval is not touched


def test_a_critique_citing_nothing_real_is_refused(kb, research_ref):  # noqa: F811
    stored(kb, research_ref, criticised=False)
    bad = critique_content().model_copy(update={"evidence_refs": ["evidence:2026-01-01-nada"]})
    with pytest.raises(KnowledgeError, match="critique refused"):
        critique(kb=kb, key=KEY, content=bad, host=HOST, now=NOW)


def test_save_refuses_a_rule_parameter_missing_from_the_table(kb, research_ref):  # noqa: F811
    def partial(d):
        d["parameters"] = [p for p in d["parameters"] if p["rules"] != ["X1"]]
    with pytest.raises(KnowledgeError) as exc:
        save_proposal(kb=kb, prompt="x", host=HOST, content=proposal(partial, research_ref=research_ref),
                      spec_json=spec_text(), spec_file=f"{NAME}.json", now=NOW)
    assert any(p.startswith("rule X1 has parameter") for p in exc.value.problems)


def test_cli_critique_with_invalid_input_is_a_validation_error(kb, research_ref):  # noqa: F811
    stored(kb, research_ref, criticised=False)
    code, out = _cli("strategy", "critique", "--ref", f"strategy:{KEY}", stdin="[1]",
                     env={KNOWLEDGE_DIR_ENV: str(kb.base)})
    assert code == 3 and "Invalid critique" in out["error"]


def test_sheet_puts_the_version_against_the_profile_and_what_is_open(kb, research_ref):  # noqa: F811
    from galecore_ai.application import supervisor
    from galecore_ai.application.profile import set_profile
    from tests.unit.test_capital import LIMITS, exposure
    stored(kb, research_ref)
    md = sheet(kb, KEY)["markdown"]
    assert "## Riesgo contra el perfil (sin perfil)" in md and "- Falta: perfil: no hay perfil" in md
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    asked = []

    def read(path):
        asked.append(path)
        return exposure()
    out = sheet(kb, KEY, read)
    md = out["markdown"]
    assert asked[0] == ("/App/Runtime/Exposure?capital=10000.0&maxRiskPerTradePct=5.0&maxOpenRiskPct=50.0"
                        "&reservePct=10.0&maxBetPct=30.0")
    spec = json.loads(spec_text())
    cap, n = spec["risk_limits"]["max_loss_per_trade_usd"], spec["risk_limits"]["max_concurrent_positions"]
    assert f"| Pérdida máxima por operación (1 contrato) | {cap:g} USD (tope de la spec; el runtime no abre por encima) | 500 USD (5 %) |" in md
    assert f"({n:g} posiciones × pérdida máxima)" in md
    assert "- Kill switch: G5 — lo ejecuta GaleCore: no (hueco declarado)" in md
    assert "- Abierto hoy en SHADOW: 1.368 USD en riesgo en 3 posiciones; entra riesgo nuevo por 3.632 USD" in md
    # WS-0027: the controls verdict and any broken portfolio limit go first, so «¿la activo?» cannot skip them.
    assert "## ¿Se puede aprobar?" in md and "- Controles: No se recomienda aprobar" in md
    assert out["recomendar_aprobacion"] is False and "Límite de cartera fuera hoy" not in md
    broken = {"limit": "bet:SPY bullish 2026-W47", "used": 1968.0, "max": 1500.0, "headroom": -468.0, "ok": False}
    md = sheet(kb, KEY, lambda path: exposure(checks=[broken]))["markdown"]
    assert "- Límite de cartera fuera hoy: apuesta SPY bullish 2026-W47: 1.968 USD de 1.500 (SHADOW)" in md

    def down(path):
        raise supervisor.SupervisorError("GaleCore no respondió en http://localhost:7001: ConnectError")
    assert "- Falta: lo abierto en SHADOW: GaleCore no respondió en" in sheet(kb, KEY, down)["markdown"]
    assert "respuesta inesperada de GaleCore" in sheet(kb, KEY, lambda path: {"asOf": "x"})["markdown"]
    assert "- Falta: lo abierto en SHADOW: no se consultó GaleCore" in sheet(kb, KEY)["markdown"]


def _structures_response() -> dict:
    def priced(structure, executable, credit, risk, bes, note=None):
        return {"structure": structure, "executableToday": executable, "note": note, "credit": credit,
                "maxRisk": risk, "capital": risk, "breakevens": bes, "touchProbability": 0.317,
                "greeks": {"delta": 2.11, "gamma": -0.08, "thetaPerDay": 0.73, "vegaPerVolPoint": -5.35},
                "scenarios": [{"name": "gap -5%", "spot": 736.07, "volShift": 0, "pnl": -143.57},
                              {"name": "vol +5 pts", "spot": 774.81, "volShift": 0.05, "pnl": -24.45}]}
    return {"symbol": "SPY", "spot": 774.81, "expiration": "2026-11-13", "dte": 36, "asOf": "2026-10-08T15:00:00Z",
            "error": None, "assumptions": ["montos en USD por contrato (×100)"], "structures": [
                priced("put_credit_spread", True, 0.46, 454.0, [736.54]),
                {"structure": "call_credit_spread", "executableToday": False,
                 "note": "sin cotización utilizable para la call .SPY261113C811"},
                priced("iron_condor", False, 1.2, 380.0, [735.8, 807.2], "no ejecutable hoy: el runtime sólo construye PCS (P1-07)"),
                {"structure": "wait", "executableToday": True, "note": "no abre posición: sin crédito ni riesgo"}]}


def test_sheet_compares_structures_with_what_galecore_returns(kb, research_ref):  # noqa: F811
    from galecore_ai.application import supervisor
    stored(kb, research_ref)
    asked = []

    def read(path):
        asked.append(path)
        return _structures_response()
    out = sheet(kb, KEY, read)
    md = out["markdown"]
    spec = json.loads(spec_text())
    sell = next(leg for leg in spec["candidate_construction"]["legs"] if leg["side"].upper() == "SELL")
    assert asked[-1].startswith("/App/Runtime/Structures?symbol=SPY&delta=" + f"{abs(sell['strike_selection']['target_delta'])}")
    assert "| PCS | 0.46 | 454.0 | 454.0 | 736.54 | 0.317 | 2.11 | -0.08 | 0.73 | -5.35 | -143.57 | -24.45 |" in md
    assert "| Iron condor | 1.2 | 380.0 | 380.0 | 735.8 / 807.2 |" in md
    assert "- CCS: no ejecutable hoy — sin cotización utilizable para la call .SPY261113C811" in md
    assert "- PCS: ejecutable hoy" in md and "- Iron condor: no ejecutable hoy — no ejecutable hoy: el runtime" in md
    assert "- Esperar: ejecutable hoy — no abre posición" in md
    assert out["structures"]["data"]["dte"] == 36

    def down(path):
        raise supervisor.SupervisorError("GaleCore no respondió")
    assert "- Falta: estructuras: GaleCore no respondió" in sheet(kb, KEY, down)["markdown"]
    assert "- Falta: estructuras: no se consultó GaleCore" in sheet(kb, KEY)["markdown"]
    failed = dict(_structures_response(), error="sin PCS: sin cadena de opciones para SPY", structures=[])
    assert "- Falta: estructuras: sin PCS: sin cadena" in sheet(kb, KEY, lambda path: failed)["markdown"]


def test_a_cap_above_the_profile_is_flagged(kb, research_ref):  # noqa: F811
    from galecore_ai.application.profile import set_profile
    from tests.unit.test_capital import LIMITS
    set_profile(kb.profile, changes={"reference_capital": {"amount": 4000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    stored(kb, research_ref)
    rows = sheet(kb, KEY)["risk"]["rows"]
    assert rows[0][2] == "200 USD (5 %)" and rows[0][3] == "EXCEDE"
    lim = json.loads(spec_text())["risk_limits"]
    worst = lim["max_loss_per_trade_usd"] * lim["max_concurrent_positions"]
    assert rows[1][2] == "2.000 USD (50 %)" and rows[1][3] == ("EXCEDE" if worst > 2000 else "dentro")


def test_without_a_cap_the_full_width_bounds_the_loss(kb, research_ref):  # noqa: F811
    from galecore_ai.application.strategy_sheet import risk
    doc, _ = stored(kb, research_ref)
    spec = json.loads(doc.spec_json)
    spec["risk_limits"]["max_loss_per_trade_usd"] = None
    width = next(leg["strike_selection"]["width"] for leg in spec["candidate_construction"]["legs"]
                 if leg["side"].upper() == "BUY")
    out = risk(kb, doc.model_copy(update={"spec_json": json.dumps(spec)}))
    assert not out["rows"]   # no profile in this kb: nothing to compare, said as missing
    assert out["missing"][0] == "perfil: no hay perfil"
    from galecore_ai.application.profile import set_profile
    from tests.unit.test_capital import LIMITS
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    row = risk(kb, doc.model_copy(update={"spec_json": json.dumps(spec)}))["rows"][0]
    assert row[1].startswith(f"{width * 100:g} USD (ancho completo × 100")


def _next_version(kb, research_ref, change):  # noqa: F811
    spec = json.loads(spec_text())
    spec["identity"]["version"] = "1.0.4"
    spec["risk_limits"]["max_concurrent_positions"] = 3

    def bump(d):
        d["version"] = "1.0.4"
        d["owner_decisions"] = []
        for r in d["rules"]:
            if r["id"] == "E1":
                r["text"] += " Hasta 3 posiciones."
        if change is not None:
            d["change"] = change
    return save_proposal(kb=kb, prompt="x", host=HOST, content=proposal(bump, research_ref=research_ref),
                         spec_json=json.dumps(spec, indent=2), spec_file=f"{NAME}.json", now=NOW)


def test_a_new_version_says_what_it_changes_and_why(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError) as exc:
        _next_version(kb, research_ref, None)
    assert any("says what it changes and why" in p for p in exc.value.problems)
    with pytest.raises(KnowledgeError) as exc:
        _next_version(kb, research_ref, {"from_version": "1.0.3", "reason": "más posiciones",
                                         "refs": ["decision:sha256:000000000000"]})
    assert any("no decision of the project" in p for p in exc.value.problems)
    with pytest.raises(KnowledgeError) as exc:
        _next_version(kb, research_ref, {"from_version": "1.0.9", "reason": "más posiciones", "refs": [research_ref]})
    assert any("is not a stored version" in p for p in exc.value.problems)
    from galecore_ai.application import project
    story, _ = project.add(kb=kb, name=NAME, kind="story", words="funciona en calma", prompt="p", now=NOW)
    decided, _ = project.add(kb=kb, name=NAME, kind="decision", words="más posiciones", prompt="p", now=NOW)
    with pytest.raises(KnowledgeError) as exc:   # a story is not a decision
        _next_version(kb, research_ref, {"from_version": "1.0.3", "reason": "x", "refs": [f"decision:{story.hash}"]})
    assert any("no decision of the project" in p for p in exc.value.problems)
    _next_version(kb, research_ref, {"from_version": "1.0.3", "reason": "más posiciones para generar data",
                                     "refs": [research_ref, f"decision:{decided.hash[:19]}"]})
    out = diff(kb, KEY, f"{NAME}/1.0.4")
    assert out["change"]["reason"] == "más posiciones para generar data"
    assert {"path": "risk_limits.max_concurrent_positions", "from": 1, "to": 3} in out["spec"]
    assert not any(d["path"] == "identity.version" for d in out["spec"])
    assert {"rule": "E1", "change": "changed", "fields": ["text"]} in out["rules"]
    assert "**Motivo:** más posiciones para generar data" in out["markdown"]


def test_a_change_needs_a_reason_and_what_originated_it():
    with pytest.raises(ValidationError, match="cites the decision"):
        VersionChange(from_version="1.0.3", reason="x", refs=[])
    with pytest.raises(ValidationError):
        VersionChange(from_version="1.0.3", reason="  ", refs=["research:x"])



def test_diff_compares_two_versions_of_one_strategy(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="two versions of one strategy"):
        diff(kb, KEY, KEY)
    with pytest.raises(KnowledgeError, match="two versions of one strategy"):
        diff(kb, KEY, "otra_estrategia/1.0.4")
    _next_version(kb, research_ref, {"from_version": "1.0.3", "reason": "más posiciones", "refs": [research_ref]})
    code, out = _cli("strategy", "diff", "--from", f"strategy:{KEY}", "--ref", f"strategy:{NAME}/1.0.4",
                     env={KNOWLEDGE_DIR_ENV: str(kb.base)})
    assert code == 0 and out["change"]["reason"] == "más posiciones" and out["spec"]
