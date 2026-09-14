"""Pure checks shared by SOX collection and scheduled freshness decisions."""
from __future__ import annotations

import datetime as dt
import math
from typing import Any

from earnings_growth import earnings_growth

MIN_CONSTITUENTS = 25


def _finite_number(value: Any, *, positive: bool = False) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and (not positive or value > 0)
    except OverflowError:
        return False


def _date(value: Any) -> dt.date | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.isoformat() == value else None


def _valid_growth(metrics: dict[str, Any], prefix: str) -> bool:
    growth = metrics.get(f"{prefix}Growth")
    if prefix == "quarterlyRevenue" or not isinstance(growth, dict):
        return False
    previous = growth.get("previous")
    current = growth.get("current")
    previous_date = _date(growth.get("previousDate"))
    current_date = _date(growth.get("currentDate"))
    valid_observations = (
        _finite_number(previous)
        and _finite_number(current)
        and current == metrics.get(f"{prefix}Latest")
        and current_date is not None
        and current_date == _date(metrics.get(f"{prefix}Date"))
        and previous_date is not None
        and 350 <= (current_date - previous_date).days <= 380
        and growth.get("methodology") == "absolute_prior_base_change_v1"
    )
    if not valid_observations or any(key not in growth for key in ("state", "yoy", "changeSignal", "reason")):
        return False
    expected = earnings_growth([
        {"asOfDate": growth["previousDate"], "raw": previous},
        {"asOfDate": growth["currentDate"], "raw": current},
    ])
    if expected["state"] == "unavailable" or expected["reason"] not in (None, "zero_prior_year_base"):
        return False
    # Reuse the producer's definition for direction, valid zero-base omission,
    # and both ratios; provided context must agree even when legacy YoY is finite.
    for key in ("state", "reason", "yoy", "changeSignal"):
        actual, reference = growth[key], expected[key]
        if key in ("yoy", "changeSignal") and reference is not None and not _finite_number(actual):
            return False
        if actual != reference:
            return False
    return metrics.get(f"{prefix}YoY") == expected["yoy"]


def collect_data_quality_failures(
    rows: Any,
    constituent_meta: Any = None,
    *,
    data_as_of: Any = None,
) -> list[str]:
    """Return actionable failures without changing rows or reading external state.

    Optional ``data_as_of`` checks a stored payload's aggregate date against
    every row. A new collector payload can omit it; mixed row dates still fail.
    A null earnings YoY is intentional only when its growth context records a
    nonpositive base, while its latest reported value and period remain valid.
    """
    failures: list[str] = []
    if not isinstance(rows, list):
        return ["Constituents must be a list"]
    if len(rows) < MIN_CONSTITUENTS:
        failures.append(f"Constituent count below {MIN_CONSTITUENTS}: {len(rows)}")
    if constituent_meta is not None:
        count = constituent_meta.get("recordCount") if isinstance(constituent_meta, dict) else None
        if not isinstance(count, int) or isinstance(count, bool) or count < MIN_CONSTITUENTS:
            failures.append("Missing or invalid Nasdaq constituent recordCount")
        elif len(rows) != count:
            failures.append(f"Constituent count differs from Nasdaq recordCount: {len(rows)} != {count}")

    expected_date = _date(data_as_of) if data_as_of is not None else None
    if data_as_of is not None and expected_date is None:
        failures.append("Missing or invalid aggregate dataAsOf")
    seen: set[str] = set()
    dates: set[dt.date] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            failures.append(f"Constituent {index + 1} must be an object")
            continue
        symbol = row.get("ticker")
        ticker = symbol.strip().upper() if isinstance(symbol, str) else ""
        label = ticker or f"Constituent {index + 1}"
        if not ticker:
            failures.append(f"{label}: missing ticker")
        elif ticker in seen:
            failures.append(f"{label}: duplicate ticker")
        seen.add(ticker)

        quality = row.get("dataQuality")
        quality = quality if isinstance(quality, dict) else {}
        if quality.get("ok") is not True:
            failures.append(f"{label}: dataQuality.ok is not true")
        row_failures = quality.get("failures")
        if not isinstance(row_failures, list):
            failures.append(f"{label}: missing or invalid provider failures list")
        else:
            failures.extend(f"{label}: {failure}" for failure in row_failures)
        points = quality.get("pricePoints")
        if not isinstance(points, int) or isinstance(points, bool) or points <= 0:
            failures.append(f"{label}: missing or invalid pricePoints")

        for key in ("price", "marketCap"):
            if not _finite_number(row.get(key), positive=True):
                failures.append(f"{label}: missing or invalid {key}")
        row_date = _date(row.get("lastTradeDate"))
        if row_date is None:
            failures.append(f"{label}: missing or invalid lastTradeDate")
        else:
            dates.add(row_date)
            if expected_date is not None and row_date != expected_date:
                failures.append(f"{label}: lastTradeDate {row_date} differs from dataAsOf {expected_date}")

        metrics = row.get("metrics")
        metrics = metrics if isinstance(metrics, dict) else {}
        for prefix in ("quarterlyRevenue", "quarterlyEps", "quarterlyNetIncome"):
            if not _finite_number(metrics.get(f"{prefix}Latest")):
                failures.append(f"{label}: missing or invalid {prefix}Latest")
            if _date(metrics.get(f"{prefix}Date")) is None:
                failures.append(f"{label}: missing or invalid {prefix}Date")
            growth = metrics.get(f"{prefix}YoY")
            has_context = f"{prefix}Growth" in metrics
            valid_context = _valid_growth(metrics, prefix) if has_context else False
            if has_context and not valid_context:
                failures.append(f"{label}: missing or invalid {prefix}Growth")
            intentional_null = (
                growth is None
                and valid_context
            )
            if not _finite_number(growth) and not intentional_null:
                failures.append(f"{label}: missing or invalid {prefix}YoY")
        for key in ("trailingRevenue", "trailingNetIncome", "netMargin"):
            if not _finite_number(metrics.get(key), positive=key == "trailingRevenue"):
                failures.append(f"{label}: missing or invalid {key}")
        # P/E is optional: a loss-making company can legitimately have no P/E.
    if len(dates) > 1:
        failures.append(f"Mixed lastTradeDate values: {', '.join(str(day) for day in sorted(dates))}")
    return failures
