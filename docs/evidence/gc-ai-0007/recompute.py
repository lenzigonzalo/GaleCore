"""Recalcula los «Cálculo propio» de research:2026-09-27-spy-contexto-prima-30-60d desde la evidencia guardada.

Uso: python docs/evidence/gc-ai-0007/recompute.py   (lee <workspace>/knowledge/evidence/, no consulta fuentes)
"""

import csv
import io
import itertools
import json
import math
from pathlib import Path

KB = Path(__file__).resolve().parents[6] / "knowledge" / "evidence"
PREFIX = "2026-09-27-spy-ctx-"


def payload(slug: str) -> str:
    return json.loads((KB / f"{PREFIX}{slug}.json").read_text(encoding="utf-8"))["content"]["payload"]


def main() -> None:
    closes = sorted((r["date"], r["price"]) for r in json.loads(payload("fmp-spy-eod")))
    rets = [math.log(b[1] / a[1]) for a, b in itertools.pairwise(closes)][-20:]
    mean = sum(rets) / len(rets)
    rv20 = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(252) * 100
    iv30 = json.loads(payload("galecore-spy-iv-term"))["iV30_30d"]
    print(f"RV20 SPY {rv20:.2f} %  (ventana {closes[-21][0]}..{closes[-1][0]})  IV30/RV20 {iv30 / rv20:.2f}")

    last = {s: json.loads(payload(f"galecore-{s}"))["data"][0]["price"] for s in ("vix", "vix9d", "vix3m")}
    print(f"VIX9D/VIX {last['vix9d'] / last['vix']:.3f}  VIX/VIX3M {last['vix'] / last['vix3m']:.3f}")

    curve = {r["date"]: r for r in json.loads(payload("fmp-treasury-rates"))}
    for d in ("2026-09-22", "2026-09-25"):
        print(f"{d} 2s10s {(curve[d]['year10'] - curve[d]['year2']) * 100:.0f} pb")
    skew = json.loads(payload("galecore-spy-putskew"))
    print(f"distancia short 25Δ {(1 - skew['put25DeltaStrike'] / skew['spot']) * 100:.2f} %")

    av = {r["timestamp"]: r["value"] for r in csv.DictReader(io.StringIO(payload("av-cpi-monthly")))}
    print(f"CPI AV a/a ago-26 {(float(av['2026-08-01']) / float(av['2025-08-01']) - 1) * 100:.2f} %")
    fred = {o["date"]: float(o["value"]) for o in json.loads(payload("fred-cpiaucsl"))["observations"]
            if o["value"] != "."}
    print(f"CPIAUCSL a/a ago-26 {(fred['2026-08-01'] / fred['2025-08-01'] - 1) * 100:.2f} %  "
          f"ene→may {(fred['2026-05-01'] / fred['2026-01-01'] - 1) * 100:.2f} %  "
          f"may→ago {(fred['2026-08-01'] / fred['2026-05-01'] - 1) * 100:.2f} %")
    nfp = {r["timestamp"]: int(r["value"]) for r in csv.DictReader(io.StringIO(payload("av-nonfarm-payroll")))}
    print(f"NFP a/a ago-26 {nfp['2026-08-01'] - nfp['2025-08-01']:+d} mil")

    def series(slug: str) -> dict:
        return {o["date"]: o["value"] for o in json.loads(payload(slug))["observations"]}

    real, be, nom = series("fred-dfii10"), series("fred-t10yie"), series("fred-dgs10")
    for d in ("2026-09-22", "2026-09-24"):
        print(f"{d} DGS10 {nom[d]}  DFII10 {real[d]}  T10YIE {be[d]}")


if __name__ == "__main__":
    main()
