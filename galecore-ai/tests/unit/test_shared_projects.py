"""WS-0064 Fase 2b: shared-project sync (pull, push, conflicts) against a fake GaleCore with the API's rules."""

from __future__ import annotations

import base64
import hashlib
import json
from itertools import count

import httpx
import pytest

from galecore_ai.adapters.galecore_space import SpaceClient
from galecore_ai.application import shared_projects as sp


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class FakeGaleCore:
    """Users, shared projects, members and an append-only change log; `Decide` is the server's conflict rule."""

    def __init__(self):
        self.projects: dict[str, dict] = {}
        self.changes: dict[str, list[dict]] = {}
        self.seq = count(1)
        self.users = {"demo", "gonza"}

    def client(self, user: str) -> SpaceClient:
        c = SpaceClient("http://galecore.test", "k", transport=httpx.MockTransport(lambda r: self.handle(r)))
        c.login(user, "pw")
        return c

    @staticmethod
    def _user(request: httpx.Request) -> str:
        return request.headers["Authorization"].removeprefix("Bearer tok-")

    def handle(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        if path == "/App/GaleCore/Auth/Login":
            return httpx.Response(200, json={"accessToken": "tok-" + json.loads(request.content)["username"]})
        me = self._user(request)
        root = "/App/GaleCore/SharedProjects"
        body = json.loads(request.content) if request.content else {}
        if path == root and method == "POST":
            pid = f"p{len(self.projects) + 1}"
            self.projects[pid] = {"id": pid, "name": body["name"], "kind": body["kind"], "localKey": body["localKey"],
                                  "owner": me, "members": [{"username": me, "displayName": None, "role": "owner"}]}
            self.changes[pid] = []
            return httpx.Response(201, json=self.projects[pid])
        if path == root and method == "GET":
            mine = [{**p, "lastSeq": 0} for p in self.projects.values() if any(m["username"] == me for m in p["members"])]
            return httpx.Response(200, json={"projects": mine})
        parts = path.removeprefix(root + "/").split("/")
        proj = self.projects[parts[0]]
        if not any(m["username"] == me for m in proj["members"]):
            return httpx.Response(404)
        if len(parts) == 1 and method == "DELETE":
            self.projects.pop(parts[0])
            return httpx.Response(204)
        if parts[1] == "members" and method == "POST":
            if body["username"] not in self.users:
                return httpx.Response(404, json={"error": f"no existe el usuario '{body['username']}'"})
            if all(m["username"] != body["username"] for m in proj["members"]):
                proj["members"].append({"username": body["username"], "displayName": None, "role": "member"})
            return httpx.Response(200, json={"username": body["username"], "role": "member"})
        if parts[1] == "members" and method == "DELETE":
            proj["members"] = [m for m in proj["members"] if m["username"] != parts[2]]
            return httpx.Response(204)
        log = self.changes[parts[0]]
        if method == "GET":
            after = int(request.url.params["after"])
            rows = [c for c in log if c["seq"] > after]
            return httpx.Response(200, json={"changes": rows[:2], "hasMore": len(rows) > 2})   # 2 per page: paging is exercised
        return self.post_change(log, me, body)

    def post_change(self, log: list[dict], me: str, body: dict) -> httpx.Response:
        latest = next((c for c in reversed(log) if c["path"] == body["path"]), None)
        if body["op"] == "put":
            raw = body["content"].encode() if body["encoding"] == "utf8" else base64.b64decode(body["content"])
            assert len(raw) <= 2 * 1024 * 1024
            new = sha(raw)
        else:
            new = None
        base = body.get("baseHash")
        if latest is None or latest["op"] == "delete":
            outcome = "accept" if base is None else "conflict"
        elif body["op"] == "put" and new == latest["contentHash"]:
            outcome = "noop"
        else:
            outcome = "accept" if base == latest["contentHash"] else "conflict"
        if outcome == "conflict":
            return httpx.Response(409, json={"error": "la copia no parte del último contenido", "latest": latest})
        if outcome == "noop":
            return httpx.Response(200, json={"seq": latest["seq"], "contentHash": latest["contentHash"]})
        change = {"seq": next(self.seq), "path": body["path"], "op": body["op"], "encoding": body.get("encoding", "utf8"),
                  "content": body.get("content"), "contentHash": new, "baseHash": base, "author": me}
        log.append(change)
        return httpx.Response(201, json={"seq": change["seq"], "contentHash": new})


@pytest.fixture
def world(tmp_path):
    """The fake server, two knowledge bases (one per PC) and a client per user."""
    fake = FakeGaleCore()
    a, b = tmp_path / "pc_a", tmp_path / "pc_b"
    for kb in (a, b):
        (kb / "workspaces").mkdir(parents=True)
        (kb / "strategies").mkdir()
    return fake, a, b, fake.client("demo"), fake.client("gonza")


def write(base, rel, text):
    f = base / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text, encoding="utf-8")


