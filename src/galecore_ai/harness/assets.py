"""Load canonical cognitive assets from a checkout or the installed package."""

import hashlib
from pathlib import Path
from typing import TypeVar

import yaml
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


def asset_root() -> Path:
    packaged = Path(__file__).resolve().parents[1] / "_assets"
    return packaged if packaged.is_dir() else Path(__file__).resolve().parents[3] / "config"


def load_asset(relative_path: str, schema: type[T]) -> T:
    return schema.model_validate(
        yaml.safe_load((asset_root() / relative_path).read_text(encoding="utf-8")),
    )


def definition_hash(definition: BaseModel) -> str:
    """Hash effective, loaded content (including explicit runtime overrides)."""
    import json

    content = json.dumps(definition.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()
