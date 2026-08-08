import unittest

from research.idea_engine.shadow import false_positive, maturity, relative_return


class IdeaEngineShadowTests(unittest.TestCase):
    def test_maturity_boundaries(self):
        observations = [{"as_of": f"2026-{month:02d}-{day:02d}"} for month, day in ((5, 25), (6, 1), (6, 8), (6, 15), (6, 22), (6, 29), (7, 6), (7, 13))]
        outcomes = [{"horizons": {str(week): {"status": "matured"} for week in (1, 4, 12)}} for _ in range(4)]
        self.assertEqual(maturity(observations, outcomes)["status"], "mature")

    def test_relative_return_and_false_positive(self):
        self.assertEqual(relative_return(.1, .04), .06)
        self.assertTrue(false_positive({"status": "A", "return_12w": -.01}))


if __name__ == "__main__":
    unittest.main()
