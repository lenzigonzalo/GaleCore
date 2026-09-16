"""Reproducible interactive E2E for the GEX vertical against a live GaleCore.

Runs prepare + accept through the CLI adapter for one positive and a fixed set of
negative cases, and writes one JSON artifact per case (exact stdin payload, stdout,
exit code) plus a Markdown summary. Nothing secret is written: the API key is read
from the environment and never echoed.

Usage (GaleCore must be running):
    GALECORE_BASE_URL=http://localhost:5000 GALECORE_API_KEY=<key> \\
    python tools/e2e_interactive_cases.py --out docs/evidence/increment4-e2e
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPO / "config"
CLI = [sys.executable, "-B", "-m", "galecore_ai.adapters.cli"]
BASE_ENV = {
    **os.environ,
    "ALLOW_UNKNOWN_FRESHNESS": "true",
    "MAX_STALENESS_SECONDS": os.environ.get("MAX_STALENESS_SECONDS", "3600"),
    "PYTHONIOENCODING": "utf-8",
}


def run_cli(args: list[str], stdin: str | None, env: dict | None = None) -> tuple[int, str, str]:
    p = subprocess.run(CLI + args, input=stdin, capture_output=True, text=True, encoding="utf-8",
                       cwd=REPO, env=env or BASE_ENV, timeout=180, check=False)
    return p.returncode, p.stdout, p.stderr


def parse(stdout: str):
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return None


def snapshot_path(run_id: str) -> Path:
    return Path(tempfile.gettempdir()) / "galecore-ai" / "snapshots" / f"{run_id}.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--symbol", default="SPY")
    ap.add_argument("--interpretation", help="JSON file with the interpretation authored by the interactive host "
                    "for the prepared view (P1). Without it P1 is a runner template and is labelled as such.")
    ap.add_argument("--host-provider", default="claude-code")
    ap.add_argument("--host-model", default="claude-opus-5")
    ap.add_argument("--reuse-view", help="JSON file with a PreparedAnalysisView from an earlier `prepare` whose "
                    "snapshot is still in the store; used instead of preparing again so a host-authored "
                    "interpretation refers to the same facts.")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.UTC)
    artifacts: list[dict] = []

    mismatches: list[str] = []

    def record(case_id: str, title: str, expected: str, cmd: str, stdin, code: int, stdout: str, stderr: str,
               note: str = "", expect_exit: int | None = None, expect_status: str | None = None,
               expect_failed: set[str] | None = None) -> dict:
        data = parse(stdout)
        status = data.get("status") if isinstance(data, dict) else None
        error = (data.get("error") or data.get("error_detail")) if isinstance(data, dict) else None
        failed = []
        if isinstance(data, dict) and isinstance(data.get("trace"), dict):
            failed = [g["guardrail_id"] for g in data["trace"].get("guardrails_executed", []) if not g["passed"]]
        art = {
            "case": case_id, "title": title, "expected": expected, "command": cmd,
            "stdin": stdin, "exit_code": code, "stdout_json": data, "stdout_raw": None if data is not None else stdout,
            "stderr": stderr[-500:], "status": status, "failed_guardrails": failed, "error": error, "note": note,
            "observed_at": dt.datetime.now(dt.UTC).isoformat(),
        }
        problems = []
        if expect_exit is not None and code != expect_exit:
            problems.append(f"exit {code} != {expect_exit}")
        if expect_status is not None and status != expect_status:
            problems.append(f"status {status} != {expect_status}")
        if expect_failed is not None and not expect_failed <= set(failed):
            problems.append(f"failed guardrails {failed} lack {sorted(expect_failed)}")
        if expect_status == "SUCCESS" and isinstance(data, dict) and isinstance(stdin, dict) \
                and data.get("result") != stdin.get("interpretation"):
            problems.append("SUCCESS result differs from the input interpretation")
        art["verified"] = not problems
        art["problems"] = problems
        if problems:
            mismatches.append(f"{case_id}: " + "; ".join(problems))
        (out / f"{case_id}.json").write_text(json.dumps(art, indent=2, ensure_ascii=False), encoding="utf-8")
        artifacts.append(art)
        return art

    # ── prepare ──────────────────────────────────────────────────────
    prep_cmd = f"python -B -m galecore_ai.adapters.cli prepare --symbol {args.symbol}"
    if args.reuse_view:
        so, code, se = Path(args.reuse_view).read_text(encoding="utf-8"), 0, ""
        prep = record("P0-prepare", "prepare against live GaleCore (view captured earlier, same session)",
                      "exit 0, view with facts + hashes", prep_cmd, None, code, so, se,
                      note=f"view loaded from {args.reuse_view}; the snapshot must still be in the store", expect_exit=0)
    else:
        code, so, se = run_cli(["prepare", "--symbol", args.symbol], None)
        prep = record("P0-prepare", "prepare against live GaleCore", "exit 0, view with facts + hashes", prep_cmd, None,
                      code, so, se, expect_exit=0)
    if code != 0 or not prep["stdout_json"]:
        print("prepare failed; aborting", file=sys.stderr)
        return 1
    view = prep["stdout_json"]
    run_id, F = view["run_id"], view["facts"]
    regime = "negative_gamma" if F["net_gex"] < 0 else "positive_gamma"
    other = "positive_gamma" if regime == "negative_gamma" else "negative_gamma"

    def base(**ch):
        d = {
            "regime": regime,
            "observations": ["Net GEX sign shows how dealers are positioned; their hedging shapes intraday moves"],
            "implications": ["Moves may be amplified rather than dampened while this regime persists"]
            if regime == "negative_gamma" else ["Dealer hedging is expected to dampen moves while this regime persists"],
            "quantitative_claims": [
                {"metric": "net_gex", "value": F["net_gex"], "unit": "billion_usd"},
                {"metric": "spot", "value": F["spot"], "unit": "usd"},
            ],
            "evidence": [
                {"fact_path": "facts.net_gex", "claim": "Net GEX sign defines the regime"},
                {"fact_path": "facts.spot", "claim": "Spot is the reference level"},
            ],
            "limitations": ["Point-in-time snapshot of open interest; intraday flow can change the picture"],
        }
        d.update(ch)
        return d

    accept_cmd = "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept"

    def accept_case(case_id, title, expected, interp, run=run_id, note="", exit_code=3, status="VALIDATION_ERROR",
                    failed=None):
        payload = {"run_id": run, "interpretation": interp,
                   "host_provider": args.host_provider, "host_model": args.host_model}
        stdin = json.dumps(payload)
        code, so, se = run_cli(["accept"], stdin)
        return record(case_id, title, expected, accept_cmd, payload, code, so, se, note,
                      expect_exit=exit_code, expect_status=status, expect_failed=failed)

    # ── positive ─────────────────────────────────────────────────────
    if args.interpretation:
        host_interp = json.loads(Path(args.interpretation).read_text(encoding="utf-8"))
        p1_note = (f"Interpretation authored by the interactive host ({args.host_provider}/{args.host_model}, "
                   f"HOST_DECLARED) from the P0 prepared view; file: {args.interpretation}. The runner did not "
                   "generate or edit it. Host identity and model execution are declared, not verified.")
    else:
        host_interp = base()
        p1_note = "TEMPLATE generated by the runner, not by an interactive host. Does not evidence a real host run."
    accept_case("P1-positive", f"valid {regime} interpretation (host-authored)" if args.interpretation
                else f"valid {regime} interpretation (runner template)",
                "exit 0, SUCCESS, result == input", host_interp, note=p1_note, exit_code=0, status="SUCCESS")

    # ── negatives ────────────────────────────────────────────────────
    accept_case("N01-invented-number", "999.99 in an observation", "VALIDATION_ERROR (no_invented_numbers, no_numbers_in_prose)",
                base(observations=["Price target 999.99 based on momentum"]), failed={"no_invented_numbers", "no_numbers_in_prose"})
    accept_case("N02-invalid-evidence-path", "evidence fact_path=facts.nonexistent", "VALIDATION_ERROR (facts_match_source)",
                base(evidence=[{"fact_path": "facts.nonexistent", "claim": "Made up"}]), failed={"facts_match_source"})
    accept_case("N03-sign-contradiction", f"regime={other} against net_gex={F['net_gex']}", "VALIDATION_ERROR (gex_regime_sign)",
                base(regime=other), failed={"gex_regime_sign"})
    art = accept_case("N04-empty-limitations", "limitations=[]", "VALIDATION_ERROR (schema min_length)", base(limitations=[]))
    if "at least 1 item" not in (art["error"] or ""):
        mismatches.append("N04-empty-limitations: schema min_length message not in error")
    accept_case("N05-trading-rec-en", "'Consider buying puts on SPY'", "VALIDATION_ERROR (no_trading_recommendation)",
                base(implications=["Consider buying puts on SPY for protection"]), failed={"no_trading_recommendation"})
    accept_case("N06-nonexistent-run-id", "unknown run_id", "VALIDATION_ERROR (snapshot not found)", base(),
                run="01a0a7bc-0fc3-7a41-9fcf-73ec491249c3", failed={"snapshot_lookup"})
    code, so, se = run_cli(["accept"], "not json")
    record("N07-malformed-json", "stdin 'not json'", "error JSON, exit 3", accept_cmd, "not json", code, so, se,
           expect_exit=3)
    code, so, se = run_cli(["prepare"], None)
    record("N08-missing-symbol", "prepare without --symbol", "error JSON, exit 3",
           "python -B -m galecore_ai.adapters.cli prepare", None, code, so, se, expect_exit=3)
    # expired snapshot: separate prepare with a 2 s TTL
    env = {**BASE_ENV, "SNAPSHOT_TTL_SECONDS": "2"}
    code, so, se = run_cli(["prepare", "--symbol", args.symbol], None, env)
    ttl_view = parse(so)
    time.sleep(3)
    if ttl_view:
        payload = {"run_id": ttl_view["run_id"], "interpretation": base(), "host_provider": "claude-code", "host_model": "claude-opus-5"}
        code, so, se = run_cli(["accept"], json.dumps(payload), env)
        record("N09-expired-snapshot", "TTL=2s, accept after 3s", "VALIDATION_ERROR (snapshot expired)",
               "SNAPSHOT_TTL_SECONDS=2 " + accept_cmd, payload, code, so, se,
               expect_exit=3, expect_status="VALIDATION_ERROR", expect_failed={"snapshot_lookup"})
    # missing required asset: rename the agent YAML around a prepare
    agent = ASSET_ROOT / "agents" / "trading-agent.yaml"
    moved = agent.with_suffix(".yaml.e2e-moved")
    agent.rename(moved)
    try:
        code, so, se = run_cli(["prepare", "--symbol", args.symbol], None)
    finally:
        moved.rename(agent)
    record("N10-missing-asset", "trading-agent.yaml absent during prepare", "error JSON, non-zero exit", prep_cmd, None,
           code, so, se, expect_exit=1)
    code, so, se = run_cli(["accept"], "")
    record("N11-empty-stdin", "accept with empty stdin", "error JSON, non-zero exit", accept_cmd, "", code, so, se,
           expect_exit=3)
    accept_case("N12-mixed-evidence", "one valid + one invalid evidence path", "VALIDATION_ERROR (facts_match_source)",
                base(evidence=[{"fact_path": "facts.net_gex", "claim": "Net GEX sign defines the regime"},
                               {"fact_path": "facts.nonexistent", "claim": "Made up"}]), failed={"facts_match_source"})
    accept_case("N13-wrong-metric", "net_gex value claimed as metric=put_wall/usd", "VALIDATION_ERROR (quantitative_claims_valid)",
                base(quantitative_claims=[{"metric": "put_wall", "value": F["net_gex"], "unit": "usd"}]),
                failed={"quantitative_claims_valid"})
    accept_case("N14-near-zero", "regime=near_zero on real data", "VALIDATION_ERROR (gex_regime_sign, incompatible scales)",
                base(regime="near_zero"), failed={"gex_regime_sign"})
    accept_case("N15-number-in-prose", "fact value written in an observation", "VALIDATION_ERROR (no_numbers_in_prose)",
                base(observations=[f"Net GEX is {F['net_gex']}, dealers positioned accordingly"]), failed={"no_numbers_in_prose"})
    # mutated conventions in the store
    sp = snapshot_path(run_id)
    original = sp.read_text(encoding="utf-8")
    raw = json.loads(original)
    raw["resolved_conventions"]["gex_near_zero_threshold_pct"] = 50.0
    sp.write_text(json.dumps(raw), encoding="utf-8")
    try:
        accept_case("N16-conventions-mutated", "resolved_conventions edited in the store after prepare",
                    "INTERNAL_ERROR (conventions_hash mismatch), no cognitive checks", base(),
                    note="store file edited then restored; cooperative boundary, hash detects the change",
                    exit_code=1, status="INTERNAL_ERROR", failed={"snapshot_integrity"})
    finally:
        sp.write_text(original, encoding="utf-8")
    # outer freshness timestamp "refreshed" while the hashed facts keep the old one
    raw = json.loads(original)
    raw["market_data_as_of"] = dt.datetime.now(dt.UTC).isoformat()
    sp.write_text(json.dumps(raw), encoding="utf-8")
    try:
        accept_case("N21-outer-timestamp-mutated", "snapshot.market_data_as_of edited; hashed facts unchanged",
                    "INTERNAL_ERROR (market_data_as_of mismatch)", base(),
                    note="store file edited then restored; acceptance freshness is bound to the hashed facts",
                    exit_code=1, status="INTERNAL_ERROR", failed={"snapshot_integrity"})
    finally:
        sp.write_text(original, encoding="utf-8")
    accept_case("N17-trading-rec-es", "'Recomendamos vender puts de SPY'", "VALIDATION_ERROR (no_trading_recommendation)",
                base(implications=["Recomendamos vender puts de SPY mientras dure el régimen"]), failed={"no_trading_recommendation"})
    omitted = base()
    del omitted["quantitative_claims"]
    art = accept_case("N18-omitted-claims", "quantitative_claims omitted entirely", "VALIDATION_ERROR (schema: field required)", omitted)
    if "Field required" not in (art["error"] or ""):
        mismatches.append("N18-omitted-claims: schema 'Field required' not in error")
    accept_case("N19-hold-directive", "'Hold SPY shares through the event'", "VALIDATION_ERROR (no_trading_recommendation)",
                base(implications=["Hold SPY shares through the event"]), failed={"no_trading_recommendation"})
    accept_case("N20-rescaled-claim", f"net_gex {F['net_gex']} claimed as {F['net_gex'] / 1000}", "VALIDATION_ERROR (quantitative_claims_valid)",
                base(quantitative_claims=[{"metric": "net_gex", "value": F["net_gex"] / 1000, "unit": "billion_usd"},
                                          {"metric": "spot", "value": F["spot"], "unit": "usd"}]),
                failed={"quantitative_claims_valid"})

    # ── summary ──────────────────────────────────────────────────────
    lines = [
        "# Interactive E2E — Increment 4 schema (generated)",
        "",
        f"**Generated:** {started.isoformat()} · **Tool:** `tools/e2e_interactive_cases.py` · **GaleCore:** `{os.environ.get('GALECORE_BASE_URL', '?')}`",
        f"**run_id:** `{run_id}` · **conventions_hash:** `{view['conventions_hash']}` · **facts_hash:** `{view['facts_hash']}`",
        "",
        "Facts used: " + ", ".join(f"{k}={F.get(k)}" for k in ("symbol", "net_gex", "call_gex", "put_gex", "spot", "zero_gamma_level", "call_wall", "put_wall", "freshness_status")),
        "",
        "One JSON artifact per case in this folder: exact stdin payload, stdout (parsed), exit code, failed guardrails.",
        "",
        "| Case | Scenario | Expected | Exit | Status | Failed guardrails | Error (truncated) |",
        "|---|---|---|---|---|---|---|",
    ]
    for a in artifacts:
        err = " ".join((a["error"] or "").split())[:110].replace("|", "/")
        lines.append(f"| {a['case']} | {a['title']} | {a['expected']} | {a['exit_code']} | {a['status'] or '—'} | "
                     f"{', '.join(a['failed_guardrails']) or '—'} | {err} |")
    if mismatches:
        lines += ["", "## MISMATCHES", ""] + [f"- {m}" for m in mismatches]
    else:
        lines += ["", f"All {len(artifacts)} cases matched their expected exit code, status and guardrails."]
    (out / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
