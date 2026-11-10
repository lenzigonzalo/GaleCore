"""What the GaleCore this process is connected to knows about a SHADOW spec (WS-0098, increment 1). Read-only.

The follow-up used to read ``galecore-app/dev/galecore_dev.py runtime-report``, which is fixed to ``localhost:7001``
(GaleCore Dev) and the Dev demo login. This reads the same ``App/Runtime/*`` endpoints from ``GALECORE_BASE_URL`` with
the session of ``GALECORE_USERNAME``/``GALECORE_PASSWORD``: the production Lab reports production, a local one Dev.
The output has the shape the follow-up already analyses (``{"http", "body"}`` per endpoint).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable

Get = Callable[[str], object]   # GET <path> -> parsed JSON; raises an error with ``status`` on an HTTP error


def _fetch(get: Get, path: str) -> dict:
    try:
        return {"http": 200, "body": get(path)}
    except Exception as exc:
        status = getattr(exc, "status", None)
        if status is None:
            raise
        return {"http": status, "body": None}


def build_report(get: Get, api: str, spec: str, limit: int = 500) -> dict:
    spec_info = _fetch(get, f"/App/Runtime/Specs/{spec}")
    instances = _fetch(get, "/App/Runtime/Instances")
    mine = [i for i in (instances["body"] or []) if isinstance(i, dict) and i.get("specName") == spec]
    return {
        "api": api, "spec_name": spec,
        "spec_content_hash": (spec_info["body"] or {}).get("contentHash") if isinstance(spec_info["body"], dict) else None,
        "status": _fetch(get, "/App/Runtime/Status"),
        "instances": [{
            "instance": i,
            "detail": _fetch(get, f"/App/Runtime/Instances/{i['instanceId']}"),
            "evaluations": _fetch(get, f"/App/Runtime/Instances/{i['instanceId']}/Evaluations?limit={limit}"),
            "events": _fetch(get, f"/App/Runtime/Instances/{i['instanceId']}/Events?limit={limit}"),
        } for i in mine],
        "metrics": _fetch(get, "/App/Runtime/Metrics"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="runtime_report")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args(argv)
    from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
    try:
        client = SpaceClient(timeout=60.0)
        report = build_report(client.get, client.base_url, args.spec, args.limit)
    except SpaceError as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    sys.stdout.reconfigure(encoding="utf-8")  # the output is kept verbatim as evidence: UTF-8 always
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
