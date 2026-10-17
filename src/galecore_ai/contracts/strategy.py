"""Strategy contracts (GC-AI-0008): a complete proposal, its StrategySpec and the owner's approval.

A strategy is rules plus the hypothesis that justifies them, not a structure. The proposal keeps
every rule with where it comes from (grounded in a source, a hypothesis, a parameter still without
foundation, an owner decision or a design choice) and what GaleCore actually does with it
(supported by a named spec field, unsupported, or not applicable). A rule the runtime cannot
execute is declared, never dropped to make the spec pass.

What is stored, create-only and hashed, in ``<knowledge>/strategies/<name>/``:

    <version>.proposal.json   proposal + the exact spec JSON + its GaleCore hash + the check report
    <version>.approval.json   the owner's approval of that exact version and hash

Provenance is ``HOST_DECLARED``: the host wrote the proposal and transcribed the owner's words.
Storing does not certify the reasoning, the economics or the approval's authenticity beyond that.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

from galecore_ai.contracts.regime_record import RecordHost

STRATEGY_SCHEMA_VERSION = "1"
STRATEGY_PROVENANCE = "HOST_DECLARED"
STRATEGY_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
STRATEGY_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
SPEC_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
APPROVAL_SCOPE = "SHADOW:galecore-dev"  # the only scope this increment can approve
VERSION_MENTION_RE = re.compile(r"(?<![\d.])(\d+\.\d+\.\d+)(?![\d.])")


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class Block(str, Enum):
    ENTRY = "entry"
    CONSTRUCTION = "construction"
    SIZING = "sizing"
    MONITORING = "monitoring"
    ADJUSTMENT = "adjustment"
    EXIT = "exit"
    INVALIDATION = "invalidation"
    RISK = "risk"
    OPERATIONAL = "operational"


REQUIRED_BLOCKS = (Block.ENTRY, Block.CONSTRUCTION, Block.SIZING, Block.MONITORING, Block.ADJUSTMENT,
                   Block.EXIT, Block.INVALIDATION)


class Basis(str, Enum):
    GROUNDED = "grounded"                    # backed by a cited source (research, evidence, file)
    HYPOTHESIS = "hypothesis"                # what the strategy bets on; the evaluation plan tests it
    PENDING_PARAMETER = "pending_parameter"  # a value in use without foundation yet; says what would found it
    OWNER_DECISION = "owner_decision"        # risk or utility preference of the owner
    DESIGN_CHOICE = "design_choice"          # a reversible choice of the work, with its reason


class RuntimeStatus(str, Enum):
    SUPPORTED = "supported"            # GaleCore executes it through the named spec fields
    UNSUPPORTED = "unsupported"        # GaleCore cannot execute it; it stays out of the spec, declared
    NOT_APPLICABLE = "not_applicable"  # nothing for the runtime to do (e.g. an evaluation criterion)


class RuleRuntime(BaseModel):
    model_config = {"extra": "forbid"}

    status: RuntimeStatus
    spec_paths: list[str] = Field(default_factory=list)  # e.g. exits.deterministic.take_profit.pct_of_credit
    note: str = ""                                        # required unless supported: why, and what it would take

    @model_validator(mode="after")
    def _explained(self) -> RuleRuntime:
        if self.status == RuntimeStatus.SUPPORTED and not self.spec_paths:
            raise ValueError("a supported rule names the spec fields that execute it")
        if self.status != RuntimeStatus.SUPPORTED and not self.note.strip():
            raise ValueError("an unsupported or not-applicable rule says why in note")
        return self


class Rule(BaseModel):
    model_config = {"extra": "forbid"}

    id: str
    block: Block
    text: str                    # observation and moment, condition, action, response to missing data
    basis: Basis
    sources: list[str] = Field(default_factory=list)  # research:, evidence:, file: refs
    parameter: str = ""          # value and unit when the rule has one (e.g. "50 % del crédito")
    rationale: str = ""          # why this value or rule; what would found a pending parameter
    runtime: RuleRuntime

    check_not_blank = field_validator("id", "text")(_non_blank)

    @model_validator(mode="after")
    def _basis_needs(self) -> Rule:
        if self.basis == Basis.GROUNDED and not self.sources:
            raise ValueError(f"rule {self.id}: a grounded rule cites at least one source")
        if self.basis in (Basis.PENDING_PARAMETER, Basis.DESIGN_CHOICE) and not self.rationale.strip():
            raise ValueError(f"rule {self.id}: a {self.basis.value} says its reason or what would found it")
        return self


class Hypothesis(BaseModel):
    model_config = {"extra": "forbid"}

    mechanism: str
    expected_result: str
    capture: str
    failure_conditions: list[str]
    sources: list[str] = Field(default_factory=list)

    check_not_blank = field_validator("mechanism", "expected_result", "capture")(_non_blank)

    @field_validator("failure_conditions")
    @classmethod
    def _some_failure(cls, v: list[str]) -> list[str]:
        if not [x for x in v if x.strip()]:
            raise ValueError("a hypothesis says how it would fail")
        return v


class EvaluationPlan(BaseModel):
    """Fixed before looking at results. Method and statistics are the work's; utility is the owner's."""

    model_config = {"extra": "forbid"}

    question: str
    method: str
    primary_metric: str
    comparison: str
    dependence: str              # how serial dependence and overlapping positions are handled
    sample_sufficiency: str      # how many independent observations, and what happens with fewer
    supports_if: str
    refutes_if: str
    inconclusive_if: str
    data: str
    execution_evidence: str      # what each execution source can prove (SHADOW fills are simulated)
    owner_inputs: list[str] = Field(default_factory=list)  # risk and utility thresholds the owner sets

    check_not_blank = field_validator(
        "question", "method", "primary_metric", "comparison", "dependence", "sample_sufficiency",
        "supports_if", "refutes_if", "inconclusive_if", "data", "execution_evidence")(_non_blank)


class OwnerDecision(BaseModel):
    model_config = {"extra": "forbid"}

    question: str
    recommendation: str
    status: str                  # "pending" | "decided"
    decision: str = ""           # the owner's answer, transcribed, when decided

    check_not_blank = field_validator("question", "recommendation")(_non_blank)

    @model_validator(mode="after")
    def _consistent(self) -> OwnerDecision:
        if self.status not in ("pending", "decided"):
            raise ValueError("owner decision status is pending or decided")
        if self.status == "decided" and not self.decision.strip():
            raise ValueError("a decided owner decision transcribes the decision")
        return self


class Parameter(BaseModel):
    """One row of the parameter table (WS-0016): what the owner looks at first."""

    model_config = {"extra": "forbid"}

    name: str
    value: str                   # as the spec or the rule uses it
    unit: str
    reasonable_range: str        # what other values would still make sense
    depends_on: str              # what the value is tied to (DTE, IV, the profile...)
    would_found: str             # what data would ground it; for a grounded one, what grounds it
    status: Basis
    rules: list[str]             # ids of the rules that use it
    sources: list[str] = Field(default_factory=list)

    check_not_blank = field_validator("name", "value", "unit", "reasonable_range", "depends_on",
                                      "would_found")(_non_blank)

    @model_validator(mode="after")
    def _grounded_cites(self) -> Parameter:
        if self.status == Basis.GROUNDED and not self.sources:
            raise ValueError(f"parameter {self.name}: a grounded parameter cites at least one source")
        if not self.rules:
            raise ValueError(f"parameter {self.name}: names the rules that use it")
        return self


class VersionChange(BaseModel):
    """Why this version exists (WS-0016, U-30): the version it changes and the decision or finding behind it."""

    model_config = {"extra": "forbid"}

    from_version: str
    reason: str
    refs: list[str]              # research:, evidence:, feedback:, strategy: refs or decision:<hash> of the project

    check_not_blank = field_validator("reason")(_non_blank)

    @field_validator("from_version")
    @classmethod
    def _version(cls, v: str) -> str:
        if not STRATEGY_VERSION_RE.fullmatch(v):
            raise ValueError("from_version is MAJOR.MINOR.PATCH")
        return v

    @field_validator("refs")
    @classmethod
    def _some_ref(cls, v: list[str]) -> list[str]:
        if not [x for x in v if x.strip()]:
            raise ValueError("a change cites the decision, feedback or finding that originated it")
        return v


class ManagementKind(str, Enum):
    TARGET = "target"
    STOP = "stop"
    TIME = "time"
    ROLL = "roll"
    ADJUST = "adjust"
    KILL_SWITCH = "kill_switch"
    REVIEW = "review"


class ManagementStep(BaseModel):
    """A management decision as trigger -> action, not prose (WS-0016)."""

    model_config = {"extra": "forbid"}

    id: str
    kind: ManagementKind
    trigger: str                 # observable condition and when it is evaluated
    action: str                  # what is done; "nada" is an action when that is the decision
    rules: list[str]             # ids of the rules that state it (an unsupported one is a declared gap)

    check_not_blank = field_validator("id", "trigger", "action")(_non_blank)

    @field_validator("rules")
    @classmethod
    def _some_rule(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("a management step names the rules that state it")
        return v


MANAGED_BLOCKS = (Block.EXIT, Block.ADJUSTMENT)
PROPOSAL_FIELDS_ADDED = ("parameters", "management", "change", "simulated_amount_usd")  # WS-0016; WS-0043 (1e)


def design_gaps(content: ProposalContent) -> list[str]:
    """What a version saved from WS-0016 on must have: the parameter table and the management tree.

    Checked when a version is saved, not when it is read: versions stored before stay readable.
    """
    problems = []
    if not content.parameters:
        problems.append("the proposal has no parameter table (parameters)")
    if not content.management:
        problems.append("the proposal has no management tree (management)")
    in_table = {rid for p in content.parameters for rid in p.rules}
    problems += [f"rule {r.id} has parameter {r.parameter!r} but no row of the parameter table uses it"
                 for r in content.rules if r.parameter.strip() and r.id not in in_table]
    managed = {rid for s in content.management for rid in s.rules}
    problems += [f"rule {r.id} ({r.block.value}) is not a step of the management tree"
                 for r in content.rules if r.block in MANAGED_BLOCKS and r.id not in managed]
    return problems


def other_version_mentions(content: ProposalContent) -> list[str]:
    """Versions named in what defines or evaluates this version (limitations and pending may cite history).

    Checked when a version is saved, not when it is read: versions stored before this rule stay readable.
    """
    operative = content.model_dump(mode="json", include={"purpose", "display_name", "hypothesis", "rules",
                                                         "evaluation_plan", "owner_decisions"})
    return sorted({v for v in VERSION_MENTION_RE.findall(json.dumps(operative, ensure_ascii=False))
                   if v != content.version})


class ProposalContent(BaseModel):
    """What the host writes for one version. The check compares it with the spec and the runtime."""

    model_config = {"extra": "forbid"}

    name: str
    version: str
    display_name: str
    purpose: str
    research_refs: list[str]
    hypothesis: Hypothesis
    rules: list[Rule]
    evaluation_plan: EvaluationPlan
    owner_decisions: list[OwnerDecision] = Field(default_factory=list)
    pending: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    parameters: list[Parameter] = Field(default_factory=list)   # WS-0016; required at save (design_gaps)
    management: list[ManagementStep] = Field(default_factory=list)
    change: VersionChange | None = None                         # WS-0016; required at save after the first version
    # WS-0043 (1e): the amount this strategy is simulated with, declared when its design closes. The profile's capital
    # is only the real account; controls list this as missing when it is not there.
    simulated_amount_usd: float | None = Field(default=None, gt=0)

    check_not_blank = field_validator("display_name", "purpose")(_non_blank)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not STRATEGY_NAME_RE.fullmatch(v):
            raise ValueError("name is snake_case, 3-64 characters, and names what the strategy does")
        return v

    @field_validator("version")
    @classmethod
    def _version(cls, v: str) -> str:
        if not STRATEGY_VERSION_RE.fullmatch(v):
            raise ValueError("version is MAJOR.MINOR.PATCH")
        return v

    @model_validator(mode="after")
    def _complete(self) -> ProposalContent:
        if not self.research_refs:
            raise ValueError("a proposal comes from at least one investigation (research_refs)")
        ids = [r.id for r in self.rules]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"duplicate rule ids: {dupes}")
        present = {r.block for r in self.rules}
        missing = [b.value for b in REQUIRED_BLOCKS if b not in present]
        if missing:
            raise ValueError(f"every block needs at least one rule (an absent one is a not-applicable rule "
                             f"that says why): missing {missing}")
        known = set(ids)
        unknown = sorted({rid for p in self.parameters for rid in p.rules} - known)
        unknown += sorted({rid for s in self.management for rid in s.rules} - known)
        if unknown:
            raise ValueError(f"parameters or management name rules that do not exist: {sorted(set(unknown))}")
        step_ids = [s.id for s in self.management]
        if len(step_ids) != len(set(step_ids)):
            raise ValueError("duplicate management step ids")
        return self


class CritiqueVerdict(str, Enum):
    PROCEED = "seguir"           # nothing blocks asking the owner for approval
    REVISE = "revisar"           # a new version should address it first
    DISCARD = "descartar"        # the idea does not reach SHADOW as it is


class CritiqueContent(BaseModel):
    """The critic's reading of one exact version (WS-0016, U-21): why not, before anyone approves it."""

    model_config = {"extra": "forbid"}

    verdict: CritiqueVerdict
    missing: list[str]               # what the proposal lacks to be judged (evidence, data, rules)
    biases: list[str]                # e.g. recency, survivorship, a nice story fitted after the fact
    alternative_explanation: str     # another mechanism that would produce what the hypothesis expects
    why_not: list[str]               # the strongest reasons not to run it
    shutdown_criteria: list[str]     # observable conditions that switch it off (feeds the supervisor)
    closed_trade_review: str         # what is checked after each closed trade, and what it would change
    evidence_refs: list[str] = Field(default_factory=list)

    check_not_blank = field_validator("alternative_explanation", "closed_trade_review")(_non_blank)

    @field_validator("missing", "biases", "why_not", "shutdown_criteria")
    @classmethod
    def _not_empty(cls, v: list[str]) -> list[str]:
        if not [x for x in v if x.strip()]:
            raise ValueError("a critique says at least one thing here (an empty list is not a critique)")
        return v


class CritiqueDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = STRATEGY_SCHEMA_VERSION
    kind: str = "strategy_critique"
    strategy_ref: str                     # strategy:<name>/<version>
    proposal_hash: str                    # content_hash of the proposal document criticised
    content: CritiqueContent
    recorded_at: datetime
    provenance: str = STRATEGY_PROVENANCE
    host: RecordHost
    content_hash: str

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v != "strategy_critique":
            raise ValueError(f"kind must be 'strategy_critique', got {v!r}")
        return v

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


class CheckReport(BaseModel):
    model_config = {"extra": "forbid"}

    verdict: str                          # VALID | VALID_WITH_DECLARED_GAPS | INVALID
    errors: list[str]
    declared_gaps: list[str]              # "<rule id>: <text> — <why unsupported>"
    coverage: dict[str, list[str]]        # consumed spec path -> rule ids that explain it
    runtime_reference: str                # which GaleCore code the support table describes


class StrategyDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = STRATEGY_SCHEMA_VERSION
    kind: str = "strategy"
    name: str
    version: str
    recorded_at: datetime
    provenance: str = STRATEGY_PROVENANCE
    host: RecordHost
    prompt: str
    content: ProposalContent
    spec_file: str                        # the file name GaleCore loads it from (<name>.json)
    spec_json: str                        # the exact bytes GaleCore hashes, as text
    spec_hash: str                        # GaleCore's content_hash of spec_json
    check: CheckReport
    content_hash: str                     # sha256 over every field above (canonical JSON)

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v != "strategy":
            raise ValueError(f"kind must be 'strategy', got {v!r}")
        return v

    @field_validator("provenance")
    @classmethod
    def _prov(cls, v: str) -> str:
        if v != STRATEGY_PROVENANCE:
            raise ValueError(f"strategy provenance is always {STRATEGY_PROVENANCE}")
        return v

    @field_validator("spec_hash")
    @classmethod
    def _hash(cls, v: str) -> str:
        if not SPEC_HASH_RE.fullmatch(v):
            raise ValueError("spec_hash is sha256:<64 hex>")
        return v

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        for added in PROPOSAL_FIELDS_ADDED:  # absent in versions stored before them: their hash must not change
            if not data["content"].get(added):
                data["content"].pop(added, None)
        return data


class ApprovalDocument(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = STRATEGY_SCHEMA_VERSION
    kind: str = "strategy_approval"
    strategy_ref: str                     # strategy:<name>/<version>
    spec_hash: str                        # the exact GaleCore hash approved
    proposal_hash: str                    # content_hash of the proposal document approved
    scope: str = APPROVAL_SCOPE
    owner_words: str                      # the owner's approval, transcribed verbatim by the host
    recorded_at: datetime
    provenance: str = STRATEGY_PROVENANCE
    host: RecordHost
    content_hash: str

    check_not_blank = field_validator("owner_words")(_non_blank)

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v != "strategy_approval":
            raise ValueError(f"kind must be 'strategy_approval', got {v!r}")
        return v

    @field_validator("scope")
    @classmethod
    def _scope(cls, v: str) -> str:
        if v != APPROVAL_SCOPE:
            raise ValueError(f"the only approvable scope is {APPROVAL_SCOPE} (no PAPER, LIVE or production)")
        return v

    @field_validator("spec_hash")
    @classmethod
    def _hash(cls, v: str) -> str:
        if not SPEC_HASH_RE.fullmatch(v):
            raise ValueError("spec_hash is sha256:<64 hex>")
        return v

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


def compute_document_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
