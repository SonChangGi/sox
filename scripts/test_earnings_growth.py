#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import unittest

from earnings_growth import EARNINGS_GROWTH_METHOD, earnings_growth


def observations(previous: object, current: object) -> list[dict[str, object]]:
    return [
        {"asOfDate": "2025-06-30", "raw": previous, "periodType": "3M", "currencyCode": "USD"},
        {"asOfDate": "2025-09-30", "raw": 999},
        {"asOfDate": "2025-12-31", "raw": 999},
        {"asOfDate": "2026-03-31", "raw": 999},
        {"asOfDate": "2026-06-30", "raw": current, "periodType": "3M", "currencyCode": "USD"},
    ]


class EarningsGrowthTests(unittest.TestCase):
    def test_positive_base_preserves_conventional_yoy_exactly(self) -> None:
        for previous in (0.01, 1, 40, 1_000_000):
            for current in (-15, 0, 0.25, 4, 100_000_000):
                with self.subTest(previous=previous, current=current):
                    result = earnings_growth(observations(previous, current))
                    expected = current / previous - 1
                    self.assertEqual(result["yoy"], expected)
                    self.assertEqual(result["changeSignal"], expected)

    def test_negative_base_states_and_direction(self) -> None:
        cases = [
            (-2, "loss_widening", -1),
            (-1, "unchanged_loss", 0),
            (-0.5, "loss_narrowing", 0.5),
            (0, "loss_to_breakeven", 1),
            (0.5, "turnaround", 1.5),
            (2, "turnaround", 3),
        ]
        signals = []
        for current, state, signal in cases:
            with self.subTest(current=current):
                result = earnings_growth(observations(-1, current))
                self.assertIsNone(result["yoy"])
                self.assertEqual(result["state"], state)
                self.assertEqual(result["changeSignal"], signal)
                signals.append(result["changeSignal"])
        self.assertEqual(signals, sorted(signals))
        self.assertEqual(len(signals), len(set(signals)))

    def test_positive_base_states(self) -> None:
        for current, state in [
            (-1, "profit_to_loss"), (0, "profit_to_breakeven"),
            (0.5, "profit_decline"), (1, "unchanged_profit"), (2, "profit_growth"),
        ]:
            with self.subTest(current=current):
                self.assertEqual(earnings_growth(observations(1, current))["state"], state)

    def test_zero_base_has_direction_but_no_comparable_ratio(self) -> None:
        for current, state in [(-1, "loss_from_zero"), (0, "unchanged_zero"), (1, "profit_from_zero")]:
            with self.subTest(current=current):
                result = earnings_growth(observations(0, current))
                self.assertEqual(result["state"], state)
                self.assertIsNone(result["yoy"])
                self.assertIsNone(result["changeSignal"])
                self.assertEqual(result["reason"], "zero_prior_year_base")

    def test_missing_and_nonfinite_values_never_enter_ratios(self) -> None:
        for invalid in (None, "", "invalid", True, float("nan"), float("inf"), -float("inf")):
            for previous, current in ((invalid, 1), (1, invalid)):
                with self.subTest(previous=previous, current=current):
                    result = earnings_growth(observations(previous, current))
                    self.assertEqual(result["state"], "unavailable")
                    self.assertIsNone(result["yoy"])
                    self.assertIsNone(result["changeSignal"])
                    json.dumps(result, allow_nan=False)

    def test_empty_and_insufficient_history_retain_current_provenance(self) -> None:
        self.assertEqual(earnings_growth(None)["state"], "unavailable")
        self.assertEqual(earnings_growth([])["reason"], "insufficient_history")
        result = earnings_growth([{"asOfDate": "2026-06-30", "raw": 5}])
        self.assertEqual(result["current"], 5)
        self.assertEqual(result["currentDate"], "2026-06-30")
        self.assertIsNone(result["previous"])

    def test_provenance_identifies_values_periods_and_method(self) -> None:
        result = earnings_growth(observations(-0.3, 0.5))
        self.assertEqual(result["current"], 0.5)
        self.assertEqual(result["previous"], -0.3)
        self.assertEqual(result["currentDate"], "2026-06-30")
        self.assertEqual(result["previousDate"], "2025-06-30")
        self.assertEqual(result["methodology"], EARNINGS_GROWTH_METHOD)

    def test_missing_intermediate_quarters_still_use_prior_year_pair(self) -> None:
        complete = observations(2, 3)
        sparse = [complete[0], complete[-1]]
        self.assertEqual(earnings_growth(sparse), earnings_growth(complete))

    def test_fifth_last_entry_is_not_used_when_its_date_is_wrong(self) -> None:
        entries = observations(2, 3)
        entries[0]["asOfDate"] = "2025-03-31"
        result = earnings_growth(entries)
        self.assertIsNone(result["changeSignal"])
        self.assertEqual(result["reason"], "missing_prior_year_quarter")

    def test_fiscal_52_and_53_week_comparisons(self) -> None:
        for previous_date in ("2025-06-28", "2025-06-21"):
            entries = observations(2, 3)
            entries[0]["asOfDate"] = previous_date
            entries[-1]["asOfDate"] = "2026-06-27"
            self.assertEqual(earnings_growth(entries)["yoy"], 0.5)

    def test_bad_dates_and_mismatched_reporting_basis_are_unavailable(self) -> None:
        entries = observations(2, 3)
        entries[-1]["asOfDate"] = "invalid"
        self.assertEqual(earnings_growth(entries)["reason"], "invalid_current_date")
        for field, incompatible in (("currencyCode", "EUR"), ("periodType", "12M")):
            with self.subTest(field=field):
                entries = observations(2, 3)
                entries[-1][field] = incompatible
                result = earnings_growth(entries)
                self.assertEqual(result["state"], "unavailable")
                self.assertEqual(result["reason"], f"mismatched_{field}")

    def test_finite_extreme_values_do_not_overflow_into_json(self) -> None:
        for previous in (1e-308, -1e-308):
            result = earnings_growth(observations(previous, 1e308))
            self.assertIsNone(result["changeSignal"])
            self.assertIsNone(result["yoy"])
            self.assertEqual(result["reason"], "nonfinite_change_signal")
            json.dumps(result, allow_nan=False)
        # The subtraction form would overflow for this finite, valid ratio.
        result = earnings_growth(observations(-1e308, 1e308))
        self.assertEqual(result["changeSignal"], 2)
        self.assertTrue(math.isfinite(result["changeSignal"]))


if __name__ == "__main__":
    unittest.main()
