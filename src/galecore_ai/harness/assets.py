"""Load canonical cognitive assets from a checkout or the installed package."""

import hashlib
import re
from pathlib import Path
from typing import TypeVar

import yaml
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


def asset_root() -> Path:
    packaged = Path(__file__).resolve().parents[1] / "_assets"
    return packaged if packaged.is_dir() else Path(__file__).resolve().parents[3] / "config"


def load_asset(relative_path: str, schema: type[T]) -> T:
    text = (asset_root() / relative_path).read_text(encoding="utf-8")
    return schema.model_validate(skill_md(text) if relative_path.endswith(".md") else yaml.safe_load(text))


ANSWER_SECTION = "Cómo responder"


def skill_md(text: str) -> dict:
    """A SKILL.md (WS-0054, owner 21/10): frontmatter + sections in Spanish. «Cómo responder» is what the Lab pastes
    into the turn (`answer`); the rest of the body is the method (`system_prompt`), the same for any engine."""
    text = text.replace("\r\n", "\n")  # the same hash on any checkout (git may write CRLF on Windows)
    found = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.DOTALL)
    if not found:
        raise ValueError("SKILL.md without frontmatter (--- ... ---)")
    meta, body = yaml.safe_load(found.group(1)) or {}, found.group(2)
    parts = re.split(r"(?m)^## +", body)
    answer = next((p.split("\n", 1)[1].strip() for p in parts[1:] if p.startswith(ANSWER_SECTION)), "")
    method = parts[0] + "".join("## " + p for p in parts[1:] if not p.startswith(ANSWER_SECTION))
    name = meta.pop("name")
    return {"skill_id": meta.pop("skill_id", name.replace("-", "_")), "display_name": meta.pop("display_name", name),
            **meta, "system_prompt": method.strip(), "answer": answer}


def definition_hash(definition: BaseModel) -> str:
    """Hash effective, loaded content (including explicit runtime overrides)."""
    import json

    dumped = definition.model_dump(mode="json")
    if dumped.get("answer") == "":  # a field added with SKILL.md (WS-0054): older skills keep their recorded hash
        del dumped["answer"]
    content = json.dumps(dumped, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()
