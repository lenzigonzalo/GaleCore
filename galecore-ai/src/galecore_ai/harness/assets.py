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
    path = asset_root() / relative_path
    text = path.read_text(encoding="utf-8")
    return schema.model_validate(skill_md(text, skill_files(path.parent)) if relative_path.endswith(".md")
                                 else yaml.safe_load(text))


ANSWER_SECTION = "Cómo responder"


SKILL_FOLDERS = ("references", "scripts", "assets")


def skill_files(skill_dir: Path) -> dict[str, list[str]]:
    """The optional folders of a skill (WS-0073): folder → relative paths of its files (only those that exist)."""
    return {folder: sorted(f.relative_to(skill_dir).as_posix() for f in (skill_dir / folder).rglob("*") if f.is_file())
            for folder in SKILL_FOLDERS if (skill_dir / folder).is_dir()}


def folders_note(files: dict[str, list[str]]) -> str:
    """The short section the model gets when a skill has folders: what exists and how to use it."""
    lines = ["## Archivos de la skill"]
    if files.get("references"):
        lines.append("Referencias (leer sólo si hace falta): " + ", ".join(f"`{f}`" for f in files["references"]))
    if files.get("scripts"):
        lines.append("Scripts (no los leas: ejecutalos con `python -B -m galecore_ai.adapters.cli skill run <skill> <script> [args]`): "
                     + ", ".join(f"`{f.partition('/')[2]}`" for f in files["scripts"]))
    if files.get("assets"):
        lines.append("Plantillas: " + ", ".join(f"`{f}`" for f in files["assets"]))
    return "\n".join(lines) if len(lines) > 1 else ""


def skill_md(text: str, files: dict[str, list[str]] | None = None) -> dict:
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
    if not isinstance(meta, dict) or not meta.get("name"):
        raise ValueError("SKILL.md frontmatter needs a name")
    name = meta.pop("name")
    tools = meta.pop("allowed-tools", None)  # each engine adapter translates it (D-0014)
    if tools is not None:
        meta["allowed_tools"] = tools.split() if isinstance(tools, str) else tools
    files = {k: v for k, v in (files or {}).items() if v}
    note = folders_note(files)
    if files:
        meta["files"] = files
    if note:
        method = method.rstrip() + "\n\n" + note
    return {"skill_id": meta.pop("skill_id", name.replace("-", "_")), "display_name": meta.pop("display_name", name),
            **meta, "system_prompt": method.strip(), "answer": answer}


def definition_hash(definition: BaseModel) -> str:
    """Hash effective, loaded content (including explicit runtime overrides)."""
    import json

    dumped = definition.model_dump(mode="json")
    if dumped.get("answer") == "":  # a field added with SKILL.md (WS-0054): older skills keep their recorded hash
        del dumped["answer"]
    for key in ("files", "allowed_tools", "model"):  # added with skill folders (WS-0073): same rule
        if not dumped.get(key):
            dumped.pop(key, None)
    content = json.dumps(dumped, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()
