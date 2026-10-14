"""QA contra Dev: no órdenes, datos simulados ni credenciales en artefactos."""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--dev-root", type=Path, required=True)
parser.add_argument("--url", default="http://localhost:5173")
args = parser.parse_args()
config = json.loads((args.dev_root / "dev/.local/env.json").read_text(encoding="utf-8"))
username = re.search(r'TEST_USERNAME = "([^" ]+)"', (args.dev_root / "dev/galecore_dev.py").read_text(encoding="utf-8")).group(1)
out = Path(__file__).parent
with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(args.url, wait_until="domcontentloaded")
    page.locator("#username").fill(username)
    page.locator("#password").fill(config["demo_password"])
    page.get_by_role("button", name="Entrar", exact=True).click()
    page.get_by_role("heading", name="Mi portfolio", exact=True).wait_for(timeout=60000)
    page.locator(".rs-table tbody tr").first.wait_for(timeout=60000)
    page.wait_for_function("() => document.querySelector('.rs-pnl') && !document.querySelector('.rs-price-status')", timeout=45000)
    for text in ["Opciones a valor de prima", "Lectura", "P&L abierto a precios informados"]:
        assert text not in page.locator(".rs").inner_text()
    result = {"readAt": datetime.now(timezone.utc).isoformat(), "url": args.url,
              "table": page.locator(".rs-table").inner_text(), "removedTexts": "PASS"}
    mask = [page.locator(".rs-capital > div > div").first]
    page.screenshot(path=str(out / "monitor-desktop.png"), full_page=True, mask=mask)
    page.set_viewport_size({"width": 760, "height": 1000})
    page.locator(".rs-table-scroll").evaluate("el => el.scrollLeft = el.scrollWidth")
    page.screenshot(path=str(out / "monitor-760.png"), full_page=True, mask=mask)
    page.set_viewport_size({"width": 1600, "height": 1000})
    for mode in ["Operativa", "Lab"]:
        page.get_by_role("button", name=mode, exact=True).click()
        page.wait_for_timeout(1500)
        page.screenshot(path=str(out / (mode.lower() + ".png")), full_page=True)
        result[mode] = page.locator("main").locator("h1,h2,h3").all_text_contents()
    (out / "qa.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    browser.close()
