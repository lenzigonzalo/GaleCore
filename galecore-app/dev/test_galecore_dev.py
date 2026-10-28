import base64
import unittest
from unittest.mock import patch

import galecore_dev as dev


class BrokerEncryptionConfigTests(unittest.TestCase):
    def test_api_creates_and_reuses_dev_key(self):
        config = {
            "project_ref": dev.DEV_PROJECT_REF,
            "supabase_url": "https://" + dev.DEV_PROJECT_REF + ".supabase.co",
            "anon_key": "test",
            "pooler_host": "test",
            "api_password": "test",
        }
        with (
            patch.object(dev, "load_env", return_value=config),
            patch.object(dev, "save_env") as save,
            patch.object(dev, "sh", return_value=0) as run,
        ):
            self.assertEqual(dev.cmd_api(None), 0)
            key = config["token_protection_key"]
            self.assertEqual(len(base64.b64decode(key)), 32)
            save.assert_called_once_with(config)
            self.assertEqual(run.call_args.kwargs["env"]["Security__TokenProtectionKey"], key)
            save.reset_mock()
            self.assertEqual(dev.cmd_api(None), 0)
            save.assert_not_called()
            self.assertEqual(config["token_protection_key"], key)

    def test_existing_key_is_passed_without_rotation(self):
        config = {
            "project_ref": dev.DEV_PROJECT_REF,
            "supabase_url": "https://" + dev.DEV_PROJECT_REF + ".supabase.co",
            "anon_key": "test",
            "pooler_host": "test",
            "api_password": "test",
            "token_protection_key": base64.b64encode(bytes(range(32))).decode("ascii"),
        }
        with (
            patch.object(dev, "load_env", return_value=config),
            patch.object(dev, "save_env") as save,
            patch.object(dev, "sh", return_value=0) as run,
        ):
            dev.cmd_api(None)
            save.assert_not_called()
            self.assertEqual(
                run.call_args.kwargs["env"]["Security__TokenProtectionKey"], config["token_protection_key"]
            )


if __name__ == "__main__":
    unittest.main()


class RuntimePersistenceFlagTests(unittest.TestCase):
    BASE = {"supabase_url": "https://x.supabase.co", "project_ref": "x", "anon_key": "a",
            "pooler_host": "h", "api_password": "p"}

    def test_persistence_on_by_default(self):
        self.assertEqual(dev.api_env(dict(self.BASE))["Runtime__Persistence__Enabled"], "true")

    def test_second_operator_turns_it_off(self):
        env = dev.api_env({**self.BASE, "runtime_persistence": False})
        self.assertEqual(env["Runtime__Persistence__Enabled"], "false")

    def test_owner_username_is_passed_to_the_api(self):
        env = dev.api_env({**self.BASE, "runtime_owner_username": "ana"})
        self.assertEqual(env["Runtime__OwnerUsername"], "ana")
        self.assertEqual(env["Runtime__Persistence__Enabled"], "true")

    def test_no_owner_username_no_key(self):
        self.assertNotIn("Runtime__OwnerUsername", dev.api_env(dict(self.BASE)))
