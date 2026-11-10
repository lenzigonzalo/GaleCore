"""Strategy use cases (GC-AI-0008): check a proposal against its spec and the runtime, store it,
record the owner's approval of an exact version, and refuse a deploy whose hash is not the approved one.

The runtime is the authority on its own spec (WS-0062 inc. 8b): validity, errors, the hash and which spec paths
it executes come from GaleCore's ``POST /App/Runtime/Specs/Check`` (read-only), never from a table kept here.
The harness keeps its own job, fail-closed:

- every rule the proposal marks SUPPORTED must cite spec paths GaleCore reports as executed;
- every path GaleCore reports as executed must be explained by some supported rule;
- identity, file name, ASCII text, version mentions and the hash GaleCore reports against the local one;
- a rule the runtime cannot execute stays out of the spec and is listed as a declared gap.

Without GaleCore there is no check (it is always on): the error says so, there is no fallback.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
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

RUNTIME_REFERENCE = "GaleCore POST /App/Runtime/Specs/Check (el runtime dice qué ejecuta)"

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



# ── GaleCore's check of a spec ───────────────────────────────────

CHECK_PATH = "/App/Runtime/Specs/Check"
SpecChecker = Callable[[str], dict]   # spec text -> GaleCore's Check response


def _check_response_problem(body: Any) -> str | None:
    """What is wrong with a Check response (GaleCore's contract: valid, errors, content_hash, executed_paths,
    inert_paths), or None. A missing field is never read as empty: an unexplained executed path would go unseen."""
    if not isinstance(body, dict):
        return "no es un objeto"

    def strings(key: str) -> bool:
        return isinstance(body.get(key), list) and all(isinstance(x, str) for x in body[key])

    if not isinstance(body.get("valid"), bool):
        return "valid no es booleano"
    for key in ("errors", "executed_paths", "inert_paths"):
        if not strings(key):
            return f"{key} falta o no es una lista de textos"
    hashed = body.get("content_hash")
    if not (isinstance(hashed, str) if body["valid"] else hashed is None or isinstance(hashed, str)):
        return "content_hash falta o no es texto"
    return None


def galecore_spec_checker(base_url: str | None = None, api_key: str | None = None, timeout: float = 30.0) -> SpecChecker:
    """POST the spec to GaleCore's read-only Check. An unreachable or older GaleCore is an error, not a fallback."""
    import httpx

    base = (base_url or os.environ.get("GALECORE_BASE_URL", "http://localhost:7001")).rstrip("/")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if key := (api_key or os.environ.get("GALECORE_API_KEY")):
        headers["X-Api-Key"] = key

    def check(spec_json: str) -> dict:
        try:
            r = httpx.post(base + CHECK_PATH, content=spec_json.encode("utf-8"), headers=headers, timeout=timeout)
        except httpx.HTTPError as exc:
            raise KnowledgeError(f"GaleCore no respondió en {base} ({type(exc).__name__}): sin GaleCore no se puede "
                                 "verificar qué ejecuta el runtime, y no hay otra fuente") from exc
        if r.status_code == 404:
            raise KnowledgeError(f"GaleCore en {base} no tiene {CHECK_PATH}: corre una versión anterior al runtime "
                                 "genérico (WS-0062); sin él no se puede verificar la spec")
        if r.status_code != 200:
            raise KnowledgeError(f"POST {CHECK_PATH} -> HTTP {r.status_code}")
        try:
            body = r.json()
        except ValueError as exc:
            raise KnowledgeError(f"POST {CHECK_PATH} no devolvió JSON") from exc
        if problem := _check_response_problem(body):
            raise KnowledgeError(f"POST {CHECK_PATH} devolvió algo que no es un resultado de Check ({problem}): "
                                 "sin la respuesta completa no se puede verificar qué ejecuta el runtime")
        return body

    return check


def _obj(v: Any) -> dict:
    """A JSON object, or empty: malformed sections are reported by the checks that need them, never crash."""
    return v if isinstance(v, dict) else {}


# Identity and deployment paths say which spec this is and where it may run; they are not trading rules, so
# GaleCore executing them needs no supported rule. Everything else it executes must be explained by one.
_UNRULED_PREFIXES = ("identity.", "deployment_constraints.")


