"""Current quote fallback for Yahoo's metadata-only market-cap series."""
import datetime as dt
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import fetch_sox_data as collector
from yahoo_market_cap import validated_market_cap


FIXTURES = Path(__file__).parent / "fixtures"
NOW = dt.datetime(2026, 10, 24, 12, 5, tzinfo=dt.UTC)


def quote_document(quotes, *, status=200, error=None):
    envelope = {"status": status, "body": json.dumps({"quoteResponse": {"result": quotes, "error": error}})}
    return '<script type="application/json" data-sveltekit-fetched data-url="https://query1.finance.yahoo.com/v7/finance/quote?symbols=Q">' + json.dumps(envelope) + '</script>'


def fixture_quote():
    text = (FIXTURES / "q-market-cap-quote.html").read_text()
    envelope = json.loads(text.split('>', 1)[1].split('</script>', 1)[0])
    return json.loads(envelope["body"])["quoteResponse"]["result"][0]


class QuoteValidationTests(unittest.TestCase):
    def setUp(self):
        self.quote = fixture_quote()
        self.chart = json.loads((FIXTURES / "q-market-cap-chart.json").read_text())

    def validate(self, document=None, **kwargs):
        return validated_market_cap(document or quote_document([self.quote]), symbol="Q",
            chart=self.chart, expected_date="2026-10-23", now=kwargs.get("now", NOW))

    def test_raw_cap_is_not_after_hours_price_or_adjusted_close_times_shares(self):
        self.quote["postMarketPrice"] = {"raw": 110}
        self.chart["prices"][-1]["close"] = 99  # adjusted history is not the quote basis
        cap, source = self.validate()
        self.assertEqual(cap, 22991724544)
        self.assertEqual(source["regularMarketPrice"], 109.83)

    def test_identity_currency_and_session_mismatches_fail_closed(self):
        changes = {"symbol": "QCOM", "longName": "Qwest", "currency": "CAD",
                   "exchange": "NMS", "quoteType": "ETF", "marketState": "REGULAR",
                   "exchangeTimezoneName": "UTC", "regularMarketTime": {"raw": 1792699202},
                   "regularMarketPrice": {"raw": 110}}
        for key, value in changes.items():
            with self.subTest(key=key):
                bad = {**self.quote, key: value}
                with self.assertRaises(ValueError):
                    self.validate(quote_document([bad]))

    def test_missing_invalid_and_scaled_raw_fields_fail_closed(self):
        for key in ("marketCap", "sharesOutstanding", "regularMarketPrice", "regularMarketTime"):
            for value in (None, {}, {"fmt": "22.992B"}, {"raw": 0}, {"raw": -1},
                          {"raw": True}, {"raw": "22991724544"}, {"raw": float("nan")},
                          {"raw": float("inf")}):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.validate(quote_document([{**self.quote, key: value}]))
        for cap in (22991.724544, 22991724544000, 110 * 209339207):
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                self.validate(quote_document([{**self.quote, "marketCap": {"raw": cap}}]))

    def test_missing_duplicate_malformed_or_error_response_is_not_accepted(self):
        for document in ('<span>Market cap: 22.992B</span>', quote_document([]),
                         quote_document([self.quote, self.quote]), quote_document([self.quote], status=401),
                         quote_document([self.quote], error={"code": "Bad Request"}),
                         quote_document([self.quote]).replace('"body":', '"bad":')):
            with self.subTest(document=document[:60]), self.assertRaises((ValueError, KeyError)):
                self.validate(document)

    def test_unrelated_quotes_are_ignored(self):
        other = {**self.quote, "symbol": "QCOM", "marketCap": {"raw": 1}}
        self.assertEqual(self.validate(quote_document([other, self.quote]))[0], 22991724544)

    def test_stale_next_session_or_unfinished_target_is_rejected(self):
        for now in (dt.datetime(2026, 10, 27, 12, tzinfo=dt.UTC),
                    dt.datetime(2026, 10, 23, 19, tzinfo=dt.UTC)):
            with self.subTest(now=now), self.assertRaises(ValueError):
                self.validate(now=now)
        self.chart["prices"][-1]["date"] = "2026-10-22"
        with self.assertRaises(ValueError):
            self.validate()

    def test_post_close_timestamp_does_not_extend_existing_two_second_boundary(self):
        self.quote["regularMarketTime"] = {"raw": 1792785603}
        self.chart["meta"]["regularMarketTime"] = 1792785603
        with self.assertRaises(ValueError):
            self.validate()


class MissingMarketCapTests(unittest.TestCase):
    def test_metadata_only_series_recovers_current_cap_in_collector(self):
        payload = json.loads((FIXTURES / "q-market-cap-missing.json").read_text())
        chart = json.loads((FIXTURES / "q-market-cap-chart.json").read_text())
        with patch.object(collector, "http_json", return_value=payload), patch.object(
            collector, "fetch_chart", return_value=chart
        ), patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(
            (FIXTURES / "q-market-cap-quote.html").read_bytes()
        )), patch.object(collector, "now_iso", return_value="2026-10-24T12:05:00Z"):
            row = collector.analyze_symbol({"ticker": "Q", "displayName": "Qnity Electronics, Inc."}, "2026-10-23")
        self.assertEqual(row["marketCap"], 22991724544)
        self.assertTrue(row["dataQuality"]["ok"])
        self.assertEqual(row["dataQuality"]["marketCapRepair"]["dataAsOf"], "2026-10-23")
        self.assertIsNone(row["metrics"]["trailingRevenue"])

    def test_present_or_invalid_series_is_not_replaced(self):
        for observations in ([{"raw": 123}], [{"raw": -1}], [{"raw": None}]):
            with self.subTest(observations=observations), patch.object(
                collector, "fetch_fundamentals", return_value={"trailingMarketCap": observations}
            ), patch.object(collector, "fetch_chart", return_value={"meta": {}, "prices": []}), patch.object(
                collector.urllib.request, "urlopen", side_effect=AssertionError("unexpected quote fetch")
            ) as request:
                collector.analyze_symbol({"ticker": "Q"}, "2026-10-23")
                request.assert_not_called()

    def test_failed_quote_keeps_cap_missing_and_records_failure(self):
        with patch.object(collector, "fetch_fundamentals", return_value={"trailingMarketCap": []}), patch.object(
            collector, "fetch_chart", return_value={"meta": {}, "prices": []}
        ), patch.object(collector.urllib.request, "urlopen", side_effect=TimeoutError("unavailable")):
            row = collector.analyze_symbol({"ticker": "Q"}, "2026-10-23")
        self.assertIsNone(row["marketCap"])
        self.assertFalse(row["dataQuality"]["ok"])
        self.assertIn("market cap quote: TimeoutError", row["dataQuality"]["failures"][0])

    def test_timeseries_api_error_cannot_activate_fallback(self):
        with patch.object(collector, "http_json", return_value={"timeseries": {
            "result": [{"meta": {"type": ["trailingMarketCap"]}}], "error": {"code": "Unavailable"}
        }}):
            with self.assertRaises(ValueError):
                collector.fetch_fundamentals("Q")


if __name__ == "__main__":
    unittest.main()
