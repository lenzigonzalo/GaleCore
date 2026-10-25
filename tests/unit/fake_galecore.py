"""A fake GaleCore for ``POST /App/Runtime/Specs/Check`` (WS-0062 inc. 8b): canned Check responses, in process or
behind a local HTTP server, so the strategy check is tested without a live GaleCore."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from galecore_ai.application.strategy import galecore_spec_hash

CHECKS = Path(__file__).resolve().parents[1] / "fixtures" / "galecore" / "spec_checks"


def recorded(name: str, **changes) -> dict:
    """A Check response of GaleCore's contract (valid sandwich-like spec, or an invalid one), with changes."""
    return {**json.loads((CHECKS / f"{name}.json").read_text(encoding="utf-8")), **changes}


def fake_checker(response: dict | None = None, pin_hash: bool = False):
    """A checker (spec text -> response) that records what it was asked. A valid response carries the hash of the
    spec it was asked about (as GaleCore does) unless ``pin_hash`` keeps the recorded one."""
    asked: list[str] = []

    def check(spec_json: str) -> dict:
        asked.append(spec_json)
        out = dict(response if response is not None else recorded("spy_prima_varianza_valid"))
        if out["valid"] and not pin_hash:
            out["content_hash"] = galecore_spec_hash(spec_json)
        return out

    check.asked = asked  # type: ignore[attr-defined]
    return check


@contextmanager
def galecore_server(response: dict | None = None, status: int = 200) -> Iterator[str]:
    """A local HTTP GaleCore answering Check with the response; yields its base URL."""
    body = json.dumps(response if response is not None else recorded("spy_prima_varianza_valid")).encode()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            ok = status == 200 and self.path == "/App/Runtime/Specs/Check"
            self.send_response(200 if ok else (status if status != 200 else 404))
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body if ok else b"{}")

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
