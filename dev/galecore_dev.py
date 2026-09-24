"""Entorno de DESARROLLO aislado de GaleCore (GC-0004): Supabase local + API + monitor.

Nada de esto apunta a producción. Postgres y Auth corren en Docker en esta máquina (Supabase CLI por
npx); la API y el monitor se levantan con variables de entorno que pisan la configuración local sólo
para ese proceso, así que user-secrets y los .env del monitor no se tocan. Los datos de MERCADO siguen
siendo reales: la API usa las credenciales de Tastytrade de siempre (user-secrets).

Uso, desde la raíz del repo GaleCore:

    python dev/galecore_dev.py check      # qué falta instalar
    python dev/galecore_dev.py up         # Supabase local, clave ES256, roles, migraciones EF
    python dev/galecore_dev.py seed-user  # usuario de prueba (Auth local + fila en users)
    python dev/galecore_dev.py api        # API en :7001 contra el entorno local (primer plano)
    python dev/galecore_dev.py monitor    # monitor en :3039 contra el entorno local (primer plano)
    python dev/galecore_dev.py deploy     # entra como el usuario de prueba y despliega la spec de prueba
    python dev/galecore_dev.py test       # dotnet test con la base de prueba local (incluye Postgres)
    python dev/galecore_dev.py down       # baja Supabase local (los datos quedan en el volumen)

Lo generado localmente (clave de firma, contraseñas de los roles y del usuario de prueba) vive en
dev/.local/ y dev/supabase/signing_keys.json, ambos fuera de git. Son credenciales de un entorno local
de prueba, no de producción; igual no se imprimen.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # repo GaleCore
DEV = ROOT / "dev"
LOCAL = DEV / ".local"
ENV_FILE = LOCAL / "env.json"
SIGNING_KEYS = DEV / "supabase" / "signing_keys.json"
DATAFEED = ROOT / "source" / "galecore-datafeed"
API_CSPROJ = DATAFEED / "DataFeed.Api" / "DataFeed.Api.csproj"
MONITOR = ROOT / "source" / "galecore-monitor"

SUPABASE = ["npx", "-y", "supabase@2.117.0"]
PROJECT_ID = "galecore-dev"
DB_CONTAINER = f"supabase_db_{PROJECT_ID}"
# Lo que el flujo no usa: sólo quedan Postgres, Auth (gotrue) y el gateway (kong).
EXCLUDE = "realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
DB_HOST, DB_PORT = "127.0.0.1", 54322
# Contraseña por defecto del superusuario del Postgres LOCAL de la CLI de Supabase (pública, no es un secreto).
LOCAL_SUPERUSER = "postgres"
TEST_DATABASE = "galecore_test"
API_URL = "http://localhost:7001"
TEST_USERNAME = "demo"
TEST_EMAIL = "demo@galecore-dev.local"


def sh(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict | None = None,
    check: bool = True,
    capture: bool = False,
    stdin: str | None = None,
) -> subprocess.CompletedProcess:
    exe = shutil.which(cmd[0]) or cmd[0]
    r = subprocess.run(
        [exe, *cmd[1:]],
        cwd=cwd,
        env=env,
        text=True,
        input=stdin,
        capture_output=capture,
        encoding="utf-8",
        errors="replace",
    )
    if check and r.returncode != 0:
        detail = (r.stderr or r.stdout or "").strip()[-2000:] if capture else ""
        sys.exit(f"falló: {' '.join(cmd[:4])} … (exit {r.returncode}) {detail}")
    return r


def load_env() -> dict:
    if not ENV_FILE.exists():
        sys.exit("falta dev/.local/env.json: correr primero `python dev/galecore_dev.py up`")
    return json.loads(ENV_FILE.read_text(encoding="utf-8"))


def save_env(env: dict) -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text(json.dumps(env, indent=2), encoding="utf-8")


def cs(user: str, password: str, database: str = "postgres") -> str:
    return f"Host={DB_HOST};Port={DB_PORT};Database={database};Username={user};Password={password}"


def psql(sql: str) -> str:
    r = sh(
        [
            "docker",
            "exec",
            "-i",
            DB_CONTAINER,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-t",
            "-A",
        ],
        stdin=sql,
        capture=True,
    )
    return r.stdout.strip()


def http(
    method: str, url: str, body: dict | None = None, headers: dict | None = None
) -> tuple[int, dict | list | None]:
    req = urllib.request.Request(
        url,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
    )
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


# ── comandos ──────────────────────────────────────────────────────────


def cmd_check(_: argparse.Namespace) -> int:
    missing = []
    for tool, why in [
        ("docker", "Docker Desktop (con WSL2) para Supabase local"),
        ("npx", "Node.js, para la CLI de Supabase"),
        ("dotnet", ".NET SDK 8"),
    ]:
        found = shutil.which(tool)
        print(f"{tool:8} {'OK ' + found if found else 'FALTA - ' + why}")
        if not found:
            missing.append(tool)
    if "docker" not in missing:
        r = sh(["docker", "info", "--format", "{{.ServerVersion}}"], check=False, capture=True)
        print(
            f"docker   servidor: {r.stdout.strip() if r.returncode == 0 else 'NO responde (¿Docker Desktop abierto?)'}"
        )
        if r.returncode != 0:
            missing.append("docker-server")
    r = sh(["dotnet", "ef", "--version"], check=False, capture=True) if shutil.which("dotnet") else None
    print(
        "dotnet-ef",
        "OK" if r and r.returncode == 0 else "FALTA - dotnet tool install --global dotnet-ef --version 8.0.11",
    )
    return 1 if missing else 0


def cmd_up(_: argparse.Namespace) -> int:
    if cmd_check(_) != 0:
        return 1
    if not SIGNING_KEYS.exists():
        SIGNING_KEYS.write_text("[]", encoding="utf-8")
        sh([*SUPABASE, "gen", "signing-key", "--algorithm", "ES256", "--append", "--workdir", str(DEV)], stdin="")
    sh([*SUPABASE, "start", "--workdir", str(DEV), "-x", EXCLUDE])
    status = json.loads(sh([*SUPABASE, "status", "-o", "json", "--workdir", str(DEV)], capture=True).stdout)

    env = json.loads(ENV_FILE.read_text(encoding="utf-8")) if ENV_FILE.exists() else {}
    env.setdefault("ddl_password", secrets.token_urlsafe(24))
    env.setdefault("api_password", secrets.token_urlsafe(24))
    env.update(
        {
            "supabase_url": status["API_URL"],
            "anon_key": status["ANON_KEY"],
            "service_role_key": status["SERVICE_ROLE_KEY"],
        }
    )
    save_env(env)

    # Dos roles, como en producción: galecore_ddl es dueño del esquema y aplica migraciones;
    # galecore_api (el de la API) sólo lee y escribe filas, no puede alterar tablas.
    psql(f"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galecore_ddl') THEN CREATE ROLE galecore_ddl LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galecore_api') THEN CREATE ROLE galecore_api LOGIN; END IF;
END $$;
ALTER ROLE galecore_ddl PASSWORD '{env["ddl_password"]}';
ALTER ROLE galecore_api PASSWORD '{env["api_password"]}';
GRANT galecore_ddl TO postgres;   -- para fijar sus privilegios por defecto y cargar el usuario de prueba
GRANT USAGE, CREATE ON SCHEMA public TO galecore_ddl;
GRANT USAGE ON SCHEMA public TO galecore_api;
ALTER DEFAULT PRIVILEGES FOR ROLE galecore_ddl IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO galecore_api;
""")
    run_env = {**os.environ, "GALECORE_DB": cs("galecore_ddl", env["ddl_password"])}
    sh(
        [
            "dotnet",
            "ef",
            "database",
            "update",
            "--project",
            "DataFeed.Repositories",
            "--startup-project",
            "DataFeed.Repositories",
        ],
        cwd=DATAFEED,
        env=run_env,
    )
    applied = psql('SELECT count(*) FROM "__EFMigrationsHistory"')
    print(
        f"\nSupabase local arriba ({status['API_URL']}); migraciones EF aplicadas: {applied}. "
        "Siguiente: `python dev/galecore_dev.py seed-user`."
    )
    return 0


