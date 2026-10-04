import math
import unittest
from dataclasses import FrozenInstanceError
from datetime import date, timedelta

from research.take_profit_indicator import (
    TakeProfitParameters,
    new_position,
    normalize_adjusted_bars,
    update_take_profit,
    wilder_atr,
)


def bar(index, open_price, high, low, close):
    return {
        "date": (date(2020, 1, 1) + timedelta(days=index)).isoformat(),
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
    }


class TakeProfitIndicatorTests(unittest.TestCase):
    def test_no_signal_before_both_activation_requirements(self):
        # 5% is binding for a low ATR, 2*entry ATR for a high ATR.
        for entry_atr, near, exact in ((1, 104.99, 105), (4, 107.99, 108)):
            with self.subTest(entry_atr=entry_atr):
                state = update_take_profit(new_position(100, entry_atr), near, 1)
                self.assertFalse(state.active)
                self.assertIsNone(state.line)
                self.assertIsNone(state.score)
                fallen = update_take_profit(state, 60, 20)
                self.assertFalse(fallen.signal)
                state = update_take_profit(fallen, exact, 1)
                self.assertTrue(state.active)

    def test_activation_is_latched_and_threshold_uses_entry_atr(self):
        state = update_take_profit(new_position(100, 2), 110, 2)
        self.assertEqual(state.line, 105)
        state = update_take_profit(state, 107, 10)
        self.assertTrue(state.active)
        self.assertEqual(state.line, 105)
        self.assertFalse(state.signal)

    def test_line_never_falls_when_atr_expands(self):
        state = update_take_profit(new_position(100, 1), 120, 1)
        self.assertEqual(state.line, 117)
        for close, atr in ((119, 4), (125, 10), (121, 50)):
            previous_line = state.line
            state = update_take_profit(state, close, atr)
            self.assertGreaterEqual(state.line, previous_line)
        self.assertEqual(state.line, 117)

    def test_new_high_and_smaller_atr_can_raise_line(self):
        state = update_take_profit(new_position(100, 1), 120, 4)
        self.assertEqual(state.line, 110)
        state = update_take_profit(state, 125, 2)
        self.assertEqual(state.line, 119)
        state = update_take_profit(state, 123, 1)
        self.assertEqual(state.line, 122)

    def test_exact_threshold_and_gap_below_threshold_trigger(self):
        state = update_take_profit(new_position(100, 1), 120, 1)
        exact = update_take_profit(state, 117, 5)
        self.assertTrue(exact.signal)
        self.assertEqual(exact.score, 100)
        gap = update_take_profit(state, 90, 15)
        self.assertTrue(gap.signal)
        self.assertEqual(gap.line, 117)
        self.assertEqual(gap.score, 100)
        # A signal above entry is not a guaranteed profitable execution.
        self.assertLess(90 / gap.entry_price - 1, 0)

    def test_score_is_drawdown_to_line_and_has_no_probability_meaning(self):
        state = update_take_profit(new_position(100, 1), 120, 2)
        self.assertEqual(state.line, 114)
        self.assertEqual(state.score, 0)
        state = update_take_profit(state, 117, 2)
        self.assertEqual(state.score, 50)
        state = update_take_profit(state, 80, 2)
        self.assertEqual(state.score, 100)

    def test_reset_creates_independent_new_position_and_parameters_are_frozen(self):
        first = update_take_profit(new_position(100, 2), 120, 1)
        second = new_position(150, 3)
        self.assertTrue(first.active)
        self.assertEqual(second.peak_close, 150)
        self.assertFalse(second.active)
        self.assertIsNone(second.line)
        with self.assertRaises(FrozenInstanceError):
            second.parameters.atr_multiple = 9
        with self.assertRaises(FrozenInstanceError):
            second.peak_close = 200

    def test_computation_is_causal_under_prefixes(self):
        bars = [bar(i, 100 + i, 103 + i, 99 + i, 102 + i) for i in range(50)]
        full = wilder_atr(bars)
        for length in range(1, len(bars) + 1):
            self.assertEqual(wilder_atr(bars[:length]), full[:length])
        closes = [102, 106, 113, 110, 120, 116, 112]
        states = []
        state = new_position(100, 2)
        for close in closes:
            state = update_take_profit(state, close, 2)
            states.append(state)
        for length in range(1, len(closes) + 1):
            prefix_state = new_position(100, 2)
            for close in closes[:length]:
                prefix_state = update_take_profit(prefix_state, close, 2)
            self.assertEqual(prefix_state, states[length - 1])

    def test_wilder_atr_initial_seed_and_recursion_independent_arithmetic(self):
        # Prior close 100: TR1=4, TR2=8, TR3=14; seed=(4+8+14)/3.
        bars = [bar(0, 100, 102, 98, 100), bar(1, 106, 108, 104, 106), bar(2, 94, 96, 92, 94), bar(3, 95, 99, 93, 98)]
        result = wilder_atr(bars, period=3)
        self.assertEqual(result[:2], [None, None])
        self.assertAlmostEqual(result[2], 26 / 3)
        self.assertAlmostEqual(result[3], ((26 / 3) * 2 + 6) / 3)
        default_bars = [bar(i, 100, 102, 98, 100) for i in range(14)] + [bar(14, 105, 107, 103, 105)]
        default = wilder_atr(default_bars)
        self.assertEqual(default[:13], [None] * 13)
        self.assertEqual(default[13], 4)
        self.assertAlmostEqual(default[14], (4 * 13 + 7) / 14)

    def test_split_adjustment_does_not_create_false_true_range(self):
        pre_split = {**bar(0, 200, 204, 196, 200), "adjusted": 100}
        post_split = {**bar(1, 100, 102, 98, 100), "adjusted": 100}
        normalized = normalize_adjusted_bars([pre_split, post_split])
        self.assertEqual(normalized[0], normalized[1] | {"date": normalized[0]["date"]})
        self.assertEqual(wilder_atr(normalized, period=1), [4, 4])
        self.assertEqual(wilder_atr([bar(0, 200, 204, 196, 200), bar(1, 100, 102, 98, 100)], period=1), [8, 102])

    def test_full_adjusted_fields_take_precedence(self):
        row = {"date": "2020-01-01", "adjusted_open": 100, "adjusted_high": 102, "adjusted_low": 98, "adjusted_close": 101, "open": 200, "high": 204, "low": 196, "close": 202, "adjusted": 101}
        self.assertEqual(normalize_adjusted_bars([row])[0], bar(0, 100, 102, 98, 101))

    def test_adjusted_close_alias_agrees_or_is_rejected(self):
        raw = bar(0, 200, 204, 196, 200)
        expected = bar(0, 100, 102, 98, 100)
        for aliases in ({"adjusted": 100}, {"adjusted_close": 100}, {"adjusted": 100, "adjusted_close": 100}):
            self.assertEqual(normalize_adjusted_bars([raw | aliases])[0], expected)
        with self.assertRaises(ValueError):
            normalize_adjusted_bars([raw | {"adjusted": 100, "adjusted_close": 99}])
        with self.assertRaises(ValueError):
            normalize_adjusted_bars([raw | {"adjusted_open": 100, "adjusted_high": 102, "adjusted_low": 98, "adjusted_close": 100, "adjusted": 99}])

    def test_partial_adjustments_and_raw_only_are_rejected(self):
        raw = bar(0, 100, 102, 98, 100)
        for invalid in (raw, raw | {"adjusted": 100, "adjusted_open": 100}, raw | {"adjusted": None}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                normalize_adjusted_bars([invalid])

    def test_bad_bar_values_and_dates_are_rejected(self):
        valid = bar(0, 100, 102, 98, 100) | {"adjusted": 100}
        bad_rows = [
            valid | {"close": math.nan}, valid | {"open": math.inf},
            valid | {"low": -1}, valid | {"high": 99},
            valid | {"open": True}, valid | {"adjusted": 0},
            valid | {"date": "20200101"}, valid | {"date": "2020-02-30"},
        ]
        for invalid in bad_rows:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                normalize_adjusted_bars([invalid])
        for rows in ([valid, valid], [valid | {"date": "2020-01-02"}, valid]):
            with self.assertRaises(ValueError):
                normalize_adjusted_bars(rows)
        with self.assertRaises(ValueError):
            wilder_atr([bar(0, 100, 99, 98, 100)])

    def test_parameter_position_and_update_validation(self):
        for name, value in (("atr_multiple", 0), ("activation_pct", -1), ("activation_atr", math.inf), ("retain_profit", 1), ("retain_profit", 0), ("retain_profit", True)):
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                TakeProfitParameters(**{name: value})
        for price, atr in ((0, 1), (100, 0), (math.nan, 2), (100, -1)):
            with self.assertRaises(ValueError):
                new_position(price, atr)
        state = new_position(100, 2)
        for close, atr in ((math.inf, 2), (100, -1), (False, 2)):
            with self.assertRaises(ValueError):
                update_take_profit(state, close, atr)
        for period in (0, -1, 2.5, True):
            with self.assertRaises(ValueError):
                wilder_atr([], period)
        self.assertEqual(wilder_atr([]), [])

    def test_dates_prevent_duplicate_or_out_of_order_completed_updates(self):
        state = new_position(100, 1, entry_date="2020-01-01")
        state = update_take_profit(state, 101, 1, date="2020-01-01")
        for invalid_date in ("2020-01-01", "2019-12-31", None):
            with self.assertRaises(ValueError):
                update_take_profit(state, 102, 1, date=invalid_date)
        state = update_take_profit(state, 106, 1, date="2020-01-02")
        self.assertTrue(state.active)


if __name__ == "__main__":
    unittest.main()
