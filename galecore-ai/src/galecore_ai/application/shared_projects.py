"""Shared projects (WS-0064 Fase 2b): a project folder that two or more traders keep in sync through GaleCore.

Every PC keeps its own copy of the files; GaleCore only relays *changes* (put/delete of one file) between the members.
Each shared project folder holds ``.sync.json`` (``{sharedProjectId, lastSeq, files: {path: sha256}}``): ``files`` is
what both sides had at the last sync, so a file whose local hash still equals it is untouched here and a remote change
can be applied; if it differs, both sides edited it and nothing is lost: the local version stays next to it as
``<name> (conflicto <usuario> <fecha>).<ext>`` and the remote one takes the original path.

``.sync.json``, ``.scratch/``, ``.git/`` (and caches) are never synced. ``.sync.json`` is per PC, so it is also kept out
of the knowledge base's git (``.git/info/exclude``): restoring an old commit must not roll the cursor back.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from datetime import date, datetime
from pathlib import Path, PurePosixPath

from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError

SYNC_FILE = ".sync.json"
KIND_FOLDERS = {"workspace": "workspaces", "strategy": "strategies"}
SKIP_DIRS = {".git", ".scratch", "node_modules", "__pycache__"}
MAX_BYTES = 2 * 1024 * 1024
MAX_PATH = 400
MAX_ROUNDS = 3
_KEY_RE = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")


class SharedProjectError(Exception):
    """A shared-project request that cannot be done; the message says why."""


# -- local state --------------------------------------------------------------------------------------------------

def load_state(project_dir: Path) -> dict | None:
    try:
        data = json.loads((project_dir / SYNC_FILE).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise SharedProjectError(f"{project_dir.name}/{SYNC_FILE} is unreadable; not overwritten") from exc
    if not isinstance(data, dict) or not data.get("sharedProjectId"):
        raise SharedProjectError(f"{project_dir.name}/{SYNC_FILE} has no sharedProjectId")
    data.setdefault("lastSeq", 0)
    data.setdefault("files", {})
    return data


def save_state(project_dir: Path, state: dict) -> None:
    tmp = project_dir / (SYNC_FILE + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, project_dir / SYNC_FILE)


def _exclude_from_git(project_dir: Path) -> None:
    """Keep ``.sync.json`` out of the knowledge base's git (idempotent, local to this PC)."""
    for parent in (project_dir, *project_dir.parents):
        info = parent / ".git" / "info"
        if (parent / ".git").is_dir():
            try:
                info.mkdir(exist_ok=True)
                exclude = info / "exclude"
                lines = exclude.read_text(encoding="utf-8").splitlines() if exclude.exists() else []
                if "**/" + SYNC_FILE not in lines:
                    exclude.write_text("\n".join([*lines, "**/" + SYNC_FILE]) + "\n", encoding="utf-8")
            except OSError:
                pass
            return


def find_project(kb_base: Path, key: str) -> Path:
    if not _KEY_RE.match(key):
        raise SharedProjectError(f"{key!r} is not a project key")
    found = [kb_base / folder / key for folder in KIND_FOLDERS.values() if (kb_base / folder / key).is_dir()]
    if not found:
        raise SharedProjectError(f"no project {key} in workspaces/ or strategies/")
    if len(found) > 1:
        raise SharedProjectError(f"{key} exists as workspace and as strategy; rename one first")
    return found[0]


def _kind_of(project_dir: Path) -> str:
    return "strategy" if project_dir.parent.name == "strategies" else "workspace"


def _label_of(project_dir: Path) -> str:
    try:
        label = json.loads((project_dir / "workspace.json").read_text(encoding="utf-8")).get("label")
        if isinstance(label, str) and label.strip():
            return label.strip()[:100]
    except (OSError, ValueError, AttributeError):
        pass
    return project_dir.name


# -- files ---------------------------------------------------------------------------------------------------------

def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _local_hash(target: Path) -> str | None:
    try:
        return _sha(target.read_bytes()) if target.is_file() and not target.is_symlink() else None
    except OSError:
        return None


def _encode(data: bytes) -> tuple[str, str]:
    """Text travels as utf8, anything else (or text with NULs) as base64."""
    try:
        text = data.decode("utf-8")
        if "\x00" not in text:
            return "utf8", text
    except UnicodeDecodeError:
        pass
    return "base64", base64.b64encode(data).decode("ascii")


