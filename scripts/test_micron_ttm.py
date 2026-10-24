"""MU metadata-only TTM regression, captured 2026-10-24 from public sources."""
from copy import deepcopy
import datetime as dt
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import fetch_sox_data as collector
import micron_ttm

FIXTURES = Path(__file__).parent / "fixtures"
NOW = dt.datetime(2026, 10, 24, 17, 46, tzinfo=dt.UTC)


def documents():
    return [(FIXTURES / f"mu-ttm-{part}.html").read_text() for part in ("quote", "index", "release")]


def chart():
    price = micron_ttm.summary(documents()[0])["price"]
    return {"meta": {"symbol": "MU", "longName": price["longName"], "currency": "USD",
                     "exchangeName": "NMS", "instrumentType": "EQUITY", "regularMarketTime": price["regularMarketTime"]},
            "prices": [{"date": "2026-10-23", "close": 877.55, "volume": 1000}]}


def quote_document(data, *, status=200, error=None):
    body = {"quoteSummary": {"result": [data], "error": error}}
    return '<script type="application/json" data-sveltekit-fetched data-url="https://query1.finance.yahoo.com/v10/finance/quoteSummary/MU">' + json.dumps({"status": status, "body": json.dumps(body)}) + '</script>'


class AnnualTtmValidationTests(unittest.TestCase):
    def setUp(self):
        self.quote, self.index, self.release = documents()
        self.chart = chart()

    def validate(self, *, now=NOW):
        return micron_ttm.validate_ttm(self.quote, self.index, self.release,
            chart=self.chart, expected_date="2026-10-23", now=now)

    def test_53_week_annual_period_is_ttm_and_has_provenance(self):
        revenue, income, provenance = self.validate()
        self.assertEqual((revenue, income), (133188001792, 84968996864))
        self.assertEqual(provenance["periodStart"], "2025-08-29")
        self.assertEqual(provenance["periodEnd"], "2026-09-03")
        self.assertEqual(provenance["currency"], "USD")
        self.assertTrue(provenance["issuerFilingUrl"].endswith('.pdf'))
        self.assertEqual(provenance["source"], "yahoo-quote-summary-issuer-annual-release-verified")
        self.assertEqual(provenance["issuerFilingCheck"],
                         "latest issuer index link only; filing body not fetched or validated")
        self.assertEqual(set(provenance["sourceSha256"]), {"quote", "issuerIndex", "issuerRelease"})
        self.assertTrue(all(len(h) == 64 for h in provenance["sourceSha256"].values()))

    def test_wrong_entity_currency_exchange_or_quote_session_fails(self):
        original = micron_ttm.summary(self.quote)
        for module, key, value in (
            ("price", "symbol", "Q"), ("price", "longName", "Another Micron"),
            ("price", "exchange", "NYQ"), ("price", "quoteType", "ETF"),
            ("price", "currency", "EUR"), ("financialData", "financialCurrency", "EUR"),
            ("price", "regularMarketTime", 1792699200),
        ):
            data = deepcopy(original); data[module][key] = value; self.quote = quote_document(data)
            with self.subTest(module=module, key=key), self.assertRaises(ValueError):
                self.validate()

    def test_zero_nonfinite_scaled_missing_and_revised_amounts_fail(self):
        original = micron_ttm.summary(self.quote)
        for module, key in (("financialData", "totalRevenue"), ("defaultKeyStatistics", "netIncomeToCommon")):
            for raw in (None, True, "133188001792", float('nan'), float('inf'), 0, 133188, 100000000000):
                data = deepcopy(original); data[module][key] = {"raw": raw}; self.quote = quote_document(data)
                with self.subTest(module=module, raw=raw), self.assertRaises(ValueError):
                    self.validate()

    def test_report_period_must_equal_quote_latest_quarter_and_fiscal_year(self):
        original = micron_ttm.summary(self.quote)
        for key in ("mostRecentQuarter", "lastFiscalYearEnd"):
            data = deepcopy(original); data['defaultKeyStatistics'][key] = {"raw": 1780185600}
            self.quote = quote_document(data)
            with self.subTest(key=key), self.assertRaises(ValueError): self.validate()
        self.quote = quote_document(original)
        with self.assertRaises(ValueError): self.validate(now=dt.datetime(2027, 2, 1, tzinfo=dt.UTC))

    def test_newer_interim_release_or_filing_blocks_old_annual_ttm(self):
        for category in ('Press release', 'Form 10-Q / 10K'):
            original = self.index
            marker = '{"category":"' + category + '","data":['
            new = '{"year":2027,"documents":[{"text":"Q1","link":"https://investors.micron.com/news/press-release/2026/new-quarter"}]},'
            self.index = self.index.replace(marker, marker + new)
            with self.subTest(category=category), self.assertRaises(ValueError): self.validate()
            self.index = original

    def test_duplicate_period_or_category_and_missing_filing_fail_closed(self):
        original = self.index
        for changed in (
            original.replace('{"text":"Q4",', '{"text":"Q3",'),
            original.replace('"Form 10-Q / 10K"', '"Missing category"'),
            original + original,
            original.replace('http://investors.micron.com/news/', 'https://unrelated.test/news/'),
        ):
            self.index = changed
            with self.subTest(index=changed[:80]), self.assertRaises(ValueError): self.validate()

    def test_units_columns_missing_tables_and_corrections_are_not_silently_accepted(self):
        original = self.release
        for changed in (
            original.replace('in millions,', 'in thousands,'),
            original.replace('FY-26', 'FY-25'),
            original.replace('Year Ended', 'Quarter Ended'),
            original.replace('Annual Financial Results', 'Quarterly Financial Results'),
            original.replace('133,188', '134,188'),
            original.replace('84,969', '85,969', 1),
            original.replace('August 28, 2025', 'May 28, 2025'),
            original + original,
        ):
            self.release = changed
            with self.subTest(release=changed[:80]), self.assertRaises(ValueError): self.validate()

    def test_annual_columns_require_separate_gaap_then_non_gaap_labels(self):
        original = self.release
        for label in ("Non-GAAP (1)", "Adjusted GAAP (1)", "GAAP Non-GAAP (1)", "GAAP (1) extra", ""):
            self.release = original.replace("<td>GAAP (1)</td>", f"<td>{label}</td>")
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, "GAAP column"):
                self.validate()
        for changed in (
            original.replace("<td>Non-GAAP (2)</td>", "<td>GAAP (2)</td>"),
            original.replace("<td>GAAP (1)</td>", "<td>GAAP (1)</td><td>GAAP (1)</td>"),
            original.replace("<td>GAAP (1)</td>", "<td>Non-GAAP (1)</td>").replace("<td>Non-GAAP (2)</td>", "<td>GAAP (2)</td>"),
        ):
            self.release = changed
            with self.subTest(release=changed[:200]), self.assertRaisesRegex(ValueError, "GAAP column"):
                self.validate()

    def test_provider_error_duplicate_summary_and_bad_margin_fail(self):
        original = micron_ttm.summary(self.quote)
        bad_margin = deepcopy(original); bad_margin['financialData']['profitMargins'] = {'raw': 0.6}
        for changed in (quote_document(original, status=403), quote_document(original, error={'code': 'Unavailable'}),
                        self.quote + self.quote, quote_document(bad_margin), '<html>No data</html>'):
            self.quote = changed
            with self.subTest(quote=changed[:80]), self.assertRaises((ValueError, KeyError)): self.validate()