def _related(p: str, e: str) -> bool:
    """Spec paths are opaque dotted strings with list indexes: one covers the other when it is a prefix."""
    return p == e or any(a.startswith(b + sep) for a, b in ((e, p), (p, e)) for sep in (".", "["))


def check_proposal(content: ProposalContent, spec_json: str, spec_file: str,
                   checker: SpecChecker | None = None) -> CheckReport:
    errors: list[str] = []
    try:
        spec = json.loads(spec_json)
    except json.JSONDecodeError as exc:
        return CheckReport(verdict="INVALID", errors=[f"spec is not JSON: {exc}"], declared_gaps=[],
                           coverage={}, runtime_reference=RUNTIME_REFERENCE)
    if not isinstance(spec, dict):
        return CheckReport(verdict="INVALID", errors=["a StrategySpec is a JSON object"], declared_gaps=[],
                           coverage={}, runtime_reference=RUNTIME_REFERENCE)
    ident = _obj(spec.get("identity"))
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

    result = (checker or galecore_spec_checker())(spec_json)
    errors.extend(f"GaleCore: {e}" for e in result.get("errors") or [])
    if not result["valid"] and not result.get("errors"):
        errors.append("GaleCore: the runtime refuses the spec without saying why")
    reported = result.get("content_hash")
    if result["valid"] and reported != galecore_spec_hash(spec_json):
        errors.append(f"GaleCore hashes this spec as {reported}, the local hash is {galecore_spec_hash(spec_json)}")

    coverage: dict[str, list[str]] = {}
    if result["valid"]:
        executed = list(dict.fromkeys(result["executed_paths"]))
        inert = list(result["inert_paths"])
        supported: dict[str, list[str]] = {}
        for rule in content.rules:
            if rule.runtime.status == RuntimeStatus.SUPPORTED:
                for p in rule.runtime.spec_paths:
                    supported.setdefault(p, []).append(rule.id)
        for e in sorted(executed):
            rule_ids = sorted({r for p, ids in supported.items() if _related(p, e) for r in ids})
            if not rule_ids and e.startswith(_UNRULED_PREFIXES):
                continue
            if not rule_ids:
                errors.append(f"{e}: GaleCore executes it but no supported rule explains it")
            coverage[e] = rule_ids
        for p, rule_ids in supported.items():
            if not any(_related(p, e) for e in executed):
                why = "GaleCore ignores it (inert)" if any(_related(p, i) for i in inert) else "GaleCore does not execute it"
                errors.append(f"rules {rule_ids}: {p} is marked supported but {why}")

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
                  spec_json: str, spec_file: str, now: datetime | None = None,
                  checker: SpecChecker | None = None) -> tuple[StrategyDocument, str]:
    """Check and store a version. An INVALID check, an unresolved reference or a version without its parameter
    table and management tree is refused, not stored."""
    problems = _check_refs(content, kb) + design_gaps(content) + _change_problems(content, kb)
    report = check_proposal(content, spec_json, spec_file, checker)
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


def approve(*, kb: KnowledgeBase, key: str, spec_hash: str | None = None, owner_words: str, host: RecordHost,
            now: datetime | None = None) -> tuple[ApprovalDocument, str]:
    """Record the owner's approval of exactly this version. The owner says yes to the named version in plain words;
    the hash is the stored one (an explicit ``spec_hash`` must still match it)."""
    doc = load_proposal(kb, key)
    spec_hash = spec_hash or doc.spec_hash
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


def install_spec(*, kb: KnowledgeBase, key: str, target_dir: Path) -> dict:
    """Copy the approved spec, byte for byte, where GaleCore loads it from (only with an intact approval)."""
    doc = load_proposal(kb, key)
    try:
        approval = kb.strategies.load_approval(key)
    except (StrategyStoreError, StrategyIntegrityError) as exc:
        raise KnowledgeError(f"strategy:{key}: approval not usable ({exc})") from exc
    if approval is None or approval.spec_hash != doc.spec_hash:
        raise KnowledgeError(f"strategy:{key}: no approval of this version's spec; the owner approves first")
    if galecore_spec_hash(doc.spec_json) != doc.spec_hash:
        raise KnowledgeError(f"strategy:{key}: the stored spec does not hash to its recorded hash")
    if not target_dir.is_dir():
        raise KnowledgeError(f"{target_dir} does not exist")
    path = target_dir / doc.spec_file
    if path.exists() and path.read_bytes() != doc.spec_json.encode("utf-8"):
        raise KnowledgeError(f"{path.name} already exists in GaleCore with other content; not overwritten")
    path.write_bytes(doc.spec_json.encode("utf-8"))
    return {"status": "INSTALLED", "spec_file": doc.spec_file, "path": str(path), "spec_hash": doc.spec_hash}


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


