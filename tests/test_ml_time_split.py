import unittest

import pandas as pd

from research.ml_sandbox import time_split
from research.v2_ml_validation import inner_walk_forward_windows


class MLTimeSplitTests(unittest.TestCase):
    def test_maximum_target_horizon_is_purged_and_embargoed(self):
        dates = pd.date_range("2024-01-05", periods=40, freq="W-FRI")
        frame = pd.DataFrame({"date": dates.repeat(2), "ticker": ["AAA", "BBB"] * len(dates)})
        train, test, info = time_split(frame, purge_weeks=12, embargo_weeks=1)
        train_end = train["date"].max()
        test_start = test["date"].min()
        self.assertGreaterEqual((test_start - train_end).days, 13 * 7)
        self.assertEqual(info["purge_weeks"], 12)
        self.assertEqual(info["embargo_weeks"], 1)

    def test_inner_windows_never_touch_purged_or_embargoed_dates(self):
        dates = list(pd.date_range("2023-01-06", periods=120, freq="W-FRI"))
        windows = inner_walk_forward_windows(dates)
        self.assertTrue(windows)
        for window in windows:
            self.assertLess(max(window["train_dates"]), window["boundary"] - pd.Timedelta(weeks=12))
            self.assertGreaterEqual(min(window["validation_dates"]), window["boundary"] + pd.Timedelta(weeks=1))
