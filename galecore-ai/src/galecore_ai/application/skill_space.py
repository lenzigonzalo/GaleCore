"""Skills with code kept in the trader's GaleCore space (WS-0099): ``skill save|pull`` and ``skill run`` from the space.

A space piece (kind ``skill``, format ``json``) holds a whole skill folder::

    {"format": "skill-folder/1", "name", "description", "version": <short sha256 of the files>, "files": {path: text}}

Only ``SKILL.md``, ``scripts/*.py``, ``references/*`` and ``assets/*`` (UTF-8 text) are accepted, and nothing that looks
like a key. Running one writes it to a cache by version and uses the same ``run_script`` as the catalog.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import tempfile
from pathlib import Path, PurePosixPath

import yaml

from galecore_ai.application.skill_run import SkillRunError, run_script

FORMAT = "skill-folder/1"
MAX_CHARS = 190_000
CACHE_ENV = "GALECORE_SKILLS_CACHE"
_OK_MARK = ".complete"
_SECRETS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}"),
    re.compile(r"\bgca_[A-Za-z0-9]{6,}"),
    re.compile(r"""(?i)(api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["'][^"'\s]{8,}["']"""),
)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def allowed_path(rel: str) -> bool:
    """SKILL.md, scripts/<name>.py, references/** or assets/**; never an escaping or hidden path."""
    parts = PurePosixPath(rel).parts
    if not parts or rel.startswith("/") or "\\" in rel or any(p in ("", ".", "..") for p in parts):
        return False
    if parts == ("SKILL.md",):
        return True
    if parts[0] == "scripts":
        return len(parts) == 2 and parts[1].endswith(".py")
    return parts[0] in ("references", "assets") and len(parts) >= 2


def version_of(files: dict[str, str]) -> str:
    h = hashlib.sha256()
    for path in sorted(files):
        h.update(path.encode("utf-8") + b"\0" + files[path].encode("utf-8") + b"\0")
    return h.hexdigest()[:12]


def frontmatter(skill_md: str) -> dict:
    found = re.match(r"\A---\n(.*?)\n---\n", skill_md.replace("\r\n", "\n"), re.DOTALL)
    meta = yaml.safe_load(found.group(1)) if found else None
    if not isinstance(meta, dict) or not meta.get("name") or not meta.get("description"):
        raise SkillRunError("SKILL.md needs frontmatter with name and description")
    return {"name": str(meta["name"]), "description": " ".join(str(meta["description"]).split())}


def check_secrets(files: dict[str, str]) -> None:
    current = os.environ.get("GALECORE_API_KEY", "")
    for path, text in files.items():
        if (len(current) >= 8 and current in text) or any(p.search(text) for p in _SECRETS):
            raise SkillRunError(f"{path}: parece contener una clave; sacala (los scripts leen el entorno)")


def read_folder(folder: Path) -> dict[str, str]:
    """The folder's files as {relative path: text}; refuses anything outside the format."""
    if not (folder / "SKILL.md").is_file():
        raise SkillRunError(f"{folder}: falta SKILL.md")
    files: dict[str, str] = {}
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        rel = path.relative_to(folder).as_posix()
        if "__pycache__" in path.parts:
            continue
        if not allowed_path(rel):
            raise SkillRunError(f"{rel}: ruta no permitida (sólo SKILL.md, scripts/*.py, references/*, assets/*)")
        data = path.read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        if text is None or "\0" in text:
            raise SkillRunError(f"{rel}: es binario; sólo texto UTF-8")
        files[rel] = text
    return files


def build_content(files: dict[str, str]) -> tuple[str, dict]:
    """Validate and serialize; returns (json text, header)."""
    meta = frontmatter(files["SKILL.md"])
    check_secrets(files)
    header = {"format": FORMAT, **meta, "version": version_of(files)}
    content = json.dumps({**header, "files": files}, ensure_ascii=False, sort_keys=True)
    if len(content) > MAX_CHARS:
        raise SkillRunError(f"la skill pesa {len(content)} caracteres; el máximo es {MAX_CHARS}")
    return content, header


def write_files(files: dict[str, str], dest: Path) -> None:
    for rel, text in files.items():
        if not allowed_path(rel):
            raise SkillRunError(f"{rel}: ruta no permitida en la skill")
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")


def parse_piece(piece: dict) -> dict | None:
    """The folder content of a space piece, or None when it is a plain markdown skill."""
    if piece.get("format") != "json":
        return None
    try:
        data = json.loads(piece.get("content") or "")
    except (TypeError, ValueError):
        return None
    if isinstance(data, dict) and data.get("format") == FORMAT and isinstance(data.get("files"), dict):
        return data
    return None


def run_test(files: dict[str, str], spec: str, timeout_s: float = 120) -> dict:
    """Run ``"<script> [args]"`` from a temporary copy; it must exit 0 with JSON on stdout."""
    parts = shlex.split(spec)
    if not parts:
        raise SkillRunError("--test needs a script name")
    with tempfile.TemporaryDirectory(prefix="skill-test-") as tmp:
        folder = Path(tmp) / "skill"
        write_files(files, folder)
        result = run_script(folder, parts[0], parts[1:], timeout_s)
    if not result["ok"] or "result" not in result:
        detail = result.get("error") or (result.get("stderr") or "").strip()[-300:] or "sin JSON en la salida"
        raise SkillRunError(f"la prueba de {parts[0]} falló, no se sube: {detail}")
    return result


def save(client, folder: Path, *, key: str | None = None, shared: bool = False, test: str | None = None) -> dict:
    files = read_folder(folder)
    content, header = build_content(files)
    if test:
        run_test(files, test)
    key = key or slug(header["name"])
    if not key:
        raise SkillRunError("no se pudo armar una clave; usá --key")
    visibility = "shared" if shared else "private"
    client.put("skill", key, title=header["name"], content=content, fmt="json", visibility=visibility)
    return {"status": "SAVED", "key": key, "version": header["version"], "visibility": visibility,
            "tested": bool(test), "files": sorted(files)}


def find_piece(client, key: str) -> dict:
    """Own piece first, then shared by others."""
    data = client.items("skill")
    for piece in [*data["items"], *data["shared"]]:
        if piece["key"] == key:
            return piece
    raise SkillRunError(f"No skill {key!r} in the catalog or in your space")


def folder_of(piece: dict) -> dict:
    data = parse_piece(piece)
    if data is None:
        raise SkillRunError("esa skill no tiene scripts")
    return data


def pull(client, key: str, dest: Path) -> dict:
    data = folder_of(find_piece(client, key))
    write_files(data["files"], dest)
    return {"status": "PULLED", "key": key, "version": data.get("version"), "dir": str(dest),
            "files": sorted(data["files"])}


def cache_root() -> Path:
    configured = os.environ.get(CACHE_ENV)
    return Path(configured).expanduser() if configured else Path.home() / ".cache" / "galecore" / "skills"


def materialize(client, key: str, finder=None) -> tuple[Path, str]:
    """Folder (cached by version) of a space skill and its version. `finder(key)` replaces the space lookup (the
    cloud routine reads the skill with its agents key, without a login)."""
    data = folder_of(finder(key) if finder else find_piece(client, key))
    files = data["files"]
    version = version_of(files)   # recomputed: never trust the stored header for the cache name
    folder = cache_root() / key / version
    if not (folder / _OK_MARK).is_file():
        write_files(files, folder)
        (folder / _OK_MARK).write_text(version, encoding="utf-8")
    return folder, version


def scripts_of(data: dict) -> list[str]:
    return sorted(Path(p).name for p in data["files"] if p.startswith("scripts/"))
