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
_TODAY = __import__("datetime").date.today()
_FROM = (_TODAY - __import__("datetime").timedelta(days=12)).isoformat()
# Owner 19/10: «Mercado hoy» no puede salir vacío al retomar; SPY, VIX y eventos de GaleCore (~1,5 s, en paralelo).
_RUNS = {"clock": start("clock"), "list": start("galecore", "list"), "space": start("space", "context"),
         "spy": start("galecore", "get", "market_data.candles", "--param", "symbol=SPY", "--param", "interval=1d",
                      "--param", "fromTime=" + _FROM),
         "vix": start("galecore", "get", "history.index_daily", "--param", "Index=VIX", "--param", "From=" + _FROM),
         "fomc": start("galecore", "get", "calendar.fomc_meetings", "--param", f"Years={_TODAY.year}"),
         "macro": start("galecore", "get", "calendar.macro_releases", "--param", f"From={_TODAY}",
                        "--param", f"To={_TODAY + __import__('datetime').timedelta(days=21)}",
                        "--param", "ReleaseIds=50,10,46,53,54,9")}


class _Out:
    def __init__(self, proc):
        self.stdout, self.stderr = proc.communicate()
        self.returncode = proc.returncode


_DONE = {}


def cli(*args):
    key = args[0] if args[0] in _RUNS else {"galecore": "list"}[args[0]]
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


def _data(key):
    try:
        body = json.loads(cli(key).stdout)
        return body["data"]["data"] if isinstance(body.get("data"), dict) else body["data"]
    except (ValueError, KeyError, TypeError):
        return None


def _num(x):
    return f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def market_line():
    """Cómo viene el mercado: SPY y VIX de las últimas ruedas y los próximos eventos. Sin datos, se omite la parte."""
    parts = []
    spy = sorted((c for c in _data("spy") or [] if c.get("close")), key=lambda c: c["time"])
    if len(spy) >= 2:
        last, base = spy[-1], spy[-6] if len(spy) >= 6 else spy[0]
        top = max(spy[-6:], key=lambda c: c["high"])
        day = lambda c: c["timeStamp"][8:10] + "/" + c["timeStamp"][5:7]  # noqa: E731
        change = (last["close"] / base["close"] - 1) * 100
        parts.append(f"SPY {_num(last['close'])} (cierre {day(last)}), {_num(change)} % en {min(5, len(spy) - 1)} "
                     f"ruedas, máximo {_num(top['high'])} el {day(top)}")
    vix = sorted((r for r in _data("vix") or [] if r.get("close")), key=lambda r: r["date"])
    if len(vix) >= 2:
        last, base = vix[-1], vix[-6] if len(vix) >= 6 else vix[0]
        parts.append(f"VIX {_num(last['close'])} ({last['date'][8:10]}/{last['date'][5:7]}), "
                     f"desde {_num(base['close'])} el {base['date'][8:10]}/{base['date'][5:7]}")
    events = [(m["start"][:10], "Fed " + m["start"][8:10] + "-" + m["end"][8:10] + "/" + m["end"][5:7])
              for m in _data("fomc") or [] if str(m.get("start", ""))[:10] >= _TODAY.isoformat()][:1]
    events += [(r["date"][:10], r["releaseName"][:40] + " " + r["date"][8:10] + "/" + r["date"][5:7])
               for r in _data("macro") or [] if r.get("date")]
    if events:
        parts.append("próximos: " + ", ".join(e for _, e in sorted(events)[:4]))
    return ("[mercado] " + " · ".join(parts) + ". Para «Mercado hoy» y para no dar el mercado por quieto; "
            "lo demás (cadena, GEX, curva) se trae si hace falta.") if parts else ""


print(clock_line())
print(week_line())
line = market_line()
if line:
    print(line)
print(galecore_map())
print()
out = cli("space", "context")
print(out.stdout)
if out.returncode != 0:
    print(out.stderr, file=sys.stderr)
