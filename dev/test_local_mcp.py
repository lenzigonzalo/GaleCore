import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import tomlkit
from local_mcp import ConfigError, Inventory, default_backups, make_handler


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.workspace = self.home / "workspace"
        self.workspace.mkdir()
        self.context = str(self.workspace).replace("\\", "/")
        (self.home / ".codex").mkdir()
        self.codex = self.home / ".codex/config.toml"
        self.codex.write_text(
            '# Preserve comment\nmodel = "example"\n[mcp_servers.sample]\ncommand = "node"\nargs = ["secret-argument"]\n[mcp_servers.sample.env]\nTOKEN = "secret-token"\n',
            encoding="utf-8",
        )
        self.claude = self.home / ".claude.json"
        self.claude.write_text(
            json.dumps(
                {
                    "other": "keep",
                    "mcpServers": {"global": {"url": "https://secret.example/token"}},
                    "projects": {
                        self.context: {
                            "mcpServers": {"local": {"command": "node"}},
                            "other": 42,
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        self.inventory = Inventory(self.home, self.workspace, self.home / "backups")

    def row(self, name):
        return next(
            r for r in self.inventory.snapshot()["servers"] if r["name"] == name
        )

    def test_default_backups_are_outside_repo(self):
        repo = Path(__file__).resolve().parent.parent
        self.assertFalse(default_backups().resolve().is_relative_to(repo))

    def test_global_shared_approval_is_honored(self):
        (self.workspace / ".mcp.json").write_text(
            json.dumps({"mcpServers": {"shared": {"command": "node"}}})
        )
        (self.workspace / ".claude").mkdir()
        (self.workspace / ".claude/settings.local.json").write_text(
            json.dumps({"enableAllProjectMcpServers": True})
        )
        row = self.row("shared")
        self.assertTrue(row["enabled"])
        self.assertFalse(row["approvalRequired"])

    def test_snapshot_never_contains_credentials(self):
        rendered = json.dumps(self.inventory.snapshot())
        for value in ("secret-token", "secret-argument", "secret.example"):
            self.assertNotIn(value, rendered)
        self.assertEqual(len(self.inventory.snapshot()["servers"]), 3)

    def test_codex_toggle_preserves_comments_secrets_and_other_settings(self):
        original = self.codex.read_bytes()
        row = self.row("sample")
        self.inventory.toggle(row["id"], False, row["revision"])
        doc = tomlkit.parse(self.codex.read_text())
        self.assertFalse(doc["mcp_servers"]["sample"]["enabled"])
        self.assertEqual(doc["mcp_servers"]["sample"]["env"]["TOKEN"], "secret-token")
        self.assertIn("# Preserve comment", self.codex.read_text())
        self.assertEqual(doc["model"], "example")
        self.assertIn(
            original, [p.read_bytes() for p in (self.home / "backups").glob("*")]
        )
        row = self.row("sample")
        self.inventory.toggle(row["id"], True, row["revision"])
        self.assertTrue(self.row("sample")["enabled"])

    def test_claude_project_toggle_preserves_connections(self):
        original = json.loads(self.claude.read_text())
        row = self.row("local")
        self.inventory.toggle(row["id"], False, row["revision"])
        doc = json.loads(self.claude.read_text())
        self.assertEqual(doc["projects"][self.context]["disabledMcpServers"], ["local"])
        self.assertEqual(doc["mcpServers"], original["mcpServers"])
        self.assertEqual(
            doc["projects"][self.context]["mcpServers"],
            original["projects"][self.context]["mcpServers"],
        )
        self.assertEqual(doc["projects"][self.context]["other"], 42)
        row = self.row("local")
        self.inventory.toggle(row["id"], True, row["revision"])
        self.assertEqual(
            json.loads(self.claude.read_text())["projects"][self.context][
                "disabledMcpServers"
            ],
            [],
        )

    def test_shared_project_server_uses_local_disable_list(self):
        (self.workspace / ".mcp.json").write_text(
            json.dumps({"mcpServers": {"shared": {"command": "node"}}})
        )
        original = (self.workspace / ".mcp.json").read_bytes()
        (self.workspace / ".claude").mkdir()
        (self.workspace / ".claude/settings.local.json").write_text(
            json.dumps({"enabledMcpjsonServers": ["shared"]})
        )
        row = self.row("shared")
        self.inventory.toggle(row["id"], False, row["revision"])
        self.assertEqual(
            json.loads((self.workspace / ".claude/settings.local.json").read_text()),
            {"disabledMcpjsonServers": ["shared"], "enabledMcpjsonServers": ["shared"]},
        )
        self.assertEqual((self.workspace / ".mcp.json").read_bytes(), original)
        self.assertFalse(self.row("shared")["enabled"])

    def test_unapproved_shared_server_is_not_reported_or_toggled_as_enabled(self):
        (self.workspace / ".mcp.json").write_text(
            json.dumps({"mcpServers": {"shared": {"command": "node"}}})
        )
        row = self.row("shared")
        self.assertFalse(row["enabled"])
        self.assertTrue(row["approvalRequired"])
        with self.assertRaises(ConfigError):
            self.inventory.toggle(row["id"], True, row["revision"])
        self.assertFalse((self.workspace / ".claude/settings.local.json").exists())

    def test_concurrent_edit_rejected(self):
        row = self.row("sample")
        self.codex.write_text(self.codex.read_text() + "\n# concurrent\n")
        original = self.codex.read_bytes()
        with self.assertRaises(ConfigError):
            self.inventory.toggle(row["id"], False, row["revision"])
        self.assertEqual(original, self.codex.read_bytes())

    def test_invalid_id_or_boolean_does_not_write(self):
        original = self.codex.read_bytes()
        for identifier, enabled in (
            ("missing", False),
            (self.row("sample")["id"], "false"),
        ):
            with self.assertRaises(ConfigError):
                self.inventory.toggle(
                    identifier, enabled, self.row("sample")["revision"]
                )
        self.assertEqual(original, self.codex.read_bytes())

    def test_invalid_configuration_does_not_write(self):
        row = self.row("sample")
        self.codex.write_text("[broken", encoding="utf-8")
        original = self.codex.read_bytes()
        with self.assertRaises(tomlkit.exceptions.ParseError):
            self.inventory.toggle(row["id"], False, row["revision"])
        self.assertEqual(original, self.codex.read_bytes())

    def test_replace_failure_keeps_original(self):
        row = self.row("sample")
        original = self.codex.read_bytes()
        with (
            patch("local_mcp.os.replace", side_effect=OSError("denied")),
            self.assertRaises(OSError),
        ):
            self.inventory.toggle(row["id"], False, row["revision"])
        self.assertEqual(original, self.codex.read_bytes())
        self.assertEqual(list(self.codex.parent.glob(".galecore-mcp-*")), [])

    def test_http_origin_host_and_token(self):
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), make_handler(self.inventory, "test-token")
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_port}"
        headers = {"Origin": "http://localhost:3039", "Host": "127.0.0.1:8772"}
        with urlopen(Request(base + "/bootstrap", headers=headers)) as response:
            self.assertEqual(json.load(response)["token"], "test-token")
        for replacement, expected in (
            ({"Origin": "https://evil.example"}, 403),
            ({"Host": "evil.example"}, 403),
            ({}, 401),
        ):
            with self.assertRaises(HTTPError) as error:
                urlopen(
                    Request(base + "/inventory", headers={**headers, **replacement})
                )
            self.assertEqual(error.exception.code, expected)
        with urlopen(
            Request(
                base + "/inventory",
                headers={**headers, "Authorization": "Bearer test-token"},
            )
        ) as response:
            self.assertNotIn("secret-token", response.read().decode())


if __name__ == "__main__":
    unittest.main()
