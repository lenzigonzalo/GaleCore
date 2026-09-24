"""GC-0002 AC-08: una corrida completa y reproducible del runtime SHADOW, de punta a punta.

Hace todo con un solo comando y deja un manifiesto de procedencia:
  1. estado del repo (HEAD, `git status --porcelain`, sha256 de `git diff HEAD`), versiones;
  2. opcional: copia temporal de una spec extra a Files/Runtime (caso NO_DATA forzado), con su hash;
  3. `dotnet build` de la API (exit code y resumen) y sha256 de las DLL que se ejecutan y de las specs;
  4. arranque de la API (`dotnet run --no-build`, comando y variables de entorno), sólo con las líneas
     de log del runtime/arranque en el manifiesto (el log completo no se guarda: puede tener datos
     de la sesión del bróker);
  5. deploy, switch ON, N evaluaciones, snapshot, switch OFF, PAUSED, >2 ticks, snapshot;
  6. baja de la API (exit code), borrado de la spec temporal, estado final del repo.
Cada request HTTP queda en el JSONL (ver ac08_capture.py); un status >= 400 corta la corrida.
La ApiKey se lee de user-secrets y nunca se escribe.

Uso, desde la raíz del repo GaleCore, con el puerto 7001 libre y mercado abierto:
    python docs/evidence/gc-0002/ac08_run.py --name <run> --spec <spec_name> [--extra-spec <archivo.json>] [--evals 2]
Deja docs/evidence/gc-0002/<run>.jsonl y <run>.manifest.json. Exit code 0 sólo si todo salió bien.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ac08_capture as cap  # noqa: E402

REPO = cap.REPO
EVIDENCE = Path(__file__).resolve().parent
API_DIR = cap.API_PROJECT
API_CSPROJ = API_DIR / "DataFeed.Api.csproj"
BIN = API_DIR / "bin" / "Debug" / "net8.0"
RUNTIME_SPECS = API_DIR / "Files" / "Runtime"
ENV = {"ASPNETCORE_ENVIRONMENT": "Development", "ASPNETCORE_URLS": "http://localhost:7001"}
LOG_KEEP = re.compile(r"Runtime: spec|Now listening|Hosting environment|Content root|ShadowEntryLoop|ShadowPositionMonitor|fail:|crit:")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(cmd: list[str], **kw) -> dict:
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)
    return {"cmd": cmd, "exit_code": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}


def repo_state() -> dict:
    diff = subprocess.run(["git", "-C", str(REPO), "diff", "HEAD"], capture_output=True).stdout
    return {
        "at_utc": now(),
        "head": cap.head_sha(),
        "status_porcelain": run(["git", "-C", str(REPO), "status", "--porcelain"])["stdout"].splitlines(),
        "diff_head_sha256": hashlib.sha256(diff).hexdigest(),
        "diff_head_bytes": len(diff),
    }


def port_free(port: int = 7001) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def expect_ok(status: int, what: str) -> None:
    if status >= 400:
        raise RuntimeError(f"{what}: HTTP {status}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--extra-spec", type=Path)
    ap.add_argument("--evals", type=int, default=2)
    args = ap.parse_args()

    log = EVIDENCE / f"{args.name}.jsonl"
    manifest_path = EVIDENCE / f"{args.name}.manifest.json"
    if log.exists():
        log.unlink()
    m: dict = {"run": args.name, "script": "docs/evidence/gc-0002/ac08_run.py", "argv": sys.argv[1:],
               "started_utc": now(), "steps": []}

    def step(name: str, **data) -> None:
        m["steps"].append({"step": name, "at_utc": now(), **data})
        manifest_path.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

    extra_target: Path | None = None
    api: subprocess.Popen | None = None
    api_log = Path(os.environ.get("TEMP", "/tmp")) / f"gc0002-{args.name}-api.log"
    ok = False
    try:
        m["repo_start"] = repo_state()
        m["tools"] = {"python": sys.version.split()[0],
                      "dotnet": run(["dotnet", "--version"])["stdout"].strip()}
        if not port_free():
            raise RuntimeError("el puerto 7001 está ocupado: bajar la API que esté corriendo")
        step("preflight", port_7001_free=True)

        if args.extra_spec:
            extra_target = RUNTIME_SPECS / args.extra_spec.name
            if extra_target.exists():
                raise RuntimeError(f"{extra_target} ya existe")
            shutil.copyfile(args.extra_spec, extra_target)
            step("extra_spec_copied", source=str(args.extra_spec), target=str(extra_target.relative_to(REPO)),
                 sha256=sha256_file(extra_target), note="temporal, sin commitear; se borra al final")

        build = run(["dotnet", "build", str(API_CSPROJ), "-c", "Debug", "-nologo", "-v", "q"])
        summary = [ln for ln in build["stdout"].splitlines() if re.search(r"Error\(s\)|Warning\(s\)|Build succeeded|error ", ln)]
        step("build", cmd=build["cmd"], exit_code=build["exit_code"], summary=summary)
        if build["exit_code"] != 0:
            raise RuntimeError("dotnet build falló")

        step("binaries", files={p.name: sha256_file(p) for p in (BIN / "DataFeed.Api.dll", BIN / "DataFeed.Application.dll",
                                                                  BIN / "DataFeed.Infrastructure.dll")},
             specs={p.name: sha256_file(p) for p in sorted(RUNTIME_SPECS.glob("*.json"))})

        launch = ["dotnet", "run", "--no-build", "--project", str(API_CSPROJ), "--no-launch-profile"]
        with api_log.open("w", encoding="utf-8") as f:
            api = subprocess.Popen(launch, stdout=f, stderr=subprocess.STDOUT, cwd=str(API_DIR.parent),
                                   env={**os.environ, **ENV})
        step("api_launch", cmd=launch, env=ENV, pid=api.pid)
        deadline = time.time() + 240
        while time.time() < deadline:
            text = api_log.read_text(encoding="utf-8", errors="replace") if api_log.exists() else ""
            if "Now listening" in text and "FEED_CONFIG" in text:
                break
            if api.poll() is not None:
                raise RuntimeError(f"la API terminó al arrancar (exit {api.returncode})")
            time.sleep(3)
        else:
            raise RuntimeError("la API no arrancó en 240 s")
        step("api_ready", log_lines=[ln.strip() for ln in text.splitlines() if LOG_KEEP.search(ln)])

        status, _ = cap.call(log, "POST", "App/GaleCore/Services/runtime/Switch", {"enabled": False}, note="switch off (inicio limpio)")
        expect_ok(status, "switch off inicial")
        status, body = cap.call(log, "POST", "App/Runtime/Deploy", {"specName": args.spec}, note="deploy")
        expect_ok(status, "deploy")
        iid = body["instanceId"]
        step("deployed", instance_id=iid, version_hash=body.get("versionHash"))
        status, _ = cap.call(log, "POST", "App/GaleCore/Services/runtime/Switch", {"enabled": True}, note="switch on")
        expect_ok(status, "switch on")

        def evals() -> int:
            st, evs = cap.call(log, "GET", f"App/Runtime/Instances/{iid}/Evaluations", note=f"wait-evals {args.evals}")
            expect_ok(st, "evaluations")
            return len(evs)
        deadline = time.time() + 120 * args.evals + 60
        while evals() < args.evals:
            if time.time() > deadline:
                raise RuntimeError("no se completaron las evaluaciones a tiempo")
            time.sleep(10)
        step("evaluations_reached", count=args.evals)

        for path in (f"App/Runtime/Instances/{iid}", f"App/Runtime/Instances/{iid}/Evaluations",
                     f"App/Runtime/Instances/{iid}/Events", "App/GaleCore/Services/runtime/Switch"):
            st, _ = cap.call(log, "GET", path, note="snapshot before-off")
            expect_ok(st, path)
        status, _ = cap.call(log, "POST", "App/GaleCore/Services/runtime/Switch", {"enabled": False}, note="switch off")
        expect_ok(status, "switch off")
        off_at = time.time()
        step("switch_off")

        deadline = time.time() + 200
        while True:
            st, inst = cap.call(log, "GET", f"App/Runtime/Instances/{iid}", note="wait-state PAUSED")
            expect_ok(st, "instance")
            if inst["instance"]["schedulerState"] == "PAUSED":
                break
            if time.time() > deadline:
                raise RuntimeError("la instancia no pasó a PAUSED")
            time.sleep(5)
        while time.time() < off_at + 130:      # más de dos ticks del loop de entrada (60 s)
            time.sleep(5)
        for path in (f"App/Runtime/Instances/{iid}", f"App/Runtime/Instances/{iid}/Evaluations",
                     f"App/Runtime/Instances/{iid}/Events", "App/GaleCore/Services/runtime/Switch"):
            st, _ = cap.call(log, "GET", path, note="snapshot after-off")
            expect_ok(st, path)
        step("snapshot_after_off")
        ok = True
    except Exception as exc:  # noqa: BLE001 — se registra y la corrida sale con error
        step("error", error=f"{type(exc).__name__}: {exc}")
    finally:
        if api is not None and api.poll() is None:
            kill = run(["taskkill", "/T", "/F", "/PID", str(api.pid)])
            api.wait(timeout=60)
            step("api_stopped", taskkill_exit_code=kill["exit_code"], api_exit_code=api.returncode)
        if extra_target is not None and extra_target.exists():
            extra_target.unlink()
            step("extra_spec_removed", target=str(extra_target.relative_to(REPO)))
        m["repo_end"] = repo_state()
        m["finished_utc"] = now()
        m["result"] = "ok" if ok else "error"
        m["exit_code"] = 0 if ok else 1
        manifest_path.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(m["result"], manifest_path)
    return m["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
