import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from scripts import live_data as live


class LiveDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        self.patch = patch.object(live, "ROOT", self.root)
        self.patch.start()
        live.git("init")

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_release_is_two_commits_and_manifest_pins_parent(self):
        release = live.release(None, {"data/market-data.json": b'{"n":1}'}, "a" * 40)
        manifest = json.loads(live.git("show", f"{release}:{live.MANIFEST}"))
        self.assertEqual(manifest["dataCommit"], live.git("rev-parse", release + "^"))
        self.assertEqual(live.git("show", f"{manifest['dataCommit']}:data/market-data.json"), '{"n":1}')
        self.assertEqual(release, live.release(release, {"data/market-data.json": b'{"n":1}'}, "b" * 40))

    def test_allowlist_excludes_code_config_keys_and_traversal(self):
        for path in ["app.js", "data/core-satellite-v5.json", "data/private/key.json", "../results/x", "/results/x", "results/../../x"]:
            self.assertFalse(live.allowed(path), path)
        self.assertTrue(live.allowed("data/private/wealthsimple-holdings.enc.json"))

    def test_overlay_preserves_config_and_imports_latest_history(self):
        (self.root / "data").mkdir()
        config = self.root / "data/core-satellite-v5.json"
        config.write_text('{}')
        release = live.release(None, {"data/backtest-prices.json": b'{"history":[1,2,3]}'}, "a" * 40)
        live.overlay(release)
        self.assertTrue(config.exists())
        self.assertEqual(json.loads((self.root / "data/backtest-prices.json").read_text())["history"], [1, 2, 3])

    def test_normal_push_rejects_stale_competing_release(self):
        remote = Path(self.temp.name) / "remote.git"
        subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
        live.git("remote", "add", "origin", str(remote))
        initial = live.release(None, {"data/market-data.json": b'{}'}, "a" * 40)
        live.git("push", "origin", initial + ":refs/heads/live-data")
        first = live.release(initial, {"data/market-data.json": b'{"n":2}'}, "a" * 40)
        second = live.release(initial, {"results/health/test.json": b'{}'}, "a" * 40)
        live.git("push", "origin", first + ":refs/heads/live-data")
        with self.assertRaises(subprocess.CalledProcessError):
            live.git("push", "origin", second + ":refs/heads/live-data")
        rebased = live.release(live.latest(), {"results/health/test.json": b'{}'}, "a" * 40)
        live.git("push", "origin", rebased + ":refs/heads/live-data")
        self.assertEqual(live.git("show", rebased + ":data/market-data.json"), '{"n":2}')

    def test_invalid_json_rejected_before_commit(self):
        (self.root / "data").mkdir()
        (self.root / "data/market-data.json").write_text('{')
        with self.assertRaises(json.JSONDecodeError):
            live.collect(["data/market-data.json"])

    def test_holdings_cannot_use_automatic_publish(self):
        with self.assertRaisesRegex(ValueError, "manual"):
            live.publish_task("sync-snaptrade-holdings")

    def test_skipped_quote_publication_is_not_reported_as_updated_quotes(self):
        text = live.market_outcome({"publishStatus": "skipped", "publishReason": "reference validation failed"})
        self.assertIn("行情未替换", text)
        self.assertIn("reference validation failed", text)
        self.assertNotIn("行情已替换", text)
