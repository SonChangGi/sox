#!/usr/bin/env python3
"""GitHub Actions freshness gate for SOX scheduled retries.

Scheduled runs skip only when the committed generated JSON was produced after
the 06:30 KST automation window and already covers the latest expected U.S.
regular-session date. If the primary run fails to commit data, later cron slots
remain eligible to retry. Fresh scheduled retry slots also skip deployment so
they do not create Pages work or failure mail when no data can change.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
CUTOFF_KST = dt.time(hour=6, minute=30)


def latest_expected_us_session_date(now_utc: dt.datetime) -> dt.date:
    local_today = ensure_utc(now_utc).astimezone(KST).date()
    candidate = local_today - dt.timedelta(days=1)
    while not is_us_equity_regular_session(candidate):
        candidate -= dt.timedelta(days=1)
    return candidate


def is_us_equity_regular_session(day: dt.date) -> bool:
    return day.weekday() < 5 and us_equity_holiday_name(day) is None


def us_equity_holiday_name(day: dt.date) -> str | None:
    holidays = {
        **us_equity_holidays(day.year),
        **us_equity_holidays(day.year + 1),
    }
    return holidays.get(day)


def us_equity_holidays(year: int) -> dict[dt.date, str]:
    holidays = {
        observed_fixed_holiday(year, 1, 1): "new_years_day",
        nth_weekday(year, 1, 0, 3): "martin_luther_king_jr_day",
        nth_weekday(year, 2, 0, 3): "washingtons_birthday",
        easter_sunday(year) - dt.timedelta(days=2): "good_friday",
        last_weekday(year, 5, 0): "memorial_day",
        observed_fixed_holiday(year, 7, 4): "independence_day",
        nth_weekday(year, 9, 0, 1): "labor_day",
        nth_weekday(year, 11, 3, 4): "thanksgiving_day",
        observed_fixed_holiday(year, 12, 25): "christmas_day",
    }
    if year >= 2022:
        holidays[observed_fixed_holiday(year, 6, 19)] = "juneteenth"
    return holidays


def observed_fixed_holiday(year: int, month: int, day: int) -> dt.date:
    actual = dt.date(year, month, day)
    if actual.weekday() == 5:
        return actual - dt.timedelta(days=1)
    if actual.weekday() == 6:
        return actual + dt.timedelta(days=1)
    return actual


def nth_weekday(year: int, month: int, weekday: int, nth: int) -> dt.date:
    first = dt.date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + dt.timedelta(days=offset + (nth - 1) * 7)


def last_weekday(year: int, month: int, weekday: int) -> dt.date:
    if month == 12:
        cursor = dt.date(year + 1, 1, 1) - dt.timedelta(days=1)
    else:
        cursor = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    while cursor.weekday() != weekday:
        cursor -= dt.timedelta(days=1)
    return cursor


def easter_sunday(year: int) -> dt.date:
    """Return Gregorian Easter Sunday using the Meeus/Jones/Butcher algorithm."""

    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def decide(*, payload: dict[str, Any], event_name: str, now_utc: dt.datetime | None = None) -> dict[str, str]:
    now_utc = ensure_utc(now_utc or dt.datetime.now(dt.UTC))
    event = (event_name or "").strip()
    expected = latest_expected_us_session_date(now_utc)
    generated_kst = parse_timestamp(payload.get("generatedAt"))
    data_as_of = parse_date(payload.get("dataAsOf"))
    local_today = now_utc.astimezone(KST).date()
    cutoff = dt.datetime.combine(local_today, CUTOFF_KST, tzinfo=KST)

    base = {
        "event_name": event or "unknown",
        "expected_data_as_of": expected.isoformat(),
        "actual_data_as_of": data_as_of.isoformat() if data_as_of else "unknown",
        "generated_kst": generated_kst.isoformat() if generated_kst else "unknown",
        "cutoff_kst": cutoff.isoformat(),
        "expected_calendar": "us_equity_regular_session",
    }
    if event == "push":
        return {
            **base,
            "should_collect": "false",
            "should_deploy": "true",
            "freshness_reason": "push_uses_committed_generated_json",
        }
    if event != "schedule":
        return {
            **base,
            "should_collect": "true",
            "should_deploy": "true",
            "freshness_reason": "manual_collects",
        }
    if generated_kst is None or data_as_of is None:
        return {
            **base,
            "should_collect": "true",
            "should_deploy": "true",
            "freshness_reason": "missing_generated_payload",
        }
    if generated_kst >= cutoff and data_as_of >= expected:
        return {
            **base,
            "should_collect": "false",
            "should_deploy": "false",
            "freshness_reason": "fresh_for_kst_window_and_expected_us_session",
        }
    return {
        **base,
        "should_collect": "true",
        "should_deploy": "true",
        "freshness_reason": "stale_or_before_kst_window",
    }


def load_payload(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def parse_timestamp(value: Any) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ensure_utc(parsed).astimezone(KST)


def parse_date(value: Any) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def ensure_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--data-path", type=Path, default=Path("data/sox-analysis.json"))
    parser.add_argument("--now-utc", help="Optional ISO timestamp for deterministic checks")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    now = dt.datetime.fromisoformat(args.now_utc.replace("Z", "+00:00")) if args.now_utc else None
    result = decide(payload=load_payload(args.data_path), event_name=args.event_name, now_utc=now)
    for key, value in result.items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
