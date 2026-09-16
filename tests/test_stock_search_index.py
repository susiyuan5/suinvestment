import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]


class StockSearchIndexTests(unittest.TestCase):
    def test_published_index_covers_the_research_universe(self):
        universe = json.loads((ROOT / "data/research-universe-sector-balanced-80.json").read_text(encoding="utf-8"))["research_universe_symbols"]
        payload = json.loads((ROOT / "data/us-equity-search-index.json").read_text(encoding="utf-8"))
        rows = payload["symbols"]
        self.assertEqual(payload["formatVersion"], 1)
        symbols = {row["symbol"] for row in rows}
        self.assertTrue(set(universe).issubset(symbols))
        self.assertIn("JOBY", symbols)
        for row in rows:
            self.assertTrue(row["name"])
            self.assertTrue(row["exchange"])
            self.assertEqual(row["instrumentType"], "EQUITY")
            self.assertEqual(row["currency"], "USD")
            self.assertGreater(float(row["price"]), 0)
            self.assertTrue(row["quoteTimestamp"])


if __name__ == "__main__":
    unittest.main()
