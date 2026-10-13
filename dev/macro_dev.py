"""Preview Macro aislada: mismos secretos/config Dev, otros puertos, sin modificar procesos de Claude.

python dev/macro_dev.py api|monitor
No migraciones, despliegues, cambios de secretos ni configuración de producción.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess

import galecore_dev as dev


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["api", "monitor"])
    args = parser.parse_args()
    common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=dev.ROOT, text=True).strip()
    config_root = (dev.ROOT / common).resolve().parent
    if config_root == dev.ROOT:
        parser.error("La preview requiere un worktree separado; no modifica el checkout principal.")
    dev.ENV_FILE = config_root / "dev" / ".local" / "env.json"
    env = dev.load_env()  # revalida el proyecto GaleCore Dev
    api_url = "http://localhost:7002"
    if args.command == "api":
        # Overrides ignorados por git y exclusivos de este worktree. No lanzar loops de estrategias.
        files = dev.API_CSPROJ.parent / "Files"
        for prefix in ("Rpf", "Gex"):
            folder = files / prefix
            folder.mkdir(exist_ok=True)
            (folder / f"{prefix.lower()}_switch_state.json").write_text('{"enabled":false}', encoding="utf-8")
        (files / "platform_services_switch_state.json").write_text(
            json.dumps({"skew": {"enabled": False}, "runtime": {"enabled": False}}), encoding="utf-8")
        run_env = dev.api_env(env)
        run_env.update({"ASPNETCORE_URLS": api_url, "Runtime__Persistence__Enabled": "false",
                        "Macro__SnapshotDirectory": str(dev.ROOT / "dev" / ".local" / "macro-snapshots")})
        dev.sh(["dotnet", "build", str(dev.API_CSPROJ), "-nologo", "-v", "q"], cwd=dev.ROOT)
        return dev.sh(["dotnet", "run", "--no-build", "--no-launch-profile", "--project", str(dev.API_CSPROJ)],
                      cwd=dev.API_CSPROJ.parent, env=run_env, check=False)
    run_env = {**os.environ, "PORT": "5173", "BROWSER": "none", "REACT_APP_API_BASE_URL": api_url,
               "REACT_APP_SIGNALR_HUB_URL": api_url + "/hubs/marketdata",
               "REACT_APP_SUPABASE_URL": env["supabase_url"], "REACT_APP_SUPABASE_ANON_KEY": env["anon_key"]}
    return dev.sh(["npm", "start"], cwd=dev.MONITOR, env=run_env, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