def _decode(change: dict) -> bytes:
    content = change.get("content")
    if content is None:
        raise ValueError("the change has no content")
    data = content.encode("utf-8") if change.get("encoding", "utf8") == "utf8" else base64.b64decode(content)
    if change.get("contentHash") and _sha(data) != change["contentHash"]:
        raise ValueError("the content does not match its hash")
    return data


def _valid_path(rel: str) -> bool:
    return 0 < len(rel) <= MAX_PATH and not any(ord(c) < 32 for c in rel)


def _scan(project_dir: Path) -> dict[str, Path]:
    """Every syncable file: relative POSIX path -> absolute path."""
    out: dict[str, Path] = {}
    for root, dirs, names in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (Path(root) / d).is_symlink()]
        for name in names:
            full = Path(root) / name
            if name in (SYNC_FILE, SYNC_FILE + ".tmp") or full.is_symlink():
                continue
            out[full.relative_to(project_dir).as_posix()] = full
    return out


def _conflict_name(path: str, author: str, day: date, taken) -> str:
    p = PurePosixPath(path)
    base = f"{p.stem} (conflicto {author} {day:%Y-%m-%d})"
    candidate, n = p.with_name(base + p.suffix), 2
    while taken(candidate.as_posix()):
        candidate = p.with_name(f"{base} {n}{p.suffix}")
        n += 1
    return candidate.as_posix()


def _prune_empty(project_dir: Path, folder: Path) -> None:
    while folder != project_dir and folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()
        folder = folder.parent


class _Run:
    """One sync of one project: its folder, state and what happened."""

    def __init__(self, client: SpaceClient, project_dir: Path, state: dict, today: date) -> None:
        self.client, self.dir, self.state, self.today = client, project_dir, state, today
        self.pulled: set[str] = set()
        self.pushed: set[str] = set()
        self.conflicts: list[dict] = []
        self.skipped: list[dict] = []

    @property
    def files(self) -> dict:
        return self.state["files"]

    def skip(self, path: str, reason: str) -> None:
        if not any(s["path"] == path and s["reason"] == reason for s in self.skipped):
            self.skipped.append({"path": path, "reason": reason})

    def write(self, path: str, data: bytes) -> None:
        target = self.dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    # A change that comes from the other side (pulled, or the `latest` of a 409).
    def apply(self, ch: dict) -> None:
        path, author = ch["path"], ch.get("author") or "otro"
        if not _valid_path(path) or Path(path).is_absolute() or ".." in PurePosixPath(path).parts:
            return self.skip(path, "ruta no válida")
        target, base, cur = self.dir / path, self.files.get(path), _local_hash(self.dir / path)
        if ch["op"] == "put":
            data = _decode(ch)
            new = ch["contentHash"]
            if new == base:                                   # nothing new from the other side
                return
            if cur == new:
                self.files[path] = new
                return
            if cur == base:                                   # untouched here since the last sync: just take it
                self.write(path, data)
                self.files[path] = new
                self.pulled.add(path)
                return
            if cur is None:                                   # deleted here, edited there: the edit wins
                self.write(path, data)
                self.files[path] = new
                self.pulled.add(path)
                self.conflicts.append({"path": path, "with": author, "copy": None, "kind": "borrado-aquí"})
                return
            copy = _conflict_name(path, author, self.today, lambda c: (self.dir / c).exists())
            (self.dir / copy).write_bytes(target.read_bytes())   # edited on both sides: both versions stay
            self.write(path, data)
            self.files[path] = new
            self.pulled.add(path)
            self.conflicts.append({"path": path, "with": author, "copy": copy, "kind": "editado-en-ambos"})
            return
        if cur is None:                                       # delete
            self.files.pop(path, None)
        elif cur == base:
            target.unlink()
            _prune_empty(self.dir, target.parent)
            self.files.pop(path, None)
            self.pulled.add(path)
        else:                                                 # edited here, deleted there: ours stays and goes up as new
            self.files.pop(path, None)
            if base is not None:
                self.conflicts.append({"path": path, "with": author, "copy": None, "kind": "borrado-allá"})

    def pull(self) -> None:
        while True:
            page = self.client.shared_changes(self.state["sharedProjectId"], self.state["lastSeq"])
            mine = set(self.state.get("pushedSeqs", []))
            for ch in page["changes"]:
                if ch["seq"] not in mine:                  # what I pushed from this PC is already in `files`
                    try:
                        self.apply(ch)
                    except (OSError, ValueError) as exc:
                        self.skip(ch["path"], f"no se pudo aplicar: {type(exc).__name__}")
                self.state["lastSeq"] = ch["seq"]
            self.state["pushedSeqs"] = [s for s in self.state.get("pushedSeqs", []) if s > self.state["lastSeq"]]
            if not page.get("hasMore") or not page["changes"]:
                return

    def push(self) -> bool:
        """Upload what changed here. True if the server answered a conflict (the caller pulls again and retries)."""
        pid, conflicted = self.state["sharedProjectId"], False
        local = _scan(self.dir)
        todo: list[tuple[str, Path | None, str | None]] = []   # path, file (None = deleted), hash
        for path, full in local.items():
            if not _valid_path(path):
                self.skip(path, "ruta no válida")
                continue
            try:
                size = full.stat().st_size
                if size > MAX_BYTES:
                    self.skip(path, "mayor a 2 MB")
                    continue
                digest = _sha(full.read_bytes())
            except OSError:
                self.skip(path, "no se pudo leer")
                continue
            if self.files.get(path) != digest:
                todo.append((path, full, digest))
        todo += [(p, None, None) for p in self.files if p not in local]
        for path, full, digest in sorted(todo, key=lambda t: t[0]):
            base = self.files.get(path)
            change: dict = {"path": path, "baseHash": base}
            if full is None:
                change["op"] = "delete"
            else:
                encoding, content = _encode(full.read_bytes())
                change.update(op="put", encoding=encoding, content=content)
            try:
                answer = self.client.shared_push(pid, change)
            except SpaceError as exc:
                if exc.status == 409:
                    conflicted = True
                    latest = exc.body.get("latest")
                    if latest:
                        try:
                            self.apply(latest)
                        except (OSError, ValueError) as err:
                            self.skip(path, f"no se pudo aplicar: {type(err).__name__}")
                    else:
                        self.files.pop(path, None)
                    continue
                if exc.status == 400:
                    self.skip(path, "GaleCore lo rechazó")
                    continue
                raise
            if full is None:
                self.files.pop(path, None)
            else:
                self.files[path] = answer.get("contentHash") or digest
            self.state.setdefault("pushedSeqs", []).append(answer["seq"])
            self.pushed.add(path)
        return conflicted


