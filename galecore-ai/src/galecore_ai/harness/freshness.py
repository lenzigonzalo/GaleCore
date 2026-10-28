"""Observable timestamp validation, independent of fact origin or host."""

import math
from datetime import UTC, datetime


def freshness_error(
    timestamp: datetime | None,
    *,
    max_age_seconds: float,
    now: datetime | None = None,
    max_future_skew_seconds: float = 5.0,
    allow_unknown: bool = False,
) -> str | None:
    if not math.isfinite(max_age_seconds) or max_age_seconds < 0:
        return "Invalid freshness policy"
    if timestamp is None:
        return None if allow_unknown else "Data freshness is UNKNOWN"
    if timestamp.tzinfo is None:
        return "Timestamp must include a timezone"
    age = ((now or datetime.now(UTC)) - timestamp).total_seconds()
    if age < -max_future_skew_seconds:
        return "Market timestamp is in the future"
    if age > max_age_seconds:
        return "Data is stale"
    return None
