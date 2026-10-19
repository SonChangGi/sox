#!/usr/bin/env python3
"""Offline regression checks for cross-sectional ranks and fiscal-period joins."""
from __future__ import annotations

import copy
import itertools
import unittest
from unittest.mock import patch

from fetch_sox_data import analyze_symbol, rank_scores, yoy


def quarter(date: str, value: float, **metadata: object) -> dict[str, object]:
    return {"asOfDate": date, "periodType": "3M", "currencyCode": "USD", "raw": value, **metadata}


class RankScoreTests(unittest.TestCase):
    def test_ties_are_invariant_to_input_order_in_both_directions(self) -> None:
        values = [("A", 3.0), ("B", 3.0), ("C", 2.0), ("D", 1.0), ("E", 1.0)]
        expected = {"A": 0.875, "B": 0.875, "C": 0.5, "D": 0.125, "E": 0.125}
        for permutation in itertools.permutations(values):
            self.assertEqual(rank_scores(dict(permutation)), expected)
            self.assertEqual(
                rank_scores(dict(permutation), high_is_good=False),
                {key: 1 - value for key, value in expected.items()},
            )

    def test_existing_untied_singleton_and_missing_behavior(self) -> None:
        self.assertEqual(rank_scores({"A": 3.0, "B": 2.0, "C": 1.0}), {"A": 1.0, "B": 0.5, "C": 0.0})
        self.assertEqual(rank_scores({"A": 7.0, "B": None}), {"A": 1.0, "B": None})
        self.assertEqual(rank_scores({"A": None, "B": float("nan"), "C": float("inf")}), {"A": None, "B": None, "C": None})
        self.assertEqual(rank_scores({}), {})

    def test_all_equal_values_receive_midrank(self) -> None:
        self.assertEqual(rank_scores({"A": 0.0, "B": 0.0, "C": 0.0}), {"A": 0.5, "B": 0.5, "C": 0.5})


class QuarterlyYoYTests(unittest.TestCase):
    def test_missing_intermediate_quarter_does_not_shift_comparison(self) -> None:
        rows = [quarter(date, value) for date, value in [
            ("2024-09-30", 100), ("2024-12-31", 120), ("2025-03-31", 130),
            ("2025-09-30", 150), ("2025-12-31", 180),
        ]]
        self.assertAlmostEqual(yoy(rows), 0.5)

    def test_missing_prior_year_quarter_is_unavailable(self) -> None:
        rows = [quarter(date, value) for date, value in [
            ("2024-09-30", 100), ("2025-03-31", 120), ("2025-06-30", 130),
            ("2025-09-30", 150), ("2025-12-31", 180),
        ]]
        self.assertIsNone(yoy(rows))

    def test_calendar_and_52_53_week_years_including_leap_day(self) -> None:
        for previous, current in [
            ("2024-12-31", "2025-12-31"), ("2023-12-31", "2024-12-31"),
            ("2024-02-29", "2025-02-28"), ("2024-09-28", "2025-09-27"),
            ("2023-12-30", "2025-01-04"),
        ]:
            with self.subTest(previous=previous, current=current):
                self.assertAlmostEqual(yoy([quarter(previous, 100), quarter(current, 120)]), 0.2)

    def test_order_does_not_matter_and_input_is_preserved(self) -> None:
        rows = [quarter("2025-12-31", 120), quarter("2024-12-31", 100), quarter("2025-06-30", 90)]
        original = copy.deepcopy(rows)
        for permutation in itertools.permutations(rows):
            self.assertAlmostEqual(yoy(list(permutation)), 0.2)
        self.assertEqual(rows, original)

    def test_duplicate_latest_or_prior_period_is_not_arbitrarily_selected(self) -> None:
        previous, current = quarter("2024-12-31", 100), quarter("2025-12-31", 120)
        for duplicate in [previous, current, quarter("2024-12-31", 90), quarter("2025-12-31", 130)]:
            with self.subTest(duplicate=duplicate):
                self.assertIsNone(yoy([previous, current, duplicate]))

    def test_multiple_nearby_prior_year_periods_are_ambiguous(self) -> None:
        self.assertIsNone(yoy([quarter("2024-12-28", 100), quarter("2024-12-31", 110), quarter("2025-12-31", 120)]))

    def test_incompatible_periods_and_currencies_are_unavailable(self) -> None:
        previous, current = quarter("2024-12-31", 100), quarter("2025-12-31", 120)
        for changes in [{"periodType": "TTM"}, {"periodType": "12M"}, {"periodType": None}, {"currencyCode": "EUR"}, {"currencyCode": None}]:
            with self.subTest(changes=changes):
                self.assertIsNone(yoy([previous, {**current, **changes}]))

    def test_missing_or_malformed_dates_are_unavailable(self) -> None:
        for date in [None, "not-a-date", "2025-02-30"]:
            self.assertIsNone(yoy([quarter("2024-12-31", 100), quarter(date, 120)]))

    def test_zero_negative_and_nonfinite_values_preserve_ratio_semantics(self) -> None:
        for previous, current, expected in [(0, 120, None), (-100, -50, -0.5), (-100, 120, -2.2), (100, 0, -1.0)]:
            actual = yoy([quarter("2024-12-31", previous), quarter("2025-12-31", current)])
            if expected is None:
                self.assertIsNone(actual)
            else:
                self.assertAlmostEqual(actual, expected)
        for value in [None, float("nan"), float("inf"), True, "bad"]:
            self.assertIsNone(yoy([quarter("2024-12-31", 100), quarter("2025-12-31", value)]))
        self.assertIsNone(yoy(None))
        self.assertIsNone(yoy([]))

    def test_analysis_uses_date_join_for_all_three_quarterly_metrics(self) -> None:
        fundamentals = {
            key: [quarter("2024-12-31", base), quarter("2025-12-31", current)]
            for key, base, current in [
                ("quarterlyTotalRevenue", 100, 150),
                ("quarterlyDilutedEPS", 2, 3),
                ("quarterlyNetIncome", 100, 150),
            ]
        }
        with patch("fetch_sox_data.fetch_chart", return_value={"meta": {}, "prices": []}), patch(
            "fetch_sox_data.fetch_fundamentals", return_value=fundamentals
        ), patch("fetch_sox_data.time.sleep"):
            result = analyze_symbol({"ticker": "TEST"})
        self.assertEqual(result["metrics"]["quarterlyRevenueYoY"], 0.5)
        self.assertEqual(result["metrics"]["quarterlyEpsYoY"], 0.5)
        self.assertEqual(result["metrics"]["quarterlyNetIncomeYoY"], 0.5)


if __name__ == "__main__":
    unittest.main()