def read(base, rel):
    return (base / rel).read_text(encoding="utf-8")


def test_share_uploads_every_file_and_adds_the_member(world):
    fake, a, _, ca, _ = world
    write(a, "workspaces/idea/README.md", "hola")
    write(a, "workspaces/idea/memory/tema.md", "criterio")
    write(a, "workspaces/idea/.scratch/tmp.json", "no")
    write(a, "workspaces/idea/.git/HEAD", "no")
    (a / "workspaces/idea/foto.bin").write_bytes(b"\x89PNG\x00\xff")
    out = sp.share(ca, a, "idea", "gonza")
    assert out["status"] == "SHARED" and [m["username"] for m in out["members"]] == ["demo", "gonza"]
    assert out["sync"]["pushed"] == 3 and out["sync"]["conflicts"] == []
    assert sorted(c["path"] for c in fake.changes["p1"]) == ["README.md", "foto.bin", "memory/tema.md"]
    assert next(c for c in fake.changes["p1"] if c["path"] == "foto.bin")["encoding"] == "base64"
    state = json.loads((a / "workspaces/idea/.sync.json").read_text())
    assert state["sharedProjectId"] == "p1" and state["files"]["README.md"] == sha(b"hola")
    assert fake.projects["p1"]["kind"] == "workspace" and fake.projects["p1"]["localKey"] == "idea"


def test_share_with_an_unknown_user_says_so(world):
    _, a, _, ca, _ = world
    write(a, "strategies/spy_ic/README.md", "x")
    with pytest.raises(sp.SharedProjectError, match="no existe el usuario"):
        sp.share(ca, a, "spy_ic", "nadie")


def test_a_failed_first_share_leaves_nothing_behind(world):
    fake, a, _, ca, _ = world
    write(a, "strategies/spy_ic/README.md", "x")
    with pytest.raises(sp.SharedProjectError):
        sp.share(ca, a, "spy_ic", "nadie")
    assert fake.projects == {} and not (a / "strategies/spy_ic/.sync.json").exists()
    sp.share(ca, a, "spy_ic", "gonza")    # and the retry with a valid user works from scratch
    assert [m["username"] for m in fake.projects["p1"]["members"]] == ["demo", "gonza"]


def test_a_failed_share_of_an_already_shared_project_keeps_it(world):
    fake, a, _, ca, _ = world
    write(a, "workspaces/idea/README.md", "x")
    sp.share(ca, a, "idea", "gonza")
    with pytest.raises(sp.SharedProjectError):
        sp.share(ca, a, "idea", "nadie")
    assert "p1" in fake.projects and (a / "workspaces/idea/.sync.json").exists()


def test_sync_all_creates_the_folder_of_a_project_shared_with_me(world):
    _fake, a, b, ca, cb = world
    write(a, "strategies/spy_ic/README.md", "estrategia")
    write(a, "strategies/spy_ic/workspace.json", json.dumps({"id": "spy_ic", "label": "SPY IC", "type": "strategy"}))
    sp.share(ca, a, "spy_ic", "gonza")
    out = sp.sync_all(cb, b)
    assert out["created"] == ["spy_ic"] and out["errors"] == {} and out["projects"]["spy_ic"]["pulled"] == 2
    assert read(b, "strategies/spy_ic/README.md") == "estrategia"
    assert (b / "strategies/spy_ic/.sync.json").is_file()


