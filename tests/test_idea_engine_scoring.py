import unittest

from research.idea_engine.scoring import cap_method_contribution, weighted_score


class IdeaEngineScoringTests(unittest.TestCase):
    def setUp(self):
        self.config = {"dimensions": {"a": .5, "b": .5}, "limits": {"method_max_points": 25}}

    def test_missing_dimension_does_not_redistribute(self):
        score, _ = weighted_score({"a": 100, "b": None}, self.config)
        self.assertEqual(score, 50)

    def test_method_contribution_is_capped(self):
        self.assertEqual(cap_method_contribution(99, self.config), 25)
        self.assertEqual(cap_method_contribution(-99, self.config), -25)


if __name__ == "__main__":
    unittest.main()
