"""Consulta de sólo lectura a FRED (St. Louis Fed) con la respuesta guardada para `evidence add`.

Uso: python tools/fred_query.py <out_dir> <SERIE>[:<desde YYYY-MM-DD>] [...]
  ej: python tools/fred_query.py out DFII10:2026-09-01 T10YIE:2026-09-01

Por serie hace dos GET: metadatos (`fred/series`: título, unidad, frecuencia, ajuste estacional,
última actualización) y observaciones (`fred/series/observations` desde la fecha, con
realtime_start/realtime_end = vintage consultado). Guarda `<SERIE>.series.json`,
`<SERIE>.observations.json` y `<SERIE>.meta.json` (URL sin la clave, hora UTC, status).

La clave sale sólo de FRED_API_KEY y nunca se escribe. Existe porque el MCP de FRED no está
registrado en el host (GC-AI-0007); si se registra, este script deja de hacer falta.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

BASE = "https://api.stlouisfed.org/fred/"
MAX_SERIES = 6
TIMEOUT_S = 20
SERIES_RE = re.compile(r"^[A-Z0-9]{1,30}$")


def get(endpoint: str, params: dict, key: str) -> tuple[int, bytes, str]:
    query = urllib.parse.urlencode({**params, "file_type": "json"})
    public_url = f"{BASE}{endpoint}?{query}"
    try:
        with urllib.request.urlopen(f"{public_url}&api_key={key}", timeout=TIMEOUT_S) as resp:
            return resp.status, resp.read(), public_url
    except urllib.error.HTTPError as err:
        return err.code, err.read(), public_url
    except (urllib.error.URLError, TimeoutError) as err:
        return 0, str(err).encode(), public_url


def main(out_dir: str, specs: list[str]) -> int:
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("sin clave: definir FRED_API_KEY en el entorno (nunca en un archivo del repo)")
    if len(specs) > MAX_SERIES:
        sys.exit(f"presupuesto: {len(specs)} series > {MAX_SERIES}")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    failures = 0
    for spec in specs:
        series_id, _, start = spec.partition(":")
        if not SERIES_RE.fullmatch(series_id) or (start and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start)):
            sys.exit(f"serie inválida: {spec!r}")
        meta = {"series_id": series_id, "calls": []}
        for endpoint, params, suffix in (
            ("series", {"series_id": series_id}, "series"),
            ("series/observations", {"series_id": series_id, **({"observation_start": start} if start else {})},
             "observations"),
        ):
            utc = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            status, body, url = get(endpoint, params, key)
            if key.encode() in body:
                sys.exit("la respuesta contiene la clave; no se guarda")
            failures += status != 200
            (out / f"{series_id}.{suffix}.json").write_bytes(body)
            meta["calls"].append({"method": "GET", "url": url, "utc": utc, "status": status, "bytes": len(body)})
            print(f"{status} {len(body):>8} B  {url}")
        (out / f"{series_id}.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2:]))
