import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class SnapTradeReadonlyContractTests(unittest.TestCase):
    def test_encrypted_snapshot_is_outer_schema_only(self):
        value = json.loads((ROOT / "data/private/wealthsimple-holdings.enc.json").read_text(encoding="utf-8"))
        self.assertEqual(value["schema_version"], "wealthsimple-holdings-encrypted-v1")
        self.assertEqual(value["algorithm"], "AES-256-GCM")
        for field in ("accounts", "holdings", "positions", "balances", "consumer_key", "user_secret"):
            self.assertNotIn(field, value)

    def test_workflow_has_no_trade_trigger_or_secret_output(self):
        workflow = (ROOT / ".github/workflows/sync-snaptrade-holdings.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch", workflow)
        self.assertNotIn("pull_request", workflow)
        self.assertIn("HOLDINGS_SNAPSHOT_KEY", workflow)
        self.assertNotIn("echo ${{ secrets", workflow)


if __name__ == "__main__":
    unittest.main()
