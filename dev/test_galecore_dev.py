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