def cmd_seed_user(_: argparse.Namespace) -> int:
    env = load_env()
    env.setdefault("demo_password", secrets.token_urlsafe(18))
    admin = {"apikey": env["service_role_key"], "Authorization": f"Bearer {env['service_role_key']}"}
    base = env["supabase_url"] + "/auth/v1/admin/users"
    code, body = http(
        "POST", base, {"email": TEST_EMAIL, "password": env["demo_password"], "email_confirm": True}, admin
    )
    if code in (200, 201):
        user_id = body["id"]
    else:  # ya existe: se busca y se le vuelve a poner la contraseña guardada
        code, listed = http("GET", base + "?per_page=1000", headers=admin)
        users = (listed or {}).get("users", []) if isinstance(listed, dict) else []
        match = [u for u in users if u.get("email") == TEST_EMAIL]
        if not match:
            sys.exit(f"no se pudo crear ni encontrar el usuario de prueba (HTTP {code})")
        user_id = match[0]["id"]
        code, _ = http("PUT", f"{base}/{user_id}", {"password": env["demo_password"]}, admin)
        if code != 200:
            sys.exit(f"no se pudo actualizar la contraseña del usuario de prueba (HTTP {code})")
    save_env(env)
    # Admin para poder prender el switch del runtime desde Main (users.is_admin es de GaleCore).
    psql(f"""
INSERT INTO users (id, email, username, display_name, is_admin)
VALUES ('{user_id}', '{TEST_EMAIL}', '{TEST_USERNAME}', 'Usuario de prueba (dev)', true)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username, is_admin = true;
""")
    print(
        f"Usuario de prueba listo: username `{TEST_USERNAME}`; "
        "la contraseña está en dev/.local/env.json (demo_password)."
    )
    return 0


