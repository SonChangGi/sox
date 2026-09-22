#!/usr/bin/env python3
"""GitHub Actions freshness gate for SOX scheduled retries.

Scheduled runs skip only when the committed generated JSON was produced after
the 06:30 KST automation window and already covers the latest expected U.S.
regular-session date. If the primary run fails to commit data, later cron slots
remain eligible to retry. The workflow separately verifies the public release
before skipping deployment, so a failed delivery remains recoverable.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sox_data_quality import collect_data_quality_failures

KST = ZoneInfo("Asia/Seoul")
CUTOFF_KST = dt.time(hour=6, minute=30)


def latest_expected_us_session_date(now_utc: dt.datetime) -> dt.date:
    local_now = ensure_utc(now_utc).astimezone(KST)
    # The production window begins at 06:30 KST, after both DST and standard
    # U.S. closes. Before it opens, do not require an unfinished/new session.
    window_date = local_now.date()
    if local_now.time() < CUTOFF_KST:
        window_date -= dt.timedelta(days=1)
    candidate = window_date - dt.timedelta(days=1)
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
        nth_weekday(year, 1, 0, 3): "martin_luther_king_jr_day",
        nth_weekday(year, 2, 0, 3): "washingtons_birthday",
        easter_sunday(year) - dt.timedelta(days=2): "good_friday",
        last_weekday(year, 5, 0): "memorial_day",
        observed_fixed_holiday(year, 7, 4): "independence_day",
        nth_weekday(year, 9, 0, 1): "labor_day",
        nth_weekday(year, 11, 3, 4): "thanksgiving_day",
        observed_fixed_holiday(year, 12, 25): "christmas_day",
    }
    # NYSE stays open on Dec 31 when Jan 1 is a Saturday (e.g. 2021).
    new_year = dt.date(year, 1, 1)
    if new_year.weekday() != 5:
        holidays[new_year + dt.timedelta(days=1) if new_year.weekday() == 6 else new_year] = "new_years_day"
    if year == 2025:
        holidays[dt.date(2025, 1, 9)] = "national_day_of_mourning"
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
    status = payload.get("status")
    status_level = (
        str(status.get("level") or "").strip().lower()
        if isinstance(status, dict)
        else ""
    )
    # A Friday snapshot remains current over the weekend and Monday. A new
    # collection timestamp alone must never make an old trading date current.
    cutoff = dt.datetime.combine(expected + dt.timedelta(days=1), CUTOFF_KST, tzinfo=KST)

    base = {
        "event_name": event or "unknown",
        "expected_data_as_of": expected.isoformat(),
        "actual_data_as_of": data_as_of.isoformat() if data_as_of else "unknown",
        "generated_kst": generated_kst.isoformat() if generated_kst else "unknown",
        "cutoff_kst": cutoff.isoformat(),
        "expected_calendar": "us_equity_regular_session",
        "status_level": status_level or "unknown",
    }
    if event not in {"schedule", "push", "workflow_dispatch"}:
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
    index = payload.get("index")
    index = index if isinstance(index, dict) else {}
    quality_failures = collect_data_quality_failures(
        payload.get("constituents"),
        index.get("constituentSource", {}),
        data_as_of=payload.get("dataAsOf"),
    )
    if isinstance(status, dict) and status.get("failures"):
        quality_failures.append("Payload status records source failures")
    base["quality_failure_count"] = str(len(quality_failures))
    if data_as_of > expected or generated_kst > now_utc.astimezone(KST):
        return {
            **base,
            "should_collect": "true",
            "should_deploy": "true",
            "freshness_reason": "future_session_or_generation",
        }
    if generated_kst >= cutoff and data_as_of == expected and status_level == "ok" and not quality_failures:
        return {
            **base,
            "should_collect": "false",
            "should_deploy": "true" if event == "push" else "false",
            "freshness_reason": "fresh_for_kst_window_and_expected_us_session",
        }
    if generated_kst >= cutoff and data_as_of >= expected and status_level == "ok":
        return {
            **base,
            "should_collect": "true",
            "should_deploy": "true",
            "freshness_reason": "current_date_but_data_quality_not_ok",
        }
    if generated_kst >= cutoff and data_as_of >= expected:
        return {
            **base,
            "should_collect": "true",
            "should_deploy": "true",
            "freshness_reason": "current_date_but_status_not_ok",
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
    parser.add_argument("--require-fresh", action="store_true", help="Fail unless the payload passes the scheduled freshness and quality gates.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    now = dt.datetime.fromisoformat(args.now_utc.replace("Z", "+00:00")) if args.now_utc else None
    payload = load_payload(args.data_path)
    result = decide(payload=payload, event_name=args.event_name, now_utc=now)
    for key, value in result.items():
        print(f"{key}={value}")
    if args.require_fresh and decide(payload=payload, event_name="schedule", now_utc=now)["should_collect"] != "false":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
