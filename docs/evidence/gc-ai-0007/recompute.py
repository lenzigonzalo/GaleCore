"""Recalcula y verifica los valores derivados de research:2026-09-27-spy-contexto-prima-30-60d.

Uso: python docs/evidence/gc-ai-0007/recompute.py
Lee sólo <workspace>/knowledge/evidence/ (GALECORE_KNOWLEDGE_DIR lo cambia); no consulta fuentes.
Cada línea compara el valor recalculado con el que dice la investigación, redondeado a la precisión
con que se escribió; sale con código 1 si alguno no coincide.
"""

import csv
import io
import itertools
import json
import math
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KB = Path(os.environ.get("GALECORE_KNOWLEDGE_DIR") or Path(__file__).resolve().parents[6] / "knowledge")
PREFIX = "2026-09-27-spy-ctx-"
failures = 0


def payload(slug: str) -> str:
    path = KB / "evidence" / f"{PREFIX}{slug}.json"
    return json.loads(path.read_text(encoding="utf-8"))["content"]["payload"]


def check(label: str, value: float, stated: float, decimals: int) -> None:
    global failures
    ok = round(value, decimals) == round(stated, decimals)
    failures += not ok
    print(f"{'OK ' if ok else 'MAL'} {label}: {value:.{decimals + 2}f} (investigación: {stated})")


def fred(slug: str) -> dict:
    return {o["date"]: float(o["value"]) for o in json.loads(payload(slug))["observations"] if o["value"] != "."}


def main() -> int:
    # Opciones y volatilidad
    closes = sorted((r["date"], r["price"]) for r in json.loads(payload("fmp-spy-eod")))
    rets = [math.log(b[1] / a[1]) for a, b in itertools.pairwise(closes)][-20:]
    mean = sum(rets) / len(rets)
    rv20 = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(252) * 100
    iv = json.loads(payload("galecore-spy-iv-term"))
    check("vol realizada 20 sesiones (%)", rv20, 10.76, 2)
    check("IV30/RV20", iv["iV30_30d"] / rv20, 1.39, 2)
    vix = {s: json.loads(payload(f"galecore-{s}"))["data"][0]["price"] for s in ("vix", "vix9d", "vix3m")}
    check("VIX9D/VIX", vix["vix9d"] / vix["vix"], 0.86, 2)
    check("VIX/VIX3M", vix["vix"] / vix["vix3m"], 0.83, 2)
    skew = json.loads(payload("galecore-spy-putskew"))
    check("distancia del short 25Δ (%)", (1 - skew["put25DeltaStrike"] / skew["spot"]) * 100, 3.8, 1)

    # Tasas y curva
    curve = {r["date"]: r for r in json.loads(payload("fmp-treasury-rates"))}
    d22, d25 = curve["2026-09-22"], curve["2026-09-25"]
    check("2–10 años 22/09 (pb)", (d22["year10"] - d22["year2"]) * 100, 25, 0)
    check("2–10 años 25/09 (pb)", (d25["year10"] - d25["year2"]) * 100, 36, 0)
    check("cambio 2–10 (pb)", ((d25["year10"] - d25["year2"]) - (d22["year10"] - d22["year2"])) * 100, 11, 0)
    check("cambio 30 años 22→25/09 (pb)", (d25["year30"] - d22["year30"]) * 100, 20, 0)
    check("cambio 10 años 22→24/09 (pb)", (curve["2026-09-24"]["year10"] - d22["year10"]) * 100, 22, 0)
    effr = float(json.loads(json.loads(payload("av-effr-preview"))["sample_data"])["data"][0]["value"])
    check("letra 1 mes − fondos federales (pb)", (d25["month1"] - effr) * 100, 16, 0)
    check("letra 12 meses − fondos federales (pb)", (d25["year1"] - effr) * 100, 62, 0)

    # FRED: tasa real y breakeven
    real, be, nom = fred("fred-dfii10"), fred("fred-t10yie"), fred("fred-dgs10")
    check("DFII10 22→24/09 (pb)", (real["2026-09-24"] - real["2026-09-22"]) * 100, 22, 0)
    check("DGS10 22→24/09 (pb)", (nom["2026-09-24"] - nom["2026-09-22"]) * 100, 22, 0)
    check("T10YIE 22→24/09 (pb)", (be["2026-09-24"] - be["2026-09-22"]) * 100, 0, 0)

    # Inflación y empleo
    av_cpi = {r["timestamp"]: float(r["value"]) for r in csv.DictReader(io.StringIO(payload("av-cpi-monthly")))
              if r["value"] != "."}
    check("CPI Alpha Vantage a/a ago-26 (%)", (av_cpi["2026-08-01"] / av_cpi["2025-08-01"] - 1) * 100, 3.40, 2)
    check("CPI Alpha Vantage ene→may-26 (%)", (av_cpi["2026-05-01"] / av_cpi["2026-01-01"] - 1) * 100, 3.0, 1)
    cpi = fred("fred-cpiaucsl")
    check("CPIAUCSL a/a ago-26 (%)", (cpi["2026-08-01"] / cpi["2025-08-01"] - 1) * 100, 3.35, 2)
    check("CPIAUCSL a/a ago-25 (%)", (cpi["2025-08-01"] / cpi["2024-08-01"] - 1) * 100, 2.94, 2)
    check("CPIAUCSL ene→may-26 (%)", (cpi["2026-05-01"] / cpi["2026-01-01"] - 1) * 100, 2.26, 2)
    check("CPIAUCSL may→ago-26 (%)", (cpi["2026-08-01"] / cpi["2026-05-01"] - 1) * 100, 0.05, 2)
    check("CPIAUCSL may→ago anualizado (%)", ((cpi["2026-08-01"] / cpi["2026-05-01"]) ** 4 - 1) * 100, 0.2, 1)
    nfp = {r["timestamp"]: int(r["value"]) for r in csv.DictReader(io.StringIO(payload("av-nonfarm-payroll")))}
    check("empleo a/a ago-26 (miles)", nfp["2026-08-01"] - nfp["2025-08-01"], 456, 0)
    check("empleo a/a ago-26 (%)", (nfp["2026-08-01"] / nfp["2025-08-01"] - 1) * 100, 0.29, 2)
    check("empleo a/a ago-25 (miles)", nfp["2025-08-01"] - nfp["2024-08-01"], 712, 0)

    # Precio y concentración
    quote = json.loads(payload("fmp-spy-quote"))[0]
    check("SPY debajo del máximo 52 semanas (%)", (1 - quote["price"] / quote["yearHigh"]) * 100, 1, 0)
    px = dict(closes)
    check("SPY 22→24/09 (%)", (px["2026-09-24"] / px["2026-09-22"] - 1) * 100, -0.8, 1)
    top = {h["symbol"]: float(h["weight"]) for h in json.loads(payload("av-spy-etf-profile"))["holdings"]}
    check("NVDA+AAPL+MSFT (%)", (top["NVDA"] + top["AAPL"] + top["MSFT"]) * 100, 21.1, 1)

    print(f"\n{'Todos los valores coinciden' if not failures else f'{failures} valores NO coinciden'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
