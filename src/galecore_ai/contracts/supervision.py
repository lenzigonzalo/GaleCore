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


# What the owner can answer to each kind of alert. The first one is what the rules already do.
OPTIONS: dict[AlertKind, list[str]] = {
    AlertKind.CLOSED: ["conforme", "revisar la regla", "revisar la ejecución"],
    AlertKind.NEAR_STOP: ["dejar que decida la regla", "cerrar ahora"],
    AlertKind.NO_PRICE: ["esperar", "revisar GaleCore"],
    AlertKind.RISK_LIMIT: ["aceptar", "revisar el tamaño"],
    AlertKind.EVENT: ["mantener", "cerrar antes del dato"],
    AlertKind.WATCH: ["visto"],
}


# Only these ask the owner for a decision; the rest inform and are recorded as they are (owner 06/10: «son cosas muy
# extensas, además requiere mi input»).
NEEDS_DECISION = {AlertKind.NEAR_STOP, AlertKind.RISK_LIMIT}


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


METRIC_LABELS: dict[WatchMetric, str] = {
    WatchMetric.PRICE: "precio", WatchMetric.GAMMA_ZERO: "nivel gamma cero", WatchMetric.CALL_WALL: "muro de calls",
    WatchMetric.PUT_WALL: "muro de puts", WatchMetric.IV_RANK: "IV rank",
}


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
    content_hash: str = ""

    def hashable_content(self) -> dict:
        data = self.model_dump(mode="json")
        data.pop("content_hash", None)
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
