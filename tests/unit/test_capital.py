"""WS-0012 (P1-04): capital available, concentration against the limits and «tengo X USD», from GaleCore's numbers.
WS-0058: the limits are the ones each strategy declares in its design; the real account is read without caps."""

from __future__ import annotations

from types import SimpleNamespace

from galecore_ai.application import capital, supervisor
from galecore_ai.contracts.strategy import StrategyLimits

SL = StrategyLimits(max_risk_per_trade_pct=5.0, max_open_risk_pct=50.0, reserve_pct=10.0, max_bet_pct=30.0)


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


def test_limits_are_read_from_the_strategy_design():
    lim = capital.limits(_Doc(10000.0, limits=SL))
    assert lim == {"capital_referencia": 10000.0, "no_leidos": [], "maxRiskPerTradePct": 5.0,
                   "maxOpenRiskPct": 50.0, "reservePct": 10.0, "maxBetPct": 30.0}


def test_a_limit_the_design_does_not_declare_is_listed_not_guessed():
    lim = capital.limits(_Doc(None, limits=StrategyLimits(max_risk_per_trade_pct=5.0, max_open_risk_pct=50.0)))
    assert lim["reservePct"] is None and "reserva para ajustes" in lim["no_leidos"]
    assert "tope de una apuesta" in lim["no_leidos"] and "monto simulado" in lim["no_leidos"]
    assert len(capital.limits(_Doc(10000.0))["no_leidos"]) == 4          # no `limits` at all: nothing is guessed
    assert capital.limits(None)["no_leidos"] == ["la estrategia no tiene diseño guardado"]


def test_small_positions_of_the_same_week_are_said_as_one_bet():
    out = capital.concentration(exposure())
    assert "3 posiciones que son una sola apuesta" in out["lectura"] and "1.368 USD" in out["lectura"]
    assert "no hay diversificación entre activos" in out["lectura"] and "Límites cumplidos" in out["lectura"]
    assert out["apuestas"][0]["dentro_del_tope"] is True and out["fuera_de_limite"] == 0


def test_a_broken_limit_is_said_with_its_numbers():
    broken = {"limit": "bet:SPY bullish 2026-W47", "used": 1968.0, "max": 1500.0, "headroom": -468.0, "ok": False}
    out = capital.concentration(exposure(checks=[broken]))
    assert out["apuestas"][0]["dentro_del_tope"] is False      # GaleCore's check, not recomputed
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
    assert "ancho 2 entraría si cobrara el mismo crédito relativo" in note and "aprobación" in note and "esperar" in note


def _kb(*docs):
    store = {f"spy_pcs/1.0.{i}": d for i, d in enumerate(docs, 5)}
    return SimpleNamespace(strategies=_Store(store, set(store)))


def test_report_passes_the_strategy_percentages_and_the_amount():
    kb = _kb(_Doc(10000.0, limits=SL))
    asked = []

    def read(path):
        if path == "/App/Runtime/Instances":   # which version runs (none here)
            return []
        asked.append(path)
        return exposure() if path.startswith("/App/Runtime/Exposure") else allocation(fits=False)

    out = capital.report(kb, read, capital=5000.0, strategies=["spy_pcs"])
    assert asked[0] == ("/App/Runtime/Exposure?capital=5000.0&maxRiskPerTradePct=5.0&maxOpenRiskPct=50.0"
                        "&reservePct=10.0&maxBetPct=30.0")
    assert asked[1].startswith("/App/Runtime/Allocation?capital=5000.0&") and asked[1].endswith("&spec=spy_pcs")
    assert out["reparto"]["capital"] == 5000.0 and "diseño de cada estrategia" in out["fuente"]
    assert any("aparte de lo abierto" in f for f in out["faltantes"])
    same = capital.report(kb, read)
    assert asked[-2].startswith("/App/Runtime/Exposure?capital=10000.0&")        # its own amount
    assert any("no descuenta lo ya abierto (1.368 en riesgo)" in f for f in same["faltantes"])


