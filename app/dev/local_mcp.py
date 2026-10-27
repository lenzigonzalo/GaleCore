"""Local MCP inventory with native Claude CLI discovery. No MCP tool calls.
Run: python dev/local_mcp.py --workspace <workspace folder>
Dependency: pip install -r dev/local_mcp_requirements.txt
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import tomlkit

ORIGIN = "http://localhost:3039"
LOCK = threading.Lock()


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    if not isinstance(data, dict):
        raise TypeError("Expected object")
    return data


class ConfigError(Exception):
    pass


def secure_directory(path: Path):
    """Backups contain original credentials: owner/System only, outside synced repos."""
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
        return
    import ctypes
    from ctypes import wintypes

    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    descriptor = ctypes.c_void_p()
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    advapi.GetSecurityDescriptorDacl.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.BOOL),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.BOOL),
    ]
    advapi.SetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    # Protected DACL: inheritable full access for owner rights and local SYSTEM.
    if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)",
        1,
        ctypes.byref(descriptor),
        None,
    ):
        raise OSError("Cannot protect backup directory")
    try:
        present, defaulted, acl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        if not advapi.GetSecurityDescriptorDacl(
            descriptor,
            ctypes.byref(present),
            ctypes.byref(acl),
            ctypes.byref(defaulted),
        ):
            raise OSError("Cannot read backup ACL")
        result = advapi.SetNamedSecurityInfoW(
            str(path), 1, 0x80000004, None, None, acl, None
        )
        if result:
            raise OSError("Cannot protect backup directory")
    finally:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(descriptor)


class Inventory:
    def __init__(self, home: Path, workspace: Path, backups: Path):
        self.home, self.workspace, self.backups = home, workspace.resolve(), backups
        self.observed = []
        self.checked_at = None
        self.checking = False
        self.discovery_error = None
        self.discovery_lock = threading.Lock()

    @staticmethod
    def parse_cli_listing(output: str) -> list[dict]:
        rows = []
        for line in output.splitlines():
            match = re.match(r"^(claude[.]ai [^:]+|plugin:[^ ]+:[^:]+): (.+)$", line)
            if not match:
                continue
            name, detail = match.groups()
            if len(name) > 160:
                continue
            lowered = re.sub(r"^[^a-zA-Z]+", "", detail.rsplit(" - ", 1)[-1]).lower()
            status = "unverified"
            for phrase, value in (
                ("failed to connect", "failed"),
                ("not connected", "failed"),
                ("disconnected", "failed"),
                ("needs authentication", "needs-auth"),
                ("disabled", "disabled"),
                ("not configured", "not-configured"),
                ("invalid config", "not-configured"),
                ("missing configuration", "not-configured"),
                ("connected", "connected"),
            ):
                if lowered.startswith(phrase):
                    status = value
                    break
            rows.append({"name": name, "status": status})
        return rows

    def refresh(self):
        with self.discovery_lock:
            if self.checking:
                return
            self.checking = True
        threading.Thread(target=self._discover, daemon=True).start()

    def _discover(self):
        try:
            executable = shutil.which("claude")
            if not executable:
                raise OSError("Claude not installed")
            if os.name == "nt" and Path(executable).suffix.lower() in {".cmd", ".ps1"}:
                native = (
                    Path(executable).parent
                    / "node_modules/@anthropic-ai/claude-code/bin/claude.exe"
                )
                if native.is_file():
                    executable = str(native)
            result = subprocess.run(
                [executable, "mcp", "list"],
                cwd=self.workspace,
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=55,
            )
            if result.returncode:
                raise OSError("Claude MCP listing failed")
            rows = self.parse_cli_listing(result.stdout)
            self.observed = rows
            self.checked_at = datetime.now(timezone.utc).isoformat()
            self.discovery_error = None
        except (OSError, subprocess.TimeoutExpired):
            self.discovery_error = "No se pudo comprobar el listado de Claude. Se conservan las referencias anteriores."
        finally:
            self.checking = False

    def discovered_sources(self, data: dict) -> list[dict]:
        context = self.workspace.as_posix()
        disabled = (
            data.get("projects", {}).get(context, {}).get("disabledMcpServers", [])
        )
        observed = (
            self.observed
            if self.checked_at
            else [
                {"name": name, "status": "unverified"}
                for name in data.get("claudeAiMcpEverConnected", [])
                if isinstance(name, str) and name.startswith("claude.ai ")
            ]
        )
        claude = self.home / ".claude.json"
        return [
            {
                "provider": "claude",
                "name": row["name"],
                "context": context,
                "scope": "Control en este proyecto"
                if row["name"].startswith("claude.ai ")
                else "Plugin " + row["name"].split(":", 2)[1] + " · este proyecto",
                "source": claude,
                "target": claude,
                "spec": {"type": "http"},
                "enabled": row["name"] not in disabled,
                "kind": "claude",
                "origin": "account"
                if row["name"].startswith("claude.ai ")
                else "plugin",
                "runtimeStatus": row["status"],
                "editable": bool(self.checked_at),
                "displayName": row["name"].removeprefix("claude.ai ")
                if row["name"].startswith("claude.ai ")
                else row["name"].split(":", 2)[-1],
            }
            for row in observed
        ]

    def contexts(self, data: dict) -> list[str]:
        paths = {str(self.workspace).replace("\\", "/")}
        for folder, settings in data.get("projects", {}).items():
            if settings.get("mcpServers"):
                paths.add(folder)
        return sorted(paths)

    def sources(self) -> list[dict]:
        claude = self.home / ".claude.json"
        data = read_json(claude)
        sources = []
        for folder in self.contexts(data):
            settings = data.get("projects", {}).get(folder, {})
            servers = {**data.get("mcpServers", {}), **settings.get("mcpServers", {})}
            for name, spec in servers.items():
                sources.append(
                    {
                        "provider": "claude",
                        "name": name,
                        "context": folder,
                        "scope": "Proyecto"
                        if name in settings.get("mcpServers", {})
                        else "Usuario · control por proyecto",
                        "source": claude,
                        "target": claude,
                        "spec": spec,
                        "enabled": name not in settings.get("disabledMcpServers", []),
                        "kind": "claude",
                    }
                )
        project = self.workspace / ".mcp.json"
        local = self.workspace / ".claude/settings.local.json"
        settings = read_json(local)
        approval = {}
        for setting_file in (
            self.home / ".claude/settings.json",
            self.workspace / ".claude/settings.json",
            local,
        ):
            approval.update(read_json(setting_file))
        for name, spec in read_json(project).get("mcpServers", {}).items():
            approved = approval.get(
                "enableAllProjectMcpServers"
            ) is True or name in approval.get("enabledMcpjsonServers", [])
            sources.append(
                {
                    "provider": "claude",
                    "name": name,
                    "context": str(self.workspace).replace("\\", "/"),
                    "scope": "Proyecto compartido",
                    "source": project,
                    "target": local,
                    "spec": spec,
                    "enabled": approved
                    and name not in settings.get("disabledMcpjsonServers", []),
                    "approvalRequired": not approved,
                    "kind": "project",
                }
            )
        codex = self.home / ".codex/config.toml"
        if codex.exists():
            doc = tomlkit.parse(codex.read_text(encoding="utf-8"))
            for name, spec in doc.get("mcp_servers", {}).items():
                sources.append(
                    {
                        "provider": "codex",
                        "name": name,
                        "context": "Todos los proyectos",
                        "scope": "Usuario",
                        "source": codex,
                        "target": codex,
                        "spec": spec,
                        "enabled": spec.get("enabled", True),
                        "kind": "codex",
                    }
                )
        sources.extend(self.discovered_sources(data))
        return sources

    def identity(self, row: dict) -> str:
        return digest(
            f"{row['provider']}|{row['source']}|{row['context']}|{row['name']}".encode()
        )

    def revision(self, row: dict) -> str:
        return digest(
            b"|".join(
                p.read_bytes() if p.exists() else b""
                for p in (row["source"], row["target"])
            )
        )

    def snapshot(self) -> dict:
        rows = []
        for row in self.sources():
            spec = row["spec"]
            rows.append(
                {
                    "id": self.identity(row),
                    "name": row["name"],
                    "provider": row["provider"],
                    "context": row["context"],
                    "scope": row["scope"],
                    "enabled": row["enabled"],
                    "transport": spec.get(
                        "type", "http" if spec.get("url") else "stdio"
                    ),
                    "file": str(row["source"]),
                    "revision": self.revision(row),
                    "approvalRequired": row.get("approvalRequired", False),
                    "origin": row.get("origin", "local"),
                    "runtimeStatus": row.get("runtimeStatus", "unverified"),
                    "editable": row.get("editable", True),
                    "displayName": row.get("displayName", row["name"]),
                }
            )
        return {
            "servers": rows,
            "workspace": self.workspace.as_posix(),
            "status": "cli-and-configuration",
            "refreshing": self.checking,
            "checkedAt": self.checked_at,
            "discoveryError": self.discovery_error,
        }

    def toggle(self, identifier: str, enabled: bool, revision: str) -> dict:
        if type(enabled) is not bool:
            raise ConfigError("La habilitación debe ser true o false.")
        with LOCK:
            row = next(
                (r for r in self.sources() if self.identity(r) == identifier), None
            )
            if row is None:
                raise ConfigError("La conexión ya no existe. Actualizá el inventario.")
            if self.revision(row) != revision:
                raise ConfigError(
                    "La configuración cambió desde otra aplicación. Actualizá antes de guardar."
                )
            if not row.get("editable", True):
                raise ConfigError("Primero comproba esta conexion con Actualizar.")
            if row.get("approvalRequired"):
                raise ConfigError(
                    "Este MCP necesita aprobacion en Claude antes de habilitarse desde el panel."
                )
            path = row["target"]
            original = path.read_bytes() if path.exists() else b""
            if row["kind"] == "codex":
                doc = tomlkit.parse(original.decode("utf-8"))
                doc["mcp_servers"][row["name"]]["enabled"] = enabled
                updated = tomlkit.dumps(doc).encode("utf-8")
            else:
                doc = json.loads(original.decode("utf-8-sig")) if original else {}
                target = (
                    doc.setdefault("projects", {}).setdefault(row["context"], {})
                    if row["kind"] == "claude"
                    else doc
                )
                key = (
                    "disabledMcpServers"
                    if row["kind"] == "claude"
                    else "disabledMcpjsonServers"
                )
                names = target.get(key, [])
                if not isinstance(names, list):
                    raise ConfigError(
                        "La lista de MCP deshabilitados no tiene un formato válido."
                    )
                target[key] = [n for n in names if n != row["name"]]
                if not enabled:
                    target[key].append(row["name"])
                updated = (json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode(
                    "utf-8"
                )
            path.parent.mkdir(parents=True, exist_ok=True)
            secure_directory(self.backups)
            if original:
                backup = self.backups / (
                    digest(str(path).encode())[:12] + "-" + digest(original) + ".bak"
                )
                if not backup.exists():
                    backup.write_bytes(original)
            fd, temporary = tempfile.mkstemp(prefix=".galecore-mcp-", dir=path.parent)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(updated)
                    stream.flush()
                    os.fsync(stream.fileno())
                if self.revision(row) != revision:
                    raise ConfigError(
                        "Otra aplicación modificó la configuración. No se guardó el cambio."
                    )
                os.replace(temporary, path)
            finally:
                Path(temporary).unlink(missing_ok=True)
        return self.snapshot()


class Handler(BaseHTTPRequestHandler):
    inventory: Inventory
    token: str

    def log_message(self, *_):
        pass  # URLs/payloads never logged.

    def allowed(self):
        return self.headers.get("Origin") == ORIGIN and self.headers.get("Host") in {
            "127.0.0.1:8772",
            "localhost:8772",
        }

    def respond(self, code, body):
        self.send_response(code)
        if self.allowed():
            self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        if not self.allowed():
            return self.respond(403, {"error": "Origen no permitido."})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.end_headers()

    def dispatch(self):
        if not self.allowed():
            return self.respond(
                403, {"error": "Sólo se acepta el monitor local en 3039."}
            )
        if self.command == "GET" and self.path == "/bootstrap":
            return self.respond(200, {"token": self.token})
        authorization = self.headers.get("Authorization", "")
        if not hmac.compare_digest(authorization, "Bearer " + self.token):
            return self.respond(401, {"error": "Sesión local vencida."})
        try:
            if self.command == "GET" and self.path == "/inventory":
                return self.respond(200, self.inventory.snapshot())
            if self.command == "POST" and self.path == "/refresh":
                self.inventory.refresh()
                return self.respond(200, self.inventory.snapshot())
            if self.command == "POST" and self.path == "/toggle":
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    return self.respond(400, {"error": "Pedido inválido."})
                body = json.loads(self.rfile.read(size))
                return self.respond(
                    200,
                    self.inventory.toggle(
                        body["id"], body["enabled"], body["revision"]
                    ),
                )
            return self.respond(404, {"error": "Ruta desconocida."})
        except ConfigError as error:
            return self.respond(409, {"error": str(error)})
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.respond(
                400,
                {
                    "error": "Formato de configuración o pedido inválido. No se guardó el cambio."
                },
            )
        except OSError:
            return self.respond(
                503,
                {
                    "error": "No se pudo acceder a la configuración local. No se guardó el cambio."
                },
            )

    do_GET = dispatch
    do_POST = dispatch


def make_handler(inventory: Inventory, token: str):
    return type("LocalMcpHandler", (Handler,), {"inventory": inventory, "token": token})


def default_backups() -> Path:
    return (
        Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share")))
        / "GaleCore/mcp-backups"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    inventory = Inventory(
        Path.home(),
        args.workspace,
        default_backups(),
    )
    inventory.refresh()
    server = ThreadingHTTPServer(
        ("127.0.0.1", 8772), make_handler(inventory, secrets.token_urlsafe(32))
    )
    print(
        "Conexiones locales MCP: 127.0.0.1:8772 · monitor permitido localhost:3039",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
