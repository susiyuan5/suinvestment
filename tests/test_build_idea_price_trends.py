import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_idea_price_trends import atomic_write_json, build_payload


class IdeaPriceTrendBuilderTests(unittest.TestCase):
    def test_builds_sorted_bounded_research_only_payload(self):
        source = {
            "generatedAt": "2026-08-01T00:00:00+00:00",
            "symbols": {
                "tsm": {
                    "rows": [
                        {"date": "2026-01-09", "close": 202},
                        {"date": "2026-01-02", "close": 200},
                        {"date": "2026-01-16", "close": 0},
                        {"date": "2026-01-23", "close": 204},
                    ]
                }
            },
        }

        payload = build_payload(source, lookback_points=2)

        self.assertEqual(payload["schema_version"], "idea-price-trends-v1")
        self.assertTrue(payload["research_only"])
        self.assertEqual(payload["symbols"]["TSM"]["as_of"], "2026-01-23")
        self.assertEqual(
            payload["symbols"]["TSM"]["points"],
            [{"date": "2026-01-09", "close": 202.0}, {"date": "2026-01-23", "close": 204.0}],
        )

    def test_rejects_missing_or_empty_histories(self):
        with self.assertRaises(ValueError):
            build_payload({"symbols": {}}, lookback_points=53)
        with self.assertRaises(ValueError):
            build_payload({"symbols": {"TSM": {"rows": [{"date": "2026-01-01", "close": 1}]}}})

    def test_atomic_writer_outputs_valid_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "nested" / "trends.json"
            atomic_write_json(target, {"schema_version": "test", "research_only": True})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["schema_version"], "test")


if __name__ == "__main__":
    unittest.main()
