#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import datetime as dt
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from test_check_sox_freshness import generated_payload
from verify_publication import ANALYSIS_PATH, PUBLIC_PATHS, main, verify_publication


NOW = dt.datetime(2026, 7, 9, 4, 31, tzinfo=dt.UTC)


class PublicResponse(io.BytesIO):
    status = 200


class PublicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.local = {path: f"release bytes: {path}".encode() for path in PUBLIC_PATHS}
        self.local[ANALYSIS_PATH] = self.analysis_bytes("2026-07-08")
        for path, body in self.local.items():
            destination = self.root / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(body)
        self.stdout = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.stdout))

    def analysis_bytes(self, data_as_of: str) -> bytes:
        return json.dumps(generated_payload(
            generated_at="2026-07-08T23:38:21Z", data_as_of=data_as_of,
        )).encode()

    def downloader(self, bodies: dict[str, bytes | Exception]):
        def download(request, *, timeout):
            path = urlsplit(request.full_url).path.removeprefix("/sox/")
            body = bodies[path]
            if isinstance(body, Exception):
                raise body
            return PublicResponse(body)
        return download

    def verify(self, bodies: dict[str, bytes | Exception], **kwargs):
        with patch("verify_publication.urlopen", side_effect=self.downloader(bodies)) as opened:
            result = verify_publication(root=self.root, now_utc=NOW, **kwargs)
        self.assertEqual({path: (self.root / path).read_bytes() for path in PUBLIC_PATHS}, self.local)
        return result, opened

    def test_matching_healthy_release_checks_all_files_and_cache_headers(self) -> None:
        result, opened = self.verify(self.local)
        self.assertTrue(result["ok"])
        self.assertTrue(result["matches"])
        self.assertEqual(result["actual_data_as_of"], "2026-07-08")
        self.assertEqual(opened.call_count, 7)
        for call in opened.call_args_list:
            request = call.args[0]
            self.assertEqual(request.get_header("Cache-control"), "no-cache, no-store, max-age=0")
            self.assertEqual(request.get_header("Pragma"), "no-cache")
            self.assertTrue(parse_qs(urlsplit(request.full_url).query)["_sox_verify"][0])
            self.assertEqual(call.kwargs, {"timeout": 20})

    def test_http_200_with_stale_analysis_fails(self) -> None:
        bodies = {**self.local, ANALYSIS_PATH: self.analysis_bytes("2026-07-07")}
        result, _ = self.verify(bodies)
        self.assertFalse(result["ok"])
        self.assertEqual(result["actual_data_as_of"], "2026-07-07")
        self.assertEqual(result["expected_data_as_of"], "2026-07-08")
        self.assertTrue(any("not fresh and healthy" in error for error in result["errors"]))

    def test_matching_stale_release_still_fails_freshness(self) -> None:
        self.local[ANALYSIS_PATH] = self.analysis_bytes("2026-07-07")
        (self.root / ANALYSIS_PATH).write_bytes(self.local[ANALYSIS_PATH])
        result, _ = self.verify(self.local)
        self.assertTrue(result["matches"])
        self.assertFalse(result["ok"])

    def test_bad_analysis_json_fails_without_modifying_release(self) -> None:
        for invalid in (b"{bad json", b"[]", b"\xff"):
            with self.subTest(invalid=invalid):
                result, _ = self.verify({**self.local, ANALYSIS_PATH: invalid})
                self.assertFalse(result["ok"])
                self.assertTrue(any("invalid public JSON" in error for error in result["errors"]))

    def test_missing_public_history_fails_and_other_files_are_checked(self) -> None:
        result, opened = self.verify({
            **self.local,
            "data/sox-history.json": HTTPError("https://example.invalid/history", 404, "Not Found", {}, None),
        })
        self.assertFalse(result["ok"])
        self.assertEqual(opened.call_count, 7)
        self.assertIsNone(result["paths"]["data/sox-history.json"]["actual_sha256"])
        self.assertTrue(any("404" in error for error in result["errors"]))

    def test_one_asset_mismatch_fails_with_healthy_analysis(self) -> None:
        result, _ = self.verify({**self.local, "assets/app.js": b"old javascript"})
        self.assertFalse(result["ok"])
        self.assertEqual(result["freshness"]["should_collect"], "false")
        self.assertEqual(result["errors"], ["assets/app.js: SHA256 mismatch"])

    def test_retry_rereads_entire_release_and_recovers_with_new_nonce(self) -> None:
        first = self.downloader({**self.local, "assets/app.js": b"old javascript"})
        second = self.downloader(self.local)
        requests = []
        def download(request, *, timeout):
            requests.append(request)
            return (first if len(requests) <= 7 else second)(request, timeout=timeout)
        with patch("verify_publication.urlopen", side_effect=download), patch("verify_publication.time.sleep") as slept:
            result = verify_publication(root=self.root, attempts=3, retry_delay=0.1, now_utc=NOW)
        self.assertTrue(result["ok"])
        self.assertEqual(result["attempt"], 2)
        self.assertEqual(len(requests), 14)
        self.assertNotEqual(urlsplit(requests[0].full_url).query, urlsplit(requests[7].full_url).query)
        slept.assert_called_once_with(0.1)

    def test_persistent_transport_failure_stops_at_bound(self) -> None:
        with patch("verify_publication.time.sleep") as slept:
            result, opened = self.verify({path: URLError("network unavailable") for path in PUBLIC_PATHS}, attempts=2)
        self.assertFalse(result["ok"])
        self.assertEqual(result["attempt"], 2)
        self.assertEqual(opened.call_count, 14)
        slept.assert_called_once_with(5)

    def test_missing_local_file_does_not_start_public_readback(self) -> None:
        (self.root / "data/sox-history.json").unlink()
        with patch("verify_publication.urlopen") as opened:
            result = verify_publication(root=self.root, attempts=3, now_utc=NOW)
        self.assertFalse(result["ok"])
        self.assertEqual(result["attempt"], 1)
        opened.assert_not_called()

    def test_truncated_http_body_is_a_readback_failure(self) -> None:
        result, opened = self.verify({**self.local, "index.html": IncompleteRead(b"partial", 100)})
        self.assertFalse(result["ok"])
        self.assertEqual(opened.call_count, 7)
        self.assertTrue(any("IncompleteRead" in error for error in result["errors"]))

    def test_cli_records_final_report_and_exit_code(self) -> None:
        report = self.root / "reports/publication.json"
        argv = ["--root", str(self.root), "--now-utc", NOW.isoformat(), "--report", str(report)]
        with patch("verify_publication.urlopen", side_effect=self.downloader(self.local)):
            self.assertEqual(main(argv), 0)
        self.assertTrue(json.loads(report.read_text())["ok"])
        with patch("verify_publication.urlopen", side_effect=self.downloader({**self.local, "index.html": b"old html"})):
            self.assertEqual(main(argv), 1)
        saved = json.loads(report.read_text())
        self.assertFalse(saved["ok"])
        self.assertEqual(saved["checked_at"], "2026-07-09T04:31:00Z")
        self.assertEqual(set(saved["paths"]), set(PUBLIC_PATHS))

    def test_report_cannot_overwrite_release_file(self) -> None:
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            main(["--root", str(self.root), "--report", str(self.root / ANALYSIS_PATH)])
        self.assertEqual((self.root / ANALYSIS_PATH).read_bytes(), self.local[ANALYSIS_PATH])


if __name__ == "__main__":
    unittest.main()
