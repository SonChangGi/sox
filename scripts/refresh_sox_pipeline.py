#!/usr/bin/env python3
"""Collect in isolation, verify, then atomically promote a healthy current bundle."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from check_sox_freshness import decide
from fetch_sox_data import write_publication

ROOT = Path(__file__).resolve().parents[1]
FILES = ("sox-analysis.json", "sox-history.json", "summary.json")


def refresh(*, root: Path, data_dir: Path, attempts: int, retry_delay: float) -> int:
    # Candidates live outside the website tree and never replace the published
    # bundle until collection, complete tests, and the final date gate pass.
    with tempfile.TemporaryDirectory(prefix="sox-candidate-") as temporary:
        candidate = Path(temporary)
        command = [
            sys.executable, str(root / "scripts/fetch_sox_data.py"),
            "--fail-on-degraded", "--require-current", "--output-dir", str(candidate),
            "--history-source-dir", str(data_dir),
        ]
        for attempt in range(1, attempts + 1):
            print(f"SOX collection attempt {attempt}/{attempts}", flush=True)
            result = subprocess.run(command, cwd=root, check=False)
            if result.returncode == 0:
                break
            if attempt == attempts:
                print("Collection did not produce current healthy data; existing JSON preserved.", file=sys.stderr)
                return result.returncode
            time.sleep(retry_delay)

        result = subprocess.run(
            ["npm", "test"], cwd=root, check=False,
            env={**os.environ, "SOX_DATA_DIR": str(candidate)},
        )
        if result.returncode:
            print("Candidate verification failed; existing JSON preserved.", file=sys.stderr)
            return result.returncode

        payloads = {name: json.loads((candidate / name).read_text(encoding="utf-8")) for name in FILES}
        decision = decide(payload=payloads[FILES[0]], event_name="schedule")
        for key, value in decision.items():
            print(f"{key}={value}", flush=True)
        if decision["should_collect"] != "false":
            print("Candidate is not fresh at promotion time; existing JSON preserved.", file=sys.stderr)
            return 2
        write_publication(data_dir, payloads)
        print("Current verified SOX bundle promoted; ready for commit and deployment.", flush=True)
        return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--retry-delay", type=float, default=30)
    args = parser.parse_args(argv)
    if not 1 <= args.attempts <= 5 or not 0 <= args.retry_delay <= 120:
        parser.error("attempts must be 1..5 and retry-delay must be 0..120 seconds")
    try:
        return refresh(root=ROOT, data_dir=args.data_dir.resolve(), attempts=args.attempts, retry_delay=args.retry_delay)
    except (OSError, ValueError) as exc:
        print(f"SOX refresh failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
