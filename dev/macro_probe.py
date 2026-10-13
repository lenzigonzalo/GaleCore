"""Sonda de sólo lectura Dev de los contratos Macro, con artefactos sin secretos."""
from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import galecore_dev as dev


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--unconfigured-store", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=root, text=True).strip()
    env = json.loads(((root / common).resolve().parent / "dev/.local/env.json").read_text(encoding="utf-8"))
    if env["project_ref"] != "ecymbgpimqbtcvqyjtaq":
        raise RuntimeError("Sólo GaleCore Dev")
    if args.unconfigured_store:
        return unconfigured(env, args.output)
    base = "http://localhost:7002"
    auth: dict[str, str] = {}

    def get(path: str, body: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body else None,
                                     headers={"Content-Type": "application/json", **auth})
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as ex:
            return ex.code, json.load(ex)

    code, session = get("/App/GaleCore/Auth/Login", {"username": "demo", "password": env["demo_password"]})
    assert code == 200
    auth["Authorization"] = "Bearer " + session["accessToken"]
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "scope": "real-dev-http", "checks": []}
    code, catalog = get("/App/Macro/Catalog")
    assert code == 200 and len({d["family"] for d in catalog["seriesDefinitions"]}) == 6
    code, snapshot = get("/App/Macro/Snapshot?horizon=month&region=Global&currency=Local")
    assert code == 200 and snapshot["contentHash"] == snapshot["id"]
    for observation in snapshot["observations"]:
        assert "api_key=" not in observation["sourceRef"].lower()
        assert observation["publishedAt"] is None and observation["availableAt"] is None
    code, stored = get("/App/Macro/Snapshots/" + snapshot["id"])
    assert code == 200 and stored == snapshot
    code, series = get("/App/Macro/Series/UST10?snapshotId=" + snapshot["id"])
    assert code == 200 and series["observations"]
    code, events = get("/App/Macro/Events?snapshotId=" + snapshot["id"])
    assert code == 200 and events["sourceStatuses"]
    report["checks"].append("Catálogo seis familias; snapshot almacenado idéntico; series y eventos con referencias")
    for path, expected in [("/App/Macro/Snapshot?cutoff=2025-01-01", 400),
                           ("/App/Macro/Snapshot?currency=USD", 400),
                           ("/App/Macro/Snapshot?region=AR", 400),
                           ("/App/Macro/Snapshots/not-found", 404),
                           ("/App/Macro/Series/unknown?snapshotId=" + snapshot["id"], 404)]:
        code, _ = get(path)
        assert code == expected, (path, code)
        report["checks"].append({"path": path, "status": code})
    report["source_statuses"] = snapshot["sourceStatuses"]
    report["snapshot_id"] = snapshot["id"]
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    report["exit_code"] = 0
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "snapshot-real.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output / "api-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"snapshot": snapshot["id"], "checks": len(report["checks"]), "exit_code": 0}))
    return 0


def unconfigured(env: dict, output: Path) -> int:
    base = "http://localhost:7003"
    try:
        urllib.request.urlopen(base + "/swagger", timeout=1)
    except urllib.error.URLError:
        pass
    else:
        raise RuntimeError("Puerto 7003 ocupado; no tocar otro proceso")
    run_env = dev.api_env(env)
    run_env.pop("Macro__SnapshotDirectory", None)
    run_env.update({"ASPNETCORE_URLS": base, "Runtime__Persistence__Enabled": "false"})
    process = subprocess.Popen(["dotnet", "run", "--no-build", "--no-launch-profile", "--project", str(dev.API_CSPROJ)],
                               cwd=dev.API_CSPROJ.parent, env=run_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "mode": "real-dev-unconfigured-store", "checks": []}
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/swagger/index.html", timeout=1)
                break
            except urllib.error.URLError:
                if process.poll() is not None:
                    raise RuntimeError("Preview 7003 no inició")
                time.sleep(.25)
        body = json.dumps({"username": "demo", "password": env["demo_password"]}).encode()
        req = urllib.request.Request(base + "/App/GaleCore/Auth/Login", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as response:
            token = json.load(response)["accessToken"]
        for path in ["/App/Macro/Snapshot", "/App/Macro/Snapshots/" + "a" * 64,
                     "/App/Macro/Series/UST10?snapshotId=" + "a" * 64, "/App/Macro/Events?snapshotId=" + "a" * 64]:
            req = urllib.request.Request(base + path, headers={"Authorization": "Bearer " + token})
            try:
                urllib.request.urlopen(req, timeout=5)
            except urllib.error.HTTPError as ex:
                payload = json.load(ex)
                assert ex.code == 503 and payload["code"] == "macro_store_unconfigured"
                report["checks"].append({"path": path, "status": ex.code, "code": payload["code"]})
            else:
                raise AssertionError("Store no configurado debe devolver 503")
        report.update({"finished_at": datetime.now(timezone.utc).isoformat(), "exit_code": 0})
        output.mkdir(parents=True, exist_ok=True)
        (output / "unconfigured-store-run.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"unconfigured_store": "4 routes return 503", "exit_code": 0}))
        return 0
    finally:
        # Terminar únicamente el proceso creado por esta sonda y sus hijos (dotnet run).
        if process.poll() is None:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