def sync_project(client: SpaceClient, project_dir: Path, *, today: date | None = None) -> dict:
    """Pull what others changed, then push what changed here. Returns {pulled, pushed, conflicts, skipped}."""
    state = load_state(project_dir)
    if state is None:
        raise SharedProjectError(f"{project_dir.name} is not shared (no {SYNC_FILE})")
    if client.user is None:
        client.login()
    _exclude_from_git(project_dir)
    run = _Run(client, project_dir, state, today or datetime.now().astimezone().date())
    try:
        for _ in range(MAX_ROUNDS):
            run.pull()
            if not run.push():
                break
    except SpaceError as exc:
        if exc.status == 404:   # GaleCore answers 404 to a non-member: the owner unshared it (or it was deleted)
            raise SharedProjectError(f"ya no tenés acceso a {project_dir.name}: el dueño dejó de compartirlo o lo borró. "
                                     "Tu copia local queda como está (sin sincronizar).") from exc
        raise
    finally:
        save_state(project_dir, state)
    return {"pulled": len(run.pulled), "pushed": len(run.pushed), "conflicts": run.conflicts, "skipped": run.skipped}


# -- commands ------------------------------------------------------------------------------------------------------

def _members(client: SpaceClient, project_id: str) -> list[dict]:
    mine = next((p for p in client.shared_projects() if p["id"] == project_id), None)
    return mine["members"] if mine else []


