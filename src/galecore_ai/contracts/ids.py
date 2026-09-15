"""ID generation — UUIDv7 for time-ordered, standards-compliant identifiers."""

from uuid_utils import uuid7


def new_id() -> str:
    """Generate a UUIDv7 string."""
    return str(uuid7())
