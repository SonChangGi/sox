#!/usr/bin/env python3
"""Verify the complete public SOX release and its current data health.

Downloads stay in memory. All seven release files must match the local release
byte for byte, and public analysis must pass the scheduled freshness gate.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
from http.client import HTTPException
import json
import math
from pathlib import Path
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
import uuid

from check_sox_freshness import decide, ensure_utc


PUBLIC_PATHS = (
    "index.html",
    "assets/app.js",
    "assets/styles.css",
    "assets/shared-nav.css",
    "data/sox-analysis.json",
    "data/sox-history.json",
    "data/summary.json",
)
ANALYSIS_PATH = "data/sox-analysis.json"
DEFAULT_BASE_URL = "https://sonchanggi.github.io/sox/"


def public_url(base_url: str, path: str, nonce: str) -> str:
    parts = urlsplit(base_url)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ValueError("base URL must be an absolute HTTP or HTTPS URL")
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("_sox_verify", nonce))
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/") + "/" + path, urlencode(query), ""))


def read_public(url: str, timeout: float) -> bytes:
    request = Request(url, headers={
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache",
        "User-Agent": "sox-publication-verifier/1.0",
        "Accept-Encoding": "identity",
    })
    # urlopen uses normal certificate and hostname verification for HTTPS.
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise ValueError(f"HTTP {response.status}; expected 200")
        return response.read()


def verify_publication(
    *,
    root: Path,
    base_url: str = DEFAULT_BASE_URL,
    attempts: int = 1,
    retry_delay: float = 5,
    timeout: float = 20,
    now_utc: dt.datetime | None = None,
) -> dict[str, Any]:
    """Retry a full readback, returning only the final attempt's result."""
    if attempts < 1 or not math.isfinite(retry_delay) or retry_delay < 0:
        raise ValueError("attempts must be positive and retry delay must be finite and nonnegative")
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be finite and positive")
    public_url(base_url, ANALYSIS_PATH, "validate-url")
    expected_hashes: dict[str, str | None] = {}
    local_errors = []
    for path in PUBLIC_PATHS:
        try:
            expected_hashes[path] = hashlib.sha256((root / path).read_bytes()).hexdigest()
        except OSError as exc:
            expected_hashes[path] = None
            local_errors.append(f"{path}: cannot read local release: {exc}")

    for attempt in range(1, attempts + 1):
        now = ensure_utc(now_utc or dt.datetime.now(dt.UTC))
        errors = list(local_errors)
        paths = {
            path: {"expected_sha256": expected_hashes[path], "actual_sha256": None, "matches": False}
            for path in PUBLIC_PATHS
        }
        analysis_bytes = None
        nonce = f"{uuid.uuid4().hex}-{attempt}"
        # Missing local inputs cannot be repaired by retrying the public site.
        if not local_errors:
            for path in PUBLIC_PATHS:
                try:
                    body = read_public(public_url(base_url, path, nonce), timeout)
                except (HTTPError, URLError, HTTPException, OSError, ValueError) as exc:
                    errors.append(f"{path}: public read failed: {exc}")
                    continue
                actual_hash = hashlib.sha256(body).hexdigest()
                paths[path]["actual_sha256"] = actual_hash
                paths[path]["matches"] = actual_hash == expected_hashes[path]
                if not paths[path]["matches"]:
                    errors.append(f"{path}: SHA256 mismatch")
                if path == ANALYSIS_PATH:
                    analysis_bytes = body

        payload = {}
        if analysis_bytes is not None:
            try:
                parsed = json.loads(analysis_bytes)
                if not isinstance(parsed, dict):
                    raise ValueError("analysis must be a JSON object")
                payload = parsed
            except (ValueError, UnicodeError) as exc:
                errors.append(f"{ANALYSIS_PATH}: invalid public JSON: {exc}")
        freshness = decide(payload=payload, event_name="schedule", now_utc=now)
        if freshness["should_collect"] != "false":
            errors.append(
                "Public analysis is not fresh and healthy: "
                f"expected={freshness['expected_data_as_of']}, "
                f"actual={freshness['actual_data_as_of']}, "
                f"reason={freshness['freshness_reason']}"
            )
        result = {
            "checked_at": now.isoformat().replace("+00:00", "Z"),
            "base_url": base_url,
            "attempt": attempt,
            "max_attempts": attempts,
            "expected_data_as_of": freshness["expected_data_as_of"],
            "actual_data_as_of": freshness["actual_data_as_of"],
            "freshness": freshness,
            "paths": paths,
            "matches": all(item["matches"] for item in paths.values()),
            "errors": errors,
            "ok": not errors,
        }
        print_result(result)
        if result["ok"] or local_errors or attempt == attempts:
            return result
        time.sleep(retry_delay)
    raise AssertionError("positive attempts always produce a result")


def print_result(result: dict[str, Any]) -> None:
    status = "PASS" if result["ok"] else "FAIL"
    print(f"Public release {status} (attempt {result['attempt']}/{result['max_attempts']})")
    print(f"Session date: expected={result['expected_data_as_of']} actual={result['actual_data_as_of']}")
    for path, details in result["paths"].items():
        mark = "MATCH" if details["matches"] else "FAIL"
        print(f"  {mark} {path}")
        print(f"    expected SHA256: {details['expected_sha256'] or 'unavailable'}")
        print(f"    actual   SHA256: {details['actual_sha256'] or 'unavailable'}")
    for error in result["errors"]:
        print(f"  ERROR: {error}")


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return parsed


def finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise argparse.ArgumentTypeError("must be finite")
    return parsed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--attempts", type=positive_int, default=1)
    parser.add_argument("--retry-delay", type=finite_float, default=5)
    parser.add_argument("--timeout", type=finite_float, default=20)
    parser.add_argument("--now-utc", help="Optional ISO timestamp for deterministic checks")
    parser.add_argument("--report", type=Path, help="Save the final result as JSON")
    args = parser.parse_args(argv)
    if args.retry_delay < 0 or args.timeout <= 0:
        parser.error("retry delay must be nonnegative and timeout must be positive")
    if args.now_utc:
        try:
            args.now_utc = dt.datetime.fromisoformat(args.now_utc.replace("Z", "+00:00"))
        except ValueError:
            parser.error("--now-utc must be an ISO timestamp")
    if args.report and args.report.resolve() in {(args.root / path).resolve() for path in PUBLIC_PATHS}:
        parser.error("--report must not overwrite a release file")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = verify_publication(
            root=args.root, base_url=args.base_url, attempts=args.attempts,
            retry_delay=args.retry_delay, timeout=args.timeout, now_utc=args.now_utc,
        )
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except (OSError, ValueError) as exc:
        print(f"Public release verification failed: {exc}")
        return 1
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
