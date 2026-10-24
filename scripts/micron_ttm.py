"""Recover missing MU TTM fields only against the issuer's latest annual results.

At fiscal year end, the reported 52/53-week year is the trailing four quarters.
Do not sum Yahoo's incomplete quarters. A newer interim report, ambiguous
release, changed statement, or disagreement must keep publication blocked.
"""
from __future__ import annotations

import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
import math
import re
from urllib.parse import urlparse, urlunparse
from zoneinfo import ZoneInfo

RESULTS_URL = "https://investors.micron.com/financials/quarterly-results/default.aspx"
QUOTE_URL = "https://finance.yahoo.com/quote/MU/"


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts, self.tables = [], []
        self.attrs, self.parts = None, []
        self.table, self.row, self.cell = None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.attrs, self.parts = dict(attrs), []
        if tag == "table":
            if self.table is not None:
                raise ValueError("nested financial table is ambiguous")
            self.table = []
        if self.table is not None and tag == "tr":
            self.row = []
        if self.row is not None and tag in {"td", "th"}:
            self.cell = []

    def handle_data(self, data):
        if self.attrs is not None:
            self.parts.append(data)
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.attrs is not None:
            self.scripts.append((self.attrs, "".join(self.parts)))
            self.attrs = None
        if tag in {"td", "th"} and self.cell is not None:
            self.row.append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        if tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def latest_documents(index):
    categories = {}
    for match in re.finditer(r'\{"category":', index):
        item = json.JSONDecoder().raw_decode(index[match.start():])[0]
        if item.get("category") not in {"Press release", "Form 10-Q / 10K"}:
            continue
        if item["category"] in categories:
            raise ValueError("duplicate issuer result category")
        periods = {}
        for year in item["data"]:
            if type(year["year"]) is not int:
                raise ValueError("invalid issuer fiscal year")
            for doc in year["documents"]:
                if not re.fullmatch(r"Q[1-4]", doc["text"]):
                    raise ValueError("unknown issuer fiscal quarter")
                key = year["year"], int(doc["text"][1])
                if key in periods:
                    raise ValueError("duplicate issuer fiscal period")
                periods[key] = doc["link"]
        categories[item["category"]] = periods
    if set(categories) != {"Press release", "Form 10-Q / 10K"}:
        raise ValueError("missing issuer release or filing index")
    releases, filings = categories["Press release"], categories["Form 10-Q / 10K"]
    period = max(releases)
    if period != max(filings) or period[1] != 4:
        raise ValueError("latest issuer results are not an annual fiscal period")
    release = urlparse(releases[period])
    if (release.hostname != "investors.micron.com" or release.scheme not in {"http", "https"}
            or not release.path.startswith("/news/press-release/")):
        raise ValueError("unexpected issuer release URL")
    filing = filings[period]
    if filing.startswith("//"):
        filing = "https:" + filing
    if (urlparse(filing).scheme != "https"
            or urlparse(filing).hostname not in {"s25.q4cdn.com", "d18rn0p25nwr6d.cloudfront.net"}):
        raise ValueError("unexpected issuer filing URL")
    return period[0], urlunparse(release._replace(scheme="https")), filing


def number(value):
    raw = value.get("raw") if isinstance(value, dict) else value
    if type(raw) not in (int, float) or not math.isfinite(raw):
        raise ValueError("missing or invalid raw financial number")
    return raw


def summary(document):
    parsed = Document()
    parsed.feed(document)
    matches = []
    for attrs, text in parsed.scripts:
        url = urlparse(attrs.get("data-url", ""))
        if (attrs.get("type") != "application/json" or "data-sveltekit-fetched" not in attrs
                or url.scheme != "https" or url.hostname not in {"query1.finance.yahoo.com", "query2.finance.yahoo.com"}
                or url.path != "/v10/finance/quoteSummary/MU"):
            continue
        envelope = json.loads(text)
        result = json.loads(envelope["body"])["quoteSummary"]
        if envelope.get("status") != 200 or result.get("error") is not None:
            raise ValueError("quote summary request failed")
        matches.extend(result.get("result") or [])
    if len(matches) != 1:
        raise ValueError("one unambiguous MU quote summary is required")
    return matches[0]


def statement_row(table, label):
    rows = [r for r in table if r and r[0] == label]
    if len(rows) != 1:
        raise ValueError(f"missing or duplicate statement row: {label}")
    text = " ".join(rows[0][1:]).replace("$", " ").strip()
    tokens = re.findall(r"\(?\s*-?\d[\d,]*(?:\.\d+)?\s*\)?", text)
    if re.sub(r"\(?\s*-?\d[\d,]*(?:\.\d+)?\s*\)?", "", text).strip():
        raise ValueError("unrecognized financial statement amount")
    return [float(t.replace(",", "").replace(" ", "").replace("(", "-").replace(")", "")) for t in tokens]