def test_sync_all_gives_the_descriptor_when_the_owner_had_none(world):
    _, a, b, ca, cb = world
    write(a, "workspaces/idea/README.md", "x")
    sp.share(ca, a, "idea", "gonza")
    sp.sync_all(cb, b)
    meta = json.loads(read(b, "workspaces/idea/workspace.json"))
    assert meta["id"] == "idea" and meta["type"] == "analysis" and meta["relative"] == "workspaces/idea"


def test_sync_all_does_not_touch_a_local_folder_with_the_same_name(world):
    _, a, b, ca, cb = world
    write(a, "workspaces/idea/README.md", "de A")
    sp.share(ca, a, "idea", "gonza")
    write(b, "workspaces/idea/README.md", "mío")
    out = sp.sync_all(cb, b)
    assert out["created"] == [] and "ya existe" in out["skipped"][0]["reason"]
    assert read(b, "workspaces/idea/README.md") == "mío" and not (b / "workspaces/idea/.sync.json").exists()


def shared_pair(world, files=None):
    fake, a, b, ca, cb = world
    meta = json.dumps({"id": "idea", "label": "Idea", "type": "analysis"})
    for rel, text in (files or {"README.md": "uno", "memory/n.md": "nota", "workspace.json": meta}).items():
        write(a, "workspaces/idea/" + rel, text)
    sp.share(ca, a, "idea", "gonza")
    sp.sync_all(cb, b)
    return fake, a / "workspaces/idea", b / "workspaces/idea", ca, cb


def test_a_remote_update_is_applied_when_the_local_file_is_untouched(world):
    _, da, db, ca, cb = shared_pair(world)
    (da / "README.md").write_text("dos", encoding="utf-8")
    assert sp.sync_project(ca, da)["pushed"] == 1
    out = sp.sync_project(cb, db)
    assert out["pulled"] == 1 and out["pushed"] == 0 and out["conflicts"] == []
    assert read(db.parent.parent, "workspaces/idea/README.md") == "dos"


def test_new_and_deleted_files_travel(world):
    _, da, db, ca, cb = shared_pair(world)
    write(da, "files/nuevo.md", "n")
    (da / "memory/n.md").unlink()
    out = sp.sync_project(ca, da)
    assert out["pushed"] == 2
    sp.sync_project(cb, db)
    assert (db / "files/nuevo.md").read_text(encoding="utf-8") == "n"
    assert not (db / "memory").exists()           # the emptied folder goes with its last file
    assert sp.sync_project(cb, db) == {"pulled": 0, "pushed": 0, "conflicts": [], "skipped": []}   # nothing left to do


def test_both_edited_keeps_two_versions_and_both_sides_converge(world):
    _fake, da, db, ca, cb = shared_pair(world)
    (da / "README.md").write_text("de demo", encoding="utf-8")
    sp.sync_project(ca, da)
    (db / "README.md").write_text("de gonza", encoding="utf-8")
    out = sp.sync_project(cb, db)                 # pulls demo's edit while gonza had edited too
    assert [c["path"] for c in out["conflicts"]] == ["README.md"] and out["conflicts"][0]["with"] == "demo"
    assert out["conflicts"][0]["copy"].startswith("README (conflicto demo ") and out["conflicts"][0]["copy"].endswith(").md")
    copy = out["conflicts"][0]["copy"]
    assert (db / "README.md").read_text(encoding="utf-8") == "de demo"       # the remote one takes the path
    assert (db / copy).read_text(encoding="utf-8") == "de gonza"             # the local one is kept beside it
    assert out["pushed"] == 1                                                 # and the copy goes up as a new file
    sp.sync_project(ca, da)
    assert (da / copy).read_text(encoding="utf-8") == "de gonza" and (da / "README.md").read_text(encoding="utf-8") == "de demo"


