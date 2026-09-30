"""Consulta de sólo lectura a FRED (St. Louis Fed) con la respuesta guardada para `evidence add`.

Uso: python tools/fred_query.py <out_dir> <SERIE>[:<desde YYYY-MM-DD>] [...]
  ej: python tools/fred_query.py out DFII10:2026-09-01 T10YIE:2026-09-01
     python tools/fred_query.py <out_dir> --releases <desde YYYY-MM-DD> <hasta YYYY-MM-DD> [<release_id> ...]
  ej: python tools/fred_query.py out --releases 2026-09-30 2026-11-15 50 10 46 53 54 9

Calendario de publicaciones (`--releases`, GC-AI-0016): un GET a `fred/releases/dates` con las fechas
programadas en el rango (include_release_dates_with_no_data=true). Guarda la respuesta completa
(`releases.dates.json`) y, si se dan release_id, el extracto con esas publicaciones
(`releases.dates.excerpt.json`, con la lista de ids usada). FRED no da la fecha de reunión del FOMC:
«FOMC Press Release» (release 101) figura todos los días porque publica series diarias.

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


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PAGE = 1000      # FRED's maximum per request
MAX_PAGES = 5    # budget: a two-month range is ~1300 rows


def releases(out_dir: str, start: str, end: str, ids: list[str]) -> int:
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("sin clave: definir FRED_API_KEY en el entorno (nunca en un archivo del repo)")
    if not (DATE_RE.fullmatch(start) and DATE_RE.fullmatch(end)) or start > end:
        sys.exit(f"rango inválido: {start!r}..{end!r}")
    if not all(i.isdigit() for i in ids):
        sys.exit(f"release_id inválidos: {ids!r}")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    meta: dict = {"calls": []}
    pages: list[dict] = []
    status, offset, count = 200, 0, None
    while status == 200 and (count is None or offset < count) and len(pages) < MAX_PAGES:
        utc = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        status, body, url = get("releases/dates", {"realtime_start": start, "realtime_end": end, "limit": PAGE,
                                                   "offset": offset, "sort_order": "asc",
                                                   "include_release_dates_with_no_data": "true"}, key)
        if key.encode() in body:
            sys.exit("la respuesta contiene la clave; no se guarda")
        meta["calls"].append({"method": "GET", "url": url, "utc": utc, "status": status, "bytes": len(body)})
        print(f"{status} {len(body):>8} B  {url}")
        if status != 200:
            (out / "releases.error.txt").write_bytes(body)
            break
        page = json.loads(body)
        pages.append(page)
        count, offset = page.get("count", 0), offset + PAGE
    rows = [r for page in pages for r in page.get("release_dates", [])]
    complete = status == 200 and count is not None and len(rows) >= count
    meta.update({"count": count, "rows": len(rows), "complete": complete})
    # Pages joined into one response: FRED's own fields from the first page, every row, and the paging used.
    full = {**(pages[0] if pages else {}), "offset": 0, "limit": len(rows), "release_dates": rows,
            "pages": len(pages)}
    (out / "releases.dates.json").write_text(json.dumps(full, ensure_ascii=False), encoding="utf-8")
    if not complete:
        print(f"incompleto: {len(rows)} de {count} filas")
    if pages and ids:
        rows = [r for r in rows if str(r.get("release_id")) in ids]
        excerpt = {"release_ids": [int(i) for i in ids], "realtime_start": start, "realtime_end": end,
                   "release_dates": rows}
        (out / "releases.dates.excerpt.json").write_text(json.dumps(excerpt, indent=2, ensure_ascii=False),
                                                         encoding="utf-8")
        meta["excerpt"] = {"release_ids": excerpt["release_ids"], "rows": len(rows)}
        print(f"extracto: {len(rows)} fechas de {len(ids)} publicaciones")
    (out / "releases.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return 0 if complete else 1


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
    if sys.argv[2] == "--releases":
        if len(sys.argv) < 5:
            sys.exit(__doc__)
        sys.exit(releases(sys.argv[1], sys.argv[3], sys.argv[4], sys.argv[5:]))
    sys.exit(main(sys.argv[1], sys.argv[2:]))
