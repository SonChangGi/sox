"""Validate a current market cap from Yahoo's public quote-page JSON.

The timeseries API can return metadata without observations. The public page
embeds a quoteResponse with a regular-session timestamp, raw USD capitalization,
and shares outstanding. Never use rounded display text or after-hours prices.
"""
from __future__ import annotations

import datetime as dt
from html.parser import HTMLParser
import json
import math
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from check_sox_freshness import is_us_equity_regular_session, latest_expected_us_session_date


class QuotePageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture = False
        self.parts: list[str] = []
        self.quotes: list[dict[str, Any]] = []

    def handle_starttag(self, tag, attrs):
        if tag != "script":
            return
        attrs = dict(attrs)
        url = urlparse(attrs.get("data-url", ""))
        self.capture = (attrs.get("type") == "application/json"
                        and "data-sveltekit-fetched" in attrs
                        and url.scheme == "https"
                        and url.netloc in {"query1.finance.yahoo.com", "query2.finance.yahoo.com"}
                        and url.path == "/v7/finance/quote")
        self.parts = []

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag != "script" or not self.capture:
            return
        self.capture = False
        envelope = json.loads("".join(self.parts))
        if envelope.get("status") != 200:
            raise ValueError("quote page embedded request failed")
        response = json.loads(envelope["body"])["quoteResponse"]
        if response.get("error") is not None or not isinstance(response.get("result"), list):
            raise ValueError("quote page has no successful quote response")
        self.quotes.extend(response["result"])


def raw_number(value: Any) -> float:
    if isinstance(value, dict):
        value = value.get("raw")
    if (not isinstance(value, (int, float)) or isinstance(value, bool)
            or not math.isfinite(value) or value <= 0):
        raise ValueError("quote field must be a finite positive raw number")
    return float(value)


def validated_market_cap(document: str, *, symbol: str, chart: dict[str, Any],
                         expected_date: str, now: dt.datetime) -> tuple[float, dict[str, Any]]:
    parser = QuotePageParser()
    parser.feed(document)
    quotes = [q for q in parser.quotes if isinstance(q, dict) and q.get("symbol") == symbol]
    if len(quotes) != 1:
        raise ValueError("quote page requires one unambiguous matching symbol")
    quote = quotes[0]
    meta = chart.get("meta") or {}
    if (meta.get("symbol") != symbol or quote.get("quoteType") != "EQUITY"
            or meta.get("instrumentType") != "EQUITY"
            or not quote.get("longName") or quote["longName"] != meta.get("longName")
            or not quote.get("exchange") or quote["exchange"] != meta.get("exchangeName")
            or quote.get("currency") != "USD" or meta.get("currency") != "USD"
            or quote.get("exchangeTimezoneName") != "America/New_York"
            or meta.get("exchangeTimezoneName") != "America/New_York"):
        raise ValueError("quote identity, exchange, type or USD currency differs from chart")
    target = dt.date.fromisoformat(expected_date)
    prices = chart.get("prices") or []
    ny = ZoneInfo("America/New_York")
    close = dt.datetime.combine(target, dt.time(16), ny)
    timestamp = raw_number(quote.get("regularMarketTime"))
    observed = dt.datetime.fromtimestamp(timestamp, ny)
    if (not is_us_equity_regular_session(target)
            or target != latest_expected_us_session_date(now)
            or not prices or prices[-1].get("date") != expected_date
            or quote.get("marketState") != "CLOSED" or now < close
            or observed.date() != target
            or observed < dt.datetime.combine(target, dt.time(9, 30), ny)
            or observed > close + dt.timedelta(seconds=2)
            or timestamp != raw_number(meta.get("regularMarketTime"))):
        raise ValueError("quote is not for the current completed chart session")
    price = raw_number(quote.get("regularMarketPrice"))
    # Chart metadata is an unadjusted regular quote; the plotted series uses
    # adjusted closes and must not be multiplied by current shares outstanding.
    if not math.isclose(price, raw_number(meta.get("regularMarketPrice")), rel_tol=1e-6):
        raise ValueError("quote regular price differs from chart")
    cap = raw_number(quote.get("marketCap"))
    shares = raw_number(quote.get("sharesOutstanding"))
    # Yahoo's raw capitalization is rounded at floating-point precision.
    # This also rejects thousand/million-unit errors and after-hours caps.
    if not math.isclose(cap, shares * price, rel_tol=1e-6):
        raise ValueError("quote capitalization does not match regular price times shares")
    return cap, {"source": "yahoo-public-quote", "dataAsOf": expected_date,
                 "regularMarketTime": int(timestamp), "currency": "USD",
                 "regularMarketPrice": price, "sharesOutstanding": shares,
                 "marketCapField": "quoteResponse.marketCap.raw"}