# ── deploy into SHADOW ───────────────────────────────────────

SPECS_PATH = "/App/Runtime/Specs"
DEPLOY_PATH = "/App/Runtime/Deploy"
Deployer = Callable[[str, str], tuple[dict, dict]]   # (spec name, spec text) -> (Specs response, Deploy response)

_HTTP_PROBLEMS = {
    400: "GaleCore rechaza la spec o el despliegue",
    401: "GaleCore no reconoce tu sesión: volvé a entrar en el Lab y probá de nuevo",
    403: "GaleCore no te deja desplegar ni parar acá",
    404: "GaleCore no conoce esa spec",
    409: "GaleCore ya corre otra versión de esa estrategia: hay que frenar esa instancia antes de desplegar ésta",
    503: "SHADOW de GaleCore está sin persistencia: no se despliega algo que se perdería al reiniciar",
}


def _galecore_headers(authorization: str) -> dict[str, str]:
    """The one place where calls that change GaleCore authenticate: the ApiKey (if any) plus the user's session."""
    headers = {"Accept": "application/json", "Content-Type": "application/json", "Authorization": authorization}
    if key := os.environ.get("GALECORE_API_KEY"):
        headers["X-Api-Key"] = key
    return headers


def galecore_deployer(base_url: str | None = None, timeout: float = 60.0,
                      session: Callable[[], str] | None = None) -> Deployer:
    """Register the spec text and deploy it in SHADOW, in the name of the logged-in user. ``session`` returns the
    ``Authorization`` value (default: the Lab's GaleCore login). No retries: any refusal or network error is reported."""
    import httpx

    base = (base_url or os.environ.get("GALECORE_BASE_URL", "http://localhost:7001")).rstrip("/")

    def authorization() -> str:
        from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
        try:
            return session() if session else SpaceClient(base_url=base).authorization()
        except SpaceError as exc:
            raise KnowledgeError("Para desplegar hace falta tu sesión de GaleCore (usuario y contraseña del Lab): "
                                 "no se desplegó nada", [str(exc)]) from exc

    auth = ""

    def post(path: str, **kwargs) -> dict:
        try:
            r = httpx.post(base + path, headers=_galecore_headers(auth), timeout=timeout, **kwargs)
        except httpx.HTTPError as exc:
            raise KnowledgeError(f"GaleCore no respondió en {base} ({type(exc).__name__}); no se desplegó nada "
                                 "o no se sabe si quedó a medias: mirá Estrategias en la plataforma") from exc
        try:
            body = r.json()
        except ValueError:
            body = None
        if r.status_code != 200:
            why = _HTTP_PROBLEMS.get(r.status_code, f"GaleCore respondió HTTP {r.status_code}")
            detail = body.get("errors") or body.get("error") if isinstance(body, dict) else None
            if r.status_code == 409 and isinstance(body, dict) and "expected_hash" in body:
                raise KnowledgeError(
                    f"GaleCore tiene otra versión de esa estrategia que la aprobada ({path}, HTTP 409): se subió otra "
                    "versión o se reinició entre el registro y el despliegue; no se desplegó nada",
                    [f"hash aprobado: {body.get('expected_hash')}", f"hash vigente en GaleCore: {body.get('current_hash')}"])
            raise KnowledgeError(f"{why} ({path}, HTTP {r.status_code})",
                                 [str(d) for d in detail] if isinstance(detail, list) else
                                 [str(detail)] if detail else [])
        if not isinstance(body, dict):
            raise KnowledgeError(f"POST {path} no devolvió un objeto JSON")
        return body

    def deploy(name: str, spec_json: str) -> tuple[dict, dict]:
        nonlocal auth
        auth = authorization()   # before any POST: without a session nothing is sent
        registered = post(SPECS_PATH, content=spec_json.encode("utf-8"))
        if registered.get("content_hash") != galecore_spec_hash(spec_json):
            return registered, {}   # the caller refuses: nothing is deployed
        # expectedHash: GaleCore despliega sólo si la vigente sigue siendo exactamente la versión aprobada.
        return registered, post(DEPLOY_PATH, json={"specName": name, "expectedHash": galecore_spec_hash(spec_json)})

    return deploy


