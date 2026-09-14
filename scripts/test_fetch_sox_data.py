#!/usr/bin/env python3
"""Regression tests for provider failures, scoring, and safe refresh staging."""
from __future__ import annotations

from contextlib import ExitStack, redirect_stderr, redirect_stdout
from copy import deepcopy
import datetime as dt
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import fetch_sox_data as collector
from earnings_growth import earnings_growth


FILES = ("sox-analysis.json", "sox-history.json", "summary.json")
AS_OF = "2026-09-11"
GENERATED_AT = "2026-09-12T00:30:00Z"


def quarters(previous: float, current: float) -> list[dict[str, object]]:
    dates = ("2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30")
    return [
        {"raw": previous if index == 0 else current, "asOfDate": date, "periodType": "3M", "currencyCode": "USD"}
        for index, date in enumerate(dates)
    ]


def fundamentals(*, eps_previous: float = 1, eps_current: float = 1.5) -> dict[str, object]:
    return {
        "trailingMarketCap": [{"raw": 1_000_000_000}],
        "trailingTotalRevenue": [{"raw": 500_000_000}],
        "trailingNetIncome": [{"raw": 80_000_000}],
        "trailingPeRatio": [{"raw": 20}],
        "quarterlyTotalRevenue": quarters(100_000_000, 120_000_000),
        "quarterlyDilutedEPS": quarters(eps_previous, eps_current),
        "quarterlyNetIncome": quarters(10_000_000, 15_000_000),
    }


def chart() -> dict[str, object]:
    end = dt.date.fromisoformat(AS_OF)
    dates = [end - dt.timedelta(days=offset) for offset in range(370)]
    dates = sorted(date for date in dates if date.weekday() < 5)[-260:]
    return {
        "meta": {"currency": "USD", "exchangeName": "NMS"},
        "prices": [{"date": date.isoformat(), "close": 100 + index / 10, "volume": 1000} for index, date in enumerate(dates)],
    }


def constituents() -> tuple[list[dict[str, object]], dict[str, object], list[str]]:
    rows = [{"ticker": f"Q{index:02d}", "displayName": f"Company {index}"} for index in range(30)]
    return rows, {"recordCount": 30, "tradeDate": AS_OF, "fallback": False}, []


def provider_mocks(*, failed_symbol: str | None = None, eps_by_symbol: dict[str, tuple[float, float]] | None = None) -> ExitStack:
    """Keep the complete local collector pipeline while forbidding real HTTP."""
    stack = ExitStack()

    def fake_fundamentals(symbol: str) -> dict[str, object]:
        if symbol == failed_symbol:
            raise TimeoutError("synthetic fundamentals provider timeout")
        previous, current = (eps_by_symbol or {}).get(symbol, (1, 1.5))
        return fundamentals(eps_previous=previous, eps_current=current)

    stack.enter_context(patch.object(collector, "http_json", side_effect=AssertionError("unexpected network access")))
    stack.enter_context(patch.object(collector, "fetch_constituents", side_effect=constituents))
    stack.enter_context(patch.object(collector, "fetch_chart", side_effect=lambda _symbol: chart()))
    stack.enter_context(patch.object(collector, "fetch_fundamentals", side_effect=fake_fundamentals))
    stack.enter_context(patch.object(collector.time, "sleep"))
    stack.enter_context(patch.object(collector, "now_iso", return_value=GENERATED_AT))
    stack.enter_context(patch.object(collector, "git_remote_status", return_value={"remoteConfigured": False}))
    return stack


def analyze_rows() -> list[dict[str, object]]:
    return [collector.analyze_symbol(item) for item in constituents()[0]]


def seed_saved_data(directory: Path) -> dict[str, bytes]:
    directory.mkdir(parents=True, exist_ok=True)
    legacy_row = {
        "ticker": "Q00", "metrics": {"quarterlyEpsYoY": -2.5},
        "scores": {"earningsMomentum": 0.123}, "chart": {"prices": [{"close": 10}]},
    }
    previous = {
        "dataAsOf": "2026-09-10", "generatedAt": "2026-09-11T00:30:00Z",
        "constituents": [legacy_row], "methodology": {"earningsMomentum": "legacy reported method"},
    }
    older = {
        "dataAsOf": "2026-09-09", "generatedAt": "2026-09-10T00:30:00Z",
        "constituents": [{"ticker": "Q00", "metrics": {"quarterlyEpsYoY": -3.5}, "scores": {"earningsMomentum": 0.987}}],
        "methodology": {"earningsMomentum": "older reported method"},
        "unrelatedHistoricalField": "preserve this record",
    }
    payloads = (previous, {"snapshots": [older], "snapshotCount": 1}, {"dataAsOf": "2026-09-10", "marker": "original summary"})
    for filename, payload in zip(FILES, payloads):
        (directory / filename).write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    return {name: (directory / name).read_bytes() for name in FILES}


