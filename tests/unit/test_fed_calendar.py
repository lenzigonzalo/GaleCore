"""GC-AI-0016: FOMC calendar from the Fed's page (tools/fed_calendar.py), parsed without network."""

from __future__ import annotations

import pytest

from galecore_ai.application.catalog_check import CHECKOUT, _script_path
from tools import fed_calendar


def row(month: str, days: str) -> str:
    return (f'<div class="fomc-meeting__month col-xs-5"><strong>{month}</strong></div><div class="x">'
            f'<div class="fomc-meeting__date col-xs-4">{days}</div>')


def panel(year: int, *rows: str) -> str:
    return f'<div class="panel-heading"><h4><a id="{year}1">{year} FOMC Meetings</a></h4></div>' + "".join(rows)


HTML = (panel(2026, row("January", "27-28"), row("September", "15-16*"), row("October", "27-28"))
        + panel(2023, row("Jan/Feb", "31-1"), row("Oct/Nov", "31-1"))
        + panel(2025, row("August", "22 (notation vote)")))


def test_meetings_by_year_with_projections_and_month_crossings():
    cal = fed_calendar.parse(HTML)
    assert [m["start"] for m in cal[2026]] == ["2026-01-27", "2026-09-15", "2026-10-27"]
    assert [m["sep"] for m in cal[2026]] == [False, True, False]
    assert cal[2023][0]["end"] == "2023-02-01" and cal[2023][1]["end"] == "2023-11-01"
    assert cal[2025][0] == {"month": "August", "days": "22 (notation vote)", "start": "2025-08-22",
                            "end": "2025-08-22", "sep": False, "scheduled": False}


def test_an_unrecognised_date_fails_instead_of_being_dropped():
    with pytest.raises(ValueError, match="no reconocida"):
        fed_calendar.parse(panel(2026, row("January", "late January")))


def test_flow_scripts_under_galecore_ai_resolve_to_this_checkout(tmp_path):
    assert _script_path("GaleCore-AI/tools/fed_calendar.py", tmp_path) == CHECKOUT / "tools" / "fed_calendar.py"
    assert _script_path("GaleCore/dev/galecore_dev.py", tmp_path) == tmp_path / "GaleCore/dev/galecore_dev.py"
    assert _script_path("GaleCore-AI/tools/fed_calendar.py", tmp_path).is_file()
