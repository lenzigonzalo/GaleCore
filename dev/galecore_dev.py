"""Entorno de DESARROLLO aislado de GaleCore (GC-0004): proyecto Supabase "GaleCore Dev".

Es la MISMA implementación que va a producción, contra otra base: el proyecto "GaleCore Dev" vive en
una organización de Supabase propia del owner, separada de la de producción. Mismo motor (PostgreSQL
de Supabase), mismas migraciones EF (la cadena completa, InitialCreate -> AddShadowRuntime), mismos dos
roles (galecore_ddl dueño del esquema, galecore_api sólo filas), mismo login (Supabase Auth, JWT por
JWKS). Lo único distinto es la configuración que recibe cada proceso. Los datos de MERCADO siguen siendo
reales: la API usa las credenciales de Tastytrade de siempre (user-secrets, que no se tocan).

Uso, desde la raíz del repo GaleCore:

    python dev/galecore_dev.py init --url <https://REF.supabase.co> --anon-key <anon pública> --pooler-host <host>
        # guarda la config del proyecto de desarrollo y genera las contraseñas de los roles; escribe el SQL
        # de roles en dev/.local/roles.sql (se aplica una vez en el proyecto de desarrollo)
    python dev/galecore_dev.py migrate            # aplica las migraciones EF como galecore_ddl
    python dev/galecore_dev.py set-demo-password  # la contraseña del usuario de prueba (se tipea, no se muestra)
    python dev/galecore_dev.py api                # API en :7001 contra GaleCore Dev (primer plano)
    python dev/galecore_dev.py monitor            # monitor en :3039 contra GaleCore Dev (primer plano)
    python dev/galecore_dev.py deploy [--switch-on]   # login del usuario de prueba + deploy de la spec de prueba
    python dev/galecore_dev.py deploy --spec <name> --approval <knowledge/strategies/<name>/<version>.approval.json>
        # una estrategia: sólo con una aprobación íntegra de esa propuesta y si GaleCore cargó el hash aprobado
    python dev/galecore_dev.py stop --instance <id>   # deja de entrar; lo abierto se sigue valuando
    python dev/galecore_dev.py runtime-report --spec <name>   # sólo lectura: instancias, posiciones, eventos
    python dev/galecore_dev.py test               # dotnet test con la base galecore_test del proyecto de desarrollo

Nada de esto toca producción ni sus secretos. Lo generado (dev/.local/) queda fuera de git; son
credenciales del proyecto de desarrollo, con datos de prueba, y no se imprimen.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent  # repo GaleCore
LOCAL = ROOT / "dev" / ".local"
ENV_FILE = LOCAL / "env.json"
ROLES_SQL = LOCAL / "roles.sql"
DATAFEED = ROOT / "source" / "galecore-datafeed"
API_CSPROJ = DATAFEED / "DataFeed.Api" / "DataFeed.Api.csproj"
MONITOR = ROOT / "source" / "galecore-monitor"
API_URL = "http://localhost:7001"
TEST_USERNAME = "demo"
TEST_EMAIL = "demo@galecore-dev.test"
TEST_DATABASE = "galecore_test"
# El ÚNICO proyecto contra el que corre este script: "GaleCore Dev" (org propia del owner, plan Free).
# Cualquier otro se rechaza antes de guardar config o ejecutar nada; el de producción, explícitamente.
DEV_PROJECT_REF = "ecymbgpimqbtcvqyjtaq"
PRODUCTION_PROJECT_REF = "vsbnukptdvsyhujgtook"


def require_dev_project(ref: str | None) -> None:
    if ref == PRODUCTION_PROJECT_REF:
        sys.exit(f"{ref} es el proyecto de PRODUCCIÓN: este script nunca corre contra producción")
    if ref != DEV_PROJECT_REF:
        sys.exit(f"{ref} no es el proyecto GaleCore Dev ({DEV_PROJECT_REF}); este script sólo corre contra él")


def sh(cmd: list[str], *, cwd: Path | None = None, env: dict | None = None, check: bool = True) -> int:
    exe = shutil.which(cmd[0]) or cmd[0]
    code = subprocess.run([exe, *cmd[1:]], cwd=cwd, env=env, check=False).returncode
    if check and code != 0:
        sys.exit(f"falló: {' '.join(cmd[:4])} ... (exit {code})")
    return code


def load_env() -> dict:
    if not ENV_FILE.exists():
        sys.exit("falta dev/.local/env.json: correr primero `python dev/galecore_dev.py init ...`")
    env = json.loads(ENV_FILE.read_text(encoding="utf-8"))
    # Se revalida en cada comando: un env.json editado a mano tampoco puede apuntar a otro proyecto.
    require_dev_project(env.get("project_ref"))
    if urlparse(env["supabase_url"]).hostname != f"{DEV_PROJECT_REF}.supabase.co":
        sys.exit("supabase_url de dev/.local/env.json no es la de GaleCore Dev")
    return env


def save_env(env: dict) -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text(json.dumps(env, indent=2), encoding="utf-8")


def cs(env: dict, role: str, password_key: str, database: str = "postgres", port: int = 5432) -> str:
    # Pooler de Supabase (Supavisor): usuario "<rol>.<ref del proyecto>". 5432 = modo sesión (migraciones,
    # CREATE DATABASE); 6543 = modo transacción, el mismo que usa la API en producción.
    # En modo transacción, Npgsql necesita no resetear la sesión ni preparar sentencias: sin esto, una
    # escritura se confirma en la base pero el cliente se cuelga leyendo la respuesta (GC-0004, 24/09).
    pooler_safe = ";No Reset On Close=true;Max Auto Prepare=0" if port == 6543 else ""
    return (
        f"Host={env['pooler_host']};Port={port};Database={database};"
        f"Username={role}.{env['project_ref']};Password={env[password_key]};SSL Mode=Require{pooler_safe}"
    )


def http(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, {"raw": raw.decode(errors="replace")[:500]}
    except urllib.error.URLError as e:  # la API todavía no escucha (arrancando) o se cayó
        return 0, {"error": str(e.reason)}


# ── comandos ──────────────────────────────────────────────────────────


def cmd_init(args: argparse.Namespace) -> int:
    ref = (urlparse(args.url).hostname or "").split(".")[0]
    require_dev_project(ref)
    if urlparse(args.url).hostname != f"{DEV_PROJECT_REF}.supabase.co":
        sys.exit("la URL no es la de GaleCore Dev")
    env = json.loads(ENV_FILE.read_text(encoding="utf-8")) if ENV_FILE.exists() else {}
    if env.get("project_ref") not in (None, ref):
        sys.exit(f"dev/.local/env.json es de otro proyecto ({env['project_ref']}); borrarlo a mano si es a propósito")
    env.update(
        {
            "supabase_url": args.url.rstrip("/"),
            "project_ref": ref,
            "anon_key": args.anon_key,
            "pooler_host": args.pooler_host,
        }
    )
    env.setdefault("ddl_password", secrets.token_urlsafe(24))
    env.setdefault("api_password", secrets.token_urlsafe(24))
    save_env(env)
    # Los mismos dos roles que producción: galecore_ddl es dueño del esquema y aplica migraciones (y crea la
    # base de tests); galecore_api sólo lee y escribe filas. token_urlsafe sólo usa [A-Za-z0-9_-].
    ROLES_SQL.write_text(
        f"""DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galecore_ddl') THEN CREATE ROLE galecore_ddl LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galecore_api') THEN CREATE ROLE galecore_api LOGIN; END IF;
