"""strategy versions / strategy duplicate (WS-0098, increment 4)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from galecore_ai.adapters.knowledge_base import KNOWLEDGE_DIR_ENV
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.application.strategy import approve, galecore_spec_hash, save_proposal
from galecore_ai.application.strategy_versions import duplicate, list_versions
from tests.unit.fake_galecore import fake_checker
from tests.unit.test_knowledge import HOST, NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import (
    KEY,
    NAME,
    _cli,
    proposal,
    research_ref,  # noqa: F401  (fixture)
    spec_text,
    stored,
)


def save_version(kb, research_ref, version, from_version=None):  # noqa: F811
    spec = json.loads(spec_text())
    spec["identity"]["version"] = version

    def bump(d):
        d["version"] = version
        d["owner_decisions"] = []
        if from_version:
            d["change"] = {"from_version": from_version, "reason": "cambio de prueba", "refs": [research_ref]}
    if from_version:
        spec["risk_limits"]["max_concurrent_positions"] = 3
    return save_proposal(checker=fake_checker(), kb=kb, prompt="x", host=HOST,
                         content=proposal(bump, research_ref=research_ref), spec_json=json.dumps(spec, indent=2),
                         spec_file=f"{NAME}.json", now=NOW)


def test_versions_sorted_numerically_with_approval_and_diff(kb, research_ref):  # noqa: F811
    save_version(kb, research_ref, "1.9.0")
    save_version(kb, research_ref, "1.10.0", "1.9.0")
    out = list_versions(kb, NAME)
    assert out["strategy"] == NAME
    first, second = out["versions"]
    assert [first["version"], second["version"]] == ["1.9.0", "1.10.0"]
    assert first["ref"] == f"strategy:{NAME}/1.9.0" and first["spec_hash"].startswith("sha256:")
    assert first["diff_from_previous"] is None and first["change"] == {"reason": None, "from_version": None}
    assert second["change"] == {"reason": "cambio de prueba", "from_version": "1.9.0"}
    d = second["diff_from_previous"]
    assert d["from"] == f"strategy:{NAME}/1.9.0" and d["spec"] and "markdown" not in d
    assert set(first["factibilidad"]) == {"veredicto", "texto"}
    assert not first["approved"] and first["approved_at"] is None and first["critique"] is None
    assert "problem" not in first and "problem" not in second


def test_versions_flag_approved_and_critique(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    approve(kb=kb, key=KEY, owner_words="Apruebo", host=HOST, now=NOW)
    [v] = list_versions(kb, NAME)["versions"]
    assert v["approved"] is True and v["approved_at"] and v["critique"] == "seguir"
    assert v["check"] == "VALID_WITH_DECLARED_GAPS"


def test_unknown_strategy_has_no_versions(kb):  # noqa: F811
    assert list_versions(kb, "no_existe_nada") == {"strategy": "no_existe_nada", "versions": []}


def test_a_broken_approval_does_not_hide_the_other_versions(kb, research_ref):  # noqa: F811
    save_version(kb, research_ref, "1.9.0")
    save_version(kb, research_ref, "1.10.0", "1.9.0")
    path = kb.strategies.path_for(f"{NAME}/1.9.0", "approval")
    path.write_text("{ roto", encoding="utf-8")
    first, second = list_versions(kb, NAME)["versions"]
    assert "approval not usable" in first["problem"] and first["approved"] is False
    assert second["version"] == "1.10.0" and "problem" not in second


def _snapshot(base: Path) -> dict[str, bytes]:
    return {str(p.relative_to(base)): p.read_bytes() for p in sorted(base.rglob("*")) if p.is_file()}


def test_duplicate_creates_a_draft_and_leaves_the_original_untouched(kb, research_ref):  # noqa: F811
    doc, _ = save_version(kb, research_ref, "1.2.0")   # no owner_decisions: they name the version itself
    KEY = f"{NAME}/1.2.0"
    from galecore_ai.application.strategy import critique
    from tests.unit.test_strategy import critique_content
    critique(kb=kb, key=KEY, content=critique_content(), host=HOST, now=NOW)
    approve(kb=kb, key=KEY, owner_words="Apruebo", host=HOST, now=NOW)
    original = kb.strategies.path_for(KEY).parent
    before = _snapshot(original)
    ref, path = duplicate(kb=kb, key=KEY, new_name="copia_de_prueba", host=HOST, now=NOW, checker=fake_checker())
    assert _snapshot(original) == before
    assert ref == "strategy:copia_de_prueba/1.0.0" and Path(path).is_file()
    assert kb.strategies.load_approval("copia_de_prueba/1.0.0") is None
    assert kb.strategies.load_critique("copia_de_prueba/1.0.0") is None
    new = kb.strategies.load("copia_de_prueba/1.0.0")
    assert new.spec_file == "copia_de_prueba.json" and new.prompt == "strategy duplicate"
    spec = json.loads(new.spec_json)
    ident = spec["identity"]
    assert (ident["name"], ident["version"]) == ("copia_de_prueba", "1.0.0")
    assert ident["parent_version_hash"] == doc.spec_hash and ident["created_at"] == "2026-09-23T22:00:00Z"
    assert ident["id"] != json.loads(doc.spec_json)["identity"]["id"]
    assert spec["content_hash"] is None and new.spec_hash == galecore_spec_hash(new.spec_json)
    assert new.content.display_name.endswith(" (copia)") and new.content.change is None
    assert new.content.pending[-1].startswith(f"Duplicada de strategy:{KEY} (spec_hash {doc.spec_hash})")
    [v] = list_versions(kb, "copia_de_prueba")["versions"]
    assert v["approved"] is False and v["critique"] is None


def test_duplicate_rewrites_the_originals_own_version_as_1_0_0_in_the_copy(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)   # its approval question names strategy:<name>/1.0.3
    before = _snapshot(kb.base / "strategies" / NAME)
    duplicate(kb=kb, key=KEY, new_name="copia_de_prueba", host=HOST, now=NOW, checker=fake_checker())
    new = kb.strategies.load("copia_de_prueba/1.0.0")
    text = json.dumps(new.content.model_dump(mode="json")["owner_decisions"], ensure_ascii=False)
    assert "strategy:copia_de_prueba/1.0.0" in text and "1.0.3" not in text and f"{NAME}/" not in text
    assert "se reescribieron como 1.0.0" in new.content.pending[-1] and "1.0.3" in new.content.pending[-1]
    assert _snapshot(kb.base / "strategies" / NAME) == before          # the original is untouched
    assert "1.0.3" in json.dumps(doc.content.model_dump(mode="json")["owner_decisions"])


def test_duplicate_still_refuses_when_the_text_names_another_version(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    src = kb.strategies.load(KEY)
    other = src.content.model_copy(deep=True, update={"purpose": src.content.purpose + " Ver también la versión 0.9.0 anterior"})
    bad = src.model_copy(update={"content": other})
    import galecore_ai.application.strategy_versions as sv
    original = sv.load_proposal
    sv.load_proposal = lambda kb_, key_: bad
    try:
        with pytest.raises(KnowledgeError, match=r"name the versions \['0.9.0'\]"):
            duplicate(kb=kb, key=KEY, new_name="copia_de_prueba", host=HOST, now=NOW, checker=fake_checker())
    finally:
        sv.load_proposal = original
    assert kb.strategies.versions() == [KEY]


def test_duplicate_refuses_an_existing_name_or_a_bad_one(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    with pytest.raises(KnowledgeError, match="already has versions"):
        duplicate(kb=kb, key=KEY, new_name=NAME, host=HOST, now=NOW, checker=fake_checker())
    with pytest.raises(KnowledgeError, match="not a valid strategy name"):
        duplicate(kb=kb, key=KEY, new_name="Mala Copia", host=HOST, now=NOW, checker=fake_checker())
    with pytest.raises(KnowledgeError, match="no such strategy version"):
        duplicate(kb=kb, key=f"{NAME}/9.9.9", new_name="otra_copia", host=HOST, now=NOW, checker=fake_checker())


def test_cli_versions_and_duplicate_refusal(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    env = {KNOWLEDGE_DIR_ENV: str(kb.base)}
    code, out = _cli("strategy", "versions", "--name", NAME, env=env)
    assert code == 0 and [v["version"] for v in out["versions"]] == ["1.0.3"]
    code, out = _cli("strategy", "versions", "--name", "no_existe_nada", env=env)
    assert code == 0 and out == {"strategy": "no_existe_nada", "versions": []}
    code, out = _cli("strategy", "duplicate", "--ref", f"strategy:{KEY}", "--as", NAME, "--host-model", "t", env=env)
    assert code == 3 and out["status"] == "REJECTED"


# ── activar desde la ficha sin crítica (WS-0098): require_critique=False ──

def test_approve_and_deploy_without_critique_only_with_the_flag(kb, research_ref):  # noqa: F811
    from galecore_ai.application.strategy import deploy_check, deploy_strategy, galecore_deployer
    from tests.unit.fake_galecore import galecore_deploy_server
    from tests.unit.test_strategy import SESSION
    doc, _ = stored(kb, research_ref, criticised=False)
    with pytest.raises(KnowledgeError, match="no critique"):
        approve(kb=kb, key=KEY, owner_words="Apruebo", host=HOST, now=NOW)
    approval, _ = approve(kb=kb, key=KEY, owner_words="Apruebo", host=HOST, now=NOW, require_critique=False)
    assert approval.spec_hash == doc.spec_hash
    with pytest.raises(KnowledgeError) as exc:
        deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash)
    assert any(p.startswith("no critique of this version") for p in exc.value.problems)
    assert deploy_check(kb=kb, key=KEY, galecore_hash=doc.spec_hash, require_critique=False)["status"] == "DEPLOY_ALLOWED"
    with galecore_deploy_server() as (base, calls):
        with pytest.raises(KnowledgeError):
            deploy_strategy(kb=kb, key=KEY, deployer=galecore_deployer(base, session=SESSION))
        assert calls == []
        out = deploy_strategy(kb=kb, key=KEY, deployer=galecore_deployer(base, session=SESSION), require_critique=False)
    assert out["status"] == "DEPLOYED"


def test_without_critique_does_not_skip_the_other_approval_rules(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref, criticised=False)
    with pytest.raises(KnowledgeError, match="not this version's"):
        approve(kb=kb, key=KEY, spec_hash="sha256:" + "0" * 64, owner_words="Apruebo", host=HOST, now=NOW,
                require_critique=False)
    with pytest.raises(KnowledgeError, match="the owner's words name version"):
        approve(kb=kb, key=KEY, owner_words="Apruebo la 9.9.9", host=HOST, now=NOW, require_critique=False)
    assert kb.strategies.load_approval(KEY) is None and doc
