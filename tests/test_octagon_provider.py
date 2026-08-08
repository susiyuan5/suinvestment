import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from research.idea_engine.providers.octagon_data import (
    BASE_URL,
    MODEL,
    OctagonGateway,
    OctagonProviderError,
    fetch_research_payload,
    normalize_payload,
)
from research.idea_engine.run_idea_engine import backfill_outcomes, run


AS_OF = "2026-07-01T12:00:00+00:00"


def raw_payload():
    dimensions = {
        "financial_quality": 90,
        "valuation": 90,
        "demand_catalyst": 90,
        "expectations_confirmation": 90,
        "industry_cycle": 90,
        "risk_liquidity_health": 90,
    }
    evidence = [
        {
            "source": "Apple 10-Q",
            "url": "https://www.sec.gov/example-a",
            "published_at": "2026-06-01T00:00:00+00:00",
            "lineage_id": "aapl-10q",
            "first_party": True,
            "supports": ["financial_quality"],
            "confidence": 0.9,
            "summary": "Reported financial evidence",
        },
        {
            "source": "Apple earnings call",
            "url": "https://www.apple.com/example-b",
            "published_at": "2026-06-02T00:00:00+00:00",
            "lineage_id": "aapl-call",
            "first_party": True,
            "supports": ["demand_catalyst"],
            "confidence": 0.8,
            "summary": "Observable demand evidence",
        },
    ]
    return {
        "universe_rows": [
            {"ticker": "AAPL", "exchange": "NASDAQ", "asset_type": "stock", "is_us_listed": True, "market_cap_usd": 3e12, "average_dollar_volume_20d_usd": 1e9},
            {"ticker": "EVIL", "exchange": "NASDAQ", "asset_type": "stock", "is_us_listed": True, "market_cap_usd": 3e12, "average_dollar_volume_20d_usd": 1e9},
        ],
        "candidates": [
            {"ticker": "AAPL", "dimensions": dimensions, "method_scores": {"anthropic_screen": 80, "serenity_alpha": 85, "juglar_cycle": 75}, "juglar": {"not_applicable": False}, "evidence": evidence, "what_makes_investable": ["财务验证"], "what_kills_thesis": ["需求反转"]},
            {"ticker": "EVIL", "dimensions": dimensions, "evidence": evidence},
        ],
    }


class FakeCompletions:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        message = SimpleNamespace(content=json.dumps(self.payload), annotations=[])
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class FakeClient:
    def __init__(self, payload):
        self.chat = SimpleNamespace(completions=FakeCompletions(payload))


class OctagonProviderTests(unittest.TestCase):
    def test_gateway_uses_audited_base_url_and_json_mode(self):
        captured = {}

        def factory(**kwargs):
            captured.update(kwargs)
            return FakeClient(raw_payload())

        gateway = OctagonGateway("secret-value", client_factory=factory)
        payload, _ = gateway.query_json("research prompt")
        self.assertIn("universe_rows", payload)
        self.assertEqual(captured["base_url"], BASE_URL)
        call = gateway.client.chat.completions.calls[0]
        self.assertEqual(call["model"], MODEL)
        self.assertEqual(call["response_format"], {"type": "json_object"})

    def test_empty_key_is_rejected_before_network(self):
        with self.assertRaises(OctagonProviderError):
            OctagonGateway("")

    def test_normalization_rejects_symbols_outside_requested_universe(self):
        payload = normalize_payload(raw_payload(), [], symbols=["AAPL"], as_of=AS_OF)
        self.assertEqual([row["ticker"] for row in payload["universe_rows"]], ["AAPL"])
        self.assertEqual([row["ticker"] for row in payload["candidates"]], ["AAPL"])
        self.assertEqual(len(payload["candidates"][0]["evidence"]), 2)
        self.assertIn("single_provider_score_dependency", payload["candidates"][0]["gates_failed"])

    def test_undated_and_future_evidence_are_not_accepted(self):
        raw = raw_payload()
        raw["candidates"][0]["evidence"][0].pop("published_at")
        raw["candidates"][0]["evidence"][1]["published_at"] = "2026-07-02T00:00:00+00:00"
        payload = normalize_payload(raw, [], symbols=["AAPL"], as_of=AS_OF)
        self.assertEqual(payload["candidates"][0]["evidence"], [])

    def test_provider_payload_runs_arbitration_and_appends_shadow(self):
        normalized = normalize_payload(raw_payload(), [], symbols=["AAPL"], as_of=AS_OF)
        normalized["provider"] = "octagon"

        def provider(_symbols, *, as_of):
            return {**normalized, "as_of": as_of}

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            first = run(None, output, AS_OF, provider_fetcher=provider)
            second = run(None, output, "2026-07-08T12:00:00+00:00", provider_fetcher=provider)
            self.assertEqual(first["status"], "ready")
            self.assertEqual(first["candidates"][0]["status"], "B")
            observations = json.loads((output / "shadow" / "observations.json").read_text(encoding="utf-8"))["observations"]
            self.assertEqual(len(observations), 2)
            self.assertEqual(second["candidates"][0]["ticker"], "AAPL")

    def test_shadow_outcomes_backfill_relative_qqq_at_all_horizons(self):
        dates = [f"2026-0{month}-{day:02d}" for month, day in ((4, 1), (4, 8), (4, 15), (4, 22), (4, 29), (5, 6), (5, 13), (5, 20), (5, 27), (6, 3), (6, 10), (6, 17), (6, 24))]
        prices = {
            "symbols": {
                "AAPL": {"rows": [{"date": day, "close": 100 + index * 2} for index, day in enumerate(dates)]},
                "QQQ": {"rows": [{"date": day, "close": 100 + index} for index, day in enumerate(dates)]},
            }
        }
        observations = [{"as_of": "2026-04-01T12:00:00+00:00", "input_hash": "hash", "candidates": [{"ticker": "AAPL", "status": "B"}]}]
        outcome = backfill_outcomes(observations, prices)[0]
        self.assertTrue(all(outcome["horizons"][str(week)]["status"] == "matured" for week in (1, 4, 12)))
        self.assertGreater(outcome["horizons"]["12"]["relative_return"], 0)


if __name__ == "__main__":
    unittest.main()
