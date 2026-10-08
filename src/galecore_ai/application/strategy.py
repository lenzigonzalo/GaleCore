"""Strategy use cases (GC-AI-0008): check a proposal against its spec and the runtime, store it,
record the owner's approval of an exact version, and refuse a deploy whose hash is not the approved one.

The check answers one question: does the spec make GaleCore do what the proposal says, and does the
proposal say everything the runtime will not do? It is fail-closed:

- every leaf of the spec must be in the runtime support table (a field nobody mapped is an error);
- a field the runtime ignores must hold the value that matches what the runtime really does
  (e.g. sizing is always one contract), otherwise the spec would promise behavior that never runs;
- a field the runtime executes must be explained by a supported rule, and a supported rule may only
  name fields the runtime executes;
- a rule the runtime cannot execute stays out of the spec and is listed as a declared gap.

The support table describes GaleCore's SHADOW runtime as read in code (``RUNTIME_REFERENCE``). When
the runtime changes, the table changes with it; until then an unknown field fails the check.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any

from galecore_ai.adapters.strategy_store import (
    StrategyIntegrityError,
    StrategyStoreError,
    split_key,
)
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError, resolve_ref
from galecore_ai.application.project import load_log
from galecore_ai.contracts.project import EntryKind
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.strategy import (
    VERSION_MENTION_RE,
    ApprovalDocument,
    CheckReport,
    CritiqueContent,
    CritiqueDocument,
    CritiqueVerdict,
    ProposalContent,
    RuntimeStatus,
    StrategyDocument,
    compute_document_hash,
    design_gaps,
    other_version_mentions,
)

RUNTIME_REFERENCE = (
    "GaleCore feature/GC-0004-shadow-durable @ bc62f22 + feature/GC-0005-shadow-espaciado @ f86877e "
    "(min_minutes_between_entries): DataFeed.Application/App/Runtime "
    "+ P1-07 (WS-0019: PCS, CCS e iron condor; una instancia RUNNING por versión) "
    "(ShadowRuntimeEngine, GenericGateEvaluator, MetricResolver, CreditSpreadCandidateBuilder, ShadowRiskValidator, "
    "ShadowFillSimulator.EvaluateExits, ShadowRuntimeTick, StrategySpecHasher)"
)

# ── GaleCore's content hash ──────────────────────────────────────
# StrategySpecHasher: drop content_hash, keys sorted by UTF-16 code units, no whitespace, numbers
# written exactly as in the source text (JsonValue.WriteTo keeps "5.0"), relaxed string escaping.

_BS = chr(92)


class _RawNumber(str):
    pass


def _escape(s: str) -> str:
    """UnsafeRelaxedJsonEscaping as far as it was verified: C0/C1 controls, U+2028/U+2029 and characters
    outside the BMP (as a UTF-16 surrogate pair) are escaped with uppercase hex. The check additionally
    refuses non-ASCII text in a spec, so a case not reproduced here cannot reach an approval."""
    out = ['"']
    for ch in s:
        o = ord(ch)
        if o > 0xFFFF:
            o -= 0x10000
            out.append(_BS + f"u{0xD800 + (o >> 10):04X}" + _BS + f"u{0xDC00 + (o & 0x3FF):04X}")
        elif ch == '"':
            out.append(_BS + '"')
        elif ch == _BS:
            out.append(_BS + _BS)
        elif ch == "\n":
            out.append(_BS + "n")
        elif ch == "\r":
            out.append(_BS + "r")
        elif ch == "\t":
            out.append(_BS + "t")
        elif ch == "\b":
            out.append(_BS + "b")
        elif ch == "\f":
            out.append(_BS + "f")
        elif o < 0x20 or 0x7F <= o <= 0x9F or o in (0x2028, 0x2029):
            out.append(_BS + f"u{o:04X}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _canonical(v: Any) -> str:
    if isinstance(v, dict):
        keys = sorted(v, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(_escape(k) + ":" + _canonical(v[k]) for k in keys) + "}"
    if isinstance(v, list):
        return "[" + ",".join(_canonical(x) for x in v) + "]"
    if isinstance(v, _RawNumber):
        return str(v)
    if isinstance(v, str):
        return _escape(v)
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    raise TypeError(f"unexpected JSON value {v!r}")


def galecore_spec_hash(spec_json: str) -> str:
    """The content_hash GaleCore computes for this spec text (verified against GaleCore's own hashes)."""
    data = json.loads(spec_json, parse_float=_RawNumber, parse_int=_RawNumber)
    if not isinstance(data, dict):
        raise TypeError("a StrategySpec is a JSON object")
    data.pop("content_hash", None)
    return "sha256:" + hashlib.sha256(_canonical(data).encode("utf-8")).hexdigest()


# ── runtime support table ────────────────────────────────────────

SELL_PUT = "candidate_construction.legs[sell_put]"
BUY_PUT = "candidate_construction.legs[buy_put]"
SELL_CALL = "candidate_construction.legs[sell_call]"
BUY_CALL = "candidate_construction.legs[buy_call]"
GATE = "entry_filters.gate_layer.gates"
# What CreditSpreadCandidateBuilder builds (GaleCore P1-07): one vertical per side, same expiration.
STRUCTURE_LEGS = {
    "put_credit_spread": ["buy_put", "sell_put"],
    "call_credit_spread": ["buy_call", "sell_call"],
    "iron_condor": ["buy_call", "buy_put", "sell_call", "sell_put"],
}

# Executed by the runtime: a non-null value changes what GaleCore does, so a supported rule explains it.
EXECUTED = {
    "universe.symbols": "cada símbolo de la lista se evalúa en cada ciclo",
    "structure.allowed_strategies": "ShadowRiskValidator rechaza estructuras fuera de la lista",
    "structure.forbidden_strategies": "ShadowRiskValidator rechaza estructuras de la lista",
    "structure.default_structure": "CreditSpreadCandidateBuilder: put_credit_spread, call_credit_spread o iron_condor",
    f"{SELL_PUT}.strike_selection.target_delta": "delta objetivo del put vendido",
    f"{SELL_PUT}.strike_selection.delta_tolerance": "tolerancia alrededor del delta objetivo",
    f"{BUY_PUT}.strike_selection.width": "ancho del spread en dólares",
    f"{SELL_CALL}.strike_selection.target_delta": "delta objetivo de la call vendida (positivo)",
    f"{SELL_CALL}.strike_selection.delta_tolerance": "tolerancia alrededor del delta objetivo de la call",
    f"{BUY_CALL}.strike_selection.width": "ancho del spread de calls en dólares",
    "candidate_construction.constraints.min_dte": "DTE mínimo del vencimiento elegido",
    "candidate_construction.constraints.max_dte": "DTE máximo del vencimiento elegido",
    "candidate_construction.constraints.min_credit": "crédito mínimo a mid; menos → sin candidato",
    "risk_limits.max_concurrent_positions": "posiciones abiertas máximas → ENTRY_SKIPPED",
    "risk_limits.min_minutes_between_entries": ("minutos mínimos desde la última entrada de la instancia, abierta "
                                                "o cerrada → ENTRY_SKIPPED (GaleCore GC-0005; un runtime anterior "
                                                "lo ignora)"),
    "risk_limits.max_loss_per_trade_usd": "riesgo máximo por operación (ancho − crédito) × 100",
    "exits.deterministic.stop_loss.pct_of_credit": "cierra si pérdida ≥ pct × crédito (precedencia 1)",
    "exits.deterministic.take_profit.pct_of_credit": "cierra si valor ≤ (1 − pct) × crédito (precedencia 2)",
    "exits.deterministic.time_exit.max_dte": "cierra si DTE ≤ max_dte (precedencia 3)",
    "operational.timezone": "zona horaria de la sesión",
    "operational.session_hours.start": "inicio de la sesión evaluada (lunes a viernes)",
    "operational.session_hours.end": "fin de la sesión evaluada",
    "data_quality.max_quote_age_seconds": ("antigüedad máxima × 10 en SHADOW (DataFreshness.ShadowAgeFactor); "
                                           "una cotización sin hora no se puede medir y se acepta"),
}

# Ignored by the runtime: only the value that matches what the runtime really does is honest.
_NEUTRAL: dict[str, tuple[Any, ...]] = {
    "candidate_construction.sizing.method": ("FIXED",),
    "candidate_construction.sizing.fixed_contracts": (None, 1),
    "candidate_construction.sizing.risk_per_trade_pct": (None,),
    "candidate_construction.constraints.max_bid_ask_spread_pct": (None,),
    "exits.deterministic.defensive_roll.enabled": (False,),
    "risk_limits.max_risk_per_trade_pct": (None,),   # compared against net liq, which SHADOW passes as null
    "risk_limits.max_portfolio_heat_pct": (None,),
    "entry_filters.signal_layer.gates": ([],),       # validated, never evaluated
    "analytics_refs": ({},),
    "data_quality.block_on_crossed_market": (True,),  # the runtime always discards crossed quotes
    "data_quality.block_on_missing_critical_data": (True,),  # and always blocks without data
}
_RUNTIME_DOES = {
    "candidate_construction.sizing.method": "siempre 1 contrato",
    "candidate_construction.sizing.fixed_contracts": "siempre 1 contrato",
    "candidate_construction.sizing.risk_per_trade_pct": "no dimensiona por riesgo",
    "candidate_construction.constraints.max_bid_ask_spread_pct": "no filtra por bid/ask",
    "exits.deterministic.defensive_roll.enabled": "no hace roll",
    "risk_limits.max_risk_per_trade_pct": "no lo aplica (net liq nula en SHADOW)",
    "risk_limits.max_portfolio_heat_pct": "no mide heat",
    "entry_filters.signal_layer.gates": "no evalúa la capa de señales",
    "analytics_refs": "no usa analytics_refs",
    "data_quality.block_on_crossed_market": "siempre descarta cotizaciones cruzadas",
    "data_quality.block_on_missing_critical_data": "siempre bloquea sin datos",
}

# What the runtime always does, whatever the spec says: a supported rule may rest on these fields when
# they hold that value. A null neutral (no heat, no bid/ask filter) is an absence, never support.
IMPLICIT_BEHAVIOR = ("candidate_construction.sizing.method", "candidate_construction.sizing.fixed_contracts",
                     "exits.deterministic.defensive_roll.enabled", "data_quality.block_on_crossed_market",
                     "data_quality.block_on_missing_critical_data")

# No neutral value exists: the proposal must declare the gap with an unsupported rule naming the field.
MUST_DECLARE = {
    "operational.calendar": "sólo excluye sábados y domingos; no conoce feriados",
}

# The runtime has exactly one semantics for these: any other value would promise behavior it does not have.
_FIXED: dict[str, Any] = {
    "universe.mode": "WHITELIST",
    "universe.instrument_types": ["EQUITY_OPTION"],
    "universe.excluded": {},
    "structure.selection_method": "FIXED",
    "entry_filters.gate_layer.pass_rule": "ALL",
    "entry_filters.gate_layer.on_fail": "NO_TRADE",
    "deployment_constraints.eligible_modes": ["SHADOW"],
    f"{SELL_PUT}.strike_selection.method": "DELTA",
    f"{BUY_PUT}.strike_selection.method": "FIXED_WIDTH",
    f"{SELL_CALL}.strike_selection.method": "DELTA",
    f"{BUY_CALL}.strike_selection.method": "FIXED_WIDTH",
}

# Descriptive fields with no behavior in SHADOW (leg side/type are checked by the legs' shape).
_INFORMATIONAL = {
    "strategy_spec_version", "canonicalization_version", "content_hash",
    "deployment_constraints.requires_human_approval_for", "entry_filters.signal_layer.pass_rule",
    "operational.decimal_precision", "operational.currency", "operational.rounding", "operational.symbology",
    *(f"{leg}.{k}" for leg in (SELL_PUT, BUY_PUT, SELL_CALL, BUY_CALL) for k in ("side", "type")),
}
_INFORMATIONAL_PREFIXES = ("identity.", "metadata.")
_ROLL = "exits.deterministic.defensive_roll."
# Leg fields the builder never reads for that leg: only null is honest.
_NULL_ONLY = (f"{SELL_PUT}.strike_selection.width", f"{BUY_PUT}.strike_selection.target_delta",
              f"{BUY_PUT}.strike_selection.delta_tolerance", f"{SELL_CALL}.strike_selection.width",
              f"{BUY_CALL}.strike_selection.target_delta", f"{BUY_CALL}.strike_selection.delta_tolerance")

_METRIC_RE = re.compile(
    r"^capability:(market_data\.quote\.[A-Z0-9.^]+\.price|market_data\.trade\.[A-Z0-9.^]+\.price|"
    r"compute\.gamma_exposure\.[A-Z0-9.^]+\.net_gex)$")
_OPERATORS = {"LT", "LTE", "GT", "GTE", "EQ", "NEQ", "BETWEEN"}
_GATE_KEYS = {"id", "label", "metric_ref", "operator", "threshold", "on_fail", "on_no_data"}


def _leg_key(leg: dict) -> str:
    return f"{str(leg.get('side', '')).lower()}_{str(leg.get('type', '')).lower()}"


def _leaves(node: Any, path: str, out: dict[str, Any], errors: list[str]) -> None:
    if isinstance(node, dict) and node:
        for k, v in node.items():
            _leaves(v, f"{path}.{k}" if path else k, out, errors)
        return
    if path == GATE and isinstance(node, list):
        for gate in node:
            gid = gate.get("id") if isinstance(gate, dict) else None
            out[f"{GATE}[{gid}]"] = gate
        return
    if path == "candidate_construction.legs" and isinstance(node, list):
        keys = [_leg_key(leg) if isinstance(leg, dict) else "?" for leg in node]
        if sorted(keys) not in STRUCTURE_LEGS.values():
            errors.append(f"legs must be one SELL and one BUY per side of a credit spread or iron condor; got {keys}")
            return
        for leg in node:
            _leaves(leg, f"candidate_construction.legs[{_leg_key(leg)}]", out, errors)
        return
    out[path] = node


def _check_gate(key: str, gate: Any, errors: list[str]) -> None:
    if not isinstance(gate, dict) or not gate.get("id"):
        errors.append(f"{key}: a gate needs an id")
        return
    if not _METRIC_RE.fullmatch(str(gate.get("metric_ref", ""))):
        errors.append(f"{key}: metric_ref {gate.get('metric_ref')!r} is not one the runtime resolves "
                      "(quote/trade price or net GEX); it would be NO_DATA forever")
    if gate.get("operator") not in _OPERATORS:
        errors.append(f"{key}: operator {gate.get('operator')!r} unknown")
    if gate.get("on_fail") != "NO_TRADE" or gate.get("on_no_data") != "BLOCK":
        errors.append(f"{key}: only on_fail=NO_TRADE and on_no_data=BLOCK keep a gate fail-closed")
    unknown = sorted(set(gate) - _GATE_KEYS)
    if unknown:
        errors.append(f"{key}: properties the gate evaluator never reads: {unknown}")
    threshold = gate.get("threshold")
    if not isinstance(threshold, dict):
        errors.append(f"{key}: threshold must be an object")
        return
    def number(v: Any) -> bool:
        return isinstance(v, int | float) and not isinstance(v, bool)
    extra = sorted(set(threshold) - {"value", "min", "max"})
    if extra:
        errors.append(f"{key}: threshold properties never read: {extra}")
    if gate.get("operator") == "BETWEEN":
        if not (number(threshold.get("min")) and number(threshold.get("max"))) or threshold.get("value") is not None:
            errors.append(f"{key}: BETWEEN needs numeric threshold.min and threshold.max and no value")
    elif not number(threshold.get("value")) or threshold.get("min") is not None or threshold.get("max") is not None:
        errors.append(f"{key}: {gate.get('operator')} needs a numeric threshold.value and no min/max")


def check_proposal(content: ProposalContent, spec_json: str, spec_file: str) -> CheckReport:
    errors: list[str] = []
    try:
        spec = json.loads(spec_json)
    except json.JSONDecodeError as exc:
        return CheckReport(verdict="INVALID", errors=[f"spec is not JSON: {exc}"], declared_gaps=[],
                           coverage={}, runtime_reference=RUNTIME_REFERENCE)
    if not isinstance(spec, dict):
        return CheckReport(verdict="INVALID", errors=["a StrategySpec is a JSON object"], declared_gaps=[],
                           coverage={}, runtime_reference=RUNTIME_REFERENCE)
    ident = spec.get("identity", {}) if isinstance(spec, dict) else {}
    if ident.get("name") != content.name or ident.get("version") != content.version:
        errors.append(f"spec identity {ident.get('name')}/{ident.get('version')} is not the proposal's "
                      f"{content.name}/{content.version}")
    if spec_file != f"{content.name}.json":
        errors.append(f"spec file {spec_file!r} must be {content.name}.json (GaleCore deploys by file name)")
    if not json.dumps(spec, ensure_ascii=False).isascii():
        errors.append("the spec's strings must be ASCII: GaleCore's JSON escaping of other characters is not fully "
                      "reproduced here, so their hash could differ; prose belongs in the proposal")
    wrong = other_version_mentions(content)
    if wrong:
        errors.append(f"version {content.version} mentions other versions {wrong} outside limitations/pending; "
                      "rules, evaluation plan and approval questions must name this exact version")
    if spec.get("content_hash") is not None:
        errors.append("content_hash must be null in the file; GaleCore computes it")
    structure = spec.get("structure", {}).get("default_structure")
    legs = spec.get("candidate_construction", {}).get("legs")
    if structure not in STRUCTURE_LEGS:
        errors.append(f"default_structure {structure!r} is not built by the runtime ({', '.join(STRUCTURE_LEGS)})")
    elif isinstance(legs, list) and sorted(_leg_key(x) for x in legs if isinstance(x, dict)) != STRUCTURE_LEGS[structure]:
        errors.append(f"legs must be exactly {STRUCTURE_LEGS[structure]} for {structure}")
    sell_call_delta = next((x.get("strike_selection", {}).get("target_delta") for x in legs or []
                            if isinstance(x, dict) and _leg_key(x) == "sell_call"), None)
    if isinstance(sell_call_delta, int | float) and sell_call_delta <= 0:
        errors.append(f"{SELL_CALL}.strike_selection.target_delta must be positive (call delta)")

    leaves: dict[str, Any] = {}
    _leaves(spec, "", leaves, errors)

    supported_paths: dict[str, list[str]] = {}
    declared_paths: set[str] = set()
    for rule in content.rules:
        if rule.runtime.status == RuntimeStatus.SUPPORTED:
            for p in rule.runtime.spec_paths:
                supported_paths.setdefault(p, []).append(rule.id)
        else:
            declared_paths.update(rule.runtime.spec_paths)

    coverage: dict[str, list[str]] = {}
    for path, value in sorted(leaves.items()):
        if path.startswith(f"{GATE}["):
            _check_gate(path, value, errors)
            if path not in supported_paths:
                errors.append(f"{path}: the runtime evaluates this gate but no supported rule explains it")
            coverage[path] = supported_paths.get(path, [])
        elif path in EXECUTED:
            if value is None:
                continue
            if path not in supported_paths:
                errors.append(f"{path} = {value!r}: the runtime executes it ({EXECUTED[path]}) "
                              "but no supported rule explains it")
            coverage[path] = supported_paths.get(path, [])
        elif path in _NEUTRAL:
            if value not in _NEUTRAL[path]:
                errors.append(f"{path} = {value!r}: the runtime ignores it ({_RUNTIME_DOES[path]}); the spec "
                              f"must say {_NEUTRAL[path][0]!r} and the rule stays declared as unsupported")
        elif path in MUST_DECLARE:
            if path not in declared_paths:
                errors.append(f"{path} = {value!r}: the runtime {MUST_DECLARE[path]}; declare it with an "
                              "unsupported rule naming this field")
        elif path in _FIXED:
            if value != _FIXED[path]:
                errors.append(f"{path} = {value!r}: the runtime only has {_FIXED[path]!r} semantics (only SHADOW, "
                              "a fixed whitelist of equity options, one PCS builder, gates with ALL/NO_TRADE)")
        elif path in _NULL_ONLY or path.startswith(_ROLL):
            if value is not None:
                errors.append(f"{path} = {value!r}: the runtime never reads it; it must be null")
        elif path not in _INFORMATIONAL and not path.startswith(_INFORMATIONAL_PREFIXES):
            errors.append(f"{path}: not in the runtime support table; nobody verified what GaleCore does with it")

    for path, rule_ids in supported_paths.items():
        if path.startswith(f"{GATE}["):
            if path not in leaves:
                errors.append(f"rules {rule_ids}: gate {path} is not in the spec")
        elif path in IMPLICIT_BEHAVIOR:
            # Supported only as what the runtime already does regardless of the spec (one contract, no roll).
            if path not in leaves or leaves[path] not in _NEUTRAL[path]:
                errors.append(f"rules {rule_ids}: {path} is supported only with the runtime's own behavior "
                              f"({_RUNTIME_DOES[path]}), value {_NEUTRAL[path][0]!r}")
        elif path not in EXECUTED:
            errors.append(f"rules {rule_ids}: {path} is marked supported but the runtime does not execute it")
        elif leaves.get(path) is None:
            errors.append(f"rules {rule_ids}: {path} is marked supported but the spec leaves it empty")

    gaps = [f"{r.id}: {r.text} — {r.runtime.note}" for r in content.rules
            if r.runtime.status == RuntimeStatus.UNSUPPORTED]
    verdict = "INVALID" if errors else ("VALID_WITH_DECLARED_GAPS" if gaps else "VALID")
    return CheckReport(verdict=verdict, errors=errors, declared_gaps=gaps, coverage=coverage,
                       runtime_reference=RUNTIME_REFERENCE)


def _check_refs(content: ProposalContent, kb: KnowledgeBase) -> list[str]:
    problems = []
    refs = list(content.research_refs) + list(content.hypothesis.sources)
    refs += [s for r in content.rules for s in r.sources]
    for ref in dict.fromkeys(refs):
        try:
            resolve_ref(ref, kb)
        except KnowledgeError as exc:
            problems.append(str(exc))
    problems += [f"research_refs must be research: refs, got {r}" for r in content.research_refs
                 if not r.startswith("research:")]
    return problems


def _change_problems(content: ProposalContent, kb: KnowledgeBase) -> list[str]:
    """After the first version, a new one says which version it changes, why, and what originated it (U-30)."""
    earlier = [k.split("/")[1] for k in kb.strategies.versions()
               if k.split("/")[0] == content.name and k.split("/")[1] != content.version]
    if not earlier:
        return []
    if content.change is None:
        return [f"{content.name} already has versions {earlier}: the proposal says what it changes and why (change)"]
    problems = []
    if content.change.from_version not in earlier:
        problems.append(f"change.from_version {content.change.from_version} is not a stored version of {content.name}")
    decisions = None
    for ref in content.change.refs:
        if ref.startswith("decision:"):
            if decisions is None:   # the raw log: full hashes, decisions only (project show prints 12 hex)
                decisions = [e.hash for e in load_log(kb, content.name).entries if e.kind == EntryKind.DECISION]
            given = ref.removeprefix("decision:")
            if len(given) < len("sha256:") + 12 or not any(h.startswith(given) for h in decisions):
                problems.append(f"{ref}: no decision of the project of {content.name} has that hash "
                                "(full, or the 12 hex digits `project show` prints)")
            continue
        try:
            resolve_ref(ref, kb)
        except KnowledgeError as exc:
            problems.append(str(exc))
    return problems


def save_proposal(*, kb: KnowledgeBase, prompt: str, host: RecordHost, content: ProposalContent,
                  spec_json: str, spec_file: str, now: datetime | None = None) -> tuple[StrategyDocument, str]:
    """Check and store a version. An INVALID check, an unresolved reference or a version without its parameter
    table and management tree is refused, not stored."""
    problems = _check_refs(content, kb) + design_gaps(content) + _change_problems(content, kb)
    report = check_proposal(content, spec_json, spec_file)
    if report.verdict == "INVALID" or problems:
        raise KnowledgeError("proposal refused", problems + report.errors)
    now = now or datetime.now(UTC)
    try:
        draft = StrategyDocument(name=content.name, version=content.version, recorded_at=now, host=host,
                                 prompt=prompt, content=content, spec_file=spec_file, spec_json=spec_json,
                                 spec_hash=galecore_spec_hash(spec_json), check=report, content_hash="pending")
    except ValueError as exc:
        raise KnowledgeError("proposal refused", [str(exc)]) from exc
    doc = draft.model_copy(update={"content_hash": compute_document_hash(draft.hashable_content())})
    try:
        path = kb.strategies.create(doc)
    except StrategyStoreError as exc:
        raise KnowledgeError(str(exc)) from exc
    return doc, str(path)


def load_proposal(kb: KnowledgeBase, key: str) -> StrategyDocument:
    try:
        doc = kb.strategies.load(key)
    except (StrategyStoreError, StrategyIntegrityError) as exc:
        raise KnowledgeError(f"strategy:{key}: not usable ({exc})") from exc
    if doc is None:
        raise KnowledgeError(f"strategy:{key}: no such strategy version")
    return doc


def approve(*, kb: KnowledgeBase, key: str, spec_hash: str, owner_words: str, host: RecordHost,
            now: datetime | None = None) -> tuple[ApprovalDocument, str]:
    """Record the owner's approval of exactly this version and hash. The hash must be retyped, not implied."""
    doc = load_proposal(kb, key)
    if spec_hash != doc.spec_hash:
        raise KnowledgeError(f"strategy:{key}: the approved hash {spec_hash} is not this version's {doc.spec_hash}")
    if doc.check.verdict == "INVALID":
        raise KnowledgeError(f"strategy:{key}: an INVALID proposal cannot be approved")
    review = load_critique(kb, key)
    if problem := critique_problem(review, doc):
        raise KnowledgeError(f"strategy:{key}: {problem}", review.content.why_not if review else [])
    others = sorted({v for v in VERSION_MENTION_RE.findall(owner_words) if v != doc.version})
    if others:
        raise KnowledgeError(f"strategy:{key}: the owner's words name version(s) {others}, not {doc.version}")
    now = now or datetime.now(UTC)
    try:
        draft = ApprovalDocument(strategy_ref=f"strategy:{key}", spec_hash=spec_hash,
                                 proposal_hash=doc.content_hash, owner_words=owner_words, recorded_at=now,
                                 host=host, content_hash="pending")
    except ValueError as exc:
        raise KnowledgeError("approval refused", [str(exc)]) from exc
    approval = draft.model_copy(update={"content_hash": compute_document_hash(draft.hashable_content())})
    try:
        path = kb.strategies.create_approval(key, approval)
    except StrategyStoreError as exc:
        raise KnowledgeError(str(exc)) from exc
    return approval, str(path)


def critique_problem(review: CritiqueDocument | None, doc: StrategyDocument) -> str | None:
    """Why this version cannot be approved or deployed for lack of a valid critique, or None (AC-06)."""
    if review is None:
        return "no critique of this version; record it with `strategy critique`"
    if review.proposal_hash != doc.content_hash:
        return "the critique is for another proposal document"
    if review.content.verdict == CritiqueVerdict.DISCARD:
        return "the critique says «descartar»; a new version has to answer it"
    return None


def load_critique(kb: KnowledgeBase, key: str) -> CritiqueDocument | None:
    try:
        return kb.strategies.load_critique(key)
    except (StrategyStoreError, StrategyIntegrityError) as exc:
        raise KnowledgeError(f"strategy:{key}: critique not usable ({exc})") from exc


def critique(*, kb: KnowledgeBase, key: str, content: CritiqueContent, host: RecordHost,
             now: datetime | None = None) -> tuple[CritiqueDocument, str]:
    """Record the critic's reading of exactly this version (one per version; a change is a new version)."""
    doc = load_proposal(kb, key)
    problems = []
    for ref in dict.fromkeys(content.evidence_refs):
        try:
            resolve_ref(ref, kb)
        except KnowledgeError as exc:
            problems.append(str(exc))
    if problems:
        raise KnowledgeError("critique refused", problems)
    now = now or datetime.now(UTC)
    draft = CritiqueDocument(strategy_ref=f"strategy:{key}", proposal_hash=doc.content_hash, content=content,
                             recorded_at=now, host=host, content_hash="pending")
    review = draft.model_copy(update={"content_hash": compute_document_hash(draft.hashable_content())})
    try:
        path = kb.strategies.create_critique(key, review)
    except StrategyStoreError as exc:
        raise KnowledgeError(str(exc)) from exc
    return review, str(path)


def deploy_check(*, kb: KnowledgeBase, key: str, galecore_hash: str, galecore_spec_json: str | None = None) -> dict:
    """Allow a deploy only if an intact approval exists for this version and GaleCore reports its hash.

    ``galecore_hash`` is what GaleCore says it loaded (``App/Runtime/Specs/<name>``); when GaleCore
    also returns the spec text, it must hash to the same value.
    """
    doc = load_proposal(kb, key)
    try:
        approval = kb.strategies.load_approval(key)
    except (StrategyStoreError, StrategyIntegrityError) as exc:
        raise KnowledgeError(f"strategy:{key}: approval not usable ({exc})") from exc
    problems = []
    if approval is None:
        problems.append(f"strategy:{key} has no recorded approval")
    else:
        if approval.proposal_hash != doc.content_hash:
            problems.append("the approval is for another proposal document")
        if approval.spec_hash != doc.spec_hash:
            problems.append("the approval is for another spec hash")
    # Also for versions approved before the critique was required (owner, 08/10): the approval stays as recorded,
    # a new deploy needs a valid critique of this exact version.
    if problem := critique_problem(load_critique(kb, key), doc):
        problems.append(problem)
    if galecore_hash != doc.spec_hash:
        problems.append(f"GaleCore loaded {galecore_hash}, the approved version is {doc.spec_hash}")
    if galecore_spec_json is not None and galecore_spec_hash(galecore_spec_json) != galecore_hash:
        problems.append("the spec text GaleCore returned does not hash to the hash it reports")
    if problems:
        raise KnowledgeError(f"deploy of strategy:{key} refused", problems)
    return {"status": "DEPLOY_ALLOWED", "strategy": f"strategy:{key}", "spec_file": doc.spec_file,
            "spec_hash": doc.spec_hash, "approval_recorded_at": approval.recorded_at.isoformat(),
            "scope": approval.scope}


def strategy_key(ref_or_key: str) -> str:
    key = ref_or_key.removeprefix("strategy:")
    try:
        split_key(key)
    except StrategyStoreError as exc:
        raise KnowledgeError(str(exc)) from exc
    return key
