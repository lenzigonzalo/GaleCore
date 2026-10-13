"""Local-only MCP configuration inventory. No subprocesses or server connections.
Run: python dev/local_mcp.py --workspace <workspace folder>
Dependency: pip install -r dev/local_mcp_requirements.txt
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import threading
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
        raise ValueError("Expected object")
    return data


class ConfigError(Exception):
    pass


class Inventory:
    def __init__(self, home: Path, workspace: Path, backups: Path):
        self.home, self.workspace, self.backups = home, workspace.resolve(), backups

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
        for name, spec in read_json(project).get("mcpServers", {}).items():
            sources.append(
                {
                    "provider": "claude",
                    "name": name,
                    "context": str(self.workspace).replace("\\", "/"),
                    "scope": "Proyecto compartido",
                    "source": project,
                    "target": local,
                    "spec": spec,
                    "enabled": name not in settings.get("disabledMcpjsonServers", []),
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
                }
            )
        return {
            "servers": rows,
            "workspace": str(self.workspace),
            "status": "configuration-only",
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
                    "La configuración cambi? desde otra aplicación. Actualizá antes de guardar."
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
            self.backups.mkdir(parents=True, exist_ok=True)
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


def make_handler(inventory: Inventory, token: str):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # URLs/payloads never logged.

        def allowed(self):
            return self.headers.get("Origin") == ORIGIN and self.headers.get(
                "Host"
            ) in {"127.0.0.1:8772", "localhost:8772"}

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
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.end_headers()

        def dispatch(self):
            if not self.allowed():
                return self.respond(
                    403, {"error": "Sólo se acepta el monitor local en 3039."}
                )
            if self.command == "GET" and self.path == "/bootstrap":
                return self.respond(200, {"token": token})
            authorization = self.headers.get("Authorization", "")
            if not hmac.compare_digest(authorization, "Bearer " + token):
                return self.respond(401, {"error": "Sesi?n local vencida."})
            try:
                if self.command == "GET" and self.path == "/inventory":
                    return self.respond(200, inventory.snapshot())
                if self.command == "POST" and self.path == "/toggle":
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 4096:
                        return self.respond(400, {"error": "Pedido inválido."})
                    body = json.loads(self.rfile.read(size))
                    return self.respond(
                        200,
                        inventory.toggle(body["id"], body["enabled"], body["revision"]),
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

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    inventory = Inventory(
        Path.home(), args.workspace, Path(__file__).parent / ".local/mcp-backups"
    )
    server = ThreadingHTTPServer(
        ("127.0.0.1", 8772), make_handler(inventory, secrets.token_urlsafe(32))
    )
    print(
        "Conexiones locales MCP: 127.0.0.1:8772 ? monitor permitido localhost:3039",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