def run_refresh(output: Path, source: Path, *options: str) -> int:
    argv = [
        "fetch_sox_data.py", "--max-workers", "1", "--output-dir", str(output),
        "--history-source-dir", str(source), *options,
    ]
    with patch.object(sys, "argv", argv), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        return collector.main()


class CollectorQualityRegressionTests(unittest.TestCase):
    def test_all_current_rows_are_ok_but_one_provider_failure_is_degraded(self) -> None:
        with provider_mocks():
            healthy = analyze_rows()
            collector.enrich_scores(healthy)
            self.assertEqual(collector.build_payload(healthy, constituents()[1], [])["status"]["level"], "ok")
        with provider_mocks(failed_symbol="Q07"):
            failed = analyze_rows()
            collector.enrich_scores(failed)
            analysis = collector.build_payload(failed, constituents()[1], [])
        self.assertEqual(analysis["status"]["level"], "degraded")
        self.assertTrue(any("Q07" in item and "fundamentals" in item for item in analysis["status"]["failures"]))
        self.assertEqual(analysis["coverage"]["price"]["count"], 30)

    def test_one_latest_ticker_does_not_hide_29_stale_dates(self) -> None:
        with provider_mocks():
            rows = analyze_rows()
            for row in rows[:-1]:
                row["lastTradeDate"] = "2026-09-10"
            collector.enrich_scores(rows)
            analysis = collector.build_payload(rows, constituents()[1], [])
        self.assertEqual(analysis["dataAsOf"], AS_OF)
        self.assertEqual(analysis["status"]["level"], "degraded")
        self.assertTrue(any("Mixed lastTradeDate" in item for item in analysis["status"]["failures"]))

    def test_valid_turnaround_breakeven_and_unchanged_loss_are_not_provider_failures(self) -> None:
        for current in (0.5, 0, -1):
            with self.subTest(current=current), provider_mocks(eps_by_symbol={"Q07": (-1, current)}):
                rows = analyze_rows()
                collector.enrich_scores(rows)
                analysis = collector.build_payload(rows, constituents()[1], [])
                self.assertEqual(analysis["status"]["level"], "ok", analysis["status"]["failures"])


class CollectorEarningsRegressionTests(unittest.TestCase):
    def test_turnaround_improves_earnings_score_without_changing_price_scores(self) -> None:
        def scored(current: float) -> dict[str, dict[str, object]]:
            with provider_mocks(eps_by_symbol={"Q00": (-1, current), "Q01": (1, 1)}):
                rows = [collector.analyze_symbol(row) for row in constituents()[0][:2]]
                collector.enrich_scores(rows)
            return {row["ticker"]: row for row in rows}

        loss, turnaround = scored(-2), scored(0.5)
        target = turnaround["Q00"]
        self.assertIsNone(target["metrics"]["quarterlyEpsYoY"])
        self.assertEqual(target["metrics"]["quarterlyEpsGrowth"]["state"], "turnaround")
        self.assertGreater(target["scores"]["earningsMomentum"], loss["Q00"]["scores"]["earningsMomentum"])
        for ticker in loss:
            self.assertEqual(loss[ticker]["scores"]["priceMomentum"], turnaround[ticker]["scores"]["priceMomentum"])

    def test_positive_base_scores_match_legacy_yoy_rank_inputs(self) -> None:
        with provider_mocks(eps_by_symbol={"Q00": (1, 2), "Q01": (2, 1.5)}):
            corrected = [collector.analyze_symbol(row) for row in constituents()[0][:2]]
        legacy = deepcopy(corrected)
        for row in legacy:
            row["metrics"].pop("quarterlyEpsGrowth")
            row["metrics"].pop("quarterlyNetIncomeGrowth")
        collector.enrich_scores(corrected)
        collector.enrich_scores(legacy)
        self.assertEqual({r["ticker"]: r["scores"] for r in corrected}, {r["ticker"]: r["scores"] for r in legacy})

    def test_zero_base_is_excluded_even_if_legacy_yoy_remains_in_input(self) -> None:
        rows = [
            {"ticker": "ZERO", "metrics": {"quarterlyEpsYoY": 999, "quarterlyEpsGrowth": earnings_growth(quarters(0, 1))}},
            {"ticker": "PEER", "metrics": {"quarterlyEpsYoY": 0.5, "quarterlyEpsGrowth": earnings_growth(quarters(1, 1.5))}},
        ]
        collector.enrich_scores(rows)
        zero = next(row for row in rows if row["ticker"] == "ZERO")
        self.assertIsNone(zero["scores"]["earningsMomentum"])
        self.assertEqual(zero["metrics"]["quarterlyEpsGrowth"]["state"], "profit_from_zero")


