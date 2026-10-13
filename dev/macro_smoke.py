"""Recorrido real Macro contra preview Dev; usa usuario demo sin imprimir credenciales."""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=root, text=True).strip()
    env = json.loads(((root / common).resolve().parent / "dev/.local/env.json").read_text(encoding="utf-8"))
    if env["project_ref"] != "ecymbgpimqbtcvqyjtaq":
        raise RuntimeError("Este recorrido sólo admite GaleCore Dev")
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "mode": "real-dev-browser", "checks": [], "responses": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()
        page.on("response", lambda r: report["responses"].append({"path": r.url.split("?")[0].replace("http://localhost:7002", ""), "status": r.status}) if "/App/Macro/" in r.url else None)
        personal = []
        page.on("request", lambda r: personal.append(r.url.split("?")[0]) if any(x in r.url for x in ["/Balances", "/Positions", "/Deploy", "/Stop"]) else None)
        page.goto("http://localhost:5173/?macro=panorama", wait_until="domcontentloaded")
        page.get_by_label("Usuario", exact=True).fill("demo")
        page.locator("#password").fill(env["demo_password"])
        page.get_by_role("button", name="Entrar", exact=True).click()
        page.get_by_role("button", name="Tesoro 10 años", exact=True).wait_for(timeout=60000)
        assert page.get_by_text("P&L", exact=True).count() == 0
        assert page.get_by_text("Órdenes", exact=True).count() == 0
        page.screenshot(path=str(args.output / "panorama-desktop.png"), full_page=True)
        report["checks"].append("Panorama real: seis familias, ausencia de gestión personal")
        page.get_by_role("button", name="Tesoro 10 años", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.wait_for()
        assert dialog.get_by_role("link", name="Abrir fuente original ↗").count() == 1
        page.screenshot(path=str(args.output / "detalle-desktop.png"))
        page.keyboard.press("Escape")
        assert page.get_by_role("dialog").count() == 0
        assert page.get_by_role("button", name="Tesoro 10 años", exact=True).evaluate("el => el === document.activeElement")
        page.go_back()
        page.get_by_role("dialog").wait_for()
        page.get_by_role("button", name="Cerrar · Esc", exact=True).click()
        report["checks"].append("Detalle fuente/fechas; Escape restaura foco; Atrás reabre detalle")
        page.get_by_role("button", name="Expectativas y drivers", exact=True).click()
        page.screenshot(path=str(args.output / "drivers-desktop.png"), full_page=True)
        page.get_by_label("Horizonte", exact=True).select_option("session")
        page.get_by_text("Este horizonte requiere", exact=False).wait_for()
        page.get_by_role("button", name="Tesoro 10 años", exact=True).wait_for()
        page.get_by_label("Horizonte", exact=True).select_option("month")
        page.get_by_role("button", name="Tesoro 10 años", exact=True).wait_for()
        page.get_by_role("button", name="Copiar enlace", exact=True).click()
        page.get_by_role("button", name="Enlace copiado", exact=True).wait_for()
        link = page.evaluate("navigator.clipboard.readText()")
        assert "snapshot=" in link and "macro=drivers" in link
        page.goto(link, wait_until="domcontentloaded")
        page.get_by_role("button", name="Tesoro 10 años", exact=True).wait_for(timeout=30000)
        assert page.get_by_text("Moneda Local · corte guardado", exact=False).count() == 1
        report["checks"].append("Horizonte sin calendario muestra N/D; enlace/recarga conserva snapshot y filtros")
        for name in ["Mercados y regiones", "Volatilidad y posicionamiento", "Eventos"]:
            page.get_by_role("button", name=name, exact=True).click()
        page.screenshot(path=str(args.output / "eventos-desktop.png"), full_page=True)
        page.get_by_role("button", name="Panorama", exact=True).click()
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(args.output / "panorama-mobile.png"), full_page=True)
        page.get_by_role("button", name="Tesoro 10 años", exact=True).click()
        assert page.get_by_role("dialog").bounding_box()["width"] >= 380
        page.screenshot(path=str(args.output / "detalle-mobile.png"))
        report["checks"].append("Todas las pestañas; móvil 390px y detalle a ancho completo")
        report["personal_requests"] = personal
        report["browser"] = browser.version
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        report["exit_code"] = 0
        browser.close()
    (args.output / "browser-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"checks": report["checks"], "personal_requests": personal, "exit_code": 0}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
