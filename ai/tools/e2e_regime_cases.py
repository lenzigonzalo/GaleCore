"""Reproducible interactive E2E for the daily-regime loop (GC-AI-0002) against a live GaleCore.

Two phases, because the interpretation must be authored by the interactive host, not by
this runner:

  1. ``--phase prepare``: runs ``prepare --skill regime`` and writes ``P0-prepare.json`` plus
     ``view.json`` into ``--out``. The host then reads the facts and writes its interpretation.
  2. ``--phase run --reuse-view <out>/view.json --interpretation <file>``: accepts and records
     the host interpretation (P1), attaches an outcome (P2), a runner-authored review (P3,
     mechanics only — not a human verdict), queries the record (P4), then runs the negative
     cases (N*).

Every record written by this runner goes to a TEMPORARY records directory that is deleted at
the end: the runner never writes into ``GaleCore/research/regime``. Real records come only from
genuine host runs (see docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md).

One JSON artifact per case: command, exact stdin, stdout (parsed), exit code, UTC timestamp.
Sanitization: the API key is read from the environment and never written; GaleCore error
bodies are truncated to their first line (no stack traces); absolute repo/temp/home paths are
replaced by ``<repo>``, ``<tmp>``, ``<home>``.

Usage (GaleCore must be running; MAX_STALENESS_SECONDS wide enough for the last prints):
    GALECORE_BASE_URL=http://localhost:5000 GALECORE_API_KEY=<key> MAX_STALENESS_SECONDS=36000 \\
    python tools/e2e_regime_cases.py --phase prepare --out docs/evidence/gc-ai-0002-e2e
    ... author docs/evidence/gc-ai-0002-e2e/host-interpretation.json ...
    python tools/e2e_regime_cases.py --phase run --out docs/evidence/gc-ai-0002-e2e \\
        --reuse-view docs/evidence/gc-ai-0002-e2e/view.json \\
        --interpretation docs/evidence/gc-ai-0002-e2e/host-interpretation.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CLI = [sys.executable, "-B", "-m", "galecore_ai.adapters.cli"]
BASE_ENV = {
    **os.environ,
    "ALLOW_UNKNOWN_FRESHNESS": "true",
    "MAX_STALENESS_SECONDS": os.environ.get("MAX_STALENESS_SECONDS", "36000"),
    "GALECORE_TIMEOUT_SECONDS": os.environ.get("GALECORE_TIMEOUT_SECONDS", "300"),
    "PYTHONIOENCODING": "utf-8",
}
PROMPT = "Analizá el régimen de hoy de SPY y guardalo"
RUNNER_REVIEW = "RUNNER-AUTHORED mechanics check, not a human verdict"


def sanitize(text: str | None) -> str | None:
    if text is None:
        return None
    home = str(Path.home())
    for needle, placeholder in (
        (str(REPO), "<repo>"),
        (tempfile.gettempdir(), "<tmp>"),
        (home, "<home>"),
    ):
        text = text.replace(needle, placeholder).replace(needle.replace("\\", "/"), placeholder)
        text = text.replace(needle.replace("\\", "\\\\"), placeholder)
    return text


def sanitize_json(data):
    """Recursively sanitize strings; error-like strings are cut to their first line."""
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            if k in ("error", "error_detail", "stderr") and isinstance(v, str):
                v = v.splitlines()[0] if v else v
            out[k] = sanitize_json(v)
        return out
    if isinstance(data, list):
        return [sanitize_json(v) for v in data]
    if isinstance(data, str):
        return sanitize(data)
    return data


def run_cli(args: list[str], stdin: str | None, env: dict | None = None) -> tuple[int, str, str]:
    p = subprocess.run(
        CLI + args,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=REPO,
        env=env or BASE_ENV,
        timeout=600,
        check=False,
    )
    return p.returncode, p.stdout, p.stderr


def parse(stdout: str):
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--phase", choices=["prepare", "run"], required=True)
    ap.add_argument("--symbol", default="SPY")
    ap.add_argument(
        "--reuse-view",
        help="view.json written by --phase prepare (snapshot must still be in the store)",
    )
    ap.add_argument(
        "--interpretation",
        help="JSON file with the host-authored RegimeInterpretation for that view",
    )
    ap.add_argument("--host-provider", default="claude-code")
    ap.add_argument("--host-model", default="claude-opus-5")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.UTC)
    artifacts: list[dict] = []
    mismatches: list[str] = []

    def record(
        case_id,
        title,
        expected,
        cmd,
        stdin,
        code,
        stdout,
        stderr,
        note="",
        expect_exit=None,
        expect_status=None,
        expect_failed=None,
        expect_record=None,
        extra_checks=None,
    ) -> dict:
        data = sanitize_json(parse(stdout))
        status = data.get("status") if isinstance(data, dict) else None
        error = (data.get("error") or data.get("error_detail")) if isinstance(data, dict) else None
        error = error.splitlines()[0] if isinstance(error, str) and error else error
        failed = []
        if isinstance(data, dict) and isinstance(data.get("trace"), dict):
            failed = [
                g["guardrail_id"]
                for g in data["trace"].get("guardrails_executed", [])
                if not g["passed"]
            ]
        rec = data.get("record") if isinstance(data, dict) else None
        art = {
            "case": case_id,
            "title": title,
            "expected": expected,
            "command": sanitize(cmd),
            "stdin": sanitize_json(stdin),
            "exit_code": code,
            "stdout_json": data,
            "stdout_raw": None if data is not None else sanitize(stdout),
            "stderr": sanitize(stderr[-500:]),
            "status": status,
            "failed_guardrails": failed,
            "error": error,
            "record": rec,
            "note": sanitize(note),
            "observed_at": dt.datetime.now(dt.UTC).isoformat(),
        }
        problems = []
        if expect_exit is not None and code != expect_exit:
            problems.append(f"exit {code} != {expect_exit}")
        if expect_status is not None and status != expect_status:
            problems.append(f"status {status} != {expect_status}")
        if expect_failed is not None and not expect_failed <= set(failed):
            problems.append(f"failed guardrails {failed} lack {sorted(expect_failed)}")
        if expect_record is not None and (rec or {}).get("status") != expect_record:
            problems.append(f"record status {(rec or {}).get('status')} != {expect_record}")
        if (
            expect_status == "SUCCESS"
            and isinstance(data, dict)
            and isinstance(stdin, dict)
            and data.get("result") != stdin.get("interpretation")
        ):
            problems.append("SUCCESS result differs from the input interpretation")
        for check_name, ok in (extra_checks or {}).items():
            if not ok:
                problems.append(check_name)
        art["verified"] = not problems
        art["problems"] = problems
        if problems:
            mismatches.append(f"{case_id}: " + "; ".join(problems))
        (out / f"{case_id}.json").write_text(
            json.dumps(art, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        artifacts.append(art)
        return art

    prep_cmd = (
        f"python -B -m galecore_ai.adapters.cli prepare --symbol {args.symbol} --skill regime"
    )

    # ── phase 1: prepare only ────────────────────────────────────────
    if args.phase == "prepare":
        code, so, se = run_cli(["prepare", "--symbol", args.symbol, "--skill", "regime"], None)
        art = record(
            "P0-prepare",
            "prepare --skill regime against live GaleCore",
            "exit 0, view with facts from gex + put_skew + vix + vvix, skill_id=regime_interpretation",
            prep_cmd,
            None,
            code,
            so,
            se,
            expect_exit=0,
            extra_checks={"skill_id": (parse(so) or {}).get("skill_id") == "regime_interpretation"},
        )
        if code != 0:
            print("prepare failed", file=sys.stderr)
            return 1
        (out / "view.json").write_text(so, encoding="utf-8")
        print(
            f"P0 done. Author the host interpretation for run_id {art['stdout_json']['run_id']} and rerun "
            f"with --phase run --reuse-view {out / 'view.json'} --interpretation <file>"
        )
        return 0

    # ── phase 2: run ─────────────────────────────────────────────────
    if not (args.reuse_view and args.interpretation):
        print("--phase run needs --reuse-view and --interpretation", file=sys.stderr)
        return 2
    view = json.loads(Path(args.reuse_view).read_text(encoding="utf-8"))
    host_interp = json.loads(Path(args.interpretation).read_text(encoding="utf-8"))
    run_id, F = view["run_id"], view["facts"]
    gamma = "negative_gamma" if F["net_gex"] < 0 else "positive_gamma"
    other_gamma = "positive_gamma" if gamma == "negative_gamma" else "negative_gamma"
    tail = "calm" if F["put_skew_level_ok"] else "elevated"
    other_tail = "elevated" if tail == "calm" else "calm"
    # Everything this runner records goes to a temporary directory, never to the research folder.
    tmp_records = Path(tempfile.mkdtemp(prefix="gc-ai-0002-e2e-"))
    real_records_dir = str(tmp_records)
    real_env = {**BASE_ENV, "GALECORE_RECORDS_DIR": real_records_dir}

    def payload(interp, run=run_id):
        return {
            "run_id": run,
            "interpretation": interp,
            "host_provider": args.host_provider,
            "host_model": args.host_model,
        }

    def base(**ch):
        """Runner-authored negative-case template: prose is generic, numbers come from the facts."""
        d = {
            "gamma_regime": gamma,
            "tail_pricing": tail,
            "observations": [
                "Dealer positioning, tail pricing and the volatility indices are read together"
            ],
            "implications": [
                "The combination shapes how moves are expected to propagate while it persists"
            ],
            "quantitative_claims": [
                {"metric": "net_gex", "value": F["net_gex"], "unit": "billion_usd"},
                {"metric": "put_skew_ratio", "value": F["put_skew_ratio"], "unit": "ratio"},
                {"metric": "vix", "value": F["vix"], "unit": "index_points"},
            ],
            "evidence": [
                {"fact_path": "facts.net_gex", "claim": "Net GEX sign defines the gamma regime"},
                {
                    "fact_path": "facts.put_skew_level_ok",
                    "claim": "GaleCore's semaphore defines tail pricing",
                },
            ],
            "limitations": ["Skew snapshot without GaleCore timestamp; indices are last prints"],
        }
        d.update(ch)
        return d

    accept_rec_cmd = f"echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept --record --prompt \"{PROMPT}\""

    # P1: accept --record with the host-authored interpretation → real records dir
    p = payload(host_interp)
    code, so, se = run_cli(["accept", "--record", "--prompt", PROMPT], json.dumps(p), real_env)
    p1 = record(
        "P1-accept-record",
        f"host-authored {gamma}/{tail} interpretation accepted and recorded",
        "exit 0, SUCCESS, result == input, record RECORDED",
        accept_rec_cmd,
        p,
        code,
        so,
        se,
        note=(
            f"Interpretation authored by the interactive host ({args.host_provider}/{args.host_model}, "
            f"HOST_DECLARED) from the P0 view; file: {args.interpretation}. The runner did not generate "
            f"or edit it. The runner executed the CLI; records dir is TEMPORARY (deleted at the end), "
            f"not GaleCore/research."
        ),
        expect_exit=0,
        expect_status="SUCCESS",
        expect_record="RECORDED",
    )
    if code != 0:
        print("P1 failed; aborting positives", file=sys.stderr)
    rec = p1["record"] or {}
    day = rec.get("date")
    # The artifact holds the sanitized path; the runner needs the real one to copy the file.
    record_path = ((parse(so) or {}).get("record") or {}).get("path")

    if day:
        # P2: outcome (facts fetched again now, T+n minutes)
        cmd = f"python -B -m galecore_ai.adapters.cli record outcome --symbol {args.symbol} --date {day} --run-id {run_id}"
        code, so, se = run_cli(
            ["record", "outcome", "--symbol", args.symbol, "--date", day, "--run-id", run_id],
            None,
            real_env,
        )
        record(
            "P2-record-outcome",
            "later facts attached to the recorded entry (T+seconds; mechanics only)",
            "exit 0, RECORDED, entry_ids=[run_id]",
            cmd,
            None,
            code,
            so,
            se,
            note="Outcome fetched seconds after acceptance: proves the append path, not a market outcome.",
            expect_exit=0,
            expect_status="RECORDED",
            extra_checks={"entry_ids": (parse(so) or {}).get("entry_ids") == [run_id]},
        )
        # P3: review
        cmd = (
            f"python -B -m galecore_ai.adapters.cli record review --symbol {args.symbol} --date {day} "
            f'--run-id {run_id} --verdict partial --comment "{RUNNER_REVIEW}"'
        )
        code, so, se = run_cli(
            [
                "record",
                "review",
                "--symbol",
                args.symbol,
                "--date",
                day,
                "--run-id",
                run_id,
                "--verdict",
                "partial",
                "--comment",
                RUNNER_REVIEW,
            ],
            None,
            real_env,
        )
        record(
            "P3-record-review",
            "review appended to the recorded entry (runner-authored, NOT a human verdict)",
            "exit 0, RECORDED",
            cmd,
            None,
            code,
            so,
            se,
            note="Exercises the append path only. A human verdict exists only when the product owner runs "
            "`record review` on a real record.",
            expect_exit=0,
            expect_status="RECORDED",
        )
        # P4: query
        since = (dt.date.fromisoformat(day) - dt.timedelta(days=7)).isoformat()
        cmd = f"python -B -m galecore_ai.adapters.cli query --symbol {args.symbol} --since {since}"
        code, so, se = run_cli(["query", "--symbol", args.symbol, "--since", since], None, real_env)
        q = parse(so) or {}
        entries = [
            e for r in q.get("records", []) if r.get("status") == "OK" for e in r.get("entries", [])
        ]
        mine = [e for e in entries if e.get("run_id") == run_id]
        record(
            "P4-query",
            "read the record back: what was said, facts, outcome, review",
            "exit 0, no INTEGRITY_FAILED, the run appears with 1 outcome and 1 review",
            cmd,
            None,
            code,
            so,
            se,
            expect_exit=0,
            extra_checks={
                "no_integrity_failed": q.get("integrity_failed") == [],
                "run_present": len(mine) == 1,
                "outcome_and_review": bool(mine)
                and len(mine[0]["outcomes"]) >= 1
                and len(mine[0]["human_reviews"]) >= 1,
                "payload_matches_accepted": bool(mine)
                and mine[0]["accepted_payload"] == host_interp,
                "facts_hash_matches_view": bool(mine)
                and mine[0]["facts_hash"] == view["facts_hash"],
            },
        )

    # ── negatives (a second temporary records dir, empty) ──
    tmp_neg = Path(tempfile.mkdtemp(prefix="gc-ai-0002-e2e-neg-"))
    tmp_env = {**BASE_ENV, "GALECORE_RECORDS_DIR": str(tmp_neg)}
    try:
        # N01: stale source — MAX_STALENESS_SECONDS=1 makes every declared timestamp stale
        env = {**BASE_ENV, "MAX_STALENESS_SECONDS": "1"}
        code, so, se = run_cli(["prepare", "--symbol", args.symbol, "--skill", "regime"], None, env)
        record(
            "N01-stale-source",
            "prepare regime with MAX_STALENESS_SECONDS=1",
            "error JSON 'stale for source(s)', exit 1",
            "MAX_STALENESS_SECONDS=1 " + prep_cmd,
            None,
            code,
            so,
            se,
            expect_exit=1,
            extra_checks={
                "stale_message": "stale for source(s)" in ((parse(so) or {}).get("error") or "")
            },
        )
        # N02: missing source — a symbol GaleCore cannot serve
        code, so, se = run_cli(["prepare", "--symbol", "ZZZZ", "--skill", "regime"], None)
        record(
            "N02-missing-source",
            "prepare regime for symbol ZZZZ",
            "error JSON 'Capability fetch failed' or 'Fact validation failed', exit 1",
            prep_cmd.replace(args.symbol, "ZZZZ"),
            None,
            code,
            so,
            se,
            expect_exit=1,
        )
        # N03: rejected interpretation with --record → NOT_RECORDED, nothing written
        p = payload(base(tail_pricing=other_tail))
        code, so, se = run_cli(["accept", "--record", "--prompt", PROMPT], json.dumps(p), tmp_env)
        record(
            "N03-rejected-not-recorded",
            f"tail_pricing={other_tail} contradicts put_skew_level_ok={F['put_skew_level_ok']}, with --record",
            "exit 3, VALIDATION_ERROR (tail_pricing_level), record NOT_RECORDED, no file",
            accept_rec_cmd,
            p,
            code,
            so,
            se,
            expect_exit=3,
            expect_status="VALIDATION_ERROR",
            expect_failed={"tail_pricing_level"},
            expect_record="NOT_RECORDED",
            extra_checks={"no_file_written": not list(tmp_neg.rglob("*.md"))},
        )
        # N04: gamma sign contradiction (regime skill)
        p = payload(base(gamma_regime=other_gamma))
        code, so, se = run_cli(["accept"], json.dumps(p))
        record(
            "N04-gamma-sign",
            f"gamma_regime={other_gamma} against net_gex={F['net_gex']}",
            "exit 3, gex_regime_sign",
            "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept",
            p,
            code,
            so,
            se,
            expect_exit=3,
            expect_status="VALIDATION_ERROR",
            expect_failed={"gex_regime_sign"},
        )
        # N05: rescaled skew claim
        p = payload(
            base(
                quantitative_claims=[
                    {
                        "metric": "put_skew_ratio",
                        "value": round(F["put_skew_ratio"], 2),
                        "unit": "ratio",
                    }
                ]
            )
        )
        code, so, se = run_cli(["accept"], json.dumps(p))
        record(
            "N05-rounded-skew-claim",
            f"put_skew_ratio {F['put_skew_ratio']} claimed as {round(F['put_skew_ratio'], 2)}",
            "exit 3, quantitative_claims_valid"
            if round(F["put_skew_ratio"], 2) != F["put_skew_ratio"]
            else "exit 0 (fact already has 2 decimals)",
            "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept",
            p,
            code,
            so,
            se,
            expect_exit=3 if round(F["put_skew_ratio"], 2) != F["put_skew_ratio"] else 0,
        )
        # N06: VIX in prose (ES)
        p = payload(base(observations=[f"El VIX está en {F['vix']} y el skew tranquilo"]))
        code, so, se = run_cli(["accept"], json.dumps(p))
        record(
            "N06-number-in-prose-es",
            "fact value written in a Spanish observation",
            "exit 3, no_numbers_in_prose",
            "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept",
            p,
            code,
            so,
            se,
            expect_exit=3,
            expect_status="VALIDATION_ERROR",
            expect_failed={"no_numbers_in_prose"},
        )
        # N07: trading directive (ES)
        p = payload(base(implications=["Conviene comprar puts de SPY mientras el skew esté calmo"]))
        code, so, se = run_cli(["accept"], json.dumps(p))
        record(
            "N07-trading-rec-es",
            "'Conviene comprar puts de SPY'",
            "exit 3, no_trading_recommendation",
            "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept",
            p,
            code,
            so,
            se,
            expect_exit=3,
            expect_status="VALIDATION_ERROR",
            expect_failed={"no_trading_recommendation"},
        )
        # N08: GEX-shaped payload against a regime snapshot
        gex_like = base()
        gex_like["regime"] = gex_like.pop("gamma_regime")
        del gex_like["tail_pricing"]
        p = payload(gex_like)
        code, so, se = run_cli(["accept"], json.dumps(p))
        record(
            "N08-gex-payload-on-regime",
            "GexInterpretation shape submitted for a regime run",
            "exit 3, schema rejection",
            "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept",
            p,
            code,
            so,
            se,
            expect_exit=3,
            expect_status="VALIDATION_ERROR",
        )
        # N09: --record without --prompt
        code, so, se = run_cli(["accept", "--record"], json.dumps(payload(base())), tmp_env)
        record(
            "N09-record-without-prompt",
            "accept --record without --prompt",
            "exit 3, argument error",
            "echo '<stdin>' | python -B -m galecore_ai.adapters.cli accept --record",
            payload(base()),
            code,
            so,
            se,
            expect_exit=3,
        )
        # N10: tampered record on query (copy of the P1 file, edited in the negatives dir)
        if record_path and Path(record_path).is_file():
            rel = Path(record_path).relative_to(Path(real_records_dir))
            target = tmp_neg / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            text = Path(record_path).read_text(encoding="utf-8")
            # The record is YAML frontmatter (accepted_payload.gamma_regime: <value>), not JSON.
            tampered = re.sub(
                rf"^(\s*gamma_regime: ){re.escape(gamma)}$",
                rf"\g<1>{other_gamma}",
                text,
                count=1,
                flags=re.MULTILINE,
            )
            target.write_text(tampered, encoding="utf-8")
            cmd = f"GALECORE_RECORDS_DIR=<tmp copy> python -B -m galecore_ai.adapters.cli query --symbol {args.symbol} --since {day}"
            code, so, se = run_cli(
                ["query", "--symbol", args.symbol, "--since", day], None, tmp_env
            )
            q = parse(so) or {}
            record(
                "N10-tampered-record-query",
                "accepted payload edited in a copy of the record file",
                "exit 3, INTEGRITY_FAILED with entry_hash mismatch, not skipped",
                cmd,
                None,
                code,
                so,
                se,
                note="the P1 record was copied into the negatives dir and edited there",
                expect_exit=3,
                extra_checks={
                    "integrity_failed": q.get("integrity_failed") == [day],
                    "problem_named": any(
                        "entry_hash mismatch" in pr
                        for r in q.get("records", [])
                        for pr in r.get("problems", [])
                    ),
                    "tamper_applied": tampered != text,
                },
            )
            # N11: outcome/review refuse to touch the tampered file
            code, so, se = run_cli(
                [
                    "record",
                    "review",
                    "--symbol",
                    args.symbol,
                    "--date",
                    day,
                    "--run-id",
                    run_id,
                    "--verdict",
                    "agree",
                    "--comment",
                    "should be refused",
                ],
                None,
                tmp_env,
            )
            record(
                "N11-review-on-tampered",
                "record review against the tampered copy",
                "exit 1, 'cannot be trusted'",
                "GALECORE_RECORDS_DIR=<tmp copy> python -B -m galecore_ai.adapters.cli record review ...",
                None,
                code,
                so,
                se,
                expect_exit=1,
                extra_checks={
                    "refused": "cannot be trusted" in ((parse(so) or {}).get("error") or "")
                },
            )
        # N12: review for a run_id that does not exist
        if day:
            code, so, se = run_cli(
                [
                    "record",
                    "review",
                    "--symbol",
                    args.symbol,
                    "--date",
                    day,
                    "--run-id",
                    "01a0a7bc-0fc3-7a41-9fcf-73ec491249c3",
                    "--verdict",
                    "agree",
                    "--comment",
                    "x",
                ],
                None,
                real_env,
            )
            record(
                "N12-review-unknown-run",
                "record review with unknown run_id on the P1 record",
                "exit 1, 'not found'",
                "python -B -m galecore_ai.adapters.cli record review ... --run-id <unknown>",
                None,
                code,
                so,
                se,
                expect_exit=1,
                extra_checks={"not_found": "not found" in ((parse(so) or {}).get("error") or "")},
            )
    finally:
        shutil.rmtree(tmp_neg, ignore_errors=True)
        shutil.rmtree(tmp_records, ignore_errors=True)

    # ── summary ──────────────────────────────────────────────────────
    lines = [
        "# Regime loop E2E — GC-AI-0002 (generated)",
        "",
        f"**Generated:** {started.isoformat()} · **Tool:** `tools/e2e_regime_cases.py` · **GaleCore:** `{os.environ.get('GALECORE_BASE_URL', '?')}`",
        (
            f"**run_id:** `{run_id}` · **facts_hash:** `{view['facts_hash']}` · **conventions_hash:** "
            f"`{view['conventions_hash']}` · **MAX_STALENESS_SECONDS:** {BASE_ENV['MAX_STALENESS_SECONDS']}"
        ),
        (
            "**Records dir:** temporary, deleted after the run (this runner never writes to GaleCore/research/regime). "
            f"P1 record path during the run: `{sanitize(record_path)}`"
        ),
        "",
        "Facts used: "
        + ", ".join(
            f"{k}={F.get(k)}"
            for k in (
                "symbol",
                "net_gex",
                "spot",
                "put_skew_ratio",
                "atm_iv",
                "put_wing_iv",
                "put_skew_level_ok",
                "vix",
                "vvix",
                "freshness_status",
            )
        ),
        "Per-source freshness: "
        + ", ".join(f"{k}={v['freshness_status']}" for k, v in F["sources"].items()),
        "",
        "One JSON artifact per case in this folder: exact stdin payload, stdout (parsed), exit code, failed guardrails.",
        "Sanitized: errors cut to their first line, absolute paths replaced by <repo>/<tmp>/<home>, no API key.",
        "P3 is a runner-authored review (mechanics only); P2 is an outcome fetched seconds after acceptance.",
        "",
        "| Case | Scenario | Expected | Exit | Status | Failed guardrails | Record | Error (truncated) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for a in artifacts:
        err = " ".join((a["error"] or "").split())[:100].replace("|", "/")
        rec_status = (
            (a["record"] or {}).get("status", "—") if isinstance(a["record"], dict) else "—"
        )
        lines.append(
            f"| {a['case']} | {a['title']} | {a['expected']} | {a['exit_code']} | {a['status'] or '—'} | "
            f"{', '.join(a['failed_guardrails']) or '—'} | {rec_status} | {err} |"
        )
    if mismatches:
        lines += ["", "## MISMATCHES", ""] + [f"- {m}" for m in mismatches]
    else:
        lines += [
            "",
            f"All {len(artifacts)} cases matched their expected exit code, status, guardrails and record outcome.",
        ]
    (out / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
