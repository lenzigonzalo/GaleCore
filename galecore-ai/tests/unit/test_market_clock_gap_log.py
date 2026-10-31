from datetime import UTC, date, datetime

import pytest

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


def test_gap_log_merges_same_need_worded_differently(tmp_path):
    gap_log.add(tmp_path, need="Consenso de analistas para ganancias de NVDA", kind="data")
    again = gap_log.add(tmp_path, need="consenso de analistas de NVDA, próximo trimestre", kind="data")
    other = gap_log.add(tmp_path, need="Consenso de analistas para ganancias de AMD", kind="data")
    assert again["count"] == 2
    assert other["count"] == 1 and len(gap_log.items(tmp_path)) == 2


def test_api_errors_of_different_capabilities_are_not_merged(tmp_path):
    chains = gap_log.add(tmp_path, need="Error de API en market_data.option_chains", kind="api_error")
    greeks = gap_log.add(tmp_path, need="Error de API en market_data.option_greeks", kind="api_error")
    again = gap_log.add(tmp_path, need="Error de API en market_data.option_greeks", kind="api_error")
    assert chains["count"] == 1 and greeks["id"] != chains["id"] and again["count"] == 2


def test_gap_log_rejects_unknown_kind(tmp_path):
    try:
        gap_log.add(tmp_path, need="x", kind="web")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_gap_log_close_hides_it_and_a_new_ask_reopens_it(tmp_path):
    item = gap_log.add(tmp_path, need="Volumen en velas diarias", kind="data")
    closed = gap_log.close(tmp_path, item["id"], resolution="ParseLong arreglado")
    assert closed["resolution"] == "ParseLong arreglado" and gap_log.items(tmp_path) == []
    assert len(gap_log.items(tmp_path, include_closed=True)) == 1
    again = gap_log.add(tmp_path, need="Volumen en velas diarias", kind="data")
    assert "closed_at" not in again and again["count"] == 2 and len(gap_log.items(tmp_path)) == 1
    with pytest.raises(ValueError):
        gap_log.close(tmp_path, "no-existe", resolution="x")


def test_repeated_server_faults_are_raised_as_bugfix_but_caller_mistakes_are_not(tmp_path):
    for _ in range(5):   # a 4xx is the caller's mistake: counted, never a bugfix
        gap_log.add(tmp_path, need="Error de API en market_data.option_chains", kind="api_error", why="HTTP 400: Rango inválido")
    assert gap_log.bugfixes(tmp_path) == []
    for n in range(3):
        item = gap_log.add(tmp_path, need="Error de API en calendar.macro_releases", kind="api_error", why="HTTP 502: fred")
        assert ("bugfix" in item) == (n == 2)
    assert [i["id"] for i in gap_log.bugfixes(tmp_path)] == ["error-de-api-en-calendar-macro-releases"]
    gap_log.close(tmp_path, "error-de-api-en-calendar-macro-releases", resolution="arreglado")
    assert gap_log.bugfixes(tmp_path) == []
    again = gap_log.add(tmp_path, need="Error de API en calendar.macro_releases", kind="api_error", why="HTTP 502: fred")
    assert "bugfix" in again   # failing again after being closed raises it again
    gap_log.close(tmp_path, "error-de-api-en-calendar-macro-releases", resolution="arreglado")
    timeout = gap_log.add(tmp_path, need="Error de API en calendar.macro_releases", kind="api_error", why="HTTP 400")
    assert "bugfix" not in timeout   # the closed 5xx do not count for a new non-5xx failure