class CollectorRefreshRegressionTests(unittest.TestCase):
    def test_strict_partial_provider_failure_preserves_all_existing_json_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "data"
            original = seed_saved_data(source)
            with provider_mocks(failed_symbol="Q07"):
                result = run_refresh(source, source, "--fail-on-degraded")
            self.assertNotEqual(result, 0)
            self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)

    def test_summary_serialization_failure_preserves_bundle_and_is_not_offline_success(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "data"
            original = seed_saved_data(source)
            with provider_mocks(), patch.object(collector, "build_summary", return_value={"badValue": float("nan")}):
                result = run_refresh(source, source, "--fail-on-degraded", "--offline-ok")
            self.assertNotEqual(result, 0)
            self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)

    def test_second_replace_failure_restores_prior_bundle_or_removes_partial_candidate(self) -> None:
        for existing_output in (True, False):
            with self.subTest(existing_output=existing_output), tempfile.TemporaryDirectory() as temp:
                source = Path(temp) / "data"
                output = source if existing_output else Path(temp) / "candidate"
                original = seed_saved_data(source)
                real_replace = Path.replace
                replace_count = 0

                def fail_second_replace(staged: Path, target: Path) -> Path:
                    nonlocal replace_count
                    if staged.name in FILES:
                        replace_count += 1
                        if replace_count == 2:
                            raise OSError("synthetic second publication rename failure")
                    return real_replace(staged, target)

                with provider_mocks(), patch.object(Path, "replace", new=fail_second_replace):
                    result = run_refresh(output, source, "--fail-on-degraded", "--offline-ok")
                self.assertNotEqual(result, 0)
                self.assertEqual(replace_count, 2)
                self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)
                self.assertEqual({path.name for path in output.iterdir()}, set(FILES) if existing_output else set())

    def test_successful_staged_refresh_preserves_source_and_historical_scores(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / "data", Path(temp) / "candidate"
            original = seed_saved_data(source)
            with provider_mocks(eps_by_symbol={"Q00": (-1, 0.5)}):
                result = run_refresh(output, source, "--fail-on-degraded")
            self.assertEqual(result, 0)
            self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)
            generated = {name: json.loads((output / name).read_text()) for name in FILES}
            analysis, history, summary = (generated[name] for name in FILES)
            self.assertEqual(analysis["status"]["level"], "ok")
            self.assertEqual(analysis["dataAsOf"], AS_OF)
            self.assertEqual(analysis["generatedAt"], GENERATED_AT)
            self.assertEqual(summary["dataAsOf"], AS_OF)
            self.assertEqual(history["latestDataAsOf"], AS_OF)
            self.assertEqual(history["snapshotCount"], 3)
            snapshots = {snapshot["dataAsOf"]: snapshot for snapshot in history["snapshots"]}
            saved_old = json.loads(original["sox-history.json"])["snapshots"][0]
            self.assertEqual(snapshots["2026-09-09"], saved_old)
            previous = snapshots["2026-09-10"]
            self.assertEqual(previous["constituents"][0]["scores"]["earningsMomentum"], 0.123)
            self.assertEqual(previous["constituents"][0]["metrics"]["quarterlyEpsYoY"], -2.5)
            self.assertEqual(previous["methodology"]["earningsMomentum"], "legacy reported method")
            self.assertNotIn("quarterlyEpsGrowth", previous["constituents"][0]["metrics"])
            latest = next(row for row in analysis["constituents"] if row["ticker"] == "Q00")
            self.assertIsNone(latest["metrics"]["quarterlyEpsYoY"])
            self.assertEqual(latest["metrics"]["quarterlyEpsGrowth"]["state"], "turnaround")


