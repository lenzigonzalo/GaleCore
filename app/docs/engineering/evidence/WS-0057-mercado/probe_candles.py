"""Desde la raíz del workspace: python GaleCore/docs/engineering/evidence/WS-0057-mercado/probe_candles.py.

Consulta real, sólo lectura, usando credenciales locales sin imprimirlas.
"""
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

workspace = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(workspace / "GaleCore-AI" / "src"))
from galecore_ai.adapters.galecore_space import SpaceClient  # noqa: E402

started = time.monotonic()
client = SpaceClient(base_url="http://localhost:7001", timeout=45)
response = client._call("GET", "/Data/Tastytrade/MarketData/Candle", params={
    "Symbol": "SPY", "Interval": "1h",
    "FromTime": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),
})
rows = response.get("data", [])
usable = sorted((r for r in rows if r.get("open") and r.get("close")), key=lambda r: r["time"])


def invalid(row):
    return not all(isinstance(row.get(k), (int, float)) and math.isfinite(row[k])
                   for k in ("open", "high", "low", "close"))


print(json.dumps({
    "checked_at_utc": datetime.now(timezone.utc).isoformat(),
    "endpoint": "localhost:7001/Data/Tastytrade/MarketData/Candle",
    "symbol": "SPY", "interval": "1h", "from_days": 30,
    "elapsed_seconds": round(time.monotonic() - started, 2),
    "count": len(rows), "duplicate_times": len(rows) - len({r.get("time") for r in rows}),
    "invalid_ohlc": sum(map(invalid, usable)),
    "invalid_in_last_100": sum(map(invalid, usable[-100:])),
}, indent=2))
