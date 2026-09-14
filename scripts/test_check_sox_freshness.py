#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import unittest

from check_sox_freshness import decide, latest_expected_us_session_date, us_equity_holiday_name
from test_sox_data_quality import healthy_rows, nonpositive_growth


def generated_payload(
    *, generated_at: str, data_as_of: str, status_level: str = "ok"
) -> dict[str, object]:
    return {
        "generatedAt": generated_at,
        "dataAsOf": data_as_of,
        "status": {"level": status_level},
        "index": {"constituentSource": {"recordCount": 30}},
        "constituents": healthy_rows(data_as_of),
    }


class FreshnessDecisionTests(unittest.TestCase):
    def current_payload(self) -> dict:
        return generated_payload(generated_at="2026-07-08T23:38:21Z", data_as_of="2026-07-08")

    def scheduled(self, payload: dict) -> dict[str, str]:
        return decide(payload=payload, event_name="schedule", now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC))

    def test_push_deploys_committed_json_without_collecting(self) -> None:
        result = decide(payload={}, event_name="push", now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC))
        self.assertEqual(result["should_collect"], "false")
        self.assertEqual(result["should_deploy"], "true")
        self.assertEqual(result["freshness_reason"], "push_uses_committed_generated_json")

    def test_manual_dispatch_collects_and_deploys(self) -> None:
        result = decide(payload={}, event_name="workflow_dispatch", now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC))
        self.assertEqual(result["should_collect"], "true")
        self.assertEqual(result["should_deploy"], "true")
        self.assertEqual(result["freshness_reason"], "manual_collects")

    def test_fresh_schedule_skips_collect_and_deploy(self) -> None:
        result = decide(
            payload=generated_payload(generated_at="2026-07-08T23:38:21Z", data_as_of="2026-07-08"),
            event_name="schedule",
            now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC),
        )
        self.assertEqual(result["expected_data_as_of"], "2026-07-08")
        self.assertEqual(result["should_collect"], "false")
        self.assertEqual(result["should_deploy"], "false")
        self.assertEqual(result["freshness_reason"], "fresh_for_kst_window_and_expected_us_session")

    def test_stale_schedule_collects_and_deploys(self) -> None:
        result = decide(
            payload=generated_payload(generated_at="2026-07-08T20:00:00Z", data_as_of="2026-07-08"),
            event_name="schedule",
            now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC),
        )
        self.assertEqual(result["should_collect"], "true")
        self.assertEqual(result["should_deploy"], "true")
        self.assertEqual(result["freshness_reason"], "stale_or_before_kst_window")

    def test_current_but_degraded_schedule_retries_collection(self) -> None:
        result = decide(
            payload=generated_payload(
                generated_at="2026-07-08T23:38:21Z",
                data_as_of="2026-07-08",
                status_level="degraded",
            ),
            event_name="schedule",
            now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC),
        )
        self.assertEqual(result["status_level"], "degraded")
        self.assertEqual(result["should_collect"], "true")
        self.assertEqual(result["should_deploy"], "true")
        self.assertEqual(result["freshness_reason"], "current_date_but_status_not_ok")

    def test_missing_payload_collects_and_deploys(self) -> None:
        result = decide(payload={}, event_name="schedule", now_utc=dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC))
        self.assertEqual(result["should_collect"], "true")
        self.assertEqual(result["should_deploy"], "true")
        self.assertEqual(result["freshness_reason"], "missing_generated_payload")

    def test_current_ok_payload_with_provider_failure_retries(self) -> None:
        payload = self.current_payload()
        payload["constituents"][0]["dataQuality"]["failures"] = ["chart: provider unavailable"]
        result = self.scheduled(payload)
        self.assertEqual(result["should_collect"], "true")
        self.assertEqual(result["should_deploy"], "true")
        self.assertEqual(result["freshness_reason"], "current_date_but_data_quality_not_ok")
        self.assertGreater(int(result["quality_failure_count"]), 0)

    def test_one_current_row_cannot_hide_twenty_nine_stale_rows(self) -> None:
        payload = self.current_payload()
        for row in payload["constituents"][1:]:
            row["lastTradeDate"] = "2026-07-07"
        result = self.scheduled(payload)
        self.assertEqual(result["should_collect"], "true")
        self.assertEqual(result["freshness_reason"], "current_date_but_data_quality_not_ok")

    def test_current_metadata_without_rows_or_required_fundamentals_retries(self) -> None:
        payload = self.current_payload()
        del payload["constituents"]
        self.assertEqual(self.scheduled(payload)["should_collect"], "true")
        payload = self.current_payload()
        del payload["constituents"][0]["metrics"]["quarterlyRevenueYoY"]
        self.assertEqual(self.scheduled(payload)["should_collect"], "true")

    def test_current_status_failures_cannot_be_hidden_by_ok_label(self) -> None:
        payload = self.current_payload()
        payload["status"]["failures"] = ["Nasdaq provider failed"]
        self.assertEqual(self.scheduled(payload)["should_collect"], "true")

    def test_intentional_nonpositive_base_null_does_not_force_retry(self) -> None:
        payload = self.current_payload()
        metrics = payload["constituents"][0]["metrics"]
        metrics["quarterlyEpsYoY"] = None
        metrics["quarterlyEpsGrowth"] = nonpositive_growth()
        result = self.scheduled(payload)
        self.assertEqual(result["should_collect"], "false")
        self.assertEqual(result["quality_failure_count"], "0")

    def test_observed_independence_day_skips_to_latest_real_session(self) -> None:
        expected = latest_expected_us_session_date(dt.datetime(2026, 7, 4, 4, 31, tzinfo=dt.UTC))
        self.assertEqual(expected, dt.date(2026, 7, 2))
        self.assertEqual(us_equity_holiday_name(dt.date(2026, 7, 3)), "independence_day")

        result = decide(
            payload=generated_payload(generated_at="2026-07-04T04:12:38Z", data_as_of="2026-07-02"),
            event_name="schedule",
            now_utc=dt.datetime(2026, 7, 4, 4, 31, tzinfo=dt.UTC),
        )
        self.assertEqual(result["expected_data_as_of"], "2026-07-02")
        self.assertEqual(result["should_collect"], "false")
        self.assertEqual(result["should_deploy"], "false")


if __name__ == "__main__":
    unittest.main()
