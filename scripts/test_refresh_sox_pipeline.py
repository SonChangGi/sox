from contextlib import redirect_stderr, redirect_stdout
import datetime as dt
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import refresh_sox_pipeline as pipeline
from check_sox_freshness import decide
from test_check_sox_freshness import generated_payload


class RefreshPipelineTests(unittest.TestCase):
    def exercise(self, *, collection_codes=(0,), verification_code=0, stale=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data"
            data.mkdir()
            original = {name: b'{"original": true}\n' for name in pipeline.FILES}
            for name, content in original.items():
                (data / name).write_bytes(content)
            now = dt.datetime(2026, 9, 18, 3, tzinfo=dt.UTC)
            payload = generated_payload(generated_at="2026-09-18T00:30:00Z", data_as_of="2026-09-16" if stale else "2026-09-17")
            calls = []
            collection_count = 0

            def run(command, **kwargs):
                nonlocal collection_count
                calls.append(command)
                if command[0] == "npm":
                    # Verification must see candidate bytes while the last
                    # good bundle is still unchanged.
                    self.assertEqual({name: (data / name).read_bytes() for name in pipeline.FILES}, original)
                    candidate = Path(kwargs["env"]["SOX_DATA_DIR"])
                    self.assertEqual(json.loads((candidate / pipeline.FILES[0]).read_text()), payload)
                    return subprocess.CompletedProcess(command, verification_code)
                self.assertIn("--fail-on-degraded", command)
                self.assertIn("--require-current", command)
                self.assertNotIn("--offline-ok", command)
                code = collection_codes[min(collection_count, len(collection_codes) - 1)]
                collection_count += 1
                if code == 0:
                    candidate = Path(command[command.index("--output-dir") + 1])
                    for name in pipeline.FILES:
                        (candidate / name).write_text(json.dumps(payload))
                return subprocess.CompletedProcess(command, code)

            with patch.object(pipeline.subprocess, "run", side_effect=run), patch.object(pipeline.time, "sleep") as sleep, patch.object(pipeline, "decide", side_effect=lambda **kwargs: decide(**kwargs, now_utc=now)), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                code = pipeline.refresh(root=root, data_dir=data, attempts=3, retry_delay=30)
            current = {name: (data / name).read_bytes() for name in pipeline.FILES}
            return code, original, current, calls, sleep.call_count

    def test_exhausted_collection_preserves_good_bundle_and_never_verifies(self):
        code, original, current, calls, sleeps = self.exercise(collection_codes=(2,))
        self.assertNotEqual(code, 0)
        self.assertEqual(current, original)
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, 2)

    def test_failed_verification_does_not_promote_or_retry_bad_candidate(self):
        code, original, current, calls, sleeps = self.exercise(verification_code=1)
        self.assertNotEqual(code, 0)
        self.assertEqual(current, original)
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, 0)

    def test_retry_can_recover_then_promote_verified_bundle(self):
        code, original, current, calls, sleeps = self.exercise(collection_codes=(2, 0))
        self.assertEqual(code, 0)
        self.assertNotEqual(current, original)
        self.assertEqual(json.loads(current[pipeline.FILES[0]])["dataAsOf"], "2026-09-17")
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, 1)

    def test_stale_but_ok_payload_never_promotes_even_after_passing_tests(self):
        code, original, current, _, _ = self.exercise(stale=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(current, original)


if __name__ == "__main__":
    unittest.main()
