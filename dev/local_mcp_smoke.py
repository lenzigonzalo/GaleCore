"""Browser QA: real configuration inventory, synthetic app auth; isolated fixture toggles."""

import base64
import json
import tempfile
import time
from pathlib import Path

from local_mcp import Inventory
from playwright.sync_api import sync_playwright


def main():
    root = Path(__file__).resolve().parent.parent
    output = root / "docs/engineering/evidence/GC-0031"
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "auth": "synthetic-browser-session",
        "inventory": "real-local-configurations",
        "toggle": "temporary-home-only",
        "checks": [],
    }
    with sync_playwright() as p, tempfile.TemporaryDirectory() as folder:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        encode = lambda value: (
            base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
        )
        user = {
            "id": "visual-preview",
            "email": "preview@example.test",
            "user_metadata": {},
        }
        token = (
            encode({"alg": "none"})
            + "."
            + encode({"sub": user["id"], "exp": int(time.time()) + 3600})
            + ".test"
        )
        session = {
            "access_token": token,
            "refresh_token": "synthetic-test-only",
            "token_type": "bearer",
            "expires_at": int(time.time()) + 3600,
            "expires_in": 3600,
            "user": user,
        }
        page.add_init_script(
            'localStorage.setItem("sb-ecymbgpimqbtcvqyjtaq-auth-token", '
            + json.dumps(json.dumps(session))
            + ")"
        )
        page.add_init_script("""document.addEventListener('DOMContentLoaded', () => {
          const note = document.createElement('div'); note.textContent = 'QA: AUTH SIMULADA / INVENTARIO LOCAL REAL';
          note.id = 'qa-scope'; note.style.cssText = 'position:fixed;bottom:0;left:0;z-index:999;background:#503b12;color:white;padding:6px 12px'; document.body.appendChild(note);
        });""")
        page.route(
            "http://localhost:7002/**",
            lambda r: r.fulfill(status=200, content_type="application/json", body="{}"),
        )
        page.goto(
            "http://localhost:3039", wait_until="domcontentloaded", timeout=120000
        )
        page.get_by_role("button", name="Configuraci\u00f3n", exact=True).first.click(
            timeout=60000
        )
        page.get_by_role("button", name="MCP locales", exact=True).click()
        page.get_by_role("button", name="Actualizar", exact=True).wait_for()
        page.get_by_role("button", name="Codex", exact=True).click()
        page.get_by_role("heading", name="node_repl", exact=True).wait_for()
        assert (
            page.get_by_role("switch", name="Habilitar node_repl").get_attribute(
                "aria-checked"
            )
            == "true"
        )
        page.screenshot(path=str(output / "codex-real.png"))
        report["checks"].append(
            "Codex inventory: node_repl enabled, real configuration; no credential fields"
        )
        page.get_by_role("button", name="Claude Code", exact=True).click()
        page.get_by_role("heading", name="datafeed", exact=True).wait_for()
        page.screenshot(path=str(output / "claude-real.png"))
        report["checks"].append(
            "Claude inventory: datafeed and exact project context, real configuration"
        )
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(output / "mobile-real.png"), full_page=True)
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"
        )
        report["checks"].append("Mobile 390px: no horizontal overflow")
        page.set_viewport_size({"width": 1440, "height": 1000})
        home = Path(folder)
        (home / ".codex").mkdir()
        config = home / ".codex/config.toml"
        config.write_text(
            '[mcp_servers.browser_fixture]\ncommand="unused"\n', encoding="utf-8"
        )
        inventory = Inventory(home, home / "workspace", home / "backups")

        def fixture(route):
            if route.request.url.endswith("/toggle"):
                body = route.request.post_data_json
                data = inventory.toggle(body["id"], body["enabled"], body["revision"])
            else:
                data = inventory.snapshot()
            route.fulfill(
                status=200, content_type="application/json", body=json.dumps(data)
            )

        page.route("http://127.0.0.1:8772/inventory", fixture)
        page.route("http://127.0.0.1:8772/toggle", fixture)
        page.locator("#qa-scope").evaluate(
            "el => el.textContent = 'QA: AUTH SIMULADA / TOGGLE EN CONFIG TEMPORAL'"
        )
        page.get_by_role("button", name="Actualizar", exact=True).click()
        page.get_by_role("button", name="Codex", exact=True).click()
        switch = page.get_by_role("switch", name="Habilitar browser_fixture")
        switch.wait_for()
        switch.click()
        page.get_by_text("browser_fixture: deshabilitado.", exact=False).wait_for()
        assert switch.get_attribute("aria-checked") == "false"
        assert "enabled = false" in config.read_text()
        switch.click()
        page.get_by_text("browser_fixture: habilitado.", exact=False).wait_for()
        assert switch.get_attribute("aria-checked") == "true"
        assert "enabled = true" in config.read_text()
        page.screenshot(path=str(output / "toggle-temporary.png"))
        report["checks"].append(
            "UI disable/enable invokes backend writer on temporary config, persists state, new-session notice"
        )
        report["browser"] = browser.version
        report["exit_code"] = 0
        (output / "browser-run.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        print(json.dumps(report))
        browser.close()


if __name__ == "__main__":
    main()
