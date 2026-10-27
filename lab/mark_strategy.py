"""Registra que el proyecto actual del Lab trabaja una estrategia (owner 19/10: proyectos sin tipo).

Lo corre el motor, desde la carpeta del proyecto, cuando el trader acepta armar la estrategia: cambia el tipo en
workspace.json y desde ahí el Lab activa el mapa de estrategia, «¿dónde quedamos?» y «Ver resultados». No aprueba ni
despliega nada. Uso: python <raíz>/lab/mark_strategy.py [nombre-de-la-estrategia]

Con un nombre, el proyecto queda vinculado a esa estrategia cuando se guardó con otro nombre que el del proyecto
(p. ej. el proyecto nació como SPY y la estrategia quedó en SPX): así Estrategias no los muestra como dos.
"""
import json
import re
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
    linked = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    if linked and not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", linked):
        return out(ok=False, error="El nombre de la estrategia sólo lleva letras, números, guion y guion bajo.")
    changed = meta.get("type") != "strategy"
    # Conserva el vínculo con una estrategia de otro nombre si el proyecto ya lo tiene.
    meta |= {"type": "strategy", "strategyName": linked or meta.get("strategyName") or meta.get("id") or here.name}
    tmp = meta_file.with_suffix(".json.tmp")   # escritura atómica (revisión 19/10)
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(meta_file)
    return out(ok=True, project=meta["strategyName"], changed=changed)


if __name__ == "__main__":
    sys.exit(main())
