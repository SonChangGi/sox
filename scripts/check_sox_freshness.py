#!/usr/bin/env python3
"""GitHub Actions freshness gate for SOX scheduled retries.

Scheduled runs skip only when the committed generated JSON was produced after
the 06:30 KST automation window and already covers the latest expected U.S.
regular-session date. If the primary run fails to commit data, later cron slots
remain eligible to retry.
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
    while candidate.weekday() >= 5:
        candidate -= dt.timedelta(days=1)
    return candidate


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
    }
    if event == "push":
        return {**base, "should_collect": "false", "freshness_reason": "push_uses_committed_generated_json"}
    if event != "schedule":
        return {**base, "should_collect": "true", "freshness_reason": "manual_collects"}
    if generated_kst is None or data_as_of is None:
        return {**base, "should_collect": "true", "freshness_reason": "missing_generated_payload"}
    if generated_kst >= cutoff and data_as_of >= expected:
        return {**base, "should_collect": "false", "freshness_reason": "fresh_for_kst_window_and_expected_us_session"}
    return {**base, "should_collect": "true", "freshness_reason": "stale_or_before_kst_window"}


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
