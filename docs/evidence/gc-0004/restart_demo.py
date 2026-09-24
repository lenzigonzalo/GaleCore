"""GC-0004 AC-08 — el runtime SHADOW sobrevive un reinicio de la API (evidencia reproducible).

Contra el entorno de desarrollo aislado (`dev/galecore_dev.py up` + `seed-user`), con datos de mercado
reales. Hace, en un solo comando:

  1. build y arranque de la API (:7001) con la config del entorno local;
  2. login real del usuario de prueba (username → API → Supabase Auth local → JWT);
  3. deploy de la spec de prueba (idempotente) y, con --switch-on, switch del runtime en ON;
  4. espera --minutes para que corran evaluaciones (sólo en sesión: 09:30–16:00 ET, días hábiles);
  5. captura A: Status, Metrics, evaluaciones, eventos y posiciones de la instancia;
  6. baja la API y la vuelve a levantar;
  7. captura B apenas arranca (antes del primer tick) y la compara con A: todo lo de A sigue, nada
     duplicado, misma instancia, posiciones iguales;
  8. espera --after minutos y captura C: la misma instancia sigue evaluando y las posiciones abiertas
     (si hay) se siguen valuando, sin una instancia ni una entrada nuevas por el reinicio.

No cambia gates ni specs y no fuerza operaciones: si el mercado no da una entrada, no hay posiciones
y la evidencia lo dice. Los tokens no se guardan. Salida en docs/evidence/gc-0004/<name>.json.

Uso, desde la raíz del repo GaleCore, con el puerto 7001 libre:
    python docs/evidence/gc-0004/restart_demo.py --name run1 --switch-on --minutes 5 --after 3
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "dev"))
import galecore_dev as dev  # noqa: E402

OUT = Path(__file__).resolve().parent
LOG_KEEP = re.compile(
    r"Runtime|Now listening|ShadowEntryLoop|ShadowPositionMonitor|Supabase Auth|GaleCore DB|fail:|crit:"
)


def now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


class Api:
    def __init__(self, env: dict, log: Path):
        self.env, self.log, self.proc = env, log, None

    def start(self) -> dict:
        started = now()
        with open(self.log, "a", encoding="utf-8") as f:
            f.write(f"\n=== start {started}\n")
            self.proc = subprocess.Popen(
                ["dotnet", "run", "--no-build", "--no-launch-profile", "--project", str(dev.API_CSPROJ)],
                cwd=dev.API_CSPROJ.parent,
                env=dev.api_env(self.env),
                stdout=f,
                stderr=subprocess.STDOUT,
            )
        for _ in range(120):
            time.sleep(1)
            code, _ = dev.http("GET", dev.API_URL + "/App/GaleCore/Rules/Core")
            if code in (200, 401):
                return {"started_at": started, "listening_at": now(), "pid": self.proc.pid}
            if self.proc.poll() is not None:
                raise RuntimeError(f"la API terminó al arrancar (exit {self.proc.returncode}); ver {self.log}")
        raise RuntimeError("la API no respondió en 120 s")

    def stop(self) -> dict:
        stopped = now()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        return {"stopped_at": stopped, "exit_code": self.proc.returncode if self.proc else None}


def capture(token: str, instance_id: str) -> dict:
    auth = {"Authorization": f"Bearer {token}"}
    base = dev.API_URL + "/App/Runtime"
    out = {"captured_at": now()}
    for key, path in [
        ("status", "/Status"),
        ("metrics", "/Metrics"),
        ("evaluations", f"/Instances/{instance_id}/Evaluations"),
        ("events", f"/Instances/{instance_id}/Events"),
        ("positions", f"/Instances/{instance_id}/Positions"),
    ]:
        code, body = dev.http("GET", base + path, headers=auth)
        out[key] = {"http": code, "body": body}
    return out


def ids(snap: dict, key: str, field: str) -> list[str]:
    body = snap[key]["body"] or []
    return [x[field] for x in body]


def compare(a: dict, b: dict) -> dict:
    checks = {}
    for key, field in [("evaluations", "evaluationId"), ("events", "eventId"), ("positions", "positionId")]:
        before, after = ids(a, key, field), ids(b, key, field)
        checks[key] = {
            "before": len(before),
            "after": len(after),
            "all_kept": set(before) <= set(after),
            "missing": sorted(set(before) - set(after)),
            "duplicates_after": len(after) - len(set(after)),
        }
    pos_a = {p["positionId"]: p for p in a["positions"]["body"] or []}
    pos_b = {p["positionId"]: p for p in b["positions"]["body"] or []}
    same = ["entryCredit", "entryAt", "status", "legs", "maxRisk", "exitReason", "realizedPnl"]
    checks["positions_unchanged"] = all(all(pos_a[k].get(f) == pos_b.get(k, {}).get(f) for f in same) for k in pos_a)
    inst_a = [i["instanceId"] for i in a["status"]["body"]["instances"]]
    inst_b = [i["instanceId"] for i in b["status"]["body"]["instances"]]
    checks["instances"] = {"before": inst_a, "after": inst_b, "same": inst_a == inst_b}
    return checks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--spec", default="shadow_runtime_test_v1")
    ap.add_argument("--switch-on", action="store_true")
    ap.add_argument("--minutes", type=float, default=5)
    ap.add_argument("--after", type=float, default=3)
    args = ap.parse_args()

    env = dev.load_env()
    log = Path(os.environ.get("TEMP", "/tmp")) / f"gc0004-{args.name}-api.log"
    ev: dict = {
        "work_item": "GC-0004",
        "criterion": "AC-08",
        "run": args.name,
        "git": {
            "head": git("rev-parse", "HEAD"),
            "branch": git("branch", "--show-current"),
            "dirty": git("status", "--porcelain") != "",
        },
        "command": sys.argv,
        "started_at": now(),
        "environment": "desarrollo aislado: Supabase local en Docker; datos de mercado reales (Tastytrade)",
        "steps": [],
    }
    build = subprocess.run(
        ["dotnet", "build", str(dev.API_CSPROJ), "-nologo", "-v", "q"], capture_output=True, text=True
    )
    ev["steps"].append({"step": "build", "exit_code": build.returncode})
    if build.returncode != 0:
        print(build.stdout[-2000:])
        return 1

    api = Api(env, log)
    exit_code = 1
    try:
        ev["steps"].append({"step": "start_1", **api.start()})
        token = dev.login(env)
        ev["steps"].append({"step": "login", "at": now(), "user": dev.TEST_USERNAME, "ok": True})
        auth = {"Authorization": f"Bearer {token}"}
        code, body = dev.http("POST", dev.API_URL + "/App/Runtime/Deploy", {"specName": args.spec}, auth)
        ev["steps"].append({"step": "deploy", "at": now(), "http": code, "body": body})
        if code != 200:
            raise RuntimeError(f"deploy HTTP {code}: {body}")
        instance_id = body["instanceId"]
        if args.switch_on:
            code, body = dev.http(
                "POST", dev.API_URL + "/App/GaleCore/Services/runtime/Switch", {"enabled": True}, auth
            )
            ev["steps"].append({"step": "switch_on", "at": now(), "http": code, "body": body})

        time.sleep(args.minutes * 60)
        ev["capture_a"] = capture(token, instance_id)
        ev["steps"].append({"step": "stop_1", **api.stop()})
        ev["steps"].append({"step": "start_2", **api.start()})
        token = dev.login(env)
        ev["capture_b"] = capture(token, instance_id)
        ev["restart_check"] = compare(ev["capture_a"], ev["capture_b"])

        time.sleep(args.after * 60)
        ev["capture_c"] = capture(token, instance_id)
        ev["continue_check"] = compare(ev["capture_b"], ev["capture_c"])
        ok = all(
            ev["restart_check"][k]["all_kept"] and ev["restart_check"][k]["duplicates_after"] == 0
            for k in ("evaluations", "events", "positions")
        )
        ok = ok and ev["restart_check"]["positions_unchanged"] and ev["restart_check"]["instances"]["same"]
        ev["result"] = "PASS" if ok else "FAIL"
        exit_code = 0 if ok else 2
    except Exception as e:  # noqa: BLE001 — se registra y se sale con código de error
        ev["error"] = str(e)
        ev["result"] = "ERROR"
    finally:
        ev["steps"].append({"step": "stop_final", **api.stop()})
        ev["finished_at"] = now()
        ev["api_log_excerpt"] = (
            [
                line.rstrip()
                for line in log.read_text(encoding="utf-8", errors="replace").splitlines()
                if LOG_KEEP.search(line)
            ][-80:]
            if log.exists()
            else []
        )
        out = OUT / f"{args.name}.json"
        out.write_text(json.dumps(ev, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"{ev['result']} → {out}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
