"""Ephemeral local store for prepared snapshots.

Keeps the authoritative snapshot outside the repository. The host cannot
replace the snapshot through the accept contract — it sends only run_id +
interpretation.

Trust boundary:
  - The host does not receive or return the authoritative snapshot.
  - The facts_hash detects accidental content changes but does not
    authenticate origin.
  - A process with access to the same filesystem (same OS user) can
    read or modify the store files directly. This is an MVP store for
    a cooperative host, not a security isolation boundary.
  - A stronger boundary would require a separate process/service,
    a different OS principal, or a MAC/signature with a key
    inaccessible to the host.

Uses atomic writes, path validation, and a TTL to expire stale snapshots.
"""

from __future__ import annotations

import abc
import logging
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from galecore_ai.contracts.prepared_analysis import StoredPreparedSnapshot

logger = logging.getLogger(__name__)

_RUN_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class SnapshotNotFoundError(Exception):
    """Raised when a run_id does not exist or has expired."""


class PreparedSnapshotStore(abc.ABC):
    """Abstract store for prepared snapshots."""

    @abc.abstractmethod
    def save(self, snapshot: StoredPreparedSnapshot) -> None:
        """Persist a snapshot. Overwrites if run_id exists."""

    @abc.abstractmethod
    def get(self, run_id: str) -> StoredPreparedSnapshot:
        """Retrieve by run_id. Raises SnapshotNotFoundError if missing or expired."""

    @abc.abstractmethod
    def delete(self, run_id: str) -> bool:
        """Delete a snapshot. Returns True if it existed."""

    @abc.abstractmethod
    def expire_stale(self) -> int:
        """Remove snapshots older than TTL. Returns count removed."""


class FileSnapshotStore(PreparedSnapshotStore):
    """File-based ephemeral store.

    Snapshots are stored as JSON files in a temp directory outside the repo.
    Uses atomic writes (write to temp file, then rename) and validates
    run_id format to prevent path traversal.
    """

    def __init__(
        self,
        *,
        base_dir: Path | None = None,
        ttl_seconds: float = 3600.0,
    ) -> None:
        import math

        if not math.isfinite(ttl_seconds) or ttl_seconds <= 0:
            raise ValueError(f"ttl_seconds must be finite and > 0, got {ttl_seconds}")
        if base_dir is None:
            base_dir = Path(tempfile.gettempdir()) / "galecore-ai" / "snapshots"
        self._base_dir = base_dir.resolve()
        self._ttl_seconds = ttl_seconds
        self._base_dir.mkdir(parents=True, exist_ok=True)
        # Restrict permissions on Unix
        try:
            os.chmod(self._base_dir, 0o700)
        except OSError:
            pass  # Windows or permission issue — best effort

    def save(self, snapshot: StoredPreparedSnapshot) -> None:
        self._validate_run_id(snapshot.run_id)
        path = self._path_for(snapshot.run_id)
        data = snapshot.model_dump_json(indent=2)

        # Atomic write: temp file + rename
        tmp_path = path.with_suffix(".tmp")
        try:
            tmp_path.write_text(data, encoding="utf-8")
            tmp_path.replace(path)
        except OSError:
            # Clean up temp file on failure
            tmp_path.unlink(missing_ok=True)
            raise

    def get(self, run_id: str) -> StoredPreparedSnapshot:
        self._validate_run_id(run_id)
        path = self._path_for(run_id)

        if not path.exists():
            raise SnapshotNotFoundError(f"Snapshot not found: {run_id}")

        # Check TTL
        age = (datetime.now(UTC) - datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)).total_seconds()
        if age > self._ttl_seconds:
            path.unlink(missing_ok=True)
            raise SnapshotNotFoundError(f"Snapshot expired (age={age:.0f}s, ttl={self._ttl_seconds:.0f}s): {run_id}")

        try:
            text = path.read_text(encoding="utf-8")
            return StoredPreparedSnapshot.model_validate_json(text)
        except (OSError, ValueError, UnicodeDecodeError) as exc:
            # Corrupt snapshot — fail closed, remove the file
            logger.warning("Corrupt snapshot %s, removing: %s", run_id, exc)
            path.unlink(missing_ok=True)
            raise SnapshotNotFoundError(f"Corrupt snapshot removed: {run_id}") from exc

    def delete(self, run_id: str) -> bool:
        self._validate_run_id(run_id)
        path = self._path_for(run_id)
        if path.exists():
            path.unlink()
            return True
        return False

    def expire_stale(self) -> int:
        removed = 0
        now = datetime.now(UTC)
        for path in self._base_dir.glob("*.json"):
            age = (now - datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)).total_seconds()
            if age > self._ttl_seconds:
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def _path_for(self, run_id: str) -> Path:
        path = (self._base_dir / f"{run_id}.json").resolve()
        # Ensure resolved path is inside base_dir (prevent traversal)
        if not str(path).startswith(str(self._base_dir)):
            raise ValueError(f"Path traversal detected for run_id: {run_id}")
        return path

    @staticmethod
    def _validate_run_id(run_id: str) -> None:
        if not _RUN_ID_RE.match(run_id):
            raise SnapshotNotFoundError(f"Invalid run_id format: {run_id}")
