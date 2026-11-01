"""SKILL.md (WS-0054): frontmatter + sections; «Cómo responder» goes to the Lab, the rest is the method."""

import hashlib
import json

import pytest

from galecore_ai.harness.assets import definition_hash, skill_md
from galecore_ai.harness.definitions import SkillDefinition

TEXT = """---
name: capital-risk
version: 2.0.0
description: Qué capital hay.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Pasos
1. Correr `capital`.

## Cómo responder
Tablas primero.

## Errores a evitar
- Presentarlo como orden.
"""


def test_sections_split_into_method_and_answer():
    skill = SkillDefinition.model_validate(skill_md(TEXT))
    assert (skill.skill_id, skill.display_name, skill.version) == ("capital_risk", "capital-risk", "2.0.0")
    assert skill.answer == "Tablas primero."
    assert "## Pasos" in skill.system_prompt and "## Errores a evitar" in skill.system_prompt
    assert "Cómo responder" not in skill.system_prompt


def test_without_frontmatter_is_refused():
    with pytest.raises(ValueError):
        skill_md("## Pasos\n1. algo\n")


def test_an_empty_answer_keeps_the_hash_of_older_skills():
    base = {"skill_id": "x", "version": "1.0.0", "display_name": "x", "output_contract": "a.B"}
    assert definition_hash(SkillDefinition.model_validate(base)) != definition_hash(
        SkillDefinition.model_validate({**base, "answer": "algo"}))
    dumped = SkillDefinition.model_validate(base).model_dump(mode="json")
    for key in ("answer", "files", "allowed_tools", "model"):  # the fields added after the first hashes
        del dumped[key]
    content = json.dumps(dumped, sort_keys=True, separators=(",", ":"))
    assert definition_hash(SkillDefinition.model_validate(base)) == "sha256:" + hashlib.sha256(
        content.encode("utf-8")).hexdigest()


def test_line_endings_do_not_change_the_skill():
    assert skill_md(TEXT) == skill_md(TEXT.replace("\n", "\r\n"))
