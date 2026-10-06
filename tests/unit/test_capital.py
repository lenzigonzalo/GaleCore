"""WS-0012 (P1-04): capital available, concentration against the limits and «tengo X USD», from GaleCore's numbers."""

from __future__ import annotations

from galecore_ai.application import capital, supervisor
from galecore_ai.application.profile import set_profile
from galecore_ai.contracts.profile import ProfileContent, ReferenceCapital
from tests.unit.test_knowledge import HOST, NOW, kb  # noqa: F401  (kb is a fixture)

LIMITS = [
    "pérdida máxima por operación 5 % del capital de referencia (500 USD)",
    "riesgo máximo sumado de las posiciones abiertas 50 % del capital de referencia (5.000 USD)",
    "reserva para ajustes 10 % del capital, sin asignar",
    "una apuesta (mismo subyacente y dirección, vencimiento en la misma semana) no pasa el 30 % del riesgo abierto",
]
PROFILE = ProfileContent(reference_capital=ReferenceCapital(amount=10000.0, currency="USD"), risk_limits=LIMITS)


def exposure(**kw):
    bet = {"key": "SPY bullish 2026-W47", "positions": 3, "maxRisk": 1368.0, "pctOfMaxOpenRisk": 27.4,
           "expirations": ["2026-11-16", "2026-11-18", "2026-11-20"], "pctOfCapital": 13.7}
    base = {"asOf": "2026-10-06T14:00:00Z", "limits": {"capital": 10000.0}, "reserveUsd": 1000.0,
            "maxRiskPerTradeUsd": 500.0, "maxOpenRiskUsd": 5000.0, "maxBetUsd": 1500.0, "positionsOpen": 3,
            "openMaxRisk": 1368.0, "openRiskPctOfCapital": 13.7, "unrealizedPnl": 12.5, "openNotValued": 0,
            "idleUsd": 8632.0, "availableForNewRiskUsd": 3632.0, "bets": [bet],
            "bySymbol": [{"key": "SPY", "maxRisk": 1368.0, "pctOfCapital": 13.7}],
            "byStrategy": [{"key": "spy_pcs", "maxRisk": 1368.0}],
            "byExpiration": [{"key": "2026-11-16", "positions": 1, "maxRisk": 456.0}],
            "checks": [{"limit": "open_risk", "used": 1368.0, "max": 5000.0, "headroom": 3632.0, "ok": True},
                       {"limit": "bet:SPY bullish 2026-W47", "used": 1368.0, "max": 1500.0, "headroom": 132.0,
                        "ok": True}]}
    return {**base, **kw}


def allocation(fits=True):
    strat = {"specName": "spy_pcs", "specVersion": "1.0.5", "symbol": "SPY", "structure": "put_credit_spread",
             "width": 5.0, "riskPerContract": 456.0, "riskSource": "observed", "maxRiskPerTradeUsd": 500.0 if fits else 250.0,
             "contractsPerPosition": 1 if fits else 0, "positions": 10 if fits else 0,
             "riskUsd": 4560.0 if fits else 0.0, "positionsPerWeek": 3 if fits else 0,
             "bindingLimit": "budget" if fits else "per_trade", "fits": fits, "maxWidthThatFits": None if fits else 2.0}
    days = [1, 2, 3, 6, 7, 8, 11, 12, 13, 16] if fits else []
    ladder = [{"day": d, "week": (d - 1) // 5 + 1, "specName": "spy_pcs", "contracts": 1, "riskUsd": 456.0,
               "cumulativeRiskUsd": 456.0 * (i + 1)} for i, d in enumerate(days)]
    return {"reserveUsd": 1000.0 if fits else 500.0, "riskBudgetUsd": 5000.0 if fits else 2500.0,
            "maxRiskPerTradeUsd": 500.0 if fits else 250.0, "maxOpenRiskUsd": 5000.0 if fits else 2500.0,
            "maxBetUsd": 1500.0 if fits else 750.0, "allocatedRiskUsd": 4560.0 if fits else 0.0,
            "unallocatedRiskUsd": 440.0 if fits else 2500.0, "cashUsd": 5440.0 if fits else 5000.0,
            "strategies": [strat], "ladder": ladder, "assumptions": ["a"], "strategiesNotFound": []}


def test_limits_are_read_from_the_profile_words():
    lim = capital.limits(PROFILE)
    assert lim == {"capital_referencia": 10000.0, "no_leidos": [], "maxRiskPerTradePct": 5.0,
                   "maxOpenRiskPct": 50.0, "reservePct": 10.0, "maxBetPct": 30.0}


