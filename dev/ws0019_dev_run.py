"""WS-0019 (P1-07): corrida en GaleCore Dev con cada paso capturado crudo (comando, salida, exit code o HTTP).

Uso, desde la raíz del repo GaleCore, con la API Dev levantada y su salida en un archivo:
    python dev/galecore_dev.py api > <api.log> 2>&1      (en otra consola)
    python dev/ws0019_dev_run.py <api.log>
Los GET se hacen con dev/galecore_dev.py:http y el token del usuario de prueba (login en este proceso; el token no
se imprime ni se guarda). El log completo de la API se copia junto al JSON si no contiene nada que parezca un secreto.
"""

import json
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_LOG = Path(sys.argv[1])
OUT = ROOT / "docs/engineering/evidence/WS-0019-p1-07-dev-run.json"
OUT_LOG = OUT.with_suffix(".api.log")
SECRET = re.compile(r"eyJ[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9]|[Pp]assword=")
sys.path.insert(0, str(ROOT / "dev"))
import galecore_dev as dev  # noqa: E402

steps: list[dict] = []


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(cmd: list[str]) -> dict:
    started = now()
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    step = {"at": started, "command": " ".join(cmd), "exit_code": p.returncode, "stdout": p.stdout, "stderr": p.stderr}
    steps.append(step)
    return step


def get(path: str, auth: dict) -> dict:
    started = now()
    try:
        code, body = dev.http("GET", dev.API_URL + path, None, auth)
    except TimeoutError:
        code, body = None, "sin respuesta en 30 s (timeout del cliente)"
    command = f"GET {dev.API_URL}{path}  (dev/galecore_dev.py:http, Bearer del usuario de prueba)"
    step = {"at": started, "command": command, "http": code, "body": body}
    steps.append(step)
    return step


head = run(["git", "rev-parse", "HEAD"])
run(["git", "status", "--porcelain", "--", "source", "dev"])
run([sys.executable, "dev/galecore_dev.py", "migrate"])

auth = {"Authorization": f"Bearer {dev.login(dev.load_env())}"}
get("/App/Runtime/Specs", auth)
get("/App/Runtime/Structures?symbol=SPY&delta=0.16&deltaTolerance=0.04&width=5&minDte=30&maxDte=45", auth)
get("/App/Runtime/Status", auth)
get("/App/Runtime/Instances", auth)

first = run([sys.executable, "dev/galecore_dev.py", "deploy", "--spec", "shadow_runtime_test_v2"])
run([sys.executable, "dev/galecore_dev.py", "deploy", "--spec", "shadow_runtime_test_v2"])
time.sleep(75)  # al menos un tick del loop de entrada con las dos versiones RUNNING
get("/App/Runtime/Status", auth)
get("/App/Runtime/Instances", auth)

m = re.search(r'"instanceId":\s*"([0-9a-f-]{36})"', first["stdout"])
if m:
    run([sys.executable, "dev/galecore_dev.py", "stop", "--instance", m.group(1)])
get("/App/Runtime/Status", auth)

api_log = API_LOG.read_text(encoding="utf-8", errors="replace")
steps.append({
    "at": now(),
    "command": "python dev/galecore_dev.py api > <api.log> 2>&1  (sigue corriendo: sin exit code)",
    "log_file": OUT_LOG.name,
    "loader_lines": [line.strip() for line in api_log.splitlines() if "Runtime" in line][:20],
})

doc = {
    "work_item": "WS-0019 (P1-07)",
    "what": "corrida en GaleCore Dev capturada paso a paso: migración, specs cargadas por el loader, estructuras "
            "con la cadena real, deploy de una segunda versión junto a la que corre, redeploy idempotente, tick "
            "con dos RUNNING, stop",
    "runner": "dev/ws0019_dev_run.py, commiteado en head_sha",
    "head_sha": head["stdout"].strip(),
    "steps": steps,
}
text = json.dumps(doc, ensure_ascii=False, indent=2)
if SECRET.search(text) or SECRET.search(api_log):
    sys.exit("la salida o el log contienen algo que parece un secreto; no se escribe")
OUT.write_text(text + "\n", encoding="utf-8")
OUT_LOG.write_text(api_log, encoding="utf-8")
print(OUT)
for s in steps:
    print(s["command"][:100], "->", s.get("exit_code", s.get("http", "")))
