"""Recorrido en navegador de la pestaña Inteligencia → Régimen (GC-0001), sobre registros SINTÉTICOS.

Requisitos (dev): Python con `playwright` + Chromium instalado; GaleCore-AI con GC-AI-0004;
`npm install` hecho en source/galecore-monitor. NO necesita la API .NET ni Supabase: se inyecta una
sesión local simulada en localStorage para montar el tablero (el resto de las pestañas mostrará
"Network Error", esperado). Nunca toca registros reales: escribe los sintéticos en un temp dir.

    python -B docs/engineering/evidence/gc-0001-monitor/e2e_regime_monitor.py <GaleCore-AI checkout> [<out-dir>]

Arranca el adapter (puerto libre) y el monitor (PORT=3039, apuntado al adapter), ejecuta el
recorrido, guarda `run.json` (pasos, respuestas y resultado) y capturas PNG en <out-dir>
(default: al lado de este script, subcarpeta `run-<UTC>`; las capturas no se versionan).
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
MONITOR = HERE.parents[3] / "source" / "galecore-monitor"
SUPABASE_KEY = "sb-vsbnukptdvsyhujgtook-auth-token"  # el ref del proyecto en .env.development
TOKEN = "e2e-review-token-not-a-secret"
REVIEW_COMMENT = "E2E SYNTHETIC review desde el monitor; no es un veredicto real"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_http(url: str, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return
        except Exception:  # noqa: BLE001 - polling until the server answers
            time.sleep(1)
    raise RuntimeError(f"{url} did not answer in {timeout}s")


def main() -> int:
    from playwright.sync_api import sync_playwright

    ai_repo = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / f"run-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="gc-0001-e2e-"))
    records = tmp / "records"
    subprocess.run([sys.executable, "-B", str(ai_repo / "tools/viewer_test_records.py"), str(records)], check=True, capture_output=True)

    with socket.socket() as probe:  # un monitor viejo en 3039 apuntaría a otro adapter: abortar, no adivinar
        if probe.connect_ex(("127.0.0.1", 3039)) == 0:
            print("port 3039 is already in use (a previous monitor?); stop it first")
            return 2
    adapter_port = free_port()
    env_ai = {**os.environ, "PYTHONPATH": "src", "GALECORE_RECORDS_DIR": str(records), "REGIME_REVIEW_TOKEN": TOKEN}
    adapter = subprocess.Popen([sys.executable, "-B", "-m", "galecore_ai.adapters.regime_viewer", "--port", str(adapter_port)],
                               cwd=ai_repo, env=env_ai, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env_ui = {**os.environ, "PORT": "3039", "BROWSER": "none", "CI": "true",
              "REACT_APP_REGIME_ADAPTER_URL": f"http://127.0.0.1:{adapter_port}"}
    npx = "npx.cmd" if os.name == "nt" else "npx"
    monitor = subprocess.Popen([npx, "react-scripts", "start"], cwd=MONITOR, env=env_ui,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run: dict = {"started_at": datetime.now(UTC).isoformat(), "adapter_port": adapter_port, "steps": [], "ok": True}

    def step(name: str, **data) -> None:
        run["steps"].append({"step": name, **data})
        print(name, json.dumps(data, ensure_ascii=False)[:160])

    try:
        wait_http(f"http://127.0.0.1:{adapter_port}/api/meta", 30)
        wait_http("http://localhost:3039/", 180)
        # Los días sintéticos son relativos a la fecha de la corrida: se identifican por su estado, no
        # por una fecha fija.
        try:  # 422 = hay un día rechazado; el cuerpo trae igual la lista completa (como el exit 3 del CLI)
            with urllib.request.urlopen(f"http://127.0.0.1:{adapter_port}/api/records?symbol=TEST&since=2000-01-01") as r:
                recs = json.loads(r.read())["records"]
        except urllib.error.HTTPError as err:
            recs = json.loads(err.read())["records"]
        failed_day = next(x["date"] for x in recs if x["status"] != "OK")
        pending_day = next(x["date"] for x in recs if x["status"] == "OK" and x["entries"][0]["states"]["review_pending"])
        outcome_day = next(x["date"] for x in recs if x["status"] == "OK" and x["entries"][0]["outcomes"])
        step("synthetic_days", pending=pending_day, with_outcome=outcome_day, integrity_failed=failed_day)
        session = {"access_token": "e2e.fake.token", "token_type": "bearer", "expires_in": 86400,
                   "expires_at": int(time.time()) + 86400, "refresh_token": "e2e-refresh",
                   "user": {"id": "e2e-user", "aud": "authenticated", "role": "authenticated", "email": "e2e@local",
                            "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}}
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1440, "height": 960})
            ctx.add_init_script(f"window.localStorage.setItem('{SUPABASE_KEY}', {json.dumps(json.dumps(session))});")
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto("http://localhost:3039/")
            page.wait_for_timeout(3000)
            tabs = [t.inner_text() for t in page.locator("nav button").all()]
            step("tabs", tabs=tabs, has_inteligencia="INTELIGENCIA" in tabs)
            page.get_by_role("button", name="Inteligencia").click()
            page.wait_for_selector("button.card-interactive", timeout=15000)
            page.screenshot(path=str(out / "01-regimen.png"))
            hoy = page.locator("section", has_text="HOY").first.inner_text()
            step("hoy", text=hoy.replace("\n", " | ")[:200])
            step("historial", rows=page.locator("button.card-interactive").count())
            # día pendiente → review con token malo (401) y con token correcto (201)
            page.locator("button.card-interactive", has_text=pending_day).first.click()
            page.wait_for_timeout(600)
            page.screenshot(path=str(out / "02-detalle-pendiente.png"), full_page=True)
            page.get_by_role("button", name="Partial", exact=True).click()
            page.get_by_label("Comentario del review").fill(REVIEW_COMMENT)
            page.get_by_label("Token de review").fill("wrong-token")
            page.get_by_role("button", name="Guardar review").click()
            page.wait_for_timeout(1200)
            alert = page.get_by_role("alert").inner_text()
            step("review_wrong_token", alert=alert, is_401="401" in alert)
            page.get_by_label("Token de review").fill(TOKEN)
            page.get_by_role("button", name="Guardar review").click()
            page.wait_for_timeout(1500)
            status = page.get_by_role("status").inner_text()
            shown = page.get_by_text(REVIEW_COMMENT).count()
            step("review_ok", status=status, review_shown=shown > 0)
            page.screenshot(path=str(out / "03-review-guardado.png"), full_page=True)
            # relectura tras Actualizar
            page.get_by_role("button", name="Actualizar").click()
            page.wait_for_timeout(2500)
            page.wait_for_selector("button.card-interactive", timeout=15000)
            page.locator("button.card-interactive", has_text=pending_day).first.click()
            page.wait_for_timeout(600)
            step("review_after_reload", review_shown=page.get_by_text(REVIEW_COMMENT).count() > 0)
            # día con outcome y día rechazado
            page.locator("button.card-interactive", has_text=outcome_day).first.click(timeout=15000)
            page.wait_for_timeout(600)
            step("outcome", legend=page.get_by_text("no una calificación de acierto").count() > 0,
                 comparison_table=page.get_by_text("Al aceptar").count() > 0 and page.get_by_text("Observado").count() > 0)
            page.screenshot(path=str(out / "04-outcome.png"), full_page=True)
            page.locator("button.card-interactive", has_text=failed_day).first.click()
            page.wait_for_timeout(600)
            step("integrity_failed", card=page.get_by_text("query rechazó este archivo").count() > 0,
                 content_hidden=page.get_by_text("Interpretación aceptada").count() == 0)
            page.screenshot(path=str(out / "05-integridad-fallida.png"))
            step("pageerrors", errors=errors)
            browser.close()
        # el CLI relee el review escrito desde el monitor
        cli = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", "query", "--symbol", "TEST",
                              "--since", "2026-01-01"], cwd=ai_repo, env=env_ai, capture_output=True, text=True, check=False)
        data = json.loads(cli.stdout)
        reviews = [(r["date"], [h["comment"] for e in r.get("entries", []) for h in e["human_reviews"]]) for r in data["records"]]
        # El CLI tiene que leer EXACTAMENTE el review que se escribió desde el monitor, en su día, y
        # salir 3 (hay un día sintético manipulado a propósito) — no cualquier salida.
        written = [c for d, cs in reviews if d == pending_day for c in cs]
        step("cli_reads_review_back", exit_code=cli.returncode, reviews=reviews,
             comment_found=REVIEW_COMMENT in written, exit_expected=cli.returncode == 3)
        checks = [s.get(k, True) for s in run["steps"] for k in ("has_inteligencia", "is_401", "review_shown", "legend",
                                                                 "comparison_table", "card", "content_hidden",
                                                                 "comment_found", "exit_expected")]
        run["ok"] = all(checks) and not errors
    except Exception as exc:  # noqa: BLE001 - the run itself is the evidence; record the failure
        run["ok"] = False
        run["error"] = repr(exc)
    finally:
        for proc in (adapter, monitor):  # en Windows terminate() no baja el árbol de node: taskkill /T
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False)
            else:
                proc.terminate()
        run["finished_at"] = datetime.now(UTC).isoformat()
        text = json.dumps(run, indent=2, ensure_ascii=False)
        text = re.sub(re.escape(str(tmp)).replace("\\\\", "\\\\\\\\"), "<tmp>", text)
        text = text.replace(json.dumps(str(tmp))[1:-1], "<tmp>").replace(os.environ.get("USERNAME", "\0"), "<user>")
        (out / "run.json").write_text(text + "\n", encoding="utf-8", newline="\n")
        print("run.json ->", out / "run.json", "ok =", run["ok"])
    return 0 if run["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