def validate_ttm(quote_html, index_html, release_html, *, chart, expected_date, now):
    year, release_url, filing_url = latest_documents(index_html)
    data = summary(quote_html)
    price, stats, finance = data["price"], data["defaultKeyStatistics"], data["financialData"]
    meta = chart.get("meta") or {}
    if (price.get("symbol") != "MU" or meta.get("symbol") != "MU"
            or price.get("longName") != "Micron Technology, Inc." or meta.get("longName") != price["longName"]
            or price.get("quoteType") != "EQUITY" or meta.get("instrumentType") != "EQUITY"
            or price.get("exchange") != "NMS" or meta.get("exchangeName") != "NMS"
            or any(c != "USD" for c in (price.get("currency"), meta.get("currency"), finance.get("financialCurrency")))):
        raise ValueError("MU identity, exchange, equity type or USD unit mismatch")
    timestamp = number(price.get("regularMarketTime"))
    if (timestamp > now.timestamp() or timestamp != number(meta.get("regularMarketTime"))
            or dt.datetime.fromtimestamp(timestamp, ZoneInfo("America/New_York")).date().isoformat() != expected_date
            or not chart.get("prices") or chart["prices"][-1]["date"] != expected_date):
        raise ValueError("MU quote does not match the current chart session")
    end = dt.datetime.fromtimestamp(number(stats.get("mostRecentQuarter")), dt.UTC).date()
    fiscal_end = dt.datetime.fromtimestamp(number(stats.get("lastFiscalYearEnd")), dt.UTC).date()
    if end != fiscal_end or end.year != year or not 0 <= (now.date() - end).days <= 140:
        raise ValueError("MU TTM period is not the latest recent fiscal year")
    parsed = Document()
    parsed.feed(release_html)
    annual = [t for t in parsed.tables if t and t[0] == ["Annual Financial Results"]]
    operations = [t for t in parsed.tables if t and "CONSOLIDATED STATEMENTS OF OPERATIONS" in " ".join(t[0])]
    if len(annual) != 1 or len(operations) != 1:
        raise ValueError("issuer annual financial statements are missing or ambiguous")
    annual, operations = annual[0], operations[0]
    header = " ".join(" ".join(r) for r in annual[:3])
    if ("in millions, except per share amounts" not in header
            or not re.search(r"GAAP.*Non-GAAP", header)
            or re.findall(r"FY-\d+", header) != [f"FY-{year % 100}", f"FY-{(year-1) % 100}"] * 2
            or "In millions, except per share amounts" not in " ".join(operations[0])
            or "Year Ended" not in " ".join(operations[1])):
        raise ValueError("issuer GAAP column, fiscal year or million-dollar unit is unverified")
    dates = [dt.datetime.strptime(c, "%B %d, %Y").date() for c in operations[2] if c]
    if len(dates) != 5 or dates[-2] != end or (end - dates[-1]).days not in {364, 371}:
        raise ValueError("issuer fiscal year dates do not establish four complete fiscal quarters")
    revenue, income = number(finance.get("totalRevenue")), number(stats.get("netIncomeToCommon"))
    if revenue <= 0:
        raise ValueError("TTM revenue must be positive")
    for label, value in (("Revenue", revenue), ("Net income", income)):
        a, o = statement_row(annual, label), statement_row(operations, label)
        if len(a) != 4 or len(o) != 5 or a[0] != o[-2] or a[1] != o[-1]:
            raise ValueError(f"issuer annual tables disagree for {label}")
        if not math.isclose(value, a[0] * 1_000_000, rel_tol=1e-6, abs_tol=1):
            raise ValueError(f"Yahoo TTM differs from current issuer GAAP {label}")
    if not math.isclose(number(finance.get("profitMargins")), income / revenue, abs_tol=0.000005, rel_tol=0):
        raise ValueError("Yahoo TTM margin disagrees with raw income/revenue")
    return revenue, income, {
        "source": "yahoo-quote-summary-issuer-annual-verified", "periodType": "TTM",
        "fiscalBasis": "latest four fiscal quarters (52/53-week annual report)",
        "periodStart": (dates[-1] + dt.timedelta(days=1)).isoformat(), "periodEnd": end.isoformat(),
        "currency": "USD", "sourceFields": ["financialData.totalRevenue.raw", "defaultKeyStatistics.netIncomeToCommon.raw"],
        "quoteUrl": QUOTE_URL, "issuerIndexUrl": RESULTS_URL, "issuerReleaseUrl": release_url,
        "issuerFilingUrl": filing_url, "issuerStatementUnit": "USD millions",
        "retrievedAt": now.isoformat().replace("+00:00", "Z"),
        "sourceSha256": {name: hashlib.sha256(doc.encode()).hexdigest() for name, doc in
                         (("quote", quote_html), ("issuerIndex", index_html), ("issuerRelease", release_html))},
    }
