"""Data helper for skill scripts (WS-0099): ``from galecore_ai import data; data.get("capability", symbol="SPY")``.

The same adapter as ``galecore get`` (same capabilities, same base URL and key from the environment): a script brings
GaleCore data without a new endpoint. A failure raises ``DataError`` with a one-line message; the script decides how to
report it (never invent the missing figure).
"""

from __future__ import annotations

import asyncio


class DataError(Exception):
    """GaleCore did not answer the capability; the message is one line."""


def get(capability: str, **params) -> dict:
    """Ask one GaleCore capability (see ``list()``); returns its payload."""
    from galecore_ai.adapters.cli import _build_dispatcher  # lazy: the CLI module is heavy
    try:
        dispatcher = _build_dispatcher()
        result = asyncio.run(dispatcher.invoke(capability, {k: v for k, v in params.items() if v is not None}))
    except SystemExit as exc:   # the CLI helpers exit on a bad environment
        raise DataError(f"{capability}: GaleCore no está configurado (exit {exc.code})") from exc
    if not result.ok:
        first = str(result.error).strip().splitlines()[0][:300] if result.error else "error"
        raise DataError(f"{capability}: {first}")
    return result.data


def list_capabilities() -> list[dict]:
    """What can be asked: id, what it is, parameters."""
    from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES
    return [{"id": c.capability_id, "what": c.description, "params": [p.name for p in c.parameters]}
            for c in KNOWN_CAPABILITIES]


list = list_capabilities   # `data.list()`; defined last so nothing above shadows the builtin
