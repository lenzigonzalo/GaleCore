"""What time it is and whether the US equity market is open (BL-020).

Pure code, no network: regular session Mon-Fri 09:30-16:00 New York, NYSE holidays and 13:00 early closes by rule.
Extended hours are not modelled. Other countries are not implemented: add a market, not a new function.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
OPEN, CLOSE, EARLY_CLOSE = time(9, 30), time(16, 0), time(13, 0)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _easter(year: int) -> date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    j, k = c // 4, c % 4
    m = (a + 11 * h) // 319
    r = (2 * e + 2 * j - k - h + m + 32) % 7
    month, day = divmod(h - m + r + 90, 25)
    return date(year, month, day + 1)


def _observed(day: date) -> date | None:
    """Saturday holidays close the Friday before, Sunday ones the Monday after (Jan 1 on a Saturday: no closure)."""
    if day.weekday() == 5:
        return None if (day.month, day.day) == (1, 1) else day - timedelta(days=1)
    return day + timedelta(days=1) if day.weekday() == 6 else day


def holidays(year: int) -> dict[date, str]:
    fixed = {"Año Nuevo": date(year, 1, 1), "Juneteenth": date(year, 6, 19),
             "Día de la Independencia": date(year, 7, 4), "Navidad": date(year, 12, 25)}
    out: dict[date, str] = {}
    for name, raw in fixed.items():
        observed = _observed(raw)
        if observed:
            out[observed] = name
    out[_nth_weekday(year, 1, 0, 3)] = "Martin Luther King"
    out[_nth_weekday(year, 2, 0, 3)] = "Día de los Presidentes"
    out[_easter(year) - timedelta(days=2)] = "Viernes Santo"
    out[_last_weekday(year, 5, 0)] = "Memorial Day"
    out[_nth_weekday(year, 9, 0, 1)] = "Labor Day"
    out[_nth_weekday(year, 11, 3, 4)] = "Acción de Gracias"
    return out


def early_closes(year: int) -> set[date]:
    days = {_nth_weekday(year, 11, 3, 4) + timedelta(days=1), date(year, 12, 24)}
    if date(year, 7, 4).weekday() in (1, 2, 3, 4):
        days.add(date(year, 7, 3))
    return {d for d in days if d.weekday() < 5 and d not in holidays(year)}


def _session(day: date) -> tuple[datetime, datetime] | None:
    if day.weekday() >= 5 or day in holidays(day.year):
        return None
    close = EARLY_CLOSE if day in early_closes(day.year) else CLOSE
    return datetime.combine(day, OPEN, NEW_YORK), datetime.combine(day, close, NEW_YORK)


def _fmt(moment: datetime) -> str:
    return moment.strftime("%a %d/%m %H:%M")


@dataclass(frozen=True)
class MarketStatus:
    now_utc: datetime
    now_ny: datetime
    state: str                    # open | closed
    reason: str                   # sesión regular | antes de la apertura | después del cierre | fin de semana | feriado (...)
    last_close: datetime          # close of the last finished regular session
    next_open: datetime
    closes_at: datetime | None    # only while open
    early_close: bool

    def summary(self) -> str:
        head = f"Ahora {_fmt(self.now_ny)} Nueva York ({self.now_utc:%H:%M} UTC). Mercado EE. UU.: "
        if self.state == "open":
            tail = " (cierre anticipado)" if self.early_close else ""
            return head + f"ABIERTO, cierra {self.closes_at:%H:%M}{tail} NY."
        return (head + f"CERRADO ({self.reason}). Último cierre {_fmt(self.last_close)} NY; abre {_fmt(self.next_open)} NY. "
                "Sin datos en vivo: usar el último registrado y decir su fecha y hora.")

    def as_dict(self) -> dict:
        return {"now_utc": self.now_utc.isoformat(), "now_ny": self.now_ny.isoformat(),
                "market": "US equities (NYSE/Nasdaq)", "state": self.state, "reason": self.reason,
                "last_close_ny": self.last_close.isoformat(), "next_open_ny": self.next_open.isoformat(),
                "closes_at_ny": self.closes_at.isoformat() if self.closes_at else None,
                "early_close": self.early_close, "summary": self.summary()}


def status(now: datetime | None = None) -> MarketStatus:
    now_utc = (now or datetime.now(UTC)).astimezone(UTC)
    ny = now_utc.astimezone(NEW_YORK)
    today = _session(ny.date())
    state, reason, closes = "closed", "", None
    if today and today[0] <= ny < today[1]:
        state, reason, closes = "open", "sesión regular", today[1]
    elif today and ny < today[0]:
        reason = "antes de la apertura"
    elif today:
        reason = "después del cierre"
    elif ny.date().weekday() >= 5:
        reason = "fin de semana"
    else:
        reason = f"feriado ({holidays(ny.year)[ny.date()]})"
    last_close = next(s[1] for back in range(12) if (s := _session(ny.date() - timedelta(days=back))) and s[1] <= ny)
    next_open = next(s[0] for ahead in range(12) if (s := _session(ny.date() + timedelta(days=ahead))) and s[0] > ny)
    early = bool(today) and today[1].time() == EARLY_CLOSE
    return MarketStatus(now_utc, ny, state, reason, last_close, next_open, closes, early)
