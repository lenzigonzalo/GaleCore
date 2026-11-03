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


@contextmanager
def galecore_deploy_server(specs_status: int = 200, deploy_status: int = 200, returned_hash: str | None = None,
                           replaced_hash: str | None = None, deploy_version_hash: str | None = "",
                           stale_hash: bool = False, headers_seen: list | None = None) -> Iterator[tuple[str, list[tuple[str, bytes]]]]:
    """A local HTTP GaleCore for ``POST /App/Runtime/Specs`` and ``/App/Runtime/Deploy``; yields (base URL, calls).
    Specs answers with the hash of what it was sent unless ``returned_hash`` says another. Deploy answers the instance's
    ``versionHash`` as the spec sent unless ``deploy_version_hash`` says another (None: leaves it out); ``stale_hash`` makes
    the 409 the one for an ``expectedHash`` that is no longer the current spec."""
    calls: list[tuple[str, bytes]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            calls.append((self.path, raw))
            if headers_seen is not None:
                headers_seen.append(dict(self.headers))
            if self.path == "/App/Runtime/Specs":
                status = specs_status
                body = {"name": "x", "content_hash": returned_hash or galecore_spec_hash(raw.decode("utf-8")),
                        "registered": True, "replaced_hash": replaced_hash}
            else:
                status = deploy_status
                name = json.loads(raw)["specName"]
                spec = next(r for p, r in calls if p == "/App/Runtime/Specs")
                body = {"deploymentId": "d-1", "instanceId": "i-1", "specName": name, "mode": "SHADOW",
                        "lifecycleState": "RUNNING", "versionHash": galecore_spec_hash(spec.decode("utf-8")),
                        "existing": False}
                if deploy_version_hash is None:
                    del body["versionHash"]
                elif deploy_version_hash:
                    body["versionHash"] = deploy_version_hash
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            refused = {"error": "no", "expected_hash": "sha256:esperado", "current_hash": "sha256:vigente"} if stale_hash else {"error": "no"}
            self.wfile.write(json.dumps(body if status == 200 else refused).encode())

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", calls
    finally:
        server.shutdown()
        server.server_close()
