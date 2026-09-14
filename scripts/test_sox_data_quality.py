#!/usr/bin/env python3
from __future__ import annotations

import copy
import unittest

from sox_data_quality import collect_data_quality_failures


def healthy_rows(data_as_of: str = "2026-07-08") -> list[dict]:
    """Complete legacy-shaped rows, built entirely in memory."""
    return [
        {
            "ticker": f"TEST{index:02d}",
            "lastTradeDate": data_as_of,
            "price": 100.0,
            "marketCap": 1000000000.0,
            "dataQuality": {"ok": True, "failures": [], "pricePoints": 300},
            "metrics": {
                "quarterlyRevenueLatest": 1000000.0,
                "quarterlyRevenueDate": "2026-03-31",
                "quarterlyRevenueYoY": 0.2,
                "quarterlyEpsLatest": 1.0,
                "quarterlyEpsDate": "2026-03-31",
                "quarterlyEpsYoY": 0.2,
                "quarterlyNetIncomeLatest": 100000.0,
                "quarterlyNetIncomeDate": "2026-03-31",
                "quarterlyNetIncomeYoY": 0.2,
                "trailingRevenue": 4000000.0,
                "trailingNetIncome": 400000.0,
                "netMargin": 0.1,
                "trailingPe": 20.0,
            },
        }
        for index in range(30)
    ]


def nonpositive_growth(*, current: float = 1.0, previous: float = -1.0, state: str = "turnaround") -> dict:
    return {
        "yoy": None,
        "state": state,
        "changeSignal": current / abs(previous) + 1 if previous < 0 else None,
        "current": current,
        "previous": previous,
        "currentDate": "2026-03-31",
        "previousDate": "2025-03-31",
        "methodology": "absolute_prior_base_change_v1",
        "reason": None if previous < 0 else "zero_prior_year_base",
    }


