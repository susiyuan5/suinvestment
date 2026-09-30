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

    def test_holdings_whitespace_check_ignores_overlay_csv_but_rejects_bad_snapshot(self):
        live.git("config", "core.autocrlf", "false")
        live.git("config", "core.whitespace", "blank-at-eol,blank-at-eof,space-before-tab")
        snapshot_path = "data/private/wealthsimple-holdings.enc.json"
        csv_path = "results/dca_l2/v2/trades.csv"
        for path, content in [(snapshot_path, b'{"n":1}\n'), (csv_path, b"symbol,value\n")]:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        base = live.commit_files(None, {snapshot_path: b'{"n":1}\n', csv_path: b"symbol,value\n"}, "baseline")
        live.git("update-ref", "HEAD", base)
        live.git("read-tree", base)
        (self.root / csv_path).write_bytes(b"symbol,value\r\nSPY,1\r\n")
        (self.root / snapshot_path).write_bytes(b'{"n":2}\n')
        checks = [step["run"] for step in live.TASKS["sync-snaptrade-holdings"]["commands"]
                  if step["run"].startswith("git diff --check")]
        self.assertEqual(len(checks), 1)
        check = checks[0].split()
        self.assertEqual(subprocess.run(check, cwd=self.root, capture_output=True).returncode, 0)
        self.assertNotEqual(subprocess.run(["git", "diff", "--check"], cwd=self.root, capture_output=True).returncode, 0)
        (self.root / snapshot_path).write_bytes(b'{"n":2} \n')
        self.assertNotEqual(subprocess.run(check, cwd=self.root, capture_output=True).returncode, 0)

    def test_skipped_quote_publication_is_not_reported_as_updated_quotes(self):
        text = live.market_outcome({"publishStatus": "skipped", "publishReason": "reference validation failed"})
        self.assertIn("行情未替换", text)
        self.assertIn("reference validation failed", text)
        self.assertNotIn("行情已替换", text)
