"""Contexto del momento para cada turno del Lab: reloj, calendario, mapa de GaleCore y contexto del trader.

Lo corre el Lab antes de cada turno, para cualquier motor (D-0014). Lo estable (`galecore-ai/PRODUCT.md`) va aparte;
acá sólo lo que cambia, con tope de diseño de 6.000 caracteres (D-0012).
"""
import datetime
import json
import subprocess
import sys

from concepto import es_concepto

sys.stdout.reconfigure(encoding="utf-8")
try:  # el Lab pasa {"prompt","cwd"}; sin eso (o sin JSON) el contexto es el completo de siempre
    _EVENT = {} if sys.stdin is None or sys.stdin.isatty() else json.load(sys.stdin)
except ValueError:
    _EVENT = {}
_LIGHT = isinstance(_EVENT, dict) and es_concepto(_EVENT.get("prompt") or "", _EVENT.get("cwd"))


def start(*args):
    return subprocess.Popen([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")


# Las consultas corren a la vez y el reloj una sola vez: en serie eran ~7 s antes de cada turno (WS-0039).
# Owner 19/10: «Mercado hoy» no puede salir vacío al retomar: SPY, VIX y eventos de GaleCore, en paralelo con el resto.
_TODAY = datetime.date.today()
_FROM = (_TODAY - datetime.timedelta(days=12)).isoformat()
_RUNS = {"clock": start("clock"), "space": start("space", "context")}
# Una pregunta de concepto no usa el mercado, el mapa ni la cuenta: no se consultan (WS-0050).
if not _LIGHT:
    _RUNS |= {"list": start("galecore", "list"),
         "spy": start("galecore", "get", "market_data.candles", "--param", "symbol=SPY", "--param", "interval=1d",
                      "--param", "fromTime=" + _FROM),
         "vix": start("galecore", "get", "history.index_daily", "--param", "Index=VIX", "--param", "From=" + _FROM),
         "fomc": start("galecore", "get", "calendar.fomc_meetings", "--param", f"Years={_TODAY.year}"),
         "macro": start("galecore", "get", "calendar.macro_releases", "--param", f"From={_TODAY}",
                        "--param", f"To={_TODAY + datetime.timedelta(days=21)}",
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
        if out.returncode:
            raise ValueError
        return "[reloj] " + json.loads(out.stdout)["summary"]
    except (ValueError, KeyError, TypeError):
        return "[reloj] no disponible: no asumas la fecha ni si el mercado está abierto."


def galecore_map():
    """Qué sirve GaleCore (de `galecore list`, agrupado por área) y qué no."""
    out = cli("galecore", "list")
    try:
        if out.returncode:
            raise ValueError
        caps = json.loads(out.stdout)["capabilities"]
        if not isinstance(caps, list) or any(not isinstance(c, dict) or not isinstance(c.get("id"), str)
                                              for c in caps):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return "[mapa de GaleCore] no disponible: `galecore list`."
    areas = {}
    for c in caps:
        area, _, name = c["id"].partition(".")
        areas.setdefault(area, []).append(name)
    lines = ["[mapa de GaleCore] Lo que GaleCore sirve (`galecore get <área.nombre> --param k=v`; "
             "el detalle: `galecore list`):"]
    lines += [f"- {a}: {', '.join(n)}" for a, n in areas.items()]
    board = next((c for c in caps if c["id"] == "macro.board"), None)
    if board and board.get("what"):
        lines.append(f"- macro.board: {board['what']}")
    lines.append("Próximo balance, hora y consenso de EPS, sector e industria, ex-dividendo: "
                 "`market_data.volatility_metrics`; balances pasados: `market_data.earnings_history`. "
                 "No lo sirve (no está abordado por GaleCore): noticias, objetivos de precio, consenso fuera del EPS. "
                 "Ante eso: `gap add` y decirlo; la web sólo si el trader la pide o para un dato puntual, "
                 "con fuente y fecha.")
    return chr(10).join(lines)


def week_line():
    """Días de la semana de los próximos 7 días, para decir fechas relativas sin errores."""
    names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    out = cli("clock")
    try:
        now = datetime.datetime.fromisoformat(json.loads(out.stdout)["now_ny"]).date()
    except (ValueError, KeyError, TypeError):
        return ""
    near = ["hoy", "mañana", "pasado mañana"]
    days = [f"{near[i] if i < 3 else ''} {names[d.weekday()]} {d:%d/%m}".strip()
            for i, d in enumerate(now + datetime.timedelta(days=i) for i in range(7))]
    return "[calendario NY] " + " · ".join(days)


def _data(key):
    out = cli(key)
    if out.returncode:
        raise ValueError("consulta fallida")
    data = json.loads(out.stdout)["data"]
    data = data["data"] if isinstance(data, dict) else data
    if not isinstance(data, list):
        raise ValueError("respuesta no válida")
    return data


def _num(x):
    return f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _day(iso: str) -> str:
    return iso[8:10] + "/" + iso[5:7]


def _spy():
    spy = sorted((c for c in _data("spy") or [] if c.get("close")), key=lambda c: c["time"])
    if len(spy) < 2:
        return ""
    last, base = spy[-1], spy[-6] if len(spy) >= 6 else spy[0]
    top = max(spy[-6:], key=lambda c: c["high"])
    # Revisión 19/10: con el mercado abierto la vela de hoy está en curso; no es un «cierre».
    live = last["timeStamp"][:10] == _TODAY.isoformat() and "ABIERTO" in clock_line()
    label = f"último {_day(last['timeStamp'])}, intradía" if live else f"cierre {_day(last['timeStamp'])}"
    change = (last["close"] / base["close"] - 1) * 100
    return (f"SPY {_num(last['close'])} ({label}), {_num(change)} % en {min(5, len(spy) - 1)} ruedas, "
            f"máximo {_num(top['high'])} el {_day(top['timeStamp'])}")


def _vix():
    vix = sorted((r for r in _data("vix") or [] if r.get("close")), key=lambda r: r["date"])
    if len(vix) < 2:
        return ""
    last, base = vix[-1], vix[-6] if len(vix) >= 6 else vix[0]
    return f"VIX {_num(last['close'])} ({_day(last['date'])}), desde {_num(base['close'])} el {_day(base['date'])}"


def _events():
    events, missing = [], []
    for key, label in (("fomc", "FOMC"), ("macro", "eventos macro")):
        try:
            rows = _data(key)
            if key == "fomc":
                events += [(m["start"][:10], f"Fed {m['start'][8:10]}-{_day(m['end'])}")
                           for m in rows if str(m.get("start", ""))[:10] >= _TODAY.isoformat()][:1]
            else:
                events += [(r["date"][:10], f"{r['releaseName'][:40]} {_day(r['date'])}")
                           for r in rows if r.get("date")]
        except (ValueError, KeyError, TypeError, AttributeError, IndexError):
            missing.append(f"{label}: consulta fallida o respuesta no válida; datos no disponibles")
    upcoming = ["próximos: " + ", ".join(e for _, e in sorted(events)[:4])] if events else []
    return " · ".join(upcoming + missing)


def market_line():
    """Cómo viene el mercado: SPY y VIX de las últimas ruedas y los próximos eventos. Una parte que falla o cambia de
    forma se avisa sin tumbar el resto del contexto (WS-0059)."""
    parts = []
    for label, part in (("SPY", _spy), ("VIX", _vix), ("eventos", _events)):
        try:
            if text := part():
                parts.append(text)
        except (ValueError, KeyError, TypeError, AttributeError, IndexError, ZeroDivisionError):
            parts.append(f"{label}: consulta fallida o respuesta no válida; datos no disponibles")
    return ("[mercado] " + " · ".join(parts) + ". Para «Mercado hoy» y para no dar el mercado por quieto; "
            "lo demás (cadena, GEX, curva) se trae si hace falta.") if parts else ""


print(clock_line())
print(week_line())
if not _LIGHT:
    line = market_line()
    if line:
        print(line)
    print(galecore_map())
print()
out = cli("space", "context")
if out.returncode != 0:
    print("[espacio del trader] consulta fallida; nombre, intereses y memoria no disponibles.")
    print(out.stderr, file=sys.stderr)
else:
    print(out.stdout)
