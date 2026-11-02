"""WS-0073 AC-4: check_propuesta.py (strategy-design) con cadena y cotizaciones inyectadas, sin red."""
import importlib.util
from datetime import UTC, datetime
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "config" / "skills" / "strategy-design" / "scripts" / "check_propuesta.py"
spec = importlib.util.spec_from_file_location("check_propuesta", SCRIPT)
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)

CHAIN = {"expirations": [{"expirationDate": "2026-11-20", "strikes": [
    {"strikePrice": "700.0", "putStreamerSymbol": ".SPY261120P700", "callStreamerSymbol": ".SPY261120C700"},
    {"strikePrice": "695.0", "putStreamerSymbol": ".SPY261120P695", "callStreamerSymbol": ".SPY261120C695"}]}]}
QUOTES = {".SPY261120P700": {"bidPrice": 1.86, "askPrice": 1.91, "retrieved_at": "2026-11-02T15:00:00+00:00"},
          ".SPY261120P695": {"bidPrice": 1.60, "askPrice": 1.65, "retrieved_at": "2026-11-02T15:00:02+00:00"}}
MONDAY_OPEN = datetime(2026, 11, 2, 15, 0, tzinfo=UTC)   # 10:00 Nueva York


def spread(price=0.21, risk=479, short=700, fill="natural"):
    return {"underlying": "SPY", "structures": [{"id": "A", "kind": "credit", "price": price, "fill": fill,
            "max_risk_usd": risk, "legs": [
                {"expiration": "2026-11-20", "strike": short, "right": "put", "side": "sell", "qty": 1},
                {"expiration": "2026-11-20", "strike": 695, "right": "put", "side": "buy", "qty": 1}]}]}


def check(payload, quotes=QUOTES):
    return cp.run(payload, CHAIN, quotes.get, MONDAY_OPEN)


def test_put_spread_correcto_es_ok():
    out = check(spread())
    assert out["ok"] and not out["faltantes"]
    assert out["mercado_abierto"] and out["hora_consulta_ny"] == "2026-11-02 10:00:00"
    assert out["estructuras"][0]["separacion_patas_s"] == 2.0


def test_credito_alterado_falla_en_credito_y_riesgo_con_los_corregidos():
    s = check(spread(price=0.50, risk=450))["estructuras"][0]
    assert not s["ok"]
    assert s["corregidos"] == {"credit": 0.21, "riesgo": 479.0}


def test_un_credito_entre_natural_y_medio_es_valido():
    assert check(spread(price=0.24, risk=476))["ok"]


def test_pata_sin_cotizacion_sale_con_el_motivo():
    out = check(spread(), {".SPY261120P700": QUOTES[".SPY261120P700"]})
    assert not out["ok"] and "sin cotización" in out["faltantes"][0]["motivo"]


def test_cotizacion_cruzada_es_sin_propuesta():
    crossed = {**QUOTES, ".SPY261120P700": {"bidPrice": 2.0, "askPrice": 1.9, "retrieved_at": "2026-11-02T15:00:00+00:00"}}
    out = check(spread(), crossed)
    assert not out["ok"] and "cruzada" in out["faltantes"][0]["motivo"]


def test_strike_inexistente():
    out = check(spread(short=701))
    assert not out["ok"] and "strike 701 inexistente" in out["faltantes"][0]["motivo"]


def test_mercado_cerrado_el_domingo():
    out = cp.run(spread(), CHAIN, QUOTES.get, datetime(2026, 11, 1, 15, 0, tzinfo=UTC))
    assert out["ok"] and not out["mercado_abierto"]


def test_patas_invertidas_marcan_el_tipo_y_no_inventan_un_credito():
    payload = spread(price=0.30, risk=470)
    legs = payload["structures"][0]["legs"]
    legs[0]["side"], legs[1]["side"] = "buy", "sell"   # comprado el 700 y vendido el 695: es un débito
    s = check(payload)["estructuras"][0]
    assert not s["ok"] and s["corregidos"]["tipo"] == "debit" and "credit" not in s["corregidos"]
    assert s["corregidos"]["debit"] == 0.31   # compra el 700 al ask 1,91 y vende el 695 al bid 1,60
    assert s["corregidos"]["riesgo"] < 100   # un débito arriesga lo que paga, no el ancho


def test_cantidades_distintas_no_se_confirman():
    payload = spread()
    payload["structures"][0]["legs"][1]["qty"] = 2   # 1 vendido contra 2 comprados: el crédito declarado no se puede confirmar
    out = check(payload)
    assert not out["ok"] and "cantidades distintas" in out["faltantes"][0]["motivo"]
