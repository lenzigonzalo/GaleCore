"""Lleva el pedido del trader a la capacidad que corresponde (`catalog --match`). Lo corre el Lab en cada turno, para
cualquier motor (D-0014); recibe por stdin `{"prompt": ..., "cwd": ...}`."""
import json
import re
import subprocess
import sys
from pathlib import Path

from concepto import NOT_TICKERS, es_concepto

try:
    import yaml
except ImportError:  # sin PyYAML se pierde el «cómo responder», no el aviso de capacidad
    yaml = None

MIN_SCORE = 6  # debajo de esto el cruce de palabras es casualidad («hacer» ≠ perfil)
_HERE = Path(__file__).resolve()
_ROOT = _HERE.parents[2]  # lab/context/match_request.py → raíz del producto
SKILLS = _ROOT / "ai" / "config"
DESIGN = {"capability": "strategy_design", "skill": "skills/strategy-design/SKILL.md", "score": MIN_SCORE}

sys.stdout.reconfigure(encoding="utf-8")
try:
    event = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
prompt = event.get("prompt", "")
if not prompt.strip():
    sys.exit(0)
if es_concepto(prompt, event.get("cwd")):  # una explicación no usa mercado ni vigilancia (WS-0050)
    sys.exit(0)
in_project = "strategies" in Path(event.get("cwd") or ".").parts
METHOD = SKILLS / "skills" / "strategy-design" / "method.md"  # sólo en turnos de idea o estrategia (WS-0050)


def method():
    if METHOD.is_file():
        print(METHOD.read_text(encoding="utf-8").strip())


if in_project:
    method()


