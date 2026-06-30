#!/usr/bin/env python3
"""Generate static SOX dashboard data from free public sources.

Sources:
- Nasdaq Global Index Watch SOX weighting endpoint for free constituent list.
- Yahoo Finance chart and fundamentals-timeseries endpoints for market/fundamental metrics.

The public dashboard intentionally reads only generated JSON; this script owns live network access.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ANALYSIS_PATH = DATA_DIR / "sox-analysis.json"
SUMMARY_PATH = DATA_DIR / "summary.json"
HISTORY_PATH = DATA_DIR / "sox-history.json"
USER_AGENT = "Mozilla/5.0 (compatible; sox-dashboard/0.1; +https://sonchanggi.github.io/sox/)"
NASDAQ_TRADE_DATE_OVERRIDE = os.environ.get("SOX_NASDAQ_TRADE_DATE")
YAHOO_PERIOD1 = int(dt.datetime(2023, 1, 1, tzinfo=dt.timezone.utc).timestamp())
YAHOO_PERIOD2 = int(dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc).timestamp())
YAHOO_TYPES = [
    "trailingMarketCap",
    "trailingPeRatio",
    "trailingTotalRevenue",
    "trailingNetIncome",
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyDilutedEPS",
]
EXPECTED_MIN_CONSTITUENTS = 25

COMPANY_ALIASES = {
    "ADI": "Analog Devices",
    "ALAB": "Astera Labs",
    "AMAT": "Applied Materials",
    "AMD": "Advanced Micro Devices",
    "ARM": "Arm Holdings",
    "ASML": "ASML Holding",
    "AVGO": "Broadcom",
    "COHR": "Coherent",
    "CRDO": "Credo Technology",
    "ENTG": "Entegris",
    "GFS": "GlobalFoundries",
    "INTC": "Intel",
    "KLAC": "KLA",
    "LRCX": "Lam Research",
    "MCHP": "Microchip Technology",
    "MPWR": "Monolithic Power Systems",
    "MRVL": "Marvell Technology",
    "MTSI": "MACOM Technology",
    "MU": "Micron Technology",
    "NVDA": "NVIDIA",
    "NVMI": "Nova",
    "NXPI": "NXP Semiconductors",
    "ON": "ON Semiconductor",
    "QCOM": "Qualcomm",
    "QRVO": "Qorvo",
    "RMBS": "Rambus",
    "SWKS": "Skyworks Solutions",
    "TER": "Teradyne",
    "TSM": "Taiwan Semiconductor Manufacturing",
    "TXN": "Texas Instruments",
}

SEED_CONSTITUENTS = [
    ("ADI", "ANALOG DEVICES CMN"),
    ("ALAB", "ASTERA LABS, INC."),
    ("AMAT", "APPLIED MATERIALS"),
    ("AMD", "ADV MICRO DEVICES"),
    ("ARM", "ARM HOLDINGS PLC ADS"),
    ("ASML", "ASML HLDG NY REG"),
    ("AVGO", "BROADCOM INC."),
    ("COHR", "COHERENT CORP. CM"),
    ("CRDO", "CREDO TCH GP HLD ORD"),
    ("ENTG", "ENTEGRIS INC"),
    ("GFS", "GLOBALFOUNDRIES ORD"),
    ("INTC", "INTEL CORP"),
    ("KLAC", "KLA CP CMN STK"),
    ("LRCX", "LAM RESEARCH CORP"),
    ("MCHP", "MICROCHIP TECHNOLOGY"),
    ("MPWR", "MONOLITHIC POWER SYS"),
    ("MRVL", "MARVELL TECH INC CMN"),
    ("MTSI", "MACOM TECHNOLOGY S"),
    ("MU", "MICRON TECHNOLOGY"),
    ("NVDA", "NVIDIA CORPORATION"),
    ("NVMI", "NOVA LTD ORD SHS"),
    ("NXPI", "NXP SEMICONDUCTORS"),
    ("ON", "ON SEMICONDUCTOR"),
    ("QCOM", "QUALCOMM INC"),
    ("QRVO", "QORVO, INC. CMN"),
    ("RMBS", "RAMBUS INC."),
    ("SWKS", "SKYWORKS SOLUTIONS"),
    ("TER", "TERADYNE INC CMN"),
    ("TSM", "TAIWAN SEMICOND ADS"),
    ("TXN", "TEXAS INSTRUMENTS"),
]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def http_json(url: str, *, data: dict[str, str] | None = None, timeout: int = 30) -> Any:
    encoded = urllib.parse.urlencode(data).encode() if data else None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"}
    if data:
        headers.update({
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://indexes.nasdaqomx.com/Index/Weighting/SOX",
        })
    req = urllib.request.Request(url, data=encoded, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        payload = response.read().decode("utf-8", "replace")
    return json.loads(payload)


def recent_trade_date_candidates(*, today: dt.date | None = None, lookback_days: int = 10) -> list[str]:
    """Return likely SOX trade dates, newest first.

    GitHub schedules run in UTC. At 06:30 KST after the U.S. close, the latest
    available U.S. session is normally the current UTC date; weekends are
    skipped and market holidays harmlessly fall through to the next candidate.
    """

    anchor = today or dt.datetime.now(dt.timezone.utc).date()
    candidates: list[str] = []
    if NASDAQ_TRADE_DATE_OVERRIDE:
        candidates.append(NASDAQ_TRADE_DATE_OVERRIDE)
    for offset in range(0, lookback_days + 1):
        candidate = anchor - dt.timedelta(days=offset)
        if candidate.weekday() >= 5:
            continue
        iso = candidate.isoformat()
        if iso not in candidates:
            candidates.append(iso)
    return candidates


def fetch_constituents() -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
    failures: list[str] = []
    candidates = recent_trade_date_candidates()
    for trade_date in candidates:
        try:
            payload = http_json(
                "https://indexes.nasdaqomx.com/Index/WeightingData",
                data={"id": "SOX", "tradeDate": trade_date, "timeOfDay": "SOD"},
            )
            rows = payload.get("aaData") or []
            constituents = []
            for row in rows:
                symbol = str(row.get("Symbol") or "").strip().upper()
                if not symbol:
                    continue
                constituents.append({
                    "ticker": symbol,
                    "indexName": str(row.get("Name") or COMPANY_ALIASES.get(symbol, symbol)).strip(),
                    "displayName": COMPANY_ALIASES.get(symbol, str(row.get("Name") or symbol).title()),
                    "officialWeight": clean_number(row.get("SecurityWeightingPct")),
                })
            if len(constituents) >= EXPECTED_MIN_CONSTITUENTS:
                return constituents, {
                    "source": "Nasdaq Global Index Watch /Index/WeightingData",
                    "tradeDate": trade_date,
                    "requestedTradeDates": candidates,
                    "timeOfDay": "SOD",
                    "recordCount": len(constituents),
                    "officialWeightsAvailable": any(c.get("officialWeight") is not None for c in constituents),
                    "override": bool(NASDAQ_TRADE_DATE_OVERRIDE),
                }, failures
            failures.append(f"Nasdaq constituent count too low for {trade_date}: {len(constituents)}")
        except Exception as exc:  # noqa: BLE001 - source failure is captured in JSON
            failures.append(f"Nasdaq WeightingData failed for {trade_date}: {type(exc).__name__}: {exc}")

    return [
        {"ticker": ticker, "indexName": name, "displayName": COMPANY_ALIASES.get(ticker, name.title()), "officialWeight": None}
        for ticker, name in SEED_CONSTITUENTS
    ], {
        "source": "bundled seed from last verified Nasdaq free SOX constituent list",
        "tradeDate": candidates[0] if candidates else None,
        "requestedTradeDates": candidates,
        "timeOfDay": "SOD",
        "recordCount": len(SEED_CONSTITUENTS),
        "officialWeightsAvailable": False,
        "fallback": True,
    }, failures


def clean_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def fetch_chart(symbol: str) -> dict[str, Any]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range=18mo&interval=1d&events=history"
    payload = http_json(url)
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise ValueError("empty chart result")
    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = ((result.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or quote.get("close") or []
    volumes = quote.get("volume") or []
    points = []
    for ts, close, volume in zip(timestamps, closes, volumes):
        close_num = clean_number(close)
        if close_num is None:
            continue
        date = dt.datetime.fromtimestamp(int(ts), tz=dt.timezone.utc).date().isoformat()
        points.append({"date": date, "close": close_num, "volume": clean_number(volume)})
    if not points:
        raise ValueError("no close points")
    return {"meta": meta, "prices": points}


def fetch_fundamentals(symbol: str) -> dict[str, Any]:
    types = ",".join(YAHOO_TYPES)
    url = (
        "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"
        f"{urllib.parse.quote(symbol)}?type={types}&merge=false&period1={YAHOO_PERIOD1}&period2={YAHOO_PERIOD2}"
    )
    payload = http_json(url)
    result = payload.get("timeseries", {}).get("result") or []
    mapped: dict[str, list[dict[str, Any]]] = {}
    for block in result:
        meta_type = ((block.get("meta") or {}).get("type") or [None])[0]
        if not meta_type:
            continue
        entries = []
        for item in block.get(meta_type) or []:
            reported = item.get("reportedValue") or {}
            raw = clean_number(reported.get("raw"))
            entries.append({
                "asOfDate": item.get("asOfDate"),
                "periodType": item.get("periodType"),
                "currencyCode": item.get("currencyCode"),
                "raw": raw,
                "fmt": reported.get("fmt"),
            })
        entries = [e for e in entries if e.get("asOfDate") and e.get("raw") is not None]
        entries.sort(key=lambda x: x["asOfDate"])
        mapped[meta_type] = entries
    return mapped


def pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return current / previous - 1


def nearest_return(prices: list[dict[str, Any]], trading_days: int) -> float | None:
    if len(prices) <= trading_days:
        return None
    return pct_change(prices[-1]["close"], prices[-1 - trading_days]["close"])


def moving_average(prices: list[dict[str, Any]], window: int) -> float | None:
    if len(prices) < window:
        return None
    return statistics.fmean(p["close"] for p in prices[-window:])


def annualized_vol(prices: list[dict[str, Any]], window: int = 63) -> float | None:
    if len(prices) < window + 1:
        return None
    returns = []
    tail = prices[-(window + 1):]
    for prev, curr in zip(tail, tail[1:]):
        r = pct_change(curr["close"], prev["close"])
        if r is not None:
            returns.append(r)
    if len(returns) < 5:
        return None
    return statistics.pstdev(returns) * math.sqrt(252)


def rsi(prices: list[dict[str, Any]], window: int = 14) -> float | None:
    if len(prices) < window + 1:
        return None
    gains = []
    losses = []
    tail = prices[-(window + 1):]
    for prev, curr in zip(tail, tail[1:]):
        diff = curr["close"] - prev["close"]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = statistics.fmean(gains)
    avg_loss = statistics.fmean(losses)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def latest(entries: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not entries:
        return None
    return entries[-1]


def yoy(entries: list[dict[str, Any]] | None) -> float | None:
    if not entries or len(entries) < 5:
        return None
    return pct_change(entries[-1].get("raw"), entries[-5].get("raw"))


def rank_scores(values: dict[str, float | None], *, high_is_good: bool = True) -> dict[str, float | None]:
    valid = [(k, v) for k, v in values.items() if v is not None and math.isfinite(v)]
    if not valid:
        return {k: None for k in values}
    valid.sort(key=lambda kv: kv[1], reverse=high_is_good)
    n = len(valid)
    scores = {}
    for index, (key, _value) in enumerate(valid):
        scores[key] = 1.0 if n == 1 else 1 - (index / (n - 1))
    return {k: scores.get(k) for k in values}


def zish(value: float | None, values: list[float]) -> float | None:
    if value is None or not values:
        return None
    mean = statistics.fmean(values)
    sd = statistics.pstdev(values)
    if sd == 0:
        return 0.0
    return (value - mean) / sd


def weighted_average(parts: list[tuple[float | None, float]]) -> float | None:
    valid = [(value, weight) for value, weight in parts if value is not None and math.isfinite(value)]
    if not valid:
        return None
    total_weight = sum(weight for _value, weight in valid)
    if total_weight <= 0:
        return None
    return sum(value * weight for value, weight in valid) / total_weight


def classify(price_score: float | None, earnings_score: float | None) -> str:
    if price_score is None and earnings_score is None:
        return "데이터 확인 필요"
    if (price_score or 0) >= 0.67 and (earnings_score or 0) >= 0.67:
        return "가격·실적 동반 강세"
    if (price_score or 0) >= 0.67 and (earnings_score or 0) < 0.45:
        return "가격 선행 / 실적 확인"
    if (price_score or 0) < 0.45 and (earnings_score or 0) >= 0.67:
        return "실적 대비 가격 후행"
    if (price_score or 0) < 0.35 and (earnings_score or 0) < 0.35:
        return "동반 약세"
    return "중립/혼재"


def analyze_symbol(row: dict[str, Any]) -> dict[str, Any]:
    symbol = row["ticker"]
    failures: list[str] = []
    chart: dict[str, Any] = {"meta": {}, "prices": []}
    fundamentals: dict[str, Any] = {}
    try:
        chart = fetch_chart(symbol)
        time.sleep(0.02)
    except Exception as exc:  # noqa: BLE001
        failures.append(f"chart: {type(exc).__name__}: {exc}")
    try:
        fundamentals = fetch_fundamentals(symbol)
        time.sleep(0.02)
    except Exception as exc:  # noqa: BLE001
        failures.append(f"fundamentals: {type(exc).__name__}: {exc}")

    prices = chart.get("prices") or []
    last = prices[-1]["close"] if prices else None
    ma50 = moving_average(prices, 50)
    ma200 = moving_average(prices, 200)
    high_252 = max((p["close"] for p in prices[-252:]), default=None)
    low_252 = min((p["close"] for p in prices[-252:]), default=None)
    market_cap = clean_number((latest(fundamentals.get("trailingMarketCap")) or {}).get("raw"))
    revenue = clean_number((latest(fundamentals.get("trailingTotalRevenue")) or {}).get("raw"))
    net_income = clean_number((latest(fundamentals.get("trailingNetIncome")) or {}).get("raw"))
    pe = clean_number((latest(fundamentals.get("trailingPeRatio")) or {}).get("raw"))
    latest_q_rev = latest(fundamentals.get("quarterlyTotalRevenue"))
    latest_q_eps = latest(fundamentals.get("quarterlyDilutedEPS"))
    latest_q_income = latest(fundamentals.get("quarterlyNetIncome"))

    return {
        "ticker": symbol,
        "name": row.get("displayName") or row.get("indexName") or symbol,
        "indexName": row.get("indexName"),
        "currency": (chart.get("meta") or {}).get("currency"),
        "exchange": (chart.get("meta") or {}).get("exchangeName"),
        "lastTradeDate": prices[-1]["date"] if prices else None,
        "price": last,
        "marketCap": market_cap,
        "officialWeight": row.get("officialWeight"),
        "proxyWeight": None,
        "metrics": {
            "return1m": nearest_return(prices, 21),
            "return3m": nearest_return(prices, 63),
            "return6m": nearest_return(prices, 126),
            "return12m": nearest_return(prices, 252),
            "ma50": ma50,
            "ma200": ma200,
            "ma50Gap": pct_change(last, ma50),
            "ma200Gap": pct_change(last, ma200),
            "drawdown52w": pct_change(last, high_252),
            "range52wPosition": None if high_252 is None or low_252 is None or high_252 == low_252 or last is None else (last - low_252) / (high_252 - low_252),
            "volatility63d": annualized_vol(prices, 63),
            "rsi14": rsi(prices, 14),
            "trailingRevenue": revenue,
            "trailingNetIncome": net_income,
            "netMargin": None if revenue in (None, 0) or net_income is None else net_income / revenue,
            "trailingPe": pe,
            "quarterlyRevenueLatest": None if latest_q_rev is None else latest_q_rev.get("raw"),
            "quarterlyRevenueDate": None if latest_q_rev is None else latest_q_rev.get("asOfDate"),
            "quarterlyRevenueYoY": yoy(fundamentals.get("quarterlyTotalRevenue")),
            "quarterlyEpsLatest": None if latest_q_eps is None else latest_q_eps.get("raw"),
            "quarterlyEpsDate": None if latest_q_eps is None else latest_q_eps.get("asOfDate"),
            "quarterlyEpsYoY": yoy(fundamentals.get("quarterlyDilutedEPS")),
            "quarterlyNetIncomeLatest": None if latest_q_income is None else latest_q_income.get("raw"),
            "quarterlyNetIncomeDate": None if latest_q_income is None else latest_q_income.get("asOfDate"),
            "quarterlyNetIncomeYoY": yoy(fundamentals.get("quarterlyNetIncome")),
        },
        "chart": {
            "prices": prices[-260:],
        },
        "dataQuality": {
            "ok": not failures,
            "failures": failures,
            "pricePoints": len(prices),
            "fundamentalTypes": sorted(fundamentals.keys()),
        },
    }


def enrich_scores(rows: list[dict[str, Any]]) -> None:
    total_cap = sum((r.get("marketCap") or 0) for r in rows if r.get("marketCap"))
    for r in rows:
        if total_cap and r.get("marketCap"):
            r["proxyWeight"] = r["marketCap"] / total_cap

    values_by_metric = {
        "return1m": {r["ticker"]: r["metrics"].get("return1m") for r in rows},
        "return3m": {r["ticker"]: r["metrics"].get("return3m") for r in rows},
        "return6m": {r["ticker"]: r["metrics"].get("return6m") for r in rows},
        "return12m": {r["ticker"]: r["metrics"].get("return12m") for r in rows},
        "ma50Gap": {r["ticker"]: r["metrics"].get("ma50Gap") for r in rows},
        "ma200Gap": {r["ticker"]: r["metrics"].get("ma200Gap") for r in rows},
        "drawdown52w": {r["ticker"]: r["metrics"].get("drawdown52w") for r in rows},
        "range52wPosition": {r["ticker"]: r["metrics"].get("range52wPosition") for r in rows},
        "quarterlyRevenueYoY": {r["ticker"]: r["metrics"].get("quarterlyRevenueYoY") for r in rows},
        "quarterlyEpsYoY": {r["ticker"]: r["metrics"].get("quarterlyEpsYoY") for r in rows},
        "quarterlyNetIncomeYoY": {r["ticker"]: r["metrics"].get("quarterlyNetIncomeYoY") for r in rows},
        "netMargin": {r["ticker"]: r["metrics"].get("netMargin") for r in rows},
        "trailingPe": {r["ticker"]: r["metrics"].get("trailingPe") for r in rows},
    }
    ranks = {metric: rank_scores(vals, high_is_good=True) for metric, vals in values_by_metric.items()}
    # Lower trailing PE receives a higher score as a small valuation-context input.
    ranks["trailingPe"] = rank_scores(values_by_metric["trailingPe"], high_is_good=False)

    for r in rows:
        t = r["ticker"]
        price_score = weighted_average([
            (ranks["return1m"].get(t), 0.12),
            (ranks["return3m"].get(t), 0.20),
            (ranks["return6m"].get(t), 0.22),
            (ranks["return12m"].get(t), 0.18),
            (ranks["ma50Gap"].get(t), 0.10),
            (ranks["ma200Gap"].get(t), 0.10),
            (ranks["drawdown52w"].get(t), 0.04),
            (ranks["range52wPosition"].get(t), 0.04),
        ])
        earnings_score = weighted_average([
            (ranks["quarterlyRevenueYoY"].get(t), 0.35),
            (ranks["quarterlyEpsYoY"].get(t), 0.30),
            (ranks["quarterlyNetIncomeYoY"].get(t), 0.20),
            (ranks["netMargin"].get(t), 0.10),
            (ranks["trailingPe"].get(t), 0.05),
        ])
        combined = weighted_average([(price_score, 0.55), (earnings_score, 0.45)])
        r["scores"] = {
            "priceMomentum": price_score,
            "earningsMomentum": earnings_score,
            "combined": combined,
            "label": classify(price_score, earnings_score),
        }
    rows.sort(key=lambda r: (r.get("scores", {}).get("combined") is None, -(r.get("scores", {}).get("combined") or -1)))
    for idx, row in enumerate(rows, 1):
        row["rank"] = idx


def top(rows: list[dict[str, Any]], key: str, count: int = 10) -> list[dict[str, Any]]:
    def getv(row: dict[str, Any]) -> float:
        if key.startswith("metrics."):
            val = row.get("metrics", {}).get(key.split(".", 1)[1])
        elif key.startswith("scores."):
            val = row.get("scores", {}).get(key.split(".", 1)[1])
        else:
            val = row.get(key)
        return -10**18 if val is None or not isinstance(val, (int, float)) or not math.isfinite(val) else val
    return sorted(rows, key=getv, reverse=True)[:count]


def compact_row(row: dict[str, Any]) -> dict[str, Any]:
    metrics = row.get("metrics", {})
    scores = row.get("scores", {})
    return {
        "rank": row.get("rank"),
        "ticker": row.get("ticker"),
        "name": row.get("name"),
        "proxyWeight": row.get("proxyWeight"),
        "marketCap": row.get("marketCap"),
        "price": row.get("price"),
        "return3m": metrics.get("return3m"),
        "return12m": metrics.get("return12m"),
        "quarterlyRevenueYoY": metrics.get("quarterlyRevenueYoY"),
        "quarterlyEpsYoY": metrics.get("quarterlyEpsYoY"),
        "priceMomentum": scores.get("priceMomentum"),
        "earningsMomentum": scores.get("earningsMomentum"),
        "combined": scores.get("combined"),
        "label": scores.get("label"),
    }


def git_remote_status() -> dict[str, Any]:
    try:
        remote_url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return {
            "remoteConfigured": False,
            "publicPagesReadback": "blocked: no git remote configured in this worktree",
        }
    return {
        "remoteConfigured": bool(remote_url),
        "remoteUrl": remote_url,
        "publicPagesReadback": "pending: verify https://sonchanggi.github.io/sox/ after GitHub Pages deployment",
    }


def build_payload(rows: list[dict[str, Any]], constituent_meta: dict[str, Any], failures: list[str]) -> dict[str, Any]:
    dates = [r.get("lastTradeDate") for r in rows if r.get("lastTradeDate")]
    max_date = max(dates) if dates else None
    cap_coverage = sum(1 for r in rows if r.get("marketCap"))
    price_coverage = sum(1 for r in rows if r.get("price"))
    fundamental_coverage = sum(1 for r in rows if r.get("metrics", {}).get("quarterlyRevenueYoY") is not None)
    top_weight = top(rows, "proxyWeight", 8)
    top_price = top(rows, "scores.priceMomentum", 8)
    top_earnings = top(rows, "scores.earningsMomentum", 8)
    top_combined = top(rows, "scores.combined", 10)
    official_weights = any(r.get("officialWeight") is not None for r in rows)
    return {
        "schemaVersion": 1,
        "projectId": "sox",
        "generatedAt": now_iso(),
        "dataAsOf": max_date,
        "index": {
            "symbol": "SOX",
            "name": "PHLX Semiconductor Sector Index",
            "description": "Modified market capitalization-weighted semiconductor index. Free dashboard metrics use generated public-source data.",
            "constituentCount": len(rows),
            "constituentSource": constituent_meta,
            "weightMethod": "official" if official_weights else "market_cap_proxy",
            "weightMethodLabel": "Official Nasdaq weighting" if official_weights else "Market-cap-normalized proxy weight (not official SOX weight)",
        },
        "coverage": {
            "price": {"count": price_coverage, "ratio": price_coverage / len(rows) if rows else 0},
            "marketCap": {"count": cap_coverage, "ratio": cap_coverage / len(rows) if rows else 0},
            "fundamentals": {"count": fundamental_coverage, "ratio": fundamental_coverage / len(rows) if rows else 0},
        },
        "sources": {
            "nasdaq": {
                "name": "Nasdaq Global Index Watch",
                "url": "https://indexes.nasdaqomx.com/Index/Weighting/SOX",
                "usage": "SOX constituent list; exact free official weights may be unavailable without full access.",
            },
            "yahooFinance": {
                "name": "Yahoo Finance public endpoints",
                "url": "https://query1.finance.yahoo.com/",
                "usage": "Daily chart history, market cap, PE, revenue, net income, EPS timeseries for generated analytics.",
            },
        },
        "history": {
            "url": "data/sox-history.json",
            "policy": "Each successful refresh appends or replaces the stored snapshot for its dataAsOf date so the browser can inspect prior generated dates.",
        },
        "status": {
            "level": "ok" if not failures and price_coverage >= EXPECTED_MIN_CONSTITUENTS else "degraded",
            "message": "Generated from live public sources." if not failures else "Generated with partial source failures; see failures list.",
            "failures": failures,
            **git_remote_status(),
        },
        "summaryCards": [
            {"label": "Constituents", "value": len(rows), "detail": constituent_meta.get("tradeDate")},
            {"label": "Price coverage", "value": price_coverage, "detail": f"{price_coverage}/{len(rows)} tickers"},
            {"label": "Fundamental coverage", "value": fundamental_coverage, "detail": "YoY revenue coverage"},
            {"label": "Top proxy weight", "value": top_weight[0]["ticker"] if top_weight else None, "detail": top_weight[0].get("proxyWeight") if top_weight else None},
        ],
        "leaders": {
            "proxyWeight": [compact_row(r) for r in top_weight],
            "priceMomentum": [compact_row(r) for r in top_price],
            "earningsMomentum": [compact_row(r) for r in top_earnings],
            "combined": [compact_row(r) for r in top_combined],
        },
        "constituents": rows,
        "methodology": {
            "priceMomentum": "Composite rank of 1M/3M/6M/12M returns, moving-average gaps, 52-week drawdown resilience, and 52-week range position.",
            "earningsMomentum": "Composite rank of latest quarterly revenue/EPS/net-income YoY growth, TTM net margin, and lower trailing PE as a small valuation context input.",
            "combined": "55% price momentum + 45% earnings/fundamental momentum when both are available.",
            "weightCaveat": "Proxy weights are normalized by Yahoo trailing market cap and are not official SOX index weights unless official weights are present in the free Nasdaq payload.",
        },
    }


def compact_history_snapshot(analysis: dict[str, Any]) -> dict[str, Any]:
    """Return a browser-usable historical snapshot without heavy price charts."""

    constituents = []
    for row in analysis.get("constituents") or []:
        if not isinstance(row, dict):
            continue
        compact = dict(row)
        compact.pop("chart", None)
        constituents.append(compact)
    return {
        "schemaVersion": analysis.get("schemaVersion", 1),
        "projectId": "sox",
        "generatedAt": analysis.get("generatedAt"),
        "dataAsOf": analysis.get("dataAsOf"),
        "index": analysis.get("index"),
        "coverage": analysis.get("coverage"),
        "sources": analysis.get("sources"),
        "status": analysis.get("status"),
        "summaryCards": analysis.get("summaryCards"),
        "leaders": analysis.get("leaders"),
        "constituents": constituents,
        "methodology": analysis.get("methodology"),
    }


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def build_history(analysis: dict[str, Any]) -> dict[str, Any]:
    """Merge the latest generated analysis into stored per-date snapshots."""

    snapshots_by_date: dict[str, dict[str, Any]] = {}

    existing_history = _load_json_object(HISTORY_PATH)
    for snapshot in existing_history.get("snapshots") or []:
        if isinstance(snapshot, dict) and snapshot.get("dataAsOf"):
            snapshots_by_date[str(snapshot["dataAsOf"])] = snapshot

    existing_analysis = _load_json_object(ANALYSIS_PATH)
    if existing_analysis.get("dataAsOf"):
        snapshots_by_date[str(existing_analysis["dataAsOf"])] = compact_history_snapshot(existing_analysis)

    if analysis.get("dataAsOf"):
        snapshots_by_date[str(analysis["dataAsOf"])] = compact_history_snapshot(analysis)

    snapshots = sorted(snapshots_by_date.values(), key=lambda item: str(item.get("dataAsOf") or ""), reverse=True)
    return {
        "schemaVersion": 1,
        "projectId": "sox",
        "generatedAt": analysis.get("generatedAt") or now_iso(),
        "latestDataAsOf": analysis.get("dataAsOf"),
        "snapshotCount": len(snapshots),
        "snapshots": snapshots,
    }


def build_summary(analysis: dict[str, Any], history: dict[str, Any] | None = None) -> dict[str, Any]:
    leaders = analysis.get("leaders", {}).get("combined", [])[:5]
    primary = []
    for index, row in enumerate(leaders, start=1):
        primary.append({
            "id": row.get("ticker"),
            "symbol": row.get("ticker"),
            "label": row.get("ticker"),
            "name": row.get("name"),
            "metrics": {
                "rank": row.get("rank") or index,
                "score": row.get("combined"),
                "priceMomentum": row.get("priceMomentum"),
                "earningsMomentum": row.get("earningsMomentum"),
                "weight": row.get("proxyWeight"),
            },
            "status": row.get("label"),
            "signals": [row.get("label")] if row.get("label") else [],
            "warnings": ["Proxy weight is market-cap-normalized unless official free Nasdaq weights are present."],
        })
    coverage = analysis.get("coverage") or {}
    history = history or {}
    return {
        "schemaVersion": 1,
        "contract": "quant-research-summary",
        "projectId": "sox",
        "projectName": "SOX Semiconductor Index",
        "status": {
            "state": analysis.get("status", {}).get("level", "unknown"),
            "label": analysis.get("status", {}).get("message", "SOX public summary"),
            "cadence": "scheduled 07:30/09:30/11:30/13:30 KST Tue-Sat plus reviewed workflow_dispatch",
            "expectedFreshnessDays": 3,
            "degradedReasons": analysis.get("status", {}).get("failures", [])[:5],
        },
        "generatedAt": analysis.get("generatedAt"),
        "dataAsOf": analysis.get("dataAsOf"),
        "summary": "SOX 구성종목의 프록시 비중, 가격 모멘텀, 실적 모멘텀을 정적 JSON으로 비교합니다.",
        "primaryEntities": primary,
        "sourceUrl": "https://sonchanggi.github.io/sox/data/sox-analysis.json",
        "historyUrl": "https://sonchanggi.github.io/sox/data/sox-history.json",
        "pageUrl": "https://sonchanggi.github.io/sox/",
        "coverage": {
            "entityCount": analysis.get("index", {}).get("constituentCount"),
            "price": coverage.get("price"),
            "marketCap": coverage.get("marketCap"),
            "fundamentals": coverage.get("fundamentals"),
            "snapshotCount": history.get("snapshotCount", 0),
            "historyStorage": "data/sox-history.json",
        },
        "automation": {
            "workflowUrl": "https://github.com/SonChangGi/sox/actions/workflows/deploy-pages.yml",
            "manualUpdateLabel": "GitHub Actions deploy-pages 수동 실행",
            "tokenPolicy": "Static page keeps no GitHub token; refresh script owns public-source access.",
            "scheduleKst": ["07:30 Tue-Sat", "09:30 Tue-Sat retry", "11:30 Tue-Sat retry", "13:30 Tue-Sat retry"],
            "validation": "npm test verifies generated analysis, history, summary contract, browser endpoint boundaries, and static smoke readback.",
        },
        "limitations": [
            "Research only; not investment advice.",
            analysis.get("methodology", {}).get("weightCaveat"),
            "Nasdaq/Yahoo public endpoints can lag or omit fields; failed providers are captured in status.degradedReasons.",
            analysis.get("status", {}).get("publicPagesReadback"),
        ],
        "sources": [
            {"label": "Nasdaq Global Index Watch", "url": "https://indexes.nasdaqomx.com/Index/Weighting/SOX"},
            {"label": "Yahoo Finance public endpoints", "url": "https://query1.finance.yahoo.com/"},
        ],
        "freshness": {
            "status": analysis.get("status", {}).get("level", "unknown"),
            "detail": analysis.get("status", {}).get("message"),
        },
        "caveats": [
            "Research only; not investment advice.",
            analysis.get("methodology", {}).get("weightCaveat"),
            analysis.get("status", {}).get("publicPagesReadback"),
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline-ok", action="store_true", help="Use existing generated JSON if live refresh fails.")
    parser.add_argument("--max-workers", type=int, default=8)
    args = parser.parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    try:
        constituents, meta, source_failures = fetch_constituents()
        failures.extend(source_failures)
        rows: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=max(1, args.max_workers)) as pool:
            futures = {pool.submit(analyze_symbol, c): c for c in constituents}
            for future in as_completed(futures):
                c = futures[future]
                try:
                    rows.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"{c['ticker']}: {type(exc).__name__}: {exc}")
                    rows.append({
                        "ticker": c["ticker"], "name": c.get("displayName") or c["ticker"], "indexName": c.get("indexName"),
                        "price": None, "marketCap": None, "officialWeight": c.get("officialWeight"), "proxyWeight": None,
                        "metrics": {}, "chart": {"prices": []},
                        "dataQuality": {"ok": False, "failures": [str(exc)], "pricePoints": 0, "fundamentalTypes": []},
                    })
        enrich_scores(rows)
        analysis = build_payload(rows, meta, failures)
        history = build_history(analysis)
        summary = build_summary(analysis, history)
        ANALYSIS_PATH.write_text(json.dumps(analysis, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        HISTORY_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        print(f"wrote {ANALYSIS_PATH} ({len(rows)} constituents, status={analysis['status']['level']})")
        print(f"wrote {HISTORY_PATH} ({history['snapshotCount']} stored snapshots)")
        print(f"wrote {SUMMARY_PATH}")
        return 0
    except Exception as exc:  # noqa: BLE001
        if args.offline_ok and ANALYSIS_PATH.exists() and SUMMARY_PATH.exists():
            print(f"live refresh failed, keeping existing JSON: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 0
        print(f"refresh failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