def share(client: SpaceClient, kb_base: Path, key: str, username: str) -> dict:
    project_dir = find_project(kb_base, key)
    if client.user is None:
        client.login()
    state = load_state(project_dir)
    fresh = state is None
    if fresh:
        created = client.shared_create(_label_of(project_dir), _kind_of(project_dir), key)
        state = {"sharedProjectId": created["id"], "lastSeq": 0, "files": {}}
        save_state(project_dir, state)
    try:
        client.shared_add_member(state["sharedProjectId"], username)
    except SpaceError as exc:
        if fresh:    # a failed first share leaves nothing behind: no remote project with only the owner, no local state
            try:
                client.shared_delete(state["sharedProjectId"])
            except SpaceError:
                pass
            else:
                (project_dir / SYNC_FILE).unlink(missing_ok=True)
        if exc.status in (403, 404):
            raise SharedProjectError(str(exc.body.get("error") or "no se pudo sumar al miembro")) from exc
        raise
    result = sync_project(client, project_dir)
    return {"status": "SHARED", "project": key, "shared_project_id": state["sharedProjectId"],
            "members": _members(client, state["sharedProjectId"]), "sync": result}


def unshare(client: SpaceClient, kb_base: Path, key: str, username: str) -> dict:
    project_dir = find_project(kb_base, key)
    state = load_state(project_dir)
    if state is None:
        raise SharedProjectError(f"{key} is not shared")
    try:
        client.shared_remove_member(state["sharedProjectId"], username)
    except SpaceError as exc:
        if exc.status in (400, 403, 404):
            raise SharedProjectError(str(exc.body.get("error") or f"{username} no es miembro de {key}")) from exc
        raise
    return {"status": "UNSHARED", "project": key, "members": _members(client, state["sharedProjectId"])}


def _local_index(kb_base: Path) -> dict[str, Path]:
    """sharedProjectId -> local folder, for every folder that carries a .sync.json."""
    index: dict[str, Path] = {}
    for folder in KIND_FOLDERS.values():
        base = kb_base / folder
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if d.is_dir() and (d / SYNC_FILE).is_file():
                try:
                    state = load_state(d)
                except SharedProjectError:
                    continue
                if state:
                    index[state["sharedProjectId"]] = d
    return index


def list_shared(client: SpaceClient, kb_base: Path) -> dict:
    if client.user is None:
        client.login()
    index = _local_index(kb_base)
    projects = []
    for p in client.shared_projects():
        local = index.get(p["id"])
        projects.append({**p, "mine": p.get("owner") == client.user, "local": local.name if local else None})
    return {"user": client.user, "projects": projects}


def _create_local(kb_base: Path, remote: dict) -> Path | None:
    key = remote.get("localKey", "")
    if remote.get("kind") not in KIND_FOLDERS or not _KEY_RE.match(key):
        return None
    folder = kb_base / KIND_FOLDERS[remote["kind"]] / key
    if folder.exists():
        return None
    folder.mkdir(parents=True)
    save_state(folder, {"sharedProjectId": remote["id"], "lastSeq": 0, "files": {}})
    return folder


def _ensure_descriptor(project_dir: Path, remote: dict) -> None:
    """The Lab lists a folder as a project by its workspace.json; the owner's own one arrives with the files."""
    if (project_dir / "workspace.json").exists():
        return
    strategy = _kind_of(project_dir) == "strategy"
    meta = {"id": project_dir.name, "label": remote.get("name") or project_dir.name,
            "type": "strategy" if strategy else "analysis",
            "relative": f"{project_dir.parent.name}/{project_dir.name}",
            "strategyName": project_dir.name if strategy else None}
    (project_dir / "workspace.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def sync_all(client: SpaceClient, kb_base: Path) -> dict:
    """Sync every shared project; the ones shared with me that I do not have yet get their folder first."""
    if client.user is None:
        client.login()
    index = _local_index(kb_base)
    out: dict = {"projects": {}, "created": [], "skipped": [], "errors": {}}
    for remote in client.shared_projects():
        folder, fresh = index.get(remote["id"]), False
        if folder is None:
            folder = _create_local(kb_base, remote)
            if folder is None:
                out["skipped"].append({"project": remote["name"], "reason": f"ya existe una carpeta local «{remote.get('localKey')}» o su nombre no es válido"})
                continue
            fresh = True
        try:
            out["projects"][folder.name] = sync_project(client, folder)
            if fresh:
                _ensure_descriptor(folder, remote)
                out["created"].append(folder.name)
        except (SpaceError, SharedProjectError) as exc:
            out["errors"][folder.name] = str(exc)
    return out
