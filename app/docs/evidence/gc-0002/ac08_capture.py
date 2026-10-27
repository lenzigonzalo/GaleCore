"""GC-0002 AC-08: captura reproducible de una corrida del runtime SHADOW contra la API local.

Cada llamada queda en un JSONL (una línea por request): hora UTC, SHA del repo, método, ruta,
payload, status y cuerpo de la respuesta. La ApiKey se lee de user-secrets y nunca se escribe.

Uso (desde la raíz del repo GaleCore, con la API corriendo en http://localhost:7001):
    python docs/evidence/gc-0002/ac08_capture.py <log.jsonl> deploy <spec_name>
    python docs/evidence/gc-0002/ac08_capture.py <log.jsonl> switch on|off
    python docs/evidence/gc-0002/ac08_capture.py <log.jsonl> wait-evals <instance_id> <n> [timeout_s]
    python docs/evidence/gc-0002/ac08_capture.py <log.jsonl> wait-state <instance_id> <schedulerState> [timeout_s]
    python docs/evidence/gc-0002/ac08_capture.py <log.jsonl> snapshot <instance_id> <label>
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
API_PROJECT = REPO / "source" / "galecore-datafeed" / "DataFeed.Api"
BASE = "http://localhost:7001/"
_KEY: str | None = None


def api_key() -> str:
    global _KEY
    if _KEY is None:
        out = subprocess.run(["dotnet", "user-secrets", "list", "--project", str(API_PROJECT)],
                             capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            name, _, value = line.partition(" = ")
            if name.strip() == "ApiKey":
                _KEY = value.strip()
                break
        else:
            sys.exit("sin ApiKey en user-secrets")
    return _KEY


def head_sha() -> str:
    return subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


def call(log: Path, method: str, path: str, body: dict | None = None, note: str = "") -> tuple[int, object]:
    req = urllib.request.Request(BASE + path.lstrip("/"), method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"X-API-KEY": api_key(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            status, text = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode()
    try:
        parsed: object = json.loads(text)
    except ValueError:
        parsed = text
    entry = {"at_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "repo_head": head_sha(), "note": note,
             "request": {"method": method, "path": path, "body": body}, "status": status, "response": parsed}
    with log.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return status, parsed


def wait(log: Path, check, timeout: float, note: str) -> None:
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return
        time.sleep(5)
    call(log, "GET", "App/Runtime/Instances", note=f"TIMEOUT: {note}")
    sys.exit(f"timeout: {note}")


def main(argv: list[str]) -> None:
    log, cmd, args = Path(argv[0]), argv[1], argv[2:]
    if cmd == "deploy":
        status, body = call(log, "POST", "App/Runtime/Deploy", {"specName": args[0]}, note="deploy")
        print(status, json.dumps(body, ensure_ascii=False))
    elif cmd == "switch":
        status, body = call(log, "POST", "App/GaleCore/Services/runtime/Switch", {"enabled": args[0] == "on"},
                            note=f"switch {args[0]}")
        print(status, body)
    elif cmd == "wait-evals":
        iid, n = args[0], int(args[1])
        timeout = float(args[2]) if len(args) > 2 else 300

        def enough() -> bool:
            _, evs = call(log, "GET", f"App/Runtime/Instances/{iid}/Evaluations", note=f"wait-evals {n}")
            return isinstance(evs, list) and len(evs) >= n
        wait(log, enough, timeout, f"{n} evaluaciones")
        print("ok")
    elif cmd == "wait-state":
        iid, state = args[0], args[1]
        timeout = float(args[2]) if len(args) > 2 else 300

        def reached() -> bool:
            _, body = call(log, "GET", f"App/Runtime/Instances/{iid}", note=f"wait-state {state}")
            return isinstance(body, dict) and body.get("instance", {}).get("schedulerState") == state
        wait(log, reached, timeout, f"schedulerState {state}")
        print("ok")
    elif cmd == "snapshot":
        iid, label = args[0], args[1]
        for path in (f"App/Runtime/Instances/{iid}", f"App/Runtime/Instances/{iid}/Evaluations",
                     f"App/Runtime/Instances/{iid}/Events", "App/GaleCore/Services/runtime/Switch",
                     "App/Runtime/Specs"):
            call(log, "GET", path, note=f"snapshot {label}")
        print("ok")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
