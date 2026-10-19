"""Registra que el proyecto actual del Lab trabaja una estrategia (owner 19/10: proyectos sin tipo).

Lo corre el motor, desde la carpeta del proyecto, cuando el trader acepta armar la estrategia: cambia el tipo en
workspace.json y desde ahí el Lab activa el mapa de estrategia, «¿dónde quedamos?» y «Ver resultados». No aprueba ni
despliega nada. Uso: python <raíz>/tools/terminal/mark_strategy.py
"""
import json
import sys
from pathlib import Path


def out(**body) -> int:
    print(json.dumps(body, ensure_ascii=False))
    return 0 if body.get("ok") else 1


def main() -> int:
    here = Path.cwd().resolve()
    meta_file = here / "workspace.json"
    if here.parent.name not in ("workspaces", "strategies") or not meta_file.exists():
        return out(ok=False, error="Correlo desde la carpeta de un proyecto del Lab.")
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out(ok=False, error="workspace.json no se pudo leer; no se cambió nada.")
    if meta.get("type") == "personal":
        return out(ok=False, error="Personal no lleva estrategias: abrí un proyecto aparte.")
    changed = meta.get("type") != "strategy"
    meta |= {"type": "strategy", "strategyName": meta.get("id") or here.name}
    tmp = meta_file.with_suffix(".json.tmp")   # escritura atómica (revisión 19/10)
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(meta_file)
    return out(ok=True, project=meta["strategyName"], changed=changed)


if __name__ == "__main__":
    sys.exit(main())