def deploy_strategy(*, kb: KnowledgeBase, key: str, deployer: Deployer | None = None) -> dict:
    """Deploy an approved version in SHADOW: GaleCore is only called with an intact approval of this exact spec,
    and only deploys what it hashes to the approved hash."""
    doc = load_proposal(kb, key)
    allowed = deploy_check(kb=kb, key=key, galecore_hash=doc.spec_hash)   # intact approval and critique, no GaleCore
    approval = kb.strategies.load_approval(key)
    if approval.strategy_ref != f"strategy:{key}" or approval.scope != "SHADOW:galecore-dev":
        raise KnowledgeError(f"deploy of strategy:{key} refused", ["the approval is not of this version in SHADOW"])
    if galecore_spec_hash(doc.spec_json) != doc.spec_hash:
        raise KnowledgeError(f"strategy:{key}: the stored spec does not hash to its recorded hash")
    name = Path(doc.spec_file).stem
    registered, instance = (deployer or galecore_deployer())(name, doc.spec_json)
    if registered.get("content_hash") != doc.spec_hash:
        raise KnowledgeError(f"GaleCore registró la spec con el hash {registered.get('content_hash')}, la aprobada es "
                             f"{doc.spec_hash}: no se desplegó")
    instance_id = instance.get("instanceId")
    if not instance_id:
        raise KnowledgeError("GaleCore no devolvió la instancia desplegada")
    if instance.get("versionHash") != doc.spec_hash:
        raise KnowledgeError(f"la instancia {instance_id} corre {instance.get('versionHash') or 'una versión que GaleCore no informó'}, "
                             f"no la versión aprobada {doc.spec_hash}: frenala")
    result = {"status": "DEPLOYED", "ref": f"strategy:{key}", "instance_id": instance_id,
              "spec_hash": doc.spec_hash, "replaced_hash": registered.get("replaced_hash"),
              "existing": bool(instance.get("existing")), "scope": allowed["scope"]}
    from galecore_ai.application.project import add
    try:
        add(kb=kb, name=doc.name, kind="decision", prompt="strategy deploy", refs=[], now=None,
            words=f"Registro del sistema, no son palabras del owner: se desplegó {key} en SHADOW, instancia {instance_id}"
                  + (" (ya corría)" if result["existing"] else ""))
        result["recorded"] = True
    except KnowledgeError as exc:   # the instance is real: a failed note must not hide it
        result["recorded"] = False
        result["record_error"] = str(exc)
    return result


def stop_instance(instance_id: str, client=None) -> dict:
    """Stop a SHADOW instance in the GaleCore this process is connected to (same connection as the follow-up report),
    in the name of the logged-in user. It stops entering; what is open keeps being valued. No retries."""
    from galecore_ai.adapters.galecore_space import SpaceClient, SpaceError
    try:
        body = (client or SpaceClient(timeout=60.0)).post(f"/App/Runtime/Instances/{instance_id}/Stop")
    except SpaceError as exc:
        why = _HTTP_PROBLEMS.get(exc.status or 0, "GaleCore no pudo frenar la instancia")
        raise KnowledgeError(f"{why} (instancia {instance_id}): no se sabe si quedó frenada, mirá Estrategias en la "
                             "plataforma", [str(exc)]) from exc
    return {"status": "STOPPED", "instance_id": instance_id, "galecore": body}


def strategy_key(ref_or_key: str) -> str:
    key = ref_or_key.removeprefix("strategy:")
    try:
        split_key(key)
    except StrategyStoreError as exc:
        raise KnowledgeError(str(exc)) from exc
    return key
