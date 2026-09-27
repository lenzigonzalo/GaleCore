"""Consulta de sólo lectura a GaleCore local (DataFeed REST) con evidencia guardada.

Uso: python galecore_query.py <out_dir> <ruta> [<ruta> ...]
  ej: python galecore_query.py out /App/Rpf/Rules "/App.Analytics/PutSkew?Symbol=SPY"

Límites aplicados por código: sólo GET, sólo rutas de ALLOWED, a lo sumo MAX_CALLS por
ejecución, timeout por llamada. La clave sale de GALECORE_API_KEY o del appsettings.json local
y nunca se escribe en la evidencia.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

BASE = os.environ.get("GALECORE_URL", "http://127.0.0.1:7001")
MAX_CALLS = 15
TIMEOUT_S = 20
# Sin rutas */Switch (cambian estado) ni Gex/Analysis (puede disparar un escaneo).
ALLOWED = re.compile(
    r"^/App/(Rpf/Rules|GaleCore/Rules/Core|Runtime/(Status|Metrics|Specs(/[\w.-]+)?"
    r"|Instances(/[\w-]+(/(Positions|Evaluations|Events))?)?))"
    r"|^/App\.Analytics/(IVRank|ImpliedVolatility|PutSkew)"
    r"|^/Data/Tastytrade/MarketData/Trade$"
)
# Mismo orden que ASP.NET en Development: user-secrets (UserSecretsId de DataFeed.Api.csproj)
# pisa a appsettings.json, que en el checkout trae ApiKey vacía.
SECRETS = (
    Path(os.environ.get("APPDATA", ""))
    / "Microsoft/UserSecrets/129a9ead-8af9-443d-87fd-2c4529063094/secrets.json"
)
APPSETTINGS = (
    Path(__file__).resolve().parents[6]
    / "GaleCore/source/galecore-datafeed/DataFeed.Api/appsettings.json"
)


def api_key() -> str:
    key = os.environ.get("GALECORE_API_KEY")
    if key:
        return key
    for source in (SECRETS, APPSETTINGS):
        if source.is_file():
            match = re.search(r'"ApiKey"\s*:\s*"([^"]+)"', source.read_text(encoding="utf-8-sig"))
            if match:
                return match.group(1)
    sys.exit(f"sin clave: definir GALECORE_API_KEY o ApiKey en {SECRETS} / {APPSETTINGS}")


def slug(path: str) -> str:
    # UUIDs recortados: el worktree ya es profundo y Windows corta en 260 caracteres.
    short = re.sub(r"([0-9a-f]{8})-[0-9a-f-]{27}", r"\1", path.strip("/"))
    return re.sub(r"[^\w.-]+", "_", short)[:80]


def main(out_dir: str, paths: list[str]) -> int:
    if len(paths) > MAX_CALLS:
        sys.exit(f"presupuesto: {len(paths)} rutas > {MAX_CALLS}")
    rejected = [p for p in paths if not ALLOWED.match(p.split("?")[0])]
    if rejected:
        sys.exit(f"rutas fuera de la lista permitida: {rejected}")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    key = api_key()
    failures = 0
    for path in paths:
        req = urllib.request.Request(BASE + path, method="GET", headers={"X-API-KEY": key})
        utc = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                status, body = resp.status, resp.read()
        except urllib.error.HTTPError as err:
            status, body = err.code, err.read()
        except (urllib.error.URLError, TimeoutError) as err:
            status, body = 0, str(err).encode()
        failures += status != 200
        name = slug(path)
        (out / f"{name}.response").write_bytes(body)
        meta = {"method": "GET", "url": BASE + path, "utc": utc, "status": status, "bytes": len(body)}
        (out / f"{name}.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(f"{status} {len(body):>8} B  {path}")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2:]))