class CollectorTtmRegressionTests(unittest.TestCase):
    def test_metadata_only_ttm_uses_current_annual_report_not_old_quarters(self):
        fundamentals = {"trailingMarketCap": [{"raw": 1_000_000}], "trailingTotalRevenue": [], "trailingNetIncome": [],
                        "quarterlyTotalRevenue": [{"raw": 41456000000, "asOfDate": "2026-05-31"}],
                        "quarterlyNetIncome": [{"raw": 28243000000, "asOfDate": "2026-05-31"}]}
        with patch.object(collector, "fetch_fundamentals", return_value=fundamentals), patch.object(
            collector, "fetch_chart", return_value=chart()
        ), patch.object(collector.urllib.request, "urlopen", side_effect=[io.BytesIO(d.encode()) for d in documents()]), patch.object(
            collector, "now_iso", return_value="2026-10-24T17:46:00Z"
        ):
            row = collector.analyze_symbol({"ticker": "MU"}, "2026-10-23")
        self.assertEqual(row["metrics"]["trailingRevenue"], 133188001792)
        self.assertEqual(row["metrics"]["trailingNetIncome"], 84968996864)
        self.assertAlmostEqual(row["metrics"]["netMargin"], 84968996864 / 133188001792)
        self.assertEqual(row["dataQuality"]["ttmRepair"]["periodEnd"], "2026-09-03")
        self.assertTrue(row["dataQuality"]["ok"])

    def test_other_symbols_present_values_or_only_one_missing_field_do_not_use_fallback(self):
        for symbol, revenue, income in (("Q", [], []), ("MU", [{"raw": 100}], [{"raw": 20}]),
                                       ("MU", [], [{"raw": 20}]), ("MU", [{"raw": 100}], [])):
            with self.subTest(symbol=symbol, revenue=revenue, income=income), patch.object(
                collector, "fetch_fundamentals", return_value={"trailingMarketCap": [{"raw": 100}],
                    "trailingTotalRevenue": revenue, "trailingNetIncome": income}
            ), patch.object(collector, "fetch_chart", return_value=chart()), patch.object(
                collector.urllib.request, "urlopen", side_effect=AssertionError('unexpected fallback')
            ) as request:
                collector.analyze_symbol({'ticker': symbol}, '2026-10-23')
                request.assert_not_called()

    def test_unavailable_source_leaves_both_fields_missing_and_marks_failure(self):
        with patch.object(collector, "fetch_fundamentals", return_value={
            "trailingMarketCap": [{"raw": 100}], "trailingTotalRevenue": [], "trailingNetIncome": []
        }), patch.object(collector, "fetch_chart", return_value=chart()), patch.object(
            collector.urllib.request, "urlopen", side_effect=TimeoutError('unavailable')
        ):
            row = collector.analyze_symbol({'ticker': 'MU'}, '2026-10-23')
        self.assertFalse(row['dataQuality']['ok'])
        self.assertIn('TTM annual verification', row['dataQuality']['failures'][0])
        for field in ('trailingRevenue', 'trailingNetIncome', 'netMargin'):
            self.assertIsNone(row['metrics'][field])


if __name__ == "__main__":
    unittest.main()
