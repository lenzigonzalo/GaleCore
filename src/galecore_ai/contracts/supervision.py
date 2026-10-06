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


# What the owner can answer to each kind of alert. The first one is what the rules already do.
OPTIONS: dict[AlertKind, list[str]] = {
    AlertKind.CLOSED: ["conforme", "revisar la regla", "revisar la ejecución"],
    AlertKind.NEAR_STOP: ["dejar que decida la regla", "cerrar ahora"],
    AlertKind.NO_PRICE: ["esperar", "revisar GaleCore"],
    AlertKind.RISK_LIMIT: ["aceptar", "revisar el tamaño"],
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