class DataQualityTests(unittest.TestCase):
    def failures(self, rows: list[dict], **kwargs) -> list[str]:
        return collect_data_quality_failures(rows, {"recordCount": 30}, **kwargs)

    def test_complete_legacy_rows_pass_without_mutation(self) -> None:
        rows = healthy_rows()
        original = copy.deepcopy(rows)
        self.assertEqual(self.failures(rows, data_as_of="2026-07-08"), [])
        self.assertEqual(rows, original)

    def test_row_provider_failures_are_not_hidden_by_ok_flag(self) -> None:
        rows = healthy_rows()
        rows[0]["dataQuality"]["failures"] = ["fundamentals: provider unavailable"]
        self.assertIn("TEST00: fundamentals: provider unavailable", self.failures(rows))
        rows[0]["dataQuality"].update(ok=False, failures=[])
        self.assertIn("TEST00: dataQuality.ok is not true", self.failures(rows))

    def test_invalid_or_missing_price_and_market_cap_fail(self) -> None:
        for key in ("price", "marketCap"):
            for value in (None, 0, -1, float("nan"), float("inf"), "100", True, 10**1000):
                with self.subTest(key=key, value=value):
                    rows = healthy_rows()
                    rows[0][key] = value
                    self.assertIn(f"TEST00: missing or invalid {key}", self.failures(rows))

    def test_invalid_row_date_and_mixed_dates_fail(self) -> None:
        for value in (None, "2026-02-30", "20260708", "2026-07-08T16:00:00Z"):
            with self.subTest(value=value):
                rows = healthy_rows()
                rows[0]["lastTradeDate"] = value
                self.assertIn("TEST00: missing or invalid lastTradeDate", self.failures(rows))
        rows = healthy_rows()
        rows[0]["lastTradeDate"] = "2026-07-07"
        self.assertTrue(any("Mixed lastTradeDate" in item for item in self.failures(rows)))

    def test_stored_aggregate_date_must_match_every_row(self) -> None:
        failures = self.failures(healthy_rows(), data_as_of="2026-07-09")
        self.assertEqual(sum("differs from dataAsOf" in item for item in failures), 30)
        self.assertIn("Missing or invalid aggregate dataAsOf", self.failures(healthy_rows(), data_as_of="invalid"))

    def test_missing_duplicate_and_wrong_count_constituents_fail(self) -> None:
        self.assertTrue(collect_data_quality_failures(None, {"recordCount": 30}))
        self.assertTrue(self.failures([]))
        rows = healthy_rows()
        self.assertIn("Constituent count differs from Nasdaq recordCount: 29 != 30", self.failures(rows[:-1]))
        rows[1]["ticker"] = rows[0]["ticker"].lower()
        self.assertIn("TEST00: duplicate ticker", self.failures(rows))
        rows[1]["ticker"] = None
        self.assertIn("Constituent 2: missing ticker", self.failures(rows))
        self.assertTrue(collect_data_quality_failures(healthy_rows(), {}))

    def test_missing_fundamentals_fail_even_without_provider_exception(self) -> None:
        for key in ("quarterlyRevenueLatest", "quarterlyEpsDate", "quarterlyNetIncomeYoY", "netMargin"):
            with self.subTest(key=key):
                rows = healthy_rows()
                del rows[0]["metrics"][key]
                self.assertIn(f"TEST00: missing or invalid {key}", self.failures(rows))

    def test_legitimate_nonpositive_base_is_not_a_provider_failure(self) -> None:
        for prefix in ("quarterlyEps", "quarterlyNetIncome"):
            for previous, current, state in ((-1.0, 1.0, "turnaround"), (-2.0, -1.0, "loss_narrowing"), (0.0, 1.0, "profit_from_zero")):
                with self.subTest(prefix=prefix, state=state):
                    rows = healthy_rows()
                    metrics = rows[0]["metrics"]
                    metrics[f"{prefix}Latest"] = current
                    metrics[f"{prefix}YoY"] = None
                    metrics[f"{prefix}Growth"] = nonpositive_growth(current=current, previous=previous, state=state)
                    self.assertEqual(self.failures(rows), [])

    def test_unexplained_or_invalid_null_growth_is_not_accepted(self) -> None:
        for key, value in (("previous", 1.0), ("previous", None), ("current", None), ("state", "unavailable"), ("state", []), ("currentDate", "2026-04-30"), ("previousDate", "2026-03-01"), ("methodology", "unknown")):
            with self.subTest(key=key, value=value):
                rows = healthy_rows()
                metrics = rows[0]["metrics"]
                metrics["quarterlyEpsYoY"] = None
                metrics["quarterlyEpsGrowth"] = nonpositive_growth()
                metrics["quarterlyEpsGrowth"][key] = value
                self.assertIn("TEST00: missing or invalid quarterlyEpsYoY", self.failures(rows))
        rows = healthy_rows()
        rows[0]["metrics"]["quarterlyEpsYoY"] = None
        self.assertIn("TEST00: missing or invalid quarterlyEpsYoY", self.failures(rows))

    def test_missing_pe_is_valid_for_loss_making_company(self) -> None:
        rows = healthy_rows()
        rows[0]["metrics"]["trailingPe"] = None
        self.assertEqual(self.failures(rows), [])

    def test_nonpositive_context_cannot_hide_missing_signal_or_error(self) -> None:
        for key, value in (("changeSignal", None), ("changeSignal", float("inf")), ("changeSignal", -2.0), ("reason", "nonfinite_change_signal"), ("state", "loss_widening")):
            with self.subTest(key=key, value=value):
                rows = healthy_rows()
                metrics = rows[0]["metrics"]
                metrics["quarterlyEpsYoY"] = None
                metrics["quarterlyEpsGrowth"] = nonpositive_growth()
                metrics["quarterlyEpsGrowth"][key] = value
                self.assertIn("TEST00: missing or invalid quarterlyEpsGrowth", self.failures(rows))
        from earnings_growth import earnings_growth
        rows = healthy_rows()
        growth = earnings_growth([
            {"asOfDate": "2025-03-31", "raw": -1e-308},
            {"asOfDate": "2026-03-31", "raw": 1e308},
        ])
        rows[0]["metrics"].update(quarterlyEpsLatest=1e308, quarterlyEpsYoY=None, quarterlyEpsGrowth=growth)
        self.assertIn("TEST00: missing or invalid quarterlyEpsGrowth", self.failures(rows))

    def test_zero_base_requires_null_signal_reason_and_matching_direction(self) -> None:
        for key, value in (("changeSignal", 1.0), ("reason", None), ("state", "loss_from_zero")):
            with self.subTest(key=key, value=value):
                rows = healthy_rows()
                metrics = rows[0]["metrics"]
                metrics["quarterlyEpsYoY"] = None
                metrics["quarterlyEpsGrowth"] = nonpositive_growth(previous=0, state="profit_from_zero")
                metrics["quarterlyEpsGrowth"][key] = value
                self.assertIn("TEST00: missing or invalid quarterlyEpsGrowth", self.failures(rows))

    def test_finite_legacy_yoy_cannot_hide_malformed_provided_growth(self) -> None:
        from earnings_growth import earnings_growth
        rows = healthy_rows()
        metrics = rows[0]["metrics"]
        growth = earnings_growth([
            {"asOfDate": "2025-03-31", "raw": 0.5},
            {"asOfDate": "2026-03-31", "raw": 1.0},
        ])
        metrics.update(quarterlyEpsYoY=1.0, quarterlyEpsGrowth=growth)
        self.assertEqual(self.failures(rows), [])
        for malformed in (None, {}, {**growth, "state": "profit_to_loss"}, {**growth, "changeSignal": None}, {**growth, "yoy": 2.0}):
            with self.subTest(growth=malformed):
                metrics["quarterlyEpsGrowth"] = malformed
                self.assertIn("TEST00: missing or invalid quarterlyEpsGrowth", self.failures(rows))
        metrics["quarterlyEpsGrowth"] = growth
        metrics["quarterlyEpsYoY"] = 2.0
        self.assertIn("TEST00: missing or invalid quarterlyEpsGrowth", self.failures(rows))
        metrics["quarterlyEpsYoY"] = 1.0
        for key in ("state", "yoy", "changeSignal", "reason"):
            with self.subTest(missing=key):
                metrics["quarterlyEpsGrowth"] = {name: value for name, value in growth.items() if name != key}
                self.assertIn("TEST00: missing or invalid quarterlyEpsGrowth", self.failures(rows))


if __name__ == "__main__":
    unittest.main()
