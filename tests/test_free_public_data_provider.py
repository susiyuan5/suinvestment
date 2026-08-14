import json
import unittest
from datetime import date, timedelta
from pathlib import Path

from research.idea_engine.arbitration import arbitrate
from research.idea_engine.providers.free_public_data import (
    _fact_series,
    fetch_research_payload,
)


AS_OF = "2026-08-01T12:00:00+00:00"
CONFIG = json.loads((Path(__file__).parents[1] / "research" / "idea_engine" / "config.v1.json").read_text(encoding="utf-8"))


def fact(val, start, end, filed, *, form="10-Q", frame=""):
    row = {"val": val, "start": start, "end": end, "filed": filed, "form": form, "accn": f"{filed}-test"}
    if frame:
        row["frame"] = frame
    return row


def companyfacts():
    return {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
                    fact(100_000_000, "2025-01-01", "2025-03-31", "2025-05-01", frame="CY2025Q1"),
                    fact(125_000_000, "2026-01-01", "2026-03-31", "2026-05-01", frame="CY2026Q1"),
                ]}},
                "OperatingIncomeLoss": {"units": {"USD": [
                    fact(10_000_000, "2025-01-01", "2025-03-31", "2025-05-01", frame="CY2025Q1"),
                    fact(20_000_000, "2026-01-01", "2026-03-31", "2026-05-01", frame="CY2026Q1"),
                ]}},
                "NetIncomeLoss": {"units": {"USD": [
                    fact(40_000_000_000, "2025-01-01", "2025-12-31", "2026-02-01", form="10-K", frame="CY2025"),
                ]}},
                "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [
                    fact(50_000_000_000, "2025-01-01", "2025-12-31", "2026-02-01", form="10-K", frame="CY2025"),
                ]}},
                "Assets": {"units": {"USD": [fact(300_000_000_000, "", "2026-03-31", "2026-05-01")] }},
                "Liabilities": {"units": {"USD": [fact(120_000_000_000, "", "2026-03-31", "2026-05-01")] }},
            },
            "dei": {
                "EntityCommonStockSharesOutstanding": {"units": {"shares": [
                    fact(1_000_000_000, "", "2026-03-31", "2026-05-01"),
                ]}},
            },
        }
    }


def price_payload(symbol, slope):
    start = date(2025, 9, 1)
    rows = [
        {"date": (start + timedelta(days=index)).isoformat(), "close": 100 + index * slope, "volume": 10_000_000}
        for index in range(300)
    ]
    return {"symbol": symbol, "url": f"https://query1.finance.yahoo.com/chart/{symbol}", "meta": {}, "rows": rows}


class FakeSec:
    def ticker_map(self):
        return {"AAPL": {"ticker": "AAPL", "cik_str": 320193}}

    def submissions(self, _cik):
        return {
            "tickers": ["AAPL"], "exchanges": ["Nasdaq"],
            "filings": {"recent": {
                "form": ["10-Q"], "filingDate": ["2026-05-01"],
                "accessionNumber": ["0000320193-26-000001"], "primaryDocument": ["aapl-20260331.htm"],
            }},
        }

    def companyfacts(self, _cik):
        return companyfacts()


class FakePrices:
    def history(self, symbol, *, as_of):
        self.as_of = as_of
        return price_payload(symbol, 0.2 if symbol == "QQQ" else 0.3)


class FreePublicDataProviderTests(unittest.TestCase):
    def test_default_provider_needs_no_paid_api_key_and_is_research_only(self):
        payload = fetch_research_payload(["AAPL"], as_of=AS_OF, sec_client=FakeSec(), price_client=FakePrices())
        self.assertEqual(payload["provider"], "free_public_data")
        self.assertTrue(payload["research_only"])
        self.assertEqual(payload["universe_rows"][0]["exchange"], "NASDAQ")
        self.assertGreater(payload["universe_rows"][0]["market_cap_usd"], 2_000_000_000)
        candidate = payload["candidates"][0]
        self.assertGreaterEqual(len(candidate["evidence"]), 3)
        self.assertIn("free_source_scope_limited", candidate["gates_failed"])
        self.assertIn("no_consensus_estimates", candidate["gates_failed"])

    def test_free_source_scope_can_never_produce_a_grade(self):
        payload = fetch_research_payload(["AAPL"], as_of=AS_OF, sec_client=FakeSec(), price_client=FakePrices())
        candidate = arbitrate(payload["candidates"][0], CONFIG, as_of=AS_OF)
        self.assertNotEqual(candidate["status"], "A")
        self.assertTrue(candidate["research_only"])

    def test_companyfacts_newer_than_as_of_are_forbidden(self):
        facts = companyfacts()
        facts["facts"]["us-gaap"]["RevenueFromContractWithCustomerExcludingAssessedTax"]["units"]["USD"].append(
            fact(999_000_000, "2026-04-01", "2026-06-30", "2026-08-02", frame="CY2026Q2")
        )
        rows = _fact_series(
            facts,
            ("RevenueFromContractWithCustomerExcludingAssessedTax",),
            as_of=date(2026, 8, 1),
        )
        self.assertNotIn(999_000_000, [row["val"] for row in rows])

    def test_default_workflow_has_no_octagon_secret_dependency(self):
        workflow = (Path(__file__).parents[1] / ".github" / "workflows" / "update-idea-engine.yml").read_text(encoding="utf-8")
        self.assertNotIn("OCTAGON_API_KEY", workflow)
        self.assertNotIn("requirements-octagon", workflow)
        self.assertIn("--provider free", workflow)
        self.assertIn("research/results/v3_1/idea-engine", workflow)
        self.assertIn("gh pr ready", workflow)
        self.assertIn("--json isDraft", workflow)


if __name__ == "__main__":
    unittest.main()
