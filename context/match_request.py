"""Lleva el pedido del trader a la capacidad que corresponde (`catalog --match`). Lo corre el Lab en cada turno, para
cualquier motor (D-0014); recibe por stdin `{"prompt": ..., "cwd": ...}`."""
import json
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # sin PyYAML se pierde el «cómo responder», no el aviso de capacidad
    yaml = None

MIN_SCORE = 6  # debajo de esto el cruce de palabras es casualidad («hacer» ≠ perfil)
SKILLS = Path(__file__).resolve().parents[3] / "GaleCore-AI" / "config"
DESIGN = {"capability": "strategy_design", "skill": "skills/strategy-design/skill.yaml", "score": MIN_SCORE}

sys.stdout.reconfigure(encoding="utf-8")
try:
    event = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
prompt = event.get("prompt", "")
if not prompt.strip():
    sys.exit(0)
if "strategies" in Path(event.get("cwd") or ".").parts:  # en un proyecto de estrategia todo es diseño (H8, 13/10)
    top = DESIGN
else:
    out = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", "catalog", "--match", prompt],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        found = json.loads(out.stdout)
    except ValueError:
        sys.exit(0)
    if not found.get("confident"):  # el cruce de palabras no alcanza: que el modelo elija por el sentido (WS-0037)
        if len(prompt.split()) < 3:  # «sí», «dale», «gracias»: respuesta dentro de la conversación, no un pedido nuevo
            sys.exit(0)
        print("[capacidades] Ninguna coincide clara con el pedido. Elegí por el sentido (o ninguna: ofrecé crearla); "
              "después `catalog --match \"<el ejemplo de esa capacidad>\"` trae su flujo:")
        for o in found.get("options", []):
            print(f"- {o['capability']}: {o['serves'][:70]} (p. ej. «{o['example']}»)")
        sys.exit(0)
    top = found["matches"][0]
if top["score"] >= MIN_SCORE:
    print(f"[capacidad para este pedido] {top['capability']}. Corré primero "
          f"`python -B -m galecore_ai.adapters.cli catalog --match \"<el pedido>\"`, decí en lenguaje del trader "
          "qué vas a hacer (sin nombrar la skill) y seguí su flujo.")
    answer = None
    if yaml is not None:
        try:  # el «cómo responder» corto de la skill (decisión del owner 13/10: la sesión casi nunca lee la skill)
            answer = (yaml.safe_load((SKILLS / top["skill"]).read_text(encoding="utf-8")) or {}).get("answer")
        except (OSError, KeyError, TypeError, AttributeError, yaml.YAMLError):
            answer = None
    if answer:
        print("[cómo responder]\n" + answer.strip())