def test_report_without_limits_says_which_and_does_not_call_galecore():
    kb = _kb(_Doc(10000.0, limits=StrategyLimits(max_risk_per_trade_pct=5.0, max_open_risk_pct=50.0)))
    out = capital.report(kb, lambda path: (_ for _ in ()).throw(AssertionError(path)))
    assert out["status"] == "MISSING_LIMITS" and "reserva para ajustes" in out["error"]


def test_report_refuses_what_is_not_exposure():
    try:
        capital.report(_kb(_Doc(10000.0, limits=SL)), lambda path: [])
    except supervisor.SupervisorError as exc:
        assert "no es exposición" in str(exc)
    else:
        raise AssertionError("a list is not an exposure")


def test_missing_spec_data_is_not_said_as_a_limit():
    plan = allocation(fits=False)
    plan["strategies"][0].update(riskSource="none", bindingLimit="no_width", riskPerContract=None, maxWidthThatFits=None)
    out = capital.split(plan, 10000.0)
    assert out["por_estrategia"][0]["riesgo_de"] == "no calculable"
    assert "faltan datos de la spec" in out["lectura"] and any("falta un dato, no es un límite" in n for n in out["notas"])
    none = capital.split({**allocation(fits=False), "strategies": [], "strategiesNotFound": ["spy_pcs"]}, 10000.0)
    assert "no encontró spy_pcs" in none["lectura"] and "no es por los límites" in none["lectura"]


def _overview(**kw):
    base = {"asOf": "2026-10-16T20:00:00Z", "netLiq": 2500.0, "maxRisk": 1860.0, "attention": [],
            "positions": [{"symbol": "SPY", "structure": "PUT_CS", "expiration": "2026-11-20", "maxLoss": 1860.0}]}
    return {**base, **kw}


def test_real_account_is_read_without_caps_and_describes_a_candidate():
    asked = []

    def read(path):
        asked.append(path)
        return _overview()

    out = capital.real_account(read, width=5, credit=4.0, symbol="SPY")
    assert asked == ["/App/GaleCore/Account/Overview"]                      # no caps are passed (WS-0058)
    assert out["valor_cuenta_usd"] == 2500.0 and out["riesgo_abierto_pct_de_la_cuenta"] == 74.4
    assert out["posiciones"][0]["pct_de_la_cuenta"] == 74.4 and out["riesgo_abierto_completo"] is True
    c = out["candidato"]
    assert c["perdida_maxima_usd"] == 100.0 and c["riesgo_abierto_despues_usd"] == 1960.0 and c["pct_de_la_cuenta"] == 4.0
    assert "nada lo bloquea" in out["aviso"] and "tope" not in out["lectura"] and "cumple" not in out["lectura"]


def test_real_account_with_unpaired_legs_or_no_risk_keeps_galecore_missing():
    unpaired = "Patas sin emparejar (no suman a riesgo ni exposición): SPY 251121P00700000."
    small = {"maxRisk": 100.0, "positions": [], "missing": [unpaired, "Historia del valor de la cuenta: sin dato."]}
    out = capital.real_account(lambda path: _overview(**small), width=5, credit=4.5)
    assert out["riesgo_abierto_completo"] is False and "(incompleto)" in out["lectura"]
    assert out["faltantes"][:2] == ["afecta el riesgo abierto: " + unpaired, "Historia del valor de la cuenta: sin dato."]
    none = capital.real_account(lambda path: _overview(maxRisk=None, positions=[]), width=5, credit=4.5)
    assert none["riesgo_abierto_usd"] is None and none["candidato"]["riesgo_abierto_despues_usd"] is None
    assert any("no informó el riesgo abierto" in f for f in none["faltantes"])


class _Doc:
    def __init__(self, amount, spec_hash="", limits=None):
        self.content = SimpleNamespace(simulated_amount_usd=amount, limits=limits)
        self.spec_hash = spec_hash