END $$;
ALTER ROLE galecore_ddl PASSWORD '{env["ddl_password"]}' CREATEDB;
ALTER ROLE galecore_api PASSWORD '{env["api_password"]}';
GRANT galecore_ddl TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO galecore_ddl;
GRANT USAGE ON SCHEMA public TO galecore_api;
ALTER DEFAULT PRIVILEGES FOR ROLE galecore_ddl IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO galecore_api;
""",
        encoding="utf-8",
    )
    print(f"Config del proyecto {ref} guardada en dev/.local/env.json; SQL de roles en dev/.local/roles.sql.")
    return 0


def cmd_migrate(_: argparse.Namespace) -> int:
    env = load_env()
    run_env = {**os.environ, "GALECORE_DB": cs(env, "galecore_ddl", "ddl_password")}
    cmd = ["dotnet", "ef", "database", "update", "--project", "DataFeed.Repositories"]
    return sh([*cmd, "--startup-project", "DataFeed.Repositories"], cwd=DATAFEED, env=run_env)


def cmd_set_demo_password(_: argparse.Namespace) -> int:
    env = load_env()
    pw = getpass.getpass(f"Contraseña del usuario de prueba ({TEST_EMAIL}, username `{TEST_USERNAME}`): ")
    if len(pw) < 8:
        sys.exit("muy corta")
    env["demo_password"] = pw
    save_env(env)
    print("guardada en dev/.local/env.json")
    return 0


def api_env(env: dict) -> dict:
    return {
        **os.environ,
        "ASPNETCORE_ENVIRONMENT": "Development",
        "ASPNETCORE_URLS": API_URL,
        "ConnectionStrings__GaleCore": cs(env, "galecore_api", "api_password", port=6543),
        "Supabase__Issuer": env["supabase_url"] + "/auth/v1",
        "Supabase__AnonKey": env["anon_key"],
        "Runtime__Persistence__Enabled": "true",
        **({"Security__TokenProtectionKey": env["token_protection_key"]}
           if env.get("token_protection_key") else {}),
        # La clave de FRED del entorno del usuario (calendario macro, GC-0006); nunca se escribe en un archivo.
        **({"FredApi__Key": os.environ["FRED_API_KEY"]} if os.environ.get("FRED_API_KEY") else {}),
    }


def cmd_api(_: argparse.Namespace) -> int:
    env = load_env()
    # Clave exclusiva de Dev, persistida para poder descifrar cuentas tras reiniciar.
    if not env.get("token_protection_key"):
        env["token_protection_key"] = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        save_env(env)
    sh(["dotnet", "build", str(API_CSPROJ), "-nologo", "-v", "q"])
    run = ["dotnet", "run", "--no-build", "--no-launch-profile", "--project", str(API_CSPROJ)]
    return sh(run, cwd=API_CSPROJ.parent, env=api_env(env), check=False)


def cmd_monitor(_: argparse.Namespace) -> int:
    env = load_env()
    run_env = {
        **os.environ,
        "PORT": "3039",
        "BROWSER": "none",
        "REACT_APP_API_BASE_URL": API_URL,
        "REACT_APP_SIGNALR_HUB_URL": API_URL + "/hubs/marketdata",
        "REACT_APP_SUPABASE_URL": env["supabase_url"],
        "REACT_APP_SUPABASE_ANON_KEY": env["anon_key"],
    }
    return sh(["npm", "start"], cwd=MONITOR, env=run_env, check=False)


def login(env: dict) -> str:
    if "demo_password" not in env:
        sys.exit("falta la contraseña del usuario de prueba: `python dev/galecore_dev.py set-demo-password`")
    body = {"username": TEST_USERNAME, "password": env["demo_password"]}
    code, resp = http("POST", API_URL + "/App/GaleCore/Auth/Login", body)
    if code != 200:
        sys.exit(f"login del usuario de prueba falló (HTTP {code}): {resp}")
    return resp["accessToken"]


def _intact(path: Path) -> dict:
    """Un documento de knowledge/strategies con su content_hash verificado (misma regla que GaleCore-AI)."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    body = {k: v for k, v in doc.items() if k != "content_hash"}
    digest = "sha256:" + hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if digest != doc.get("content_hash"):
        sys.exit(f"no se despliega: {path.name} fue editado (content_hash no coincide)")
    return doc


