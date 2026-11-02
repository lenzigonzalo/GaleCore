"""Vincula una estrategia al proyecto actual del Lab (WS-0071: un proyecto tiene 0 a N estrategias, sin tipo).

Lo corre el motor, desde la carpeta del proyecto, cuando el trader acepta armar la estrategia: agrega el nombre a la
lista `strategies` de workspace.json (idempotente; no pisa las que ya tiene). No aprueba ni despliega nada.
Uso: python <raíz>/lab/mark_strategy.py [nombre-de-la-estrategia]

Sin nombre, vincula una con el nombre del proyecto. Una estrategia pertenece a un solo proyecto: si el nombre ya está
en otro, avisa y no vincula.
"""
import json
import re
import sys
from pathlib import Path

NAME = re.compile(r"[A-Za-z0-9_-]{1,80}")


def out(**body) -> int:
    print(json.dumps(body, ensure_ascii=False))
    return 0 if body.get("ok") else 1


def strategies_of(meta: dict, fallback: str) -> list:
    """Lista de estrategias de un workspace.json; migra el formato viejo (type=strategy + strategyName)."""
    if isinstance(meta.get("strategies"), list):
        return [n for n in dict.fromkeys(meta["strategies"]) if isinstance(n, str) and NAME.fullmatch(n)]
    if meta.get("type") == "strategy":
        name = meta.get("strategyName")
        return [name if isinstance(name, str) and NAME.fullmatch(name) else fallback]
    return []


def owner_of(name: str, here: Path) -> str:
    """Id del otro proyecto que ya declara la estrategia, o "". Cuenta también el formato viejo (carpeta = estrategia)."""
    for folder in ("workspaces", "strategies"):
        for other in (here.parent.parent / folder).glob("*/workspace.json"):
            if other.parent == here:
                continue
            try:
                meta = json.loads(other.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if name in strategies_of(meta, other.parent.name):
                return other.parent.name
    return ""


def main() -> int:
    here = Path.cwd().resolve()
    meta_file = here / "workspace.json"
    if here.parent.name not in ("workspaces", "strategies") or not meta_file.exists():
        return out(ok=False, error="Correlo desde la carpeta de un proyecto del Lab.")
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out(ok=False, error="workspace.json no se pudo leer; no se cambió nada.")
    if here.name == "personal":
        return out(ok=False, error="Personal no lleva estrategias: abrí un proyecto aparte.")
    linked = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    if linked and not NAME.fullmatch(linked):
        return out(ok=False, error="El nombre de la estrategia sólo lleva letras, números, guion y guion bajo.")
    current = strategies_of(meta, here.name)
    name = linked or (current[0] if current else here.name)   # sin nombre: conserva la que ya tiene
    other = owner_of(name, here)
    if other:
        return out(ok=False, error=f"La estrategia {name} ya es del proyecto {other}; no se vinculó.")
    strategies = current if name in current else current + [name]
    changed = strategies != meta.get("strategies") or "type" in meta or "strategyName" in meta
    meta = {k: v for k, v in meta.items() if k not in ("type", "strategyName")} | {"strategies": strategies}
    tmp = meta_file.with_suffix(".json.tmp")   # escritura atómica (revisión 19/10)
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(meta_file)
    return out(ok=True, project=name, strategies=strategies, changed=changed)


if __name__ == "__main__":
    sys.exit(main())
