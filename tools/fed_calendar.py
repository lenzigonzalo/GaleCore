"""Calendario de reuniones del FOMC desde la página oficial de la Fed, guardado para `evidence add` (GC-AI-0016).

Uso: python tools/fed_calendar.py <out_dir> [<año> ...]      (por defecto: el año actual y el siguiente)
  ej: python tools/fed_calendar.py out 2026 2027

Un GET a https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (HTML servido, sin clave, gratis).
Guarda `fomc.meetings.json` (por año: mes, días, fecha de inicio y de fin, si lleva proyecciones económicas «*»,
el texto original) y `fomc.meta.json` (URL, hora UTC, status, bytes, sha256 del HTML). Las reuniones sin
programar («notation vote») se conservan con `scheduled: false`. Si la página cambia de forma y no se
reconoce un año pedido, sale con error en vez de devolver una lista vacía.
"""

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path

URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
TIMEOUT_S = 30
MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                      "September", "October", "November", "December"], start=1)}
SHORT = {m[:3]: i for m, i in MONTHS.items()}
_PANEL = re.compile(r'<h4><a id="\d+">(\d{4}) FOMC Meetings</a></h4>(.*?)(?=<h4><a id="\d+">\d{4} FOMC Meetings|\Z)',
                    re.DOTALL)
_MEETING = re.compile(r'fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<', re.DOTALL)
_DAYS = re.compile(r"^(\d{1,2})(?:-(\d{1,2}))?(\*)?\s*(\(.*\))?$")


RUN_DIR_ENV = "GALECORE_AI_RUN_DIR"   # set by a scheduled run (GC-AI-0017): files may only go under it


def output_dir(out_dir: str) -> Path:
    """The directory to write to; under a scheduled run it must be inside that run's scratch directory."""
    out = Path(out_dir).resolve()
    confine = os.environ.get(RUN_DIR_ENV)
    if confine and not out.is_relative_to(Path(confine).resolve()):
        sys.exit(f"{out} está fuera del directorio de la corrida ({confine}): no se escribe")
    return out


def _month_numbers(text: str) -> tuple[int, int]:
    if "/" in text:
        a, b = (SHORT[p.strip()[:3]] for p in text.split("/"))
        return a, b
    return MONTHS[text.strip()], MONTHS[text.strip()]


def parse(html: str) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {}
    for year_text, body in _PANEL.findall(html):
        year = int(year_text)
        meetings = []
        for month_text, days_text in _MEETING.findall(body):
            m = _DAYS.match(days_text.strip())
            if not m:
                raise ValueError(f"fecha no reconocida: {month_text!r} {days_text!r}")
            first, last = int(m[1]), int(m[2] or m[1])
            m1, m2 = _month_numbers(month_text)
            end_year = year + 1 if m2 < m1 else year
            meetings.append({"month": month_text.strip(), "days": days_text.strip(),
                             "start": date(year, m1, first).isoformat(), "end": date(end_year, m2, last).isoformat(),
                             "sep": bool(m[3]), "scheduled": not m[4]})
        out[year] = meetings
    return out


def main(out_dir: str, years: list[int]) -> int:
    out = output_dir(out_dir)              # checked before any request
    utc = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    request = urllib.request.Request(URL, headers={"User-Agent": "GaleCore-AI fed_calendar (read-only)"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as resp:
            status, body = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, body = err.code, err.read()
    except (urllib.error.URLError, TimeoutError) as err:
        status, body = 0, str(err).encode()
    out.mkdir(parents=True, exist_ok=True)
    meta = {"method": "GET", "url": URL, "utc": utc, "status": status, "bytes": len(body),
            "sha256": "sha256:" + hashlib.sha256(body).hexdigest()}
    (out / "fomc.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"{status} {len(body):>8} B  {URL}")
    if status != 200:
        return 1
    calendar = parse(body.decode("utf-8", errors="replace"))
    unknown = [y for y in years if y not in calendar]
    if unknown:
        sys.exit(f"la página no trae (o ya no se reconoce) el calendario de: {unknown}")
    result = {"source": URL, "retrieved_at": utc, "years": {str(y): calendar[y] for y in years}}
    (out / "fomc.meetings.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    for y in years:
        print(y, ", ".join(f"{m['month']} {m['days']}" for m in calendar[y]))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    this_year = datetime.now(UTC).year
    wanted = [int(a) for a in sys.argv[2:]] or [this_year, this_year + 1]
    sys.exit(main(sys.argv[1], wanted))