def test_a_limit_the_profile_does_not_declare_is_listed_not_guessed():
    lim = capital.limits(ProfileContent(risk_limits=LIMITS[:2]))
    assert lim["reservePct"] is None and "reserva para ajustes" in lim["no_leidos"]
    assert "tope de una apuesta" in lim["no_leidos"] and "capital de referencia" in lim["no_leidos"]
    assert capital.limits(None)["no_leidos"] == ["perfil: no hay perfil"]


def test_small_positions_of_the_same_week_are_said_as_one_bet():
    out = capital.concentration(exposure())
    assert "3 posiciones que son una sola apuesta" in out["lectura"] and "1.368 USD" in out["lectura"]
    assert "no hay diversificación entre activos" in out["lectura"] and "Límites cumplidos" in out["lectura"]
    assert out["apuestas"][0]["dentro_del_tope"] is True and out["fuera_de_limite"] == 0


def test_a_broken_limit_is_said_with_its_numbers():
    broken = {"limit": "bet:SPY bullish 2026-W47", "used": 1968.0, "max": 1500.0, "headroom": -468.0, "ok": False}
    out = capital.concentration(exposure(checks=[broken]))
    assert out["fuera_de_limite"] == 1 and "Fuera de límite: apuesta SPY bullish 2026-W47 1.968 de 1.500" in out["lectura"]


def test_nothing_open_is_no_concentration():
    out = capital.concentration(exposure(bets=[], bySymbol=[], byStrategy=[], byExpiration=[], checks=[]))
    assert out["lectura"].startswith("Nada abierto")


def test_available_is_on_the_reference_capital():
    out = capital.available(exposure())
    assert out["ocioso_usd"] == 8632.0 and out["riesgo_nuevo_disponible_usd"] == 3632.0
    assert "entra riesgo nuevo por 3.632" in out["lectura"]


def test_split_with_ladder_and_cash():
    out = capital.split(allocation(), 10000.0)
    assert out["semanas"] == 4 and len(out["escalera"]) == 10 and out["efectivo_usd"] == 5440.0
    assert "Entran 10 posiciones por 4.560 USD" in out["lectura"] and "no una orden" in out["aviso"]
    assert any("diversificación posible es en el tiempo" in n for n in out["notas"])


def test_split_that_does_not_fit_says_why_and_the_alternatives():
    out = capital.split(allocation(fits=False), 5000.0)
    assert out["escalera"] == [] and "no entra ninguna posición" in out["lectura"]
    [note] = [n for n in out["notas"] if "no entra" in n]
    assert "arriesga 456" in note and "máximo por operación es 250" in note
    assert "ancho 2" in note and "aprobación" in note and "esperar" in note


def test_report_passes_the_profile_percentages_and_the_amount(kb):  # noqa: F811
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    asked = []

    def read(path):
        asked.append(path)
        return exposure() if path.startswith("/App/Runtime/Exposure") else allocation(fits=False)

    out = capital.report(kb, read, capital=5000.0, strategies=["spy_pcs"])
    assert asked[0] == ("/App/Runtime/Exposure?capital=10000.0&maxRiskPerTradePct=5.0&maxOpenRiskPct=50.0"
                        "&reservePct=10.0&maxBetPct=30.0")
    assert asked[1].startswith("/App/Runtime/Allocation?capital=5000.0&") and asked[1].endswith("&spec=spy_pcs")
    assert out["reparto"]["capital"] == 5000.0 and out["disponible"]["capital"] == 10000.0
    assert any("aparte de lo abierto" in f for f in out["faltantes"]) and "profile:v1" in out["fuente"]


def test_report_without_limits_says_which_and_does_not_call_galecore(kb):  # noqa: F811
    set_profile(kb.profile, changes={"risk_limits": LIMITS[:2]}, note="n", prompt="p", host=HOST, now=NOW)
    out = capital.report(kb, lambda path: (_ for _ in ()).throw(AssertionError(path)))
    assert out["status"] == "MISSING_LIMITS" and "reserva para ajustes" in out["error"]


def test_report_refuses_what_is_not_exposure(kb):  # noqa: F811
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    try:
        capital.report(kb, lambda path: [])
    except supervisor.SupervisorError as exc:
        assert "no es exposición" in str(exc)
    else:
        raise AssertionError("a list is not an exposure")