class CollectorHistoryProtectionTests(unittest.TestCase):
    def test_corrupt_saved_analysis_or_history_is_not_silently_discarded(self) -> None:
        for filename in ("sox-analysis.json", "sox-history.json"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temp:
                source = Path(temp) / "data"
                seed_saved_data(source)
                (source / filename).write_bytes(b'{"truncated":')
                original = {name: (source / name).read_bytes() for name in FILES}
                with provider_mocks(), patch.object(collector, "write_publication") as publish:
                    result = run_refresh(source, source, "--fail-on-degraded", "--offline-ok")
                self.assertNotEqual(result, 0)
                publish.assert_not_called()
                self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)

    def test_unreadable_saved_analysis_or_history_prevents_publication(self) -> None:
        for filename in ("sox-analysis.json", "sox-history.json"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temp:
                source = Path(temp) / "data"
                original = seed_saved_data(source)
                real_read = Path.read_text

                def fail_saved_read(path: Path, *args: object, **kwargs: object) -> str:
                    if path == source / filename:
                        raise PermissionError("synthetic saved snapshot read failure")
                    return real_read(path, *args, **kwargs)

                with provider_mocks(), patch.object(Path, "read_text", new=fail_saved_read), patch.object(collector, "write_publication") as publish:
                    result = run_refresh(source, source, "--fail-on-degraded", "--offline-ok")
                self.assertNotEqual(result, 0)
                publish.assert_not_called()
                self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)

    def test_invalid_history_structure_and_snapshot_records_prevent_publication(self) -> None:
        invalid_histories = [
            {}, [], {"unrelated": "object"}, {"snapshots": {}},
            {"snapshots": [], "snapshotCount": 1},
            {"snapshots": ["invalid record"]},
            {"snapshots": [{"dataAsOf": "2026-09-09", "constituents": []}]},
            {"snapshots": [{"dataAsOf": "2026-02-30", "constituents": [{"ticker": "Q00"}]}]},
        ]
        for invalid in invalid_histories:
            with self.subTest(history=invalid), tempfile.TemporaryDirectory() as temp:
                source = Path(temp) / "data"
                seed_saved_data(source)
                (source / "sox-history.json").write_text(json.dumps(invalid), encoding="utf-8")
                original = {name: (source / name).read_bytes() for name in FILES}
                with provider_mocks(), patch.object(collector, "write_publication") as publish:
                    result = run_refresh(source, source, "--fail-on-degraded", "--offline-ok")
                self.assertNotEqual(result, 0)
                publish.assert_not_called()
                self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)

    def test_duplicate_history_dates_are_rejected_without_choosing_a_record(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "data"
            seeded = seed_saved_data(source)
            history = json.loads(seeded["sox-history.json"])
            duplicate = deepcopy(history["snapshots"][0])
            duplicate["constituents"][0]["scores"]["earningsMomentum"] = 0.001
            history["snapshots"].append(duplicate)
            history["snapshotCount"] = 2
            (source / "sox-history.json").write_text(json.dumps(history), encoding="utf-8")
            original = {name: (source / name).read_bytes() for name in FILES}
            with provider_mocks(), patch.object(collector, "write_publication") as publish:
                result = run_refresh(source, source, "--fail-on-degraded", "--offline-ok")
            self.assertNotEqual(result, 0)
            publish.assert_not_called()
            self.assertEqual({name: (source / name).read_bytes() for name in FILES}, original)

    def test_missing_history_starts_store_and_preserves_existing_analysis_if_present(self) -> None:
        for has_previous_analysis in (False, True):
            with self.subTest(has_previous_analysis=has_previous_analysis), tempfile.TemporaryDirectory() as temp:
                source, output = Path(temp) / "source", Path(temp) / "candidate"
                source.mkdir()
                if has_previous_analysis:
                    seed_saved_data(source)
                    (source / "sox-history.json").unlink()
                original = {path.name: path.read_bytes() for path in source.iterdir()}
                with provider_mocks():
                    result = run_refresh(output, source, "--fail-on-degraded")
                self.assertEqual(result, 0)
                self.assertEqual({path.name: path.read_bytes() for path in source.iterdir()}, original)
                history = json.loads((output / "sox-history.json").read_text())
                self.assertEqual(history["snapshotCount"], 2 if has_previous_analysis else 1)
                self.assertEqual(history["latestDataAsOf"], AS_OF)
                if has_previous_analysis:
                    previous = next(row for row in history["snapshots"] if row["dataAsOf"] == "2026-09-10")
                    self.assertEqual(previous["constituents"][0]["scores"]["earningsMomentum"], 0.123)


if __name__ == "__main__":
    unittest.main()
