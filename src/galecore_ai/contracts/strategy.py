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
        return self


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