def test_a_push_that_loses_the_race_gets_a_409_and_is_resolved(world):
    fake, da, db, ca, cb = shared_pair(world)
    (da / "README.md").write_text("de demo", encoding="utf-8")
    (db / "README.md").write_text("de gonza", encoding="utf-8")
    sp.sync_project(ca, da)                       # demo goes first
    # gonza's pull happens to see nothing new yet (cursor ahead of the change): force the 409 path on the push
    state = json.loads((db / ".sync.json").read_text())
    state["lastSeq"] = max(c["seq"] for c in fake.changes["p1"])
    (db / ".sync.json").write_text(json.dumps(state))
    out = sp.sync_project(cb, db)
    assert len(out["conflicts"]) == 1 and out["conflicts"][0]["with"] == "demo"
    assert (db / "README.md").read_text(encoding="utf-8") == "de demo"
    assert any("conflicto demo" in p.name for p in db.iterdir())
    assert out["pushed"] == 1                     # the conflict copy


def test_edited_here_and_deleted_there_keeps_mine(world):
    _, da, db, ca, cb = shared_pair(world)
    (da / "memory/n.md").unlink()
    sp.sync_project(ca, da)
    (db / "memory/n.md").write_text("editada", encoding="utf-8")
    out = sp.sync_project(cb, db)
    assert out["conflicts"][0]["kind"] == "borrado-allá" and (db / "memory/n.md").read_text(encoding="utf-8") == "editada"
    sp.sync_project(ca, da)
    assert (da / "memory/n.md").read_text(encoding="utf-8") == "editada"      # it came back up as a new file


def test_deleted_here_and_edited_there_restores_the_edit(world):
    _, da, db, ca, cb = shared_pair(world)
    (da / "memory/n.md").write_text("editada", encoding="utf-8")
    sp.sync_project(ca, da)
    (db / "memory/n.md").unlink()
    out = sp.sync_project(cb, db)
    assert out["conflicts"][0]["kind"] == "borrado-aquí" and (db / "memory/n.md").read_text(encoding="utf-8") == "editada"


def test_binary_files_round_trip(world):
    _, da, db, ca, cb = shared_pair(world)
    blob = bytes(range(256)) * 4
    (da / "files").mkdir()
    (da / "files/datos.bin").write_bytes(blob)
    sp.sync_project(ca, da)
    sp.sync_project(cb, db)
    assert (db / "files/datos.bin").read_bytes() == blob


def test_text_keeps_its_exact_bytes_including_crlf_and_accents(world):
    _, da, db, ca, cb = shared_pair(world)
    raw = "línea 1\r\nñandú\r\n".encode()
    (da / "README.md").write_bytes(raw)
    sp.sync_project(ca, da)
    sp.sync_project(cb, db)
    assert (db / "README.md").read_bytes() == raw


def test_files_over_2_mb_are_skipped_with_a_warning(world):
    fake, da, _, ca, _ = shared_pair(world)
    (da / "grande.csv").write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    out = sp.sync_project(ca, da)
    assert out["skipped"] == [{"path": "grande.csv", "reason": "mayor a 2 MB"}] and out["pushed"] == 0
    assert all(c["path"] != "grande.csv" for c in fake.changes["p1"])
    assert "grande.csv" not in json.loads((da / ".sync.json").read_text())["files"]


def test_sync_state_is_never_synced_and_stays_out_of_git(world):
    fake, da, _, ca, _ = shared_pair(world)
    kb = da.parent.parent
    (kb / ".git/info").mkdir(parents=True)
    write(da, ".scratch/x.json", "{}")
    sp.sync_project(ca, da)
    assert all(not c["path"].startswith((".sync", ".scratch")) for c in fake.changes["p1"])
    assert "**/.sync.json" in (kb / ".git/info/exclude").read_text()


def test_sync_of_an_unshared_project_is_refused_and_leaves_it_alone(world):
    _, a, _, ca, _ = world
    write(a, "workspaces/solo/README.md", "x")
    with pytest.raises(sp.SharedProjectError, match="not shared"):
        sp.sync_project(ca, a / "workspaces/solo")
    assert not (a / "workspaces/solo/.sync.json").exists()


def test_unshare_removes_the_member_and_list_shows_it(world):
    _, a, _, ca, _ = world
    write(a, "workspaces/idea/README.md", "x")
    sp.share(ca, a, "idea", "gonza")
    listing = sp.list_shared(ca, a)
    assert listing["projects"][0]["mine"] is True and listing["projects"][0]["local"] == "idea"
    out = sp.unshare(ca, a, "idea", "gonza")
    assert [m["username"] for m in out["members"]] == ["demo"]