def approved_hash(spec: str, approval_path: Path) -> str:
    """El hash aprobado, sólo si la aprobación y la propuesta que aprueba están íntegras y son de esta spec."""
    approval = _intact(approval_path)
    version = approval_path.name.removesuffix(".approval.json")
    proposal = _intact(approval_path.with_name(f"{version}.proposal.json"))
    checks = {
        "es una aprobación": approval.get("kind") == "strategy_approval",
        "alcance SHADOW de desarrollo": approval.get("scope") == "SHADOW:galecore-dev",
        "aprueba esta spec": approval.get("strategy_ref") == f"strategy:{spec}/{version}"
                             and proposal.get("name") == spec and proposal.get("spec_file") == f"{spec}.json",
        "aprueba esta propuesta": approval.get("proposal_hash") == proposal.get("content_hash"),
        "mismo hash de spec": approval.get("spec_hash") == proposal.get("spec_hash"),
    }
    failed = [k for k, ok in checks.items() if not ok]
    if failed:
        sys.exit(f"no se despliega: la aprobación no cumple {failed}")
    return approval["spec_hash"]


def cmd_deploy(args: argparse.Namespace) -> int:
    env = load_env()
    auth = {"Authorization": f"Bearer {login(env)}"}
    if args.approval is None and not args.spec.startswith("shadow_runtime_test_"):
        sys.exit("una estrategia se despliega sólo con --approval <archivo de aprobación> (GC-AI-0008)")
    if args.approval is not None:
        expected = approved_hash(args.spec, Path(args.approval))
        code, spec = http("GET", API_URL + f"/App/Runtime/Specs/{args.spec}", None, auth)
        loaded = spec.get("contentHash") if code == 200 and isinstance(spec, dict) else None
        if loaded != expected:
            sys.exit(f"no se despliega: GaleCore cargó {loaded or f'nada (HTTP {code})'}, el aprobado es {expected}")
        # GET y POST leen la misma spec, cargada una vez al arrancar; sólo un reinicio entre ambos la cambiaría.
        print(f"aprobación íntegra; hash cargado por GaleCore = aprobado: {loaded}")
    code, body = http("POST", API_URL + "/App/Runtime/Deploy", {"specName": args.spec}, auth)
    print(f"deploy HTTP {code}: {json.dumps(body, ensure_ascii=False)}")
    if args.switch_on and code == 200:
        code2, body2 = http("POST", API_URL + "/App/GaleCore/Services/runtime/Switch", {"enabled": True}, auth)
        print(f"switch HTTP {code2}: {json.dumps(body2, ensure_ascii=False)}")
    return 0 if code == 200 else 1