class _Store:
    def __init__(self, docs, approved):
        self.docs, self.approved = docs, approved

    def versions(self):
        return list(self.docs)

    def load(self, key):
        return self.docs.get(key)

    def load_approval(self, key):
        return key in self.approved or None


def _pick(a):
    return {k: a[k] for k in ("version", "aprobada", "corriendo", "monto")}


def test_simulated_amount_comes_from_the_approved_version_not_a_later_draft():
    docs = {"a/1.0.3": _Doc(4000.0), "a/1.0.10": _Doc(9000.0),   # approved A, later draft B
            "old/1.0.0": _Doc(None),                              # an old design without an amount
            "b/1.0.0": _Doc(2000.0), "c/1.0.0": _Doc(3000.0)}     # several strategies, different amounts
    fake = type("KB", (), {"strategies": _Store(docs, {"a/1.0.3", "b/1.0.0"})})()
    out = capital._simulated_amounts(fake, ["a", "old", "b", "c", "none"])
    assert _pick(out["a"]) == {"version": "1.0.3", "aprobada": True, "corriendo": False, "monto": 4000.0}
    assert out["old"]["monto"] is None and out["b"]["monto"] == 2000.0
    assert _pick(out["c"]) == {"version": "1.0.0", "aprobada": False, "corriendo": False, "monto": 3000.0}   # a draft
    assert _pick(out["none"]) == {"version": None, "aprobada": False, "corriendo": False, "monto": None}


def test_simulated_amount_comes_from_the_version_shadow_runs_not_a_newer_approval():
    # Batería 17/10 (revisión de Codex): 1.0.1 approved after 1.0.0 was deployed; SHADOW still runs 1.0.0.
    docs = {"a/1.0.0": _Doc(4000.0, "sha256:old"), "a/1.0.1": _Doc(9000.0, "sha256:new")}
    fake = type("KB", (), {"strategies": _Store(docs, {"a/1.0.0", "a/1.0.1"})})()
    out = capital._simulated_amounts(fake, ["a"], running={"sha256:old"})
    assert _pick(out["a"]) == {"version": "1.0.0", "aprobada": True, "corriendo": True, "monto": 4000.0}
    assert capital._simulated_amounts(fake, ["a"], running=set())["a"]["version"] == "1.0.1"   # none running


def test_running_hashes_are_the_running_shadow_instances():
    rows = [{"mode": "SHADOW", "lifecycleState": "RUNNING", "versionHash": "h1"},
            {"mode": "SHADOW", "lifecycleState": "STOPPED", "versionHash": "h2"}]
    assert capital._running_hashes(lambda path: rows) == {"h1"}
    assert capital._running_hashes(lambda path: (_ for _ in ()).throw(RuntimeError("down"))) is None


def test_report_sized_by_declared_amounts_with_each_strategys_limits():
    kb = _kb(_Doc(4000.0, limits=SL))
    asked = []

    def read(path):
        if path == "/App/Runtime/Instances":   # which version runs (none here)
            return []
        asked.append(path)
        return exposure() if path.startswith("/App/Runtime/Exposure") else allocation()

    out = capital.report(kb, read)
    assert "status" not in out and asked[0].startswith("/App/Runtime/Exposure?capital=4000.0&")
    assert out["montos_simulados"][0]["monto_usd"] == 4000.0
    # a what-if brings its own capital: only the design's percentages are needed
    assert capital.report(kb, read, capital=3000.0)["reparto"]["capital"] == 3000.0
    bare = capital.report(_kb(_Doc(None, limits=SL)), read)                       # no amount declared: not split
    assert bare["status"] == "MISSING_LIMITS" and "monto simulado" in bare["error"]


def test_real_account_refuses_half_a_candidate():
    try:
        capital.real_account(lambda path: _overview(), width=5)
    except supervisor.SupervisorError as exc:
        assert "ancho y crédito" in str(exc)
    else:
        raise AssertionError("expected SupervisorError")
