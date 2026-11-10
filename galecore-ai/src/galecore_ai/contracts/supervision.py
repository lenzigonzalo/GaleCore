"""Supervisor alerts (WS-0007, P1-01): a rule of what is open in SHADOW that deserves the owner's attention.

The supervisor watches only rules that already exist — the strategy's exits, the spec's max loss per trade, and that
GaleCore can price the position — never a thesis or a judgement. Each alert says the reason (motivo), the numbers it
read (dato), the rule it compared them with, what to review (propuesta) and the options the owner can choose from.
The options are derived in code from the kind of alert; in SHADOW choosing one executes nothing, it only records the
decision. One file per alert, create-only and hashed, in ``<knowledge>/supervision/alerts/<id>.json``.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

SUPERVISION_SCHEMA_VERSION = "1"


class AlertKind(str, Enum):
    CLOSED = "closed"            # SHADOW closed the position by one of its exits (informative)
    NEAR_STOP = "near_stop"      # loss at mid >= 1x the credit: half way to the 2x stop
    NO_PRICE = "no_price"        # in session, the position could not be valued for more than 10 minutes
    RISK_LIMIT = "risk_limit"    # the position's max risk is above the spec's max loss per trade
    EVENT = "event"              # a macro release or FOMC decision before expiration, 2 business days ahead (E4)
    WATCH = "watch"              # a rule the owner asked for («avisame si SPY baja a 760») was met (P1-01b)
    BET_LIMIT = "bet_limit"      # one bet (underlying, direction, expiry week) is above the profile's cap (WS-0023)
    STALLED = "stalled"          # N evaluated business days in a row stopped for the same cause, no position (WS-0098)


# What the owner can answer to each kind of alert. The first one is what the rules already do.
OPTIONS: dict[AlertKind, list[str]] = {
    AlertKind.CLOSED: ["conforme", "revisar la regla", "revisar la ejecución"],
    AlertKind.NEAR_STOP: ["dejar que decida la regla", "cerrar ahora"],
    AlertKind.NO_PRICE: ["esperar", "revisar GaleCore"],
    AlertKind.RISK_LIMIT: ["aceptar", "revisar el tamaño"],
    AlertKind.EVENT: ["mantener", "cerrar antes del dato"],
    AlertKind.WATCH: ["visto"],
    AlertKind.BET_LIMIT: ["aceptar", "revisar la exposición"],
    AlertKind.STALLED: ["visto", "revisar los límites o las reglas"],
}


# Only these ask the owner for a decision; the rest inform and are recorded as they are (owner 06/10: «son cosas muy
# extensas, además requiere mi input»).
NEEDS_DECISION = {AlertKind.NEAR_STOP, AlertKind.RISK_LIMIT, AlertKind.BET_LIMIT}


class Alert(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = SUPERVISION_SCHEMA_VERSION
    kind_of_record: str = "alert"
    id: str                           # <YYYY-MM-DD>-<kind>-<position id prefix>[-<n>]
    key: str                          # what makes it the same alert: never raised twice for one key
    kind: AlertKind
    strategy: str                     # the spec name GaleCore runs
    strategy_ref: str | None          # strategy:<name>/<version> whose spec hash equals the instance's, if known
    instance_id: str
    position_id: str
    detected_at: datetime
    motivo: str                       # why, in one sentence
    dato: dict[str, float | int | str | None]   # the numbers read from GaleCore
    regla: str                        # the rule or limit compared with, and where it comes from
    propuesta: str                    # what to review
    options: list[str]
    sources: list[str] = Field(default_factory=list)   # GaleCore endpoints read
    content_hash: str = ""

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data


# ── rules the owner asks for (P1-01b) ────────────────────────────
#
# «Avisame si SPY baja a 760»: the host only turns the request into a rule and stores it; the supervisor (code, every
# 5 minutes) reads the number from GaleCore and raises a WATCH alert once when the condition holds. No model watches.


class WatchMetric(str, Enum):
    PRICE = "price"                      # mid of the quote (GET /Data/Tastytrade/MarketData/Quote)
    GAMMA_ZERO = "gamma_zero"            # gex.global.gammaZeroLevel (GET /App/Gex/Analysis), a price level
    CALL_WALL = "call_wall"              # gex.global.callWall
    PUT_WALL = "put_wall"                # gex.global.putWall
    IV_RANK = "iv_rank"                  # ivRank, 0-100 (GET /App.Analytics/IVRank)
    # WS-0023: reminders of a decision, read without the market. DATE: today as YYYYMMDD (New York) against the
    # threshold; OPEN_POSITIONS: open positions of one instance (GET /App/Runtime/Instances/{id}/Positions).
    DATE = "date"
    OPEN_POSITIONS = "open_positions"
    # WS-0064 AC-6: one alert per new evaluation of a SHADOW instance (it does not stop after firing).
    EVALUATION = "evaluation"


METRIC_LABELS: dict[WatchMetric, str] = {
    WatchMetric.PRICE: "precio", WatchMetric.GAMMA_ZERO: "nivel gamma cero", WatchMetric.CALL_WALL: "muro de calls",
    WatchMetric.PUT_WALL: "muro de puts", WatchMetric.IV_RANK: "IV rank", WatchMetric.DATE: "fecha",
    WatchMetric.OPEN_POSITIONS: "posiciones abiertas", WatchMetric.EVALUATION: "evaluación",
}
REMINDERS = {WatchMetric.DATE, WatchMetric.OPEN_POSITIONS, WatchMetric.EVALUATION}


class WatchCondition(str, Enum):
    BELOW = "below"                      # value <= threshold
    ABOVE = "above"                      # value >= threshold


class WatchRule(BaseModel):
    """One rule, create-only and hashed, in ``<knowledge>/supervision/rules/<id>.json``. It fires once: met means an
    alert with key ``watch:<id>`` exists. Cancelled means ``<id>.cancelled.json`` exists next to it."""

    model_config = {"extra": "forbid"}

    schema_version: str = SUPERVISION_SCHEMA_VERSION
    kind_of_record: str = "watch_rule"
    id: str                              # <YYYY-MM-DD>-<symbol>-<metric>-<condition>-<threshold>
    created_at: datetime
    symbol: str
    metric: WatchMetric
    condition: WatchCondition
    threshold: float
    words: str                           # the owner's request, verbatim
    prompt: str
    until: datetime | None = None        # after this it is no longer watched (optional)
    host_model: str | None = None
    thesis: str = ""                     # WS-0016 (U-65): the thesis this condition invalidates, when it is one
    strategies: list[str] = Field(default_factory=list)   # the strategies that depend on that thesis
    instance_id: str = ""                # WS-0023: the instance an OPEN_POSITIONS reminder counts
    decision: str = ""                   # WS-0023: the decision this reminder comes from (its words or project ref)
    content_hash: str = ""

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        for added in ("thesis", "strategies", "instance_id", "decision"):   # absent in rules stored before WS-0016: their hash must not change
            if not data.get(added):
                data.pop(added, None)
        return data


class WatchCancel(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = SUPERVISION_SCHEMA_VERSION
    kind_of_record: str = "watch_cancel"
    rule: str
    rule_hash: str
    at: datetime
    words: str
    prompt: str


# ── «analizá este aviso» (P1-01b, U-70) ──────────────────────────
#
# From the alert in the monitor, one model run with its context: the code gathers the alert, the position and the
# current numbers from GaleCore; the model (the policy's model for reading work) only describes what they mean. One
# file per run, create-only and hashed, in ``<knowledge>/supervision/analyses/<alert id>~<UTC stamp>.json``; a done
# one answers the alert for good, a failed one says why and can be asked again.


class AnalysisStatus(str, Enum):
    DONE = "done"
    FAILED = "failed"


class AlertAnalysis(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = SUPERVISION_SCHEMA_VERSION
    kind_of_record: str = "alert_analysis"
    alert: str                           # the alert id
    alert_hash: str                      # the alert's content_hash when it was analysed
    requested_at: datetime
    requested_by: str                    # monitor | session
    prompt: str
    finished_at: datetime
    status: AnalysisStatus
    summary: str = ""                    # one line: what the alert means now
    detail: str = ""                     # a few short paragraphs, the numbers it read
    missing: list[str] = Field(default_factory=list)   # what GaleCore did not give
    context: dict = Field(default_factory=dict)        # exactly what the model received
    sources: list[str] = Field(default_factory=list)   # GaleCore endpoints read
    model: str | None = None
    route: str | None = None             # why this model (policy GC-AI-0025)
    tokens: dict | None = None
    duration_s: float | None = None
    error: str | None = None
    content_hash: str = ""

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
        return data
