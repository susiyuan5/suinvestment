import unittest
from datetime import datetime, timezone, timedelta

from research.idea_engine.contracts import empty_candidate, validate_candidate, validate_as_of
from research.idea_engine.evidence import deduplicate_evidence, make_evidence


class IdeaEngineContractsTests(unittest.TestCase):
    def test_candidate_contract_is_research_only(self):
        candidate = empty_candidate("AAA", "2026-08-08T00:00:00+00:00")
        self.assertIs(validate_candidate(candidate), candidate)

    def test_duplicate_lineage_counts_once(self):
        common = dict(source="SEC", url="https://example.test", published_at="2026-08-01T00:00:00+00:00", retrieved_at="2026-08-08T00:00:00+00:00", as_of="2026-08-08T00:00:00+00:00", lineage_id="filing-1", freshness="fresh", first_party=True, supports=["quality"], missing_fields=[])
        rows = [make_evidence(**common, content="old", confidence=.5), make_evidence(**common, content="new", confidence=.9)]
        self.assertEqual(len(deduplicate_evidence(rows)), 1)
        self.assertEqual(deduplicate_evidence(rows)[0]["confidence"], .9)

    def test_future_as_of_rejected(self):
        with self.assertRaises(ValueError):
            validate_as_of((datetime.now(timezone.utc) + timedelta(days=1)).isoformat())


if __name__ == "__main__":
    unittest.main()