def preload(text):
    """Lo básico de cada ticker nombrado (hasta 3), traído por código en paralelo antes del turno (WS-0039: que el
    primer mensaje responda rápido y pregunte bien, sin que el modelo salga a buscar)."""
    seen = []
    for word in re.findall(r"\$?\b[A-Z]{1,5}\b", text):
        sym = word.lstrip("$")
        if sym not in NOT_TICKERS and sym not in seen:
            seen.append(sym)
    runs = {s: subprocess.Popen([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", "galecore", "get",
                                 "market_data.volatility_metrics", "--symbol", s], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
            for s in seen[:3]}
    lines = []
    for sym, proc in runs.items():
        try:
            raw = proc.communicate(timeout=20)[0]
            if proc.returncode:
                raise ValueError
            items = json.loads(raw)["data"]["items"]
            if not isinstance(items, list):
                raise ValueError
            if not items:  # vacío legítimo: no es una consulta fallida
                lines.append(f"- {sym}: sin resultados de volatilidad en GaleCore.")
                continue
            x = items[0]
            if not isinstance(x, dict):
                raise ValueError
            e = x.get("earnings") or {}
            parts = [f"{x.get('sector') or 's/sector'}"]
            if e.get("expectedReportDate"):
                hora = {"AMC": "después del cierre", "BMO": "antes de la apertura"}.get(e.get("timeOfDay"), "hora s/d")
                parts.append(f"próximo balance {e['expectedReportDate']} {hora}"
                             + (f", consenso EPS {e['consensusEps']}" if e.get("consensusEps") is not None else ""))
            if x.get("impliedVolatility30Day") is not None:
                hv = x.get("historicalVolatility30Day")
                vs = f" vs histórica {hv} %" if hv is not None else ""
                parts.append(f"IV 30 d {x['impliedVolatility30Day']} %{vs}")
            if x.get("priceEarningsRatio"):
                parts.append(f"P/E {round(x['priceEarningsRatio'], 1)}")
            lines.append(f"- {sym}: " + " · ".join(parts) + f" (GaleCore, {str(x.get('updatedAt', ''))[:16]} UTC)")
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            lines.append(f"- {sym}: consulta de volatilidad agotó el tiempo; datos no disponibles.")
            continue
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            lines.append(f"- {sym}: consulta de volatilidad fallida o respuesta no válida; datos no disponibles.")
            continue
    if lines:
        print("[ya traído por código, no lo vuelvas a pedir]\n" + "\n".join(lines))


PRELOAD_FOR = {"strategy_design", "context_research", "on_demand_analysis", "company_research", "research",
               "gex_interpretation"}
# Por la intención del turno, no por el lugar ni por una palabra suelta (revisión de Astra, 16/10): «armemos una
# estrategia» es diseño; «¿por qué perdió esta estrategia?» no. En un proyecto de estrategia, diseño es el default
# cuando el catálogo no reconoce otra cosa clara. Exige una estrategia nueva («una/otra/nueva»): «quiero ver cómo va
# la estrategia» o «cambiar de tema» no son diseño (revisión interna, 16/10).
BUILD = re.compile(r"\b(armar|arm[aá]|armemos|hacer|hagamos|desarrollar|desarroll[aá]|dise[nñ]ar|crear|construir|"
                   r"pensar|pensemos)\b\s+(?:\w+\s+){0,3}?(?:una|otra|nueva)\s+(?:\w+\s+){0,2}?estrateg", re.I)
if BUILD.search(prompt):
    top = DESIGN
else:
    out = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", "catalog", "--match", prompt],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        if out.returncode:
            raise ValueError
        found = json.loads(out.stdout)
        if not isinstance(found, dict):
            raise ValueError
    except ValueError:
        print("[capacidades] consulta al catálogo fallida o respuesta no válida; capacidad sin verificar.")
        sys.exit(0)
    if found.get("confident"):
        top = found["matches"][0]
    elif found.get("ambiguous"):  # dos o tres parecidas (batería 17/10): la lista corta, sin forzar diseño
        print("[capacidades] Puede ser una de estas; elegí por el sentido del pedido "
              "(`catalog --match` trae su flujo; no busques archivos de skills):")
        for o in found.get("options", []):
            print(f"- {o['capability']}: {o['serves'][:90]}")
        sys.exit(0)
    elif in_project:
        top = DESIGN
    else:  # el cruce de palabras no alcanza: que el modelo elija por el sentido (WS-0037)
        if len(prompt.split()) < 3:  # «sí», «dale», «gracias»: respuesta dentro de la conversación, no un pedido nuevo
            sys.exit(0)
        print("[capacidades] Ninguna coincide clara con el pedido. Elegí por el sentido (o ninguna: ofrecé crearla); "
              "después `catalog --match \"<el ejemplo de esa capacidad>\"` trae su flujo "
              "(no busques archivos de skills):")
        for o in found.get("options", []):
            print(f"- {o['capability']}: {o['serves'][:70]} (p. ej. «{o['example']}»)")
        sys.exit(0)
# La precarga sólo cuando aporta: una idea o un análisis de un símbolo, no una pregunta de cartera ni una explicación.
if top["capability"] in PRELOAD_FOR:
    preload(prompt)
if top["score"] >= MIN_SCORE:
    print(f"[capacidad para este pedido] {top['capability']}. Su «cómo responder» va abajo; "
          "`catalog --match` sólo cuando necesites su flujo completo (comandos, guardar). No nombres la skill.")
    answer = None
    try:  # el «cómo responder» corto de la skill (decisión del owner 13/10: la sesión casi nunca lee la skill)
        text = (SKILLS / top["skill"]).read_text(encoding="utf-8")
        if top["skill"].endswith(".md"):  # SKILL.md (WS-0054): su sección «Cómo responder»
            found = re.search(r"(?ms)^## +Cómo responder *\n(.*?)(?=^## |\Z)", text.replace("\r\n", "\n"))
            answer = found.group(1) if found else None
        elif yaml is not None:
            answer = (yaml.safe_load(text) or {}).get("answer")
    except (OSError, KeyError, TypeError, AttributeError, ValueError):
        answer = None
    if answer:
        print("[cómo responder]\n" + answer.strip())
    if top["capability"] == "strategy_design":
        print(f"[método de diseño] Si necesitás la skill completa: {SKILLS / top['skill']} "
              "(única copia; no busques otra).")
        if not in_project:
            method()
