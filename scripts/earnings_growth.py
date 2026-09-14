"""Separate conventional earnings YoY from a signed ranking input.

For a positive prior-year value, both inputs keep the conventional
``current / previous - 1`` calculation. For a negative prior-year value,
YoY is not meaningful and stays null; the ranking input instead divides the
change by the absolute prior-year value. It measures direction and size against
that company's own prior-year base, not a conventional growth percentage.
A zero prior-year value supplies a state but no ratio or ranking input.
"""
from __future__ import annotations

import datetime as dt
import math
from typing import Any


EARNINGS_GROWTH_METHOD = "absolute_prior_base_change_v1"


def _finite_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _date(value: Any) -> dt.date | None:
    if not isinstance(value, str):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def _state(current: float, previous: float) -> str:
    if previous > 0:
        if current < 0:
            return "profit_to_loss"
        if current == 0:
            return "profit_to_breakeven"
        if current > previous:
            return "profit_growth"
        return "profit_decline" if current < previous else "unchanged_profit"
    if previous < 0:
        if current > 0:
            return "turnaround"
        if current == 0:
            return "loss_to_breakeven"
        if current > previous:
            return "loss_narrowing"
        return "loss_widening" if current < previous else "unchanged_loss"
    if current > 0:
        return "profit_from_zero"
    return "loss_from_zero" if current < 0 else "unchanged_zero"


def earnings_growth(entries: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Compare the latest sorted quarterly observation with its prior-year pair.

    The collector supplies entries sorted by ``asOfDate``. A pair must be
    350-380 days apart, allowing 52/53-week fiscal calendars and leap years.
    Choosing by date, rather than the fifth-last value, avoids a false YoY when
    an intervening quarter is missing. Where supplied, period and currency must
    agree. Dates are accounting period ends, not publication or collection times.
    """
    result: dict[str, Any] = {
        "yoy": None,
        "state": "unavailable",
        "changeSignal": None,
        "current": None,
        "previous": None,
        "currentDate": None,
        "previousDate": None,
        "methodology": EARNINGS_GROWTH_METHOD,
        "reason": "insufficient_history",
    }
    if not entries:
        return result
    current_entry = entries[-1]
    result["current"] = _finite_number(current_entry.get("raw"))
    result["currentDate"] = current_entry.get("asOfDate")
    current_date = _date(result["currentDate"])
    if current_date is None:
        result["reason"] = "invalid_current_date"
        return result
    if len(entries) < 2:
        return result

    candidates = []
    for entry in entries[:-1]:
        previous_date = _date(entry.get("asOfDate"))
        if previous_date is None:
            continue
        days = (current_date - previous_date).days
        if 350 <= days <= 380:
            candidates.append((abs(days - 365), entry))
    if not candidates:
        result["reason"] = "missing_prior_year_quarter"
        return result
    previous_entry = min(candidates, key=lambda item: item[0])[1]
    result["previous"] = _finite_number(previous_entry.get("raw"))
    result["previousDate"] = previous_entry.get("asOfDate")

    for field in ("periodType", "currencyCode"):
        current_field = current_entry.get(field)
        previous_field = previous_entry.get(field)
        if current_field and previous_field and current_field != previous_field:
            result["reason"] = f"mismatched_{field}"
            return result
    current, previous = result["current"], result["previous"]
    if current is None or previous is None:
        result["reason"] = "missing_or_nonfinite_value"
        return result

    result["state"] = _state(current, previous)
    result["reason"] = None
    if previous == 0:
        result["reason"] = "zero_prior_year_base"
        return result

    # Algebraically (current - previous) / abs(previous), avoiding overflow
    # in the subtraction while preserving the positive-base formula exactly.
    signal = current / previous - 1 if previous > 0 else current / -previous + 1
    if not math.isfinite(signal):
        result["reason"] = "nonfinite_change_signal"
        return result
    result["changeSignal"] = signal
    result["yoy"] = signal if previous > 0 else None
    return result
