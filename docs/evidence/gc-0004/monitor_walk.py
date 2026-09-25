"""GC-0004 AC-06/AC-08(1): recorrido headless del monitor (Playwright) con login real y la pestaña SHADOW.

Requiere la API (:7001) y el monitor (:3039) levantados con `dev/galecore_dev.py api` y `monitor`.
Entra como el usuario de prueba `demo` (contraseña de dev/.local/env.json, fuera de git; no se guarda),
abre SHADOW y deja en walk1/: captura, texto de la pantalla y las llamadas a la API con su código.

Uso, desde la raíz del repo GaleCore:
    python docs/evidence/gc-0004/monitor_walk.py
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "walk1"
ENV = json.loads((HERE.parents[2] / "dev" / ".local" / "env.json").read_text(encoding="utf-8"))


def wait(url: str, codes: tuple[int, ...] = (200, 401)) -> None:
    for _ in range(240):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status in codes:
                    return
        except urllib.error.HTTPError as e:
            if e.code in codes:
                return
        except Exception:
            pass
        time.sleep(1)
    sys.exit(f"no responde: {url}")


def main() -> None:
    wait("http://localhost:7001/App/GaleCore/Rules/Core")
    wait("http://localhost:3039/", (200,))
    OUT.mkdir(exist_ok=True)
    log: dict = {"console_errors": [], "failed_requests": [], "responses": []}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda m: m.type == "error" and log["console_errors"].append(m.text))
        page.on("requestfailed", lambda r: log["failed_requests"].append(r.url))
        page.on(
            "response",
            lambda r: ":7001/" in r.url and log["responses"].append(f"{r.status} {r.url.split(':7001')[-1]}"),
        )
        page.goto("http://localhost:3039/")
        page.fill("input[placeholder='usuario']", "demo")
        page.fill("input[type='password']", ENV["demo_password"])
        page.click("button[type='submit']")
        page.wait_for_selector("text=SHADOW", timeout=30000)
        page.screenshot(path=str(OUT / "walk-2-home.png"))
        page.click("text=SHADOW")
        page.wait_for_timeout(8000)
        page.screenshot(path=str(OUT / "walk-3-shadow.png"), full_page=True)
        text = "
".join(line.rstrip() for line in page.locator("body").inner_text().splitlines()) + "
"
        (OUT / "walk-shadow.txt").write_text(text, encoding="utf-8")
        browser.close()
    (OUT / "walk-log.json").write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: len(v) for k, v in log.items()}))


if __name__ == "__main__":
    main()
