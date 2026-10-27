"""GC-0004 AC-01/AC-07/AC-09 — evidencia reproducible del entorno de desarrollo GaleCore Dev.

Desde la raíz del repo GaleCore, con el árbol limpio y el puerto 7001 libre:
    python docs/evidence/gc-0004/dev_env_evidence.py --name env1

Registra, sin secretos:
  1. `dotnet ef migrations list` contra GaleCore Dev (qué migraciones están aplicadas);
  2. `dotnet test` con la base de prueba `galecore_test` (salida completa en <name>-dotnet-test.txt);
  3. smoke de la API contra GaleCore Dev con su rol real: login del usuario de prueba, `/Me`,
     `/Runtime/Status`, `/Runtime/Metrics` y `/Runtime/Status` sin token (debe ser 401).
Salida: docs/evidence/gc-0004/<name>.json.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "dev"))
import galecore_dev as dev  # noqa: E402

OUT = Path(__file__).resolve().parent


def now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def scrub(text: str, env: dict) -> str:
    for key in ("ddl_password", "api_password", "demo_password", "anon_key"):
        text = text.replace(env[key], f"<{key}>")
    return text


def run(cmd: list[str], env_vars: dict, cwd: Path, secrets_env: dict) -> dict:
    r = subprocess.run(cmd, cwd=cwd, env=env_vars, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return {"command": cmd, "exit_code": r.returncode, "output": scrub(r.stdout + r.stderr, secrets_env)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    args = ap.parse_args()
    env = dev.load_env()  # rechaza cualquier proyecto que no sea GaleCore Dev
    ev: dict = {
        "work_item": "GC-0004",
        "criteria": ["AC-01", "AC-07", "AC-09"],
        "run": args.name,
        "git": {
            "head": git("rev-parse", "HEAD"),
            "branch": git("branch", "--show-current"),
            "dirty": git("status", "--porcelain") != "",
        },
        "environment": {
            "project_ref": dev.DEV_PROJECT_REF,
            "supabase_url": env["supabase_url"],
            "pooler_host": env["pooler_host"],
        },
        "started_at": now(),
    }

    mig = run(
        [
            "dotnet",
            "ef",
            "migrations",
            "list",
            "--project",
            "DataFeed.Repositories",
            "--startup-project",
            "DataFeed.Repositories",
        ],
        {**os.environ, "GALECORE_DB": dev.cs(env, "galecore_ddl", "ddl_password")},
        dev.DATAFEED,
        env,
    )
    ev["migrations"] = {
        "command": mig["command"],
        "exit_code": mig["exit_code"],
        "lines": [line for line in mig["output"].splitlines() if line[:8].isdigit()],
    }

    tests = run(
        ["dotnet", "test", str(dev.DATAFEED / "DataFeed.Tests" / "DataFeed.Tests.csproj")],
        {**os.environ, "GALECORE_TEST_DB": dev.cs(env, "galecore_ddl", "ddl_password", dev.TEST_DATABASE)},
        ROOT,
        env,
    )
    (OUT / f"{args.name}-dotnet-test.txt").write_text(tests["output"], encoding="utf-8")
    ev["dotnet_test"] = {
        "exit_code": tests["exit_code"],
        "output_file": f"{args.name}-dotnet-test.txt",
        "summary": [
            line.strip()
            for line in tests["output"].splitlines()
            if "Passed!" in line or "Failed!" in line or "[SKIP]" in line
        ],
    }

    log = Path(os.environ.get("TEMP", "/tmp")) / f"gc0004-{args.name}-api.log"
    with open(log, "w", encoding="utf-8") as f:
        api = subprocess.Popen(
            ["dotnet", "run", "--no-launch-profile", "--project", str(dev.API_CSPROJ)],
            cwd=dev.API_CSPROJ.parent,
            env=dev.api_env(env),
            stdout=f,
            stderr=subprocess.STDOUT,
        )
    smoke: dict = {}
    try:
        for _ in range(180):
            time.sleep(1)
            code, _ = dev.http("GET", dev.API_URL + "/App/GaleCore/Rules/Core")
            if code in (200, 401):
                break
        code, body = dev.http(
            "POST",
            dev.API_URL + "/App/GaleCore/Auth/Login",
            {"username": dev.TEST_USERNAME, "password": env["demo_password"]},
        )
        smoke["login"] = {"http": code, "token_received": isinstance(body, dict) and bool(body.get("accessToken"))}
        auth = {"Authorization": f"Bearer {body['accessToken']}"} if code == 200 else {}
        code, me = dev.http("GET", dev.API_URL + "/App/GaleCore/Me", headers=auth)
        smoke["me"] = {
            "http": code,
            **({k: me.get(k) for k in ("username", "isAdmin", "canManagePlatform")} if isinstance(me, dict) else {}),
        }
        code, st = dev.http("GET", dev.API_URL + "/App/Runtime/Status", headers=auth)
        smoke["runtime_status"] = {"http": code, "persistence": st.get("persistence") if isinstance(st, dict) else st}
        code, m = dev.http("GET", dev.API_URL + "/App/Runtime/Metrics", headers=auth)
        smoke["runtime_metrics"] = {"http": code, "body": m}
        code, _ = dev.http("GET", dev.API_URL + "/App/Runtime/Status")
        smoke["runtime_status_without_token"] = {"http": code}
    finally:
        api.terminate()
        api.wait(30)
    ev["api_smoke"] = smoke
    ev["api_log_excerpt"] = [
        scrub(line.rstrip(), env)
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines()
        if "Runtime" in line or "GaleCore DB" in line or "Supabase Auth" in line or "fail:" in line
    ][-20:]
    ev["finished_at"] = now()
    ok = (
        not ev["git"]["dirty"]
        and ev["migrations"]["exit_code"] == 0
        and tests["exit_code"] == 0
        and smoke.get("login", {}).get("http") == 200
        and smoke.get("me", {}).get("http") == 200
        and smoke.get("runtime_status", {}).get("persistence", {}).get("available") is True
        and smoke.get("runtime_status_without_token", {}).get("http") == 401
    )
    ev["result"] = "PASS" if ok else "FAIL"
    (OUT / f"{args.name}.json").write_text(json.dumps(ev, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{ev['result']} -> {OUT / (args.name + '.json')}")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
