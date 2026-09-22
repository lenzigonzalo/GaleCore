"""Regenerate docs/evidence/gc-ai-0004-adapter/ from SYNTHETIC records (never the real ones).

Usage:
    python -B tools/capture_viewer_evidence.py [<output-dir>]     # default: docs/evidence/gc-ai-0004-adapter

Writes synthetic records (tools/viewer_test_records.py, symbol TEST) to a temp dir, serves them
in-process with a fixed test token, exchanges the documented requests and stores each one
sanitized (token -> <token> / <wrong-token>, temp and repo paths -> <tmp> / <worktree>).
Not evidence for any GC-AI-0002 criterion.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from galecore_ai.adapters import regime_viewer as viewer
from galecore_ai.adapters.record_store import FileRecordStore

TOKEN = "evidence-token-not-a-secret"
ORIGIN = "http://localhost:3039"


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "docs/evidence/gc-ai-0004-adapter"
    tmp = Path(tempfile.mkdtemp(prefix="gc-ai-0004-evidence-"))
    target = tmp / "records"
    subprocess.run([sys.executable, "-B", str(REPO / "tools/viewer_test_records.py"), str(target)],
                   check=True, capture_output=True)
    store = FileRecordStore(target)
    config = viewer.ViewerConfig(timezone="America/New_York", allowed_origins=frozenset({ORIGIN}), review_token=TOKEN)
    srv = viewer.serve(store, port=0, annotations=[], config=config)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    host, port = srv.server_address[:2]
    base = f"http://{host}:{port}"

    def call(path, method="GET", headers=None, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(base + path, method=method, data=data)
        for k, v in (headers or {}).items():
            req.add_unredirected_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, dict(r.headers), r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read().decode()

    tmp_json = re.escape(json.dumps(str(tmp))[1:-1])  # paths as they appear inside JSON text
    repo_json = re.escape(json.dumps(str(REPO))[1:-1])

    def san(s: str) -> str:
        return re.sub(repo_json, "<worktree>", re.sub(tmp_json, "<tmp>", s))

    dates = store.dates("TEST")
    pending_day = dates[1]
    run_id = store.load("TEST", pending_day).entries[0].entry_id
    h = {"Origin": ORIGIN, "X-Review-Token": TOKEN, "Content-Type": "application/json"}
    review = {"symbol": "TEST", "date": pending_day, "run_id": run_id, "verdict": "partial",
              "comment": "SYNTHETIC evidence review from GC-AI-0004; not an owner verdict"}
    cases = [
        ("meta.json", "/api/meta", "GET", {"Origin": ORIGIN}, None),
        ("today-QQQ-no-record.json", "/api/today?symbol=QQQ", "GET", None, None),  # no QQQ folder → NO_RECORD
        ("today-TEST.json", "/api/today?symbol=TEST", "GET", None, None),  # depends on the run date: the synthetic days are relative to today
        ("preflight-allowed-origin-204.json", "/api/reviews", "OPTIONS", {"Origin": ORIGIN, "Access-Control-Request-Method": "POST"}, None),
        ("preflight-other-origin-405.json", "/api/reviews", "OPTIONS", {"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"}, None),
        ("review-wrong-token-401.json", "/api/reviews", "POST", {**h, "X-Review-Token": "wrong"}, review),
        ("review-other-origin-403.json", "/api/reviews", "POST", {**h, "Origin": "http://evil.example"}, review),
        ("review-bad-verdict-400.json", "/api/reviews", "POST", h, {**review, "verdict": "maybe"}),
        ("review-bad-date-400.json", "/api/reviews", "POST", h, {**review, "date": "20260919"}),
        ("review-unknown-run-404.json", "/api/reviews", "POST", h, {**review, "run_id": "not-a-run"}),
        ("review-tampered-day-422.json", "/api/reviews", "POST", h, {**review, "date": dates[2], "run_id": "x"}),
        ("records-before-review.json", f"/api/records?symbol=TEST&since={pending_day}&until={pending_day}", "GET", None, None),
        ("review-ok-201.json", "/api/reviews", "POST", h, review),
        ("records-after-review.json", f"/api/records?symbol=TEST&since={dates[0]}", "GET", None, None),
    ]
    out.mkdir(parents=True, exist_ok=True)
    for name, path, method, headers, body in cases:
        st, hdrs, text = call(path, method, headers, body)
        keep = {k: v for k, v in hdrs.items()
                if k.lower().startswith("access-control") or k.lower() in ("allow", "vary", "content-type")}
        shown = {k: (("<token>" if v == TOKEN else "<wrong-token>") if k == "X-Review-Token" else v)
                 for k, v in (headers or {}).items()}
        doc = {"request": {"method": method, "path": path, "headers": shown, "body": body},
               "http_status": st, "response_headers": keep, "body": json.loads(text) if text else None}
        if name == "today-QQQ-no-record.json":
            assert doc["body"]["status"] == "NO_RECORD", doc["body"]
        txt = san(json.dumps(doc, indent=2, ensure_ascii=False)) + "\n"
        assert TOKEN not in txt and os.environ.get("USERNAME", "\0") not in txt, name
        (out / name).write_text(txt, encoding="utf-8", newline="\n")
        print(name, st)
    srv.shutdown()
    srv.server_close()

    env = {**os.environ, "PYTHONPATH": "src", "GALECORE_RECORDS_DIR": str(target)}
    cli = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", "query", "--symbol", "TEST",
                          "--since", pending_day, "--until", pending_day],
                         capture_output=True, text=True, env=env, cwd=REPO, check=False)
    doc = {"command": "python -B -m galecore_ai.adapters.cli query --symbol TEST --since <day> --until <day>",
           "exit_code": cli.returncode, "stdout": json.loads(cli.stdout)}
    (out / "cli-query-reads-review-back.json").write_text(san(json.dumps(doc, indent=2, ensure_ascii=False)) + "\n",
                                                          encoding="utf-8", newline="\n")
    print("cli exit", cli.returncode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