def api_env(env: dict) -> dict:
    return {
        **os.environ,
        "ASPNETCORE_ENVIRONMENT": "Development",
        "ASPNETCORE_URLS": API_URL,
        "ConnectionStrings__GaleCore": cs("galecore_api", env["api_password"]),
        "Supabase__Issuer": env["supabase_url"] + "/auth/v1",
        "Supabase__AnonKey": env["anon_key"],
        "Supabase__ServiceRoleKey": env["service_role_key"],
    }


def cmd_api(_: argparse.Namespace) -> int:
    env = load_env()
    sh(["dotnet", "build", str(API_CSPROJ), "-nologo", "-v", "q"])
    return sh(
        ["dotnet", "run", "--no-build", "--no-launch-profile", "--project", str(API_CSPROJ)],
        cwd=API_CSPROJ.parent,
        env=api_env(env),
        check=False,
    ).returncode


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
    return sh(["npm", "start"], cwd=MONITOR, env=run_env, check=False).returncode


def login(env: dict) -> str:
    code, body = http(
        "POST", API_URL + "/App/GaleCore/Auth/Login", {"username": TEST_USERNAME, "password": env["demo_password"]}
    )
    if code != 200:
        sys.exit(f"login del usuario de prueba falló (HTTP {code}): {body}")
    return body["accessToken"]


def cmd_deploy(args: argparse.Namespace) -> int:
    env = load_env()
    auth = {"Authorization": f"Bearer {login(env)}"}
    code, body = http("POST", API_URL + "/App/Runtime/Deploy", {"specName": args.spec}, auth)
    print(f"deploy HTTP {code}: {json.dumps(body, ensure_ascii=False)}")
    if args.switch_on and code == 200:
        code2, body2 = http("POST", API_URL + "/App/GaleCore/Services/runtime/Switch", {"enabled": True}, auth)
        print(f"switch HTTP {code2}: {json.dumps(body2, ensure_ascii=False)}")
    return 0 if code == 200 else 1


def cmd_test(_: argparse.Namespace) -> int:
    run_env = {**os.environ, "GALECORE_TEST_DB": cs("postgres", LOCAL_SUPERUSER, TEST_DATABASE)}
    return sh(
        ["dotnet", "test", str(DATAFEED / "DataFeed.Tests" / "DataFeed.Tests.csproj")], env=run_env, check=False
    ).returncode


def cmd_down(_: argparse.Namespace) -> int:
    return sh([*SUPABASE, "stop", "--workdir", str(DEV)], check=False).returncode


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn in [
        ("check", cmd_check),
        ("up", cmd_up),
        ("seed-user", cmd_seed_user),
        ("api", cmd_api),
        ("monitor", cmd_monitor),
        ("test", cmd_test),
        ("down", cmd_down),
    ]:
        sub.add_parser(name).set_defaults(fn=fn)
    d = sub.add_parser("deploy")
    d.add_argument("--spec", default="shadow_runtime_test_v1")
    d.add_argument("--switch-on", action="store_true", help="además prende el switch del runtime")
    d.set_defaults(fn=cmd_deploy)
    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
