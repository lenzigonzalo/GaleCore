"""Contexto del momento para cada turno del Lab: reloj, calendario, mapa de GaleCore y contexto del trader.

Lo corre el Lab antes de cada turno, para cualquier motor (D-0014). Lo estable (`GaleCore-AI/PRODUCT.md`) va aparte;
acá sólo lo que cambia, con tope de diseño de 6.000 caracteres (D-0012).
"""
import json
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")


def start(*args):
    return subprocess.Popen([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")


# Las tres consultas corren a la vez y el reloj una sola vez: en serie eran ~7 s antes de cada turno (WS-0039).
_RUNS = {"clock": start("clock"), "list": start("galecore", "list"), "space": start("space", "context")}


class _Out:
    def __init__(self, proc):
        self.stdout, self.stderr = proc.communicate()
        self.returncode = proc.returncode


_DONE = {}


def cli(*args):
    key = {"clock": "clock", "galecore": "list", "space": "space"}[args[0]]
    if key not in _DONE:
        _DONE[key] = _Out(_RUNS[key])
    return _DONE[key]


def clock_line():
    out = cli("clock")
    try:
        return "[reloj] " + json.loads(out.stdout)["summary"]
    except (ValueError, KeyError):
        return "[reloj] no disponible: no asumas la fecha ni si el mercado está abierto."


def galecore_map():
    """Qué sirve GaleCore (de `galecore list`, agrupado por área) y qué no."""
    out = cli("galecore", "list")
    try:
        caps = json.loads(out.stdout)["capabilities"]
    except (ValueError, KeyError):
        return "[mapa de GaleCore] no disponible: `galecore list`."
    areas = {}
    for c in caps:
        area, _, name = c["id"].partition(".")
        areas.setdefault(area, []).append(name)
    lines = ["[mapa de GaleCore] Lo que GaleCore sirve (`galecore get <área.nombre> --param k=v`; "
             "el detalle: `galecore list`):"]
    lines += [f"- {a}: {', '.join(n)}" for a, n in areas.items()]
    lines.append("Próximo balance, hora y consenso de EPS, sector e industria, ex-dividendo: "
                 "`market_data.volatility_metrics`; balances pasados: `market_data.earnings_history`. "
                 "No lo sirve (no está abordado por GaleCore): noticias, objetivos de precio, consenso fuera del EPS. "
                 "Ante eso: `gap add` y decirlo; la web sólo si el trader la pide o para un dato puntual, "
                 "con fuente y fecha.")
    return chr(10).join(lines)


def week_line():
    """Días de la semana de los próximos 7 días, para decir fechas relativas sin errores."""
    import datetime
    names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    out = cli("clock")
    try:
        now = datetime.datetime.fromisoformat(json.loads(out.stdout)["now_ny"]).date()
    except (ValueError, KeyError):
        return ""
    near = ["hoy", "mañana", "pasado mañana"]
    days = [f"{near[i] if i < 3 else ''} {names[d.weekday()]} {d:%d/%m}".strip()
            for i, d in enumerate(now + datetime.timedelta(days=i) for i in range(7))]
    return "[calendario NY] " + " · ".join(days)


print(clock_line())
print(week_line())
print(galecore_map())
print()
out = cli("space", "context")
print(out.stdout)
if out.returncode != 0:
    print(out.stderr, file=sys.stderr)