def cmd_stop(args: argparse.Namespace) -> int:
    env = load_env()
    auth = {"Authorization": f"Bearer {login(env)}"}
    code, body = http("POST", API_URL + f"/App/Runtime/Instances/{args.instance}/Stop", None, auth)
    print(f"stop HTTP {code}: {json.dumps(body, ensure_ascii=False)}")
    return 0 if code == 200 else 1


def cmd_runtime_report(args: argparse.Namespace) -> int:
    """Lo que GaleCore Dev sabe de una spec, sólo con GET: la salida se guarda tal cual como evidencia."""
    env = load_env()
    auth = {"Authorization": f"Bearer {login(env)}"}

    def get(path: str) -> object:
        code, body = http("GET", API_URL + path, None, auth)
        return {"http": code, "body": body}

    spec = get(f"/App/Runtime/Specs/{args.spec}")
    instances = get("/App/Runtime/Instances")
    mine = [i for i in (instances["body"] or []) if isinstance(i, dict) and i.get("specName") == args.spec]
    report = {
        "api": API_URL, "spec_name": args.spec,
        "spec_content_hash": (spec["body"] or {}).get("contentHash") if isinstance(spec["body"], dict) else None,
        "status": get("/App/Runtime/Status"),
        "instances": [{
            "instance": i,
            "detail": get(f"/App/Runtime/Instances/{i['instanceId']}"),
            "evaluations": get(f"/App/Runtime/Instances/{i['instanceId']}/Evaluations?limit={args.limit}"),
            "events": get(f"/App/Runtime/Instances/{i['instanceId']}/Events?limit={args.limit}"),
        } for i in mine],
        "metrics": get("/App/Runtime/Metrics"),
    }
    sys.stdout.reconfigure(encoding="utf-8")  # la salida se guarda tal cual como evidencia: UTF-8 siempre
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def cmd_test(_: argparse.Namespace) -> int:
    env = load_env()
    run_env = {**os.environ, "GALECORE_TEST_DB": cs(env, "galecore_ddl", "ddl_password", TEST_DATABASE)}
    tests = DATAFEED / "DataFeed.Tests" / "DataFeed.Tests.csproj"
    return sh(["dotnet", "test", str(tests)], env=run_env, check=False)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("--url", required=True, help="URL del proyecto GaleCore Dev (https://<ref>.supabase.co)")
    i.add_argument("--anon-key", required=True, help="anon key PÚBLICA del proyecto de desarrollo")
    i.add_argument("--pooler-host", required=True, help="host del pooler (aws-...pooler.supabase.com)")
    i.set_defaults(fn=cmd_init)
    for name, fn in [
        ("migrate", cmd_migrate),
        ("set-demo-password", cmd_set_demo_password),
        ("api", cmd_api),
        ("monitor", cmd_monitor),
        ("test", cmd_test),
    ]:
        sub.add_parser(name).set_defaults(fn=fn)
    d = sub.add_parser("deploy")
    d.add_argument("--spec", default="shadow_runtime_test_v1")
    d.add_argument("--switch-on", action="store_true", help="además prende el switch del runtime")
    d.add_argument("--approval", help="knowledge/strategies/<name>/<version>.approval.json (GC-AI-0008)")
    d.set_defaults(fn=cmd_deploy)
    st = sub.add_parser("stop")
    st.add_argument("--instance", required=True)
    st.set_defaults(fn=cmd_stop)
    r = sub.add_parser("runtime-report")
    r.add_argument("--spec", required=True)
    r.add_argument("--limit", type=int, default=200, help="últimas N evaluaciones y eventos por instancia")
    r.set_defaults(fn=cmd_runtime_report)
    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
