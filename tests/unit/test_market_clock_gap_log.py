from datetime import UTC, date, datetime

from galecore_ai.application import gap_log, market_clock


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def test_open_during_regular_session():
    s = market_clock.status(at("2026-10-13T15:00:00"))          # Tue 11:00 NY
    assert s.state == "open" and s.closes_at.hour == 16


def test_closed_after_close_reports_last_close_and_next_open():
    s = market_clock.status(at("2026-10-12T23:22:00"))          # Mon 19:22 NY
    assert s.state == "closed" and s.reason == "después del cierre"
    assert s.last_close.day == 12 and s.next_open.day == 13


def test_weekend_and_holiday():
    assert market_clock.status(at("2026-10-17T15:00:00")).reason == "fin de semana"
    assert "Acción de Gracias" in market_clock.status(at("2026-11-26T15:00:00")).reason


def test_early_close_day_after_thanksgiving():
    s = market_clock.status(at("2026-11-27T15:00:00"))
    assert s.early_close and s.closes_at.hour == 13


def test_observed_holidays_and_good_friday():
    assert date(2026, 7, 3) in market_clock.holidays(2026)       # Jul 4 is a Saturday
    assert date(2026, 4, 3) in market_clock.holidays(2026)       # Good Friday
    assert date(2027, 1, 1) not in market_clock.holidays(2027) or date(2027, 1, 1).weekday() < 5


def test_gap_log_counts_repeats_and_ranks(tmp_path):
    gap_log.add(tmp_path, need="Consenso de analistas", kind="data", why="a")
    again = gap_log.add(tmp_path, need="consenso de analistas", kind="data", why="b")
    gap_log.add(tmp_path, need="GEX de QQQ", kind="api_error")
    assert again["count"] == 2
    assert next(i["need"] for i in gap_log.items(tmp_path)) == "Consenso de analistas"


def test_gap_log_rejects_unknown_kind(tmp_path):
    try:
        gap_log.add(tmp_path, need="x", kind="web")
    except ValueError:
        return
    raise AssertionError("expected ValueError")
